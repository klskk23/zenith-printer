/**
 * Address ↔ page.
 *
 * There is one page at a time now, and the address names it. Two things are
 * pinned beyond the round trip: `?preset=` rides on a label's address and
 * nowhere else, and the addresses the last design used — `/design/…`,
 * `/templates` — still resolve, because the asset ledger has been handing
 * out `/design/{id}?preset=…` links and a link that stops working is a
 * breaking change whatever the changelog says.
 */
import { describe, expect, it } from 'vitest'
import { LABEL_KINDS, PAGE_KINDS, SIDEBAR_KINDS, isLegacyAddress, pageFromPath, pathForPage } from '../src/app/routes.ts'

describe('the page set', () => {
  it('has the seven sidebar entries in the fixed order', () => {
    expect([...SIDEBAR_KINDS]).toEqual([
      'labels', 'data-sources', 'printers', 'queue', 'history', 'print-presets', 'settings',
    ])
  })

  it('keeps the API console reachable by address, out of the sidebar', () => {
    expect((PAGE_KINDS as readonly string[]).includes('api-docs')).toBe(true)
    expect((SIDEBAR_KINDS as readonly string[]).includes('api-docs')).toBe(false)
    expect(pageFromPath('/api-docs')).toEqual({ kind: 'api-docs' })
  })

  it('has no home, library or design kind', () => {
    for (const gone of ['index', 'templates', 'design']) {
      expect((PAGE_KINDS as readonly string[]).includes(gone)).toBe(false)
    }
  })
})

describe('pathForPage', () => {
  it('puts the gallery at the root', () => {
    expect(pathForPage({ kind: 'labels' })).toBe('/')
  })

  it('names a saved label by id', () => {
    expect(pathForPage({ kind: 'label', templateId: 'tpl-1' })).toBe('/labels/tpl-1')
  })

  it('names a new label plainly', () => {
    expect(pathForPage({ kind: 'label', templateId: null })).toBe('/labels/new')
  })

  it('carries a preset on a label only', () => {
    expect(pathForPage({ kind: 'label', templateId: 'tpl-1', presetId: 'p 1' })).toBe('/labels/tpl-1?preset=p%201')
    expect(pathForPage({ kind: 'printers', presetId: 'p1' } as never)).toBe('/printers')
  })

  it('names the print and confirm steps of a label', () => {
    expect(pathForPage({ kind: 'label-print', templateId: 'tpl-1' })).toBe('/labels/tpl-1/print')
    expect(pathForPage({ kind: 'label-confirm', templateId: 'tpl-1' })).toBe('/labels/tpl-1/confirm')
  })

  it('names those steps for a label nobody has saved yet', () => {
    // Printing an unsaved design works — the job carries the content, not an
    // id — so the step needs an address of its own.
    expect(pathForPage({ kind: 'label-print', templateId: null })).toBe('/labels/new/print')
    expect(pathForPage({ kind: 'label-confirm', templateId: null })).toBe('/labels/new/confirm')
  })

  it('carries a preset on the print step too', () => {
    expect(pathForPage({ kind: 'label-print', templateId: 'tpl-1', presetId: 'pre-1' }))
      .toBe('/labels/tpl-1/print?preset=pre-1')
  })

  it('names a data source by id', () => {
    expect(pathForPage({ kind: 'data-source', dataSourceId: 'ds-1' })).toBe('/data-sources/ds-1')
  })
})

describe('pageFromPath', () => {
  it('reads every static page back', () => {
    for (const kind of SIDEBAR_KINDS) {
      expect(pageFromPath(pathForPage({ kind }))).toEqual({ kind })
    }
  })

  it('reads a saved label with its preset', () => {
    expect(pageFromPath('/labels/tpl-1?preset=pre-1')).toEqual({ kind: 'label', templateId: 'tpl-1', presetId: 'pre-1' })
  })

  it('reads the print and confirm steps back', () => {
    for (const kind of ['label-print', 'label-confirm'] as const) {
      for (const templateId of ['tpl-1', null]) {
        const page = { kind, templateId }
        expect(pageFromPath(pathForPage(page))).toEqual(page)
      }
    }
  })

  it('reads a preset off the print step', () => {
    expect(pageFromPath('/labels/tpl-1/print?preset=pre-1'))
      .toEqual({ kind: 'label-print', templateId: 'tpl-1', presetId: 'pre-1' })
  })

  it('serves no other step under a label', () => {
    expect(pageFromPath('/labels/tpl-1/whatever')).toBeNull()
  })

  it('names the three label steps as one group', () => {
    expect([...LABEL_KINDS]).toEqual(['label', 'label-print', 'label-confirm'])
  })

  it('reads a new label', () => {
    expect(pageFromPath('/labels/new')).toEqual({ kind: 'label', templateId: null })
  })

  it('treats an empty preset as none', () => {
    expect(pageFromPath('/labels/tpl-1?preset=')).toEqual({ kind: 'label', templateId: 'tpl-1' })
  })

  it('ignores a trailing slash', () => {
    expect(pageFromPath('/printers/')).toEqual({ kind: 'printers' })
  })

  it('returns null for an address it does not serve', () => {
    expect(pageFromPath('/nope')).toBeNull()
  })
})

describe('addresses from before', () => {
  it('sends /templates to the gallery', () => {
    expect(pageFromPath('/templates')).toEqual({ kind: 'labels' })
  })

  it('sends /design/{id}?preset= to that label’s print step', () => {
    // A preset means "the machine, the settings and the count are already
    // chosen" — that is the language of printing, not of laying out. The
    // ledger hands these out from a device page; the person clicking wants to
    // print, not to edit.
    expect(pageFromPath('/design/tpl-7?preset=pre-1'))
      .toEqual({ kind: 'label-print', templateId: 'tpl-7', presetId: 'pre-1' })
  })

  it('sends a bare /design/{id} to the design step, as before', () => {
    expect(pageFromPath('/design/tpl-7')).toEqual({ kind: 'label', templateId: 'tpl-7' })
  })

  it('sends /design and /design/new to a new label', () => {
    expect(pageFromPath('/design')).toEqual({ kind: 'label', templateId: null })
    expect(pageFromPath('/design/new')).toEqual({ kind: 'label', templateId: null })
    // The interim form that carried a draft id: still a new label.
    expect(pageFromPath('/design/new/d-1')).toEqual({ kind: 'label', templateId: null })
  })

  it('knows which addresses are old, so the bar can be rewritten', () => {
    expect(isLegacyAddress('/design/tpl-7?preset=x')).toBe(true)
    expect(isLegacyAddress('/templates')).toBe(true)
    expect(isLegacyAddress('/labels/tpl-7')).toBe(false)
    expect(isLegacyAddress('/')).toBe(false)
  })
})
