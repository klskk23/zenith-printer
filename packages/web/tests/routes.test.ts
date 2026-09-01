/**
 * Path <-> tab mapping.
 *
 * The address bar projects *which tab is active*; it does not decide which tabs
 * exist. Keeping that mapping in a pure module means it can be checked without
 * a router, a DOM, or a browser.
 */
import { describe, expect, it } from 'vitest'
import { pathForTab, tabFromPath, TAB_KINDS } from '../src/app/routes.ts'

describe('pathForTab', () => {
  it.each([
    ['index', '/'],
    ['templates', '/templates'],
    ['printers', '/printers'],
    ['queue', '/queue'],
    ['history', '/history'],
    ['settings', '/settings'],
  ] as const)('maps %s to %s', (kind, path) => {
    expect(pathForTab({ kind })).toBe(path)
  })

  it('gives an unsaved design its own path', () => {
    expect(pathForTab({ kind: 'design', templateId: null })).toBe('/design/new')
  })

  it('addresses a design opened from a template by that template', () => {
    expect(pathForTab({ kind: 'design', templateId: 'tpl-7' })).toBe('/design/tpl-7')
  })

  it('covers every tab kind', () => {
    for (const kind of TAB_KINDS) {
      expect(pathForTab({ kind, templateId: null })).toMatch(/^\//)
    }
  })
})

describe('tabFromPath', () => {
  it.each([
    ['/', 'index'],
    ['/templates', 'templates'],
    ['/printers', 'printers'],
    ['/queue', 'queue'],
    ['/history', 'history'],
    ['/settings', 'settings'],
  ] as const)('maps %s to %s', (path, kind) => {
    expect(tabFromPath(path)).toMatchObject({ kind })
  })

  it('reads /design/new as an unsaved design', () => {
    expect(tabFromPath('/design/new')).toEqual({ kind: 'design', templateId: null })
  })

  it('reads /design/:id as a design on that template', () => {
    expect(tabFromPath('/design/tpl-7')).toEqual({ kind: 'design', templateId: 'tpl-7' })
  })

  it('tolerates a trailing slash', () => {
    expect(tabFromPath('/printers/')).toMatchObject({ kind: 'printers' })
  })

  it('returns null for an unknown path rather than guessing', () => {
    expect(tabFromPath('/nope')).toBeNull()
    expect(tabFromPath('/design')).toBeNull()
  })

  it('round-trips every kind', () => {
    for (const kind of TAB_KINDS) {
      const descriptor =
        kind === 'design'
          ? { kind, templateId: 'tpl-1' }
          : kind === 'data-source'
            ? { kind, dataSourceId: 'ds-1' }
            : { kind }
      expect(tabFromPath(pathForTab(descriptor))).toMatchObject({ kind })
    }
  })

  it('keeps the list and the editor apart, one character of path aside', () => {
    // `/data-sources` and `/data-sources/ds-1` differ by a segment and mean
    // different pages; the list must not swallow the editor.
    expect(tabFromPath('/data-sources')).toEqual({ kind: 'data-sources' })
    expect(tabFromPath('/data-sources/ds-1')).toEqual({ kind: 'data-source', dataSourceId: 'ds-1' })
  })
})

/**
 * A preset carried in the address.
 *
 * `nexus-assets` links a label as `/design/{templateId}?preset={presetId}`,
 * meaning "take me there with the settings already set" — the printer, the
 * profile and the copies that the preset records, all four of which otherwise
 * sit at their defaults no matter which link was followed.
 *
 * It stays a query rather than becoming a path segment, and the tab stays a
 * design tab: it is an initial value, not another kind of thing to open.
 */
describe('a design address carrying a preset', () => {
  it('is read out of the query', () => {
    expect(tabFromPath('/design/tpl-7?preset=pre-1')).toEqual({
      kind: 'design',
      templateId: 'tpl-7',
      presetId: 'pre-1',
    })
  })

  it('is written back, so a refresh and the back button keep it', () => {
    expect(pathForTab({ kind: 'design', templateId: 'tpl-7', presetId: 'pre-1' })).toBe(
      '/design/tpl-7?preset=pre-1',
    )
  })

  it('round-trips', () => {
    const address = '/design/tpl-7?preset=pre-1'
    expect(pathForTab(tabFromPath(address)!)).toBe(address)
  })

  it('is absent from the address when there is none', () => {
    expect(pathForTab({ kind: 'design', templateId: 'tpl-7' })).toBe('/design/tpl-7')
    expect(tabFromPath('/design/tpl-7')?.presetId).toBeUndefined()
  })

  it('ignores a query on the kinds that have no use for one', () => {
    // Otherwise a stray `?preset=` on the printers page would be carried into
    // an address that means nothing by it.
    expect(tabFromPath('/printers?preset=pre-1')).toEqual({ kind: 'printers' })
    expect(tabFromPath('/?preset=pre-1')).toEqual({ kind: 'index' })
  })

  it('survives other query parameters alongside it', () => {
    expect(tabFromPath('/design/tpl-7?utm=x&preset=pre-1')?.presetId).toBe('pre-1')
  })

  it('treats an empty preset as none, rather than as a preset named ""', () => {
    expect(tabFromPath('/design/tpl-7?preset=')?.presetId).toBeUndefined()
  })
})
