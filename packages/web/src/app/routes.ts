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
 * A label's three steps, in order.
 *
 * One label, three places to stand: lay it out, choose what to print, look
 * once before the paper moves. They share a session — the content on the
 * canvas, the machine, the chosen rows — so they are named as a group wherever
 * that session is what matters (staying mounted, asking about unsaved work).
 */
export const LABEL_KINDS = ['label', 'label-print', 'label-confirm'] as const

/**
 * Every page: the sidebar's, a label's three steps, the data source editor
 * (it needs a thing to open), and the API console.
 */
export const PAGE_KINDS = [...SIDEBAR_KINDS, ...LABEL_KINDS, 'data-source', 'api-docs'] as const

export type PageKind = (typeof PAGE_KINDS)[number]

export type LabelKind = (typeof LABEL_KINDS)[number]

export const isLabelKind = (kind: PageKind): kind is LabelKind =>
  (LABEL_KINDS as readonly string[]).includes(kind)

/** Which step of a label an address names; `null` for pages that are not one. */
export const stepOf = (kind: PageKind): 'design' | 'print' | 'confirm' | null =>
  kind === 'label' ? 'design' : kind === 'label-print' ? 'print' : kind === 'label-confirm' ? 'confirm' : null

export interface PageDescriptor {
  kind: PageKind
  /** A label's three steps. `null` is a label not yet saved. */
  templateId?: string | null
  /** Data source editor only. */
  dataSourceId?: string
  /**
   * A label's steps only: a print preset to open with, from `?preset=`.
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
  if (isLabelKind(descriptor.kind)) {
    const id = descriptor.templateId
    const base = id === null || id === undefined ? '/labels/new' : `/labels/${id}`
    const step = descriptor.kind === 'label-print' ? '/print' : descriptor.kind === 'label-confirm' ? '/confirm' : ''
    return descriptor.presetId === undefined
      ? `${base}${step}`
      : `${base}${step}?preset=${encodeURIComponent(descriptor.presetId)}`
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

function label(kind: LabelKind, templateId: string | null, preset: string): PageDescriptor {
  return { kind, templateId, ...(preset === '' ? {} : { presetId: preset }) }
}

const STEP_KINDS: Record<string, LabelKind> = { print: 'label-print', confirm: 'label-confirm' }

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

  // New form: /labels/:id, /labels/new, plus /print and /confirm under either.
  // Old form: /design/:id, /design, /design/new (and /design/new/<anything>).
  const editor = /^\/(?:labels|design)(?:\/([^/]+))?(?:\/([^/]+))?$/.exec(path)
  if (editor !== null) {
    const id = editor[1]
    const tail = editor[2]
    if (id === undefined || id === 'new') {
      // `/design/new/<draft id>` was an interim form; it is still a new label.
      // `/labels/new/print` is a step, and an unsaved label can be printed —
      // the job carries the content, not an id.
      const step = tail === undefined ? undefined : STEP_KINDS[tail]
      if (tail !== undefined && step === undefined) {
        return path.startsWith('/design/') ? label('label', null, preset) : null
      }
      return label(step ?? 'label', null, preset)
    }
    if (tail !== undefined) {
      const step = STEP_KINDS[tail]
      return step === undefined ? null : label(step, id, preset)
    }
    // The ledger's links carry `?preset=`, which says "the machine, the
    // settings and the count are already chosen". That is the language of
    // printing: send those to the print step rather than into the editor.
    const wantsPrint = preset !== '' && path.startsWith('/design/')
    return label(wantsPrint ? 'label-print' : 'label', id, preset)
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
