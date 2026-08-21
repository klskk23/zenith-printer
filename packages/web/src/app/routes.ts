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

export const TAB_KINDS = [
  'index',
  'design',
  'templates',
  'printers',
  'queue',
  'history',
  'settings',
] as const

export type TabKind = (typeof TAB_KINDS)[number]

export interface TabDescriptor {
  kind: TabKind
  /** Designs only. `null` is an unsaved blank design. */
  templateId?: string | null
}

/** Kinds that exist at most once; opening again switches to the open one. */
const SINGLETON_KINDS = new Set<TabKind>([
  'index',
  'templates',
  'printers',
  'queue',
  'history',
  'settings',
])

export function isSingletonKind(kind: TabKind): boolean {
  return SINGLETON_KINDS.has(kind)
}

const STATIC_PATHS: Record<Exclude<TabKind, 'design'>, string> = {
  index: '/',
  templates: '/templates',
  printers: '/printers',
  queue: '/queue',
  history: '/history',
  settings: '/settings',
}

export function pathForTab(descriptor: TabDescriptor): string {
  if (descriptor.kind === 'design') {
    // An unsaved design has no id to put in the address, so it gets a name of
    // its own rather than leaving the address pointing at the previous tab.
    const id = descriptor.templateId
    return id === null || id === undefined ? '/design/new' : `/design/${id}`
  }
  return STATIC_PATHS[descriptor.kind]
}

/** `null` for an address this app does not serve — the caller decides what to do. */
export function tabFromPath(path: string): TabDescriptor | null {
  const normalised = path.length > 1 ? path.replace(/\/+$/, '') : path

  for (const [kind, value] of Object.entries(STATIC_PATHS)) {
    if (value === normalised) {
      return { kind: kind as TabKind }
    }
  }

  const design = /^\/design\/([^/]+)$/.exec(normalised)
  if (design !== null) {
    const id = design[1]!
    return { kind: 'design', templateId: id === 'new' ? null : id }
  }

  return null
}
