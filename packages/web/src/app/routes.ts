/**
 * Path <-> tab mapping.
 *
 * The address bar projects *which tab is active*. It deliberately does not
 * decide which tabs exist: the tab set is application state, and letting the
 * router own it would unmount the inactive ones, discarding the selection,
 * zoom and undo history that switching back is supposed to restore.
 *
 * Only one tab fits in an address, so a refresh restores one tab. That is the
 * accepted trade for links being shareable.
 */

/**
 * Also the sidebar's order, top to bottom.
 *
 * Settings sits last because it is where somebody goes once and then rarely
 * again — the day-to-day entries should not be below it.
 */
export const TAB_KINDS = [
  'index',
  'design',
  'templates',
  'data-sources',
  'printers',
  'queue',
  'history',
  // Below the day-to-day entries: a preset is set up once and then used by
  // something other than a person.
  'print-presets',
  // Developer-facing, so it sits below the day-to-day entries and above
  // settings — which is still the thing people visit once.
  'api-docs',
  'settings',
  // Never in the sidebar: the editor needs a table to open, and an entry that
  // opened an empty one would be a dead end. Reached from the list instead.
  'data-source',
] as const

export type TabKind = (typeof TAB_KINDS)[number]

export interface TabDescriptor {
  kind: TabKind
  /** Designs only. `null` is an unsaved blank design. */
  templateId?: string | null
  /** Data source editor only. */
  dataSourceId?: string
  /**
   * Designs only: a print preset to open with, from `?preset=` in the address.
   *
   * An **initial value, not another kind of tab**. A link that carries one
   * means "take me there with the settings already set" — the printer, the
   * profile and the copies the preset records, which otherwise sit at their
   * defaults however the design was reached. Once somebody changes any of
   * them, the preset has had its say.
   *
   * It stays in the address so a refresh, a back and a forward all arrive at
   * the same place rather than at the same design with the settings quietly
   * back to default.
   */
  presetId?: string
}

/** Kinds that exist at most once; opening again switches to the open one. */
const SINGLETON_KINDS = new Set<TabKind>([
  'index',
  'templates',
  'printers',
  'queue',
  'history',
  // Developer-facing, so it sits below the day-to-day entries and above
  // settings — which is still the thing people visit once.
  'api-docs',
  'settings',
  'data-sources',
  'print-presets',
])

export function isSingletonKind(kind: TabKind): boolean {
  return SINGLETON_KINDS.has(kind)
}

const STATIC_PATHS: Record<Exclude<TabKind, 'design' | 'data-source'>, string> = {
  index: '/',
  templates: '/templates',
  printers: '/printers',
  queue: '/queue',
  history: '/history',
  'api-docs': '/api-docs',
  'print-presets': '/print-presets',
  settings: '/settings',
  'data-sources': '/data-sources',
}

export function pathForTab(descriptor: TabDescriptor): string {
  if (descriptor.kind === 'data-source') {
    return `/data-sources/${descriptor.dataSourceId ?? ''}`
  }
  if (descriptor.kind === 'design') {
    // An unsaved design has no id to put in the address, so it gets a name of
    // its own rather than leaving the address pointing at the previous tab.
    const id = descriptor.templateId
    const path = id === null || id === undefined ? '/design/new' : `/design/${id}`
    return descriptor.presetId === undefined
      ? path
      : `${path}?preset=${encodeURIComponent(descriptor.presetId)}`
  }
  return STATIC_PATHS[descriptor.kind]
}

/**
 * `null` for an address this app does not serve — the caller decides what to do.
 *
 * Takes the whole address, path and query together, because the query carries
 * `?preset=`. Reading only `location.pathname` is what made a preset link open
 * the right design with none of its settings.
 */
export function tabFromPath(address: string): TabDescriptor | null {
  const [path = '', query = ''] = address.split('?', 2)
  const normalised = path.length > 1 ? path.replace(/\/+$/, '') : path
  // An empty value is no preset, not a preset with an empty id.
  const preset = new URLSearchParams(query).get('preset')?.trim() ?? ''

  for (const [kind, value] of Object.entries(STATIC_PATHS)) {
    if (value === normalised) {
      return { kind: kind as TabKind }
    }
  }

  const source = /^\/data-sources\/([^/]+)$/.exec(normalised)
  if (source !== null) {
    return { kind: 'data-source', dataSourceId: source[1]! }
  }

  const design = /^\/design\/([^/]+)$/.exec(normalised)
  if (design !== null) {
    const id = design[1]!
    return {
      kind: 'design',
      templateId: id === 'new' ? null : id,
      // Only designs: a `?preset=` on any other address would be carried into
      // one that has no use for it.
      ...(preset === '' ? {} : { presetId: preset }),
    }
  }

  return null
}
