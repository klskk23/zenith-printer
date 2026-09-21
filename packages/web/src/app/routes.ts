/**
 * Address <-> page.
 *
 * One page is open at a time and the address names it. `?preset=` rides on a
 * label's address and nowhere else: it decides which printer, profile and
 * copy count a label opens with, and any other page would have no use for it.
 *
 * The addresses the previous design used still resolve. The asset ledger has
 * been handing out `/design/{templateId}?preset=…` links (docs/nexus-assets.md),
 * and a link that stops working is a breaking change whatever the changelog
 * says — so those are read here and rewritten to the new form by the
 * workspace, query intact.
 */

/**
 * The sidebar, top to bottom. Settings last: visited once. The API console
 * is not here — it is a developer's page, reached from settings.
 */
export const SIDEBAR_KINDS = [
  'labels',
  'data-sources',
  'printers',
  'queue',
  'history',
  'print-presets',
  'settings',
] as const

/**
 * Every page: the sidebar's, the two reached from a list (a label's editor
 * and a data source's editor both need a thing to open), and the API console.
 */
export const PAGE_KINDS = [...SIDEBAR_KINDS, 'label', 'data-source', 'api-docs'] as const

export type PageKind = (typeof PAGE_KINDS)[number]

export interface PageDescriptor {
  kind: PageKind
  /** Labels only. `null` is a label not yet saved. */
  templateId?: string | null
  /** Data source editor only. */
  dataSourceId?: string
  /**
   * Labels only: a print preset to open with, from `?preset=`.
   *
   * An initial value, not a page of its own: "take me there with the settings
   * already set". Once somebody changes any of them, the preset has had its say.
   */
  presetId?: string
}

const STATIC_PATHS: Record<(typeof SIDEBAR_KINDS)[number] | 'api-docs', string> = {
  labels: '/',
  'data-sources': '/data-sources',
  printers: '/printers',
  queue: '/queue',
  history: '/history',
  'print-presets': '/print-presets',
  settings: '/settings',
  'api-docs': '/api-docs',
}

export function pathForPage(descriptor: PageDescriptor): string {
  if (descriptor.kind === 'data-source') {
    return `/data-sources/${descriptor.dataSourceId ?? ''}`
  }
  if (descriptor.kind === 'label') {
    const id = descriptor.templateId
    const path = id === null || id === undefined ? '/labels/new' : `/labels/${id}`
    return descriptor.presetId === undefined
      ? path
      : `${path}?preset=${encodeURIComponent(descriptor.presetId)}`
  }
  return STATIC_PATHS[descriptor.kind]
}

function split(address: string): { path: string; preset: string } {
  const [raw = '', query = ''] = address.split('?', 2)
  const path = raw.length > 1 ? raw.replace(/\/+$/, '') : raw
  // An empty value is no preset, not a preset with an empty id.
  const preset = new URLSearchParams(query).get('preset')?.trim() ?? ''
  return { path, preset }
}

function label(templateId: string | null, preset: string): PageDescriptor {
  return { kind: 'label', templateId, ...(preset === '' ? {} : { presetId: preset }) }
}

/**
 * `null` for an address this app does not serve — the caller decides what to do.
 *
 * Takes the whole address, path and query together, because the query carries
 * `?preset=`.
 */
export function pageFromPath(address: string): PageDescriptor | null {
  const { path, preset } = split(address)

  for (const [kind, value] of Object.entries(STATIC_PATHS)) {
    if (value === path) {
      return { kind: kind as PageKind }
    }
  }

  const source = /^\/data-sources\/([^/]+)$/.exec(path)
  if (source !== null) {
    return { kind: 'data-source', dataSourceId: source[1]! }
  }

  // New form: /labels/:id, /labels/new
  // Old form: /design/:id, /design, /design/new (and /design/new/<anything>)
  const editor = /^\/(?:labels|design)(?:\/([^/]+))?(?:\/([^/]+))?$/.exec(path)
  if (editor !== null) {
    const id = editor[1]
    if (id === undefined || id === 'new') {
      return label(null, preset)
    }
    if (editor[2] !== undefined) {
      return null
    }
    return label(id, preset)
  }

  if (path === '/templates') {
    return { kind: 'labels' }
  }

  return null
}

/** An address from before, which the workspace rewrites to the new one. */
export function isLegacyAddress(address: string): boolean {
  const { path } = split(address)
  return path === '/templates' || path === '/design' || path.startsWith('/design/')
}
