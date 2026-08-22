/**
 * The decisions an import makes, on their own.
 *
 * These are the parts with consequences: which pool a serial is drawn from,
 * which table a design binds to. Tested directly rather than only through the
 * endpoint, because "it drew from the wrong counter" is not visible in a
 * status code.
 */
import { describe, expect, it } from 'vitest'
import {
  FILE_KIND,
  FORMAT_VERSION,
  exportFileSchema,
  remapAssetIds,
  resolveDataSource,
  resolvePool,
} from '../../src/domain/template-io.ts'

const POOL = { name: '出货号', digits: 6, step: 1, floor: 1 }

describe('choosing a sequence pool', () => {
  it('lands on the same pool when the file came from this machine', () => {
    const result = resolvePool('p-1', POOL, [{ id: 'p-1', name: '别的名字' }])
    expect(result).toEqual({ poolId: 'p-1' })
  })

  it('prefers the id over the name, so a restore is exact', () => {
    // Both could match; the id is the identity and must win.
    const result = resolvePool('p-1', POOL, [
      { id: 'p-9', name: '出货号' },
      { id: 'p-1', name: '别的名字' },
    ])
    expect(result).toEqual({ poolId: 'p-1' })
  })

  it('falls back to the name, and says so', () => {
    // Reported rather than done quietly: two pools sharing a name are not two
    // names for one pool, and drawing serials from another product line's
    // counter is not something to do without telling anybody.
    const result = resolvePool('p-1', POOL, [{ id: 'p-9', name: '出货号' }])
    expect(result).toEqual({ matchedByName: { id: 'p-9', name: '出货号' } })
  })

  it('creates from the definition when nothing matches', () => {
    expect(resolvePool('p-1', POOL, [])).toEqual({ create: POOL })
  })

  it('leaves the reference dangling when the file describes no pool', () => {
    expect(resolvePool('p-1', undefined, [])).toEqual({ unresolved: true })
  })
})

describe('choosing a data source', () => {
  const SOURCE = { name: '订单表', columns: ['订单号', '收件人'] }

  it('lands on the same table when the file came from this machine', () => {
    expect(resolveDataSource('ds-1', SOURCE, [{ id: 'ds-1', name: 'x', columns: [] }])).toEqual({
      sourceId: 'ds-1',
    })
  })

  it('binds to a table of the same name and reports the columns it wanted', () => {
    const result = resolveDataSource('ds-1', SOURCE, [
      { id: 'ds-9', name: '订单表', columns: ['订单号'] },
    ])
    expect(result).toEqual({
      matchedByName: { id: 'ds-9', name: '订单表', columns: ['订单号'] },
      missingColumns: ['收件人'],
    })
  })

  it('binds with nothing to report when the shape matches', () => {
    const result = resolveDataSource('ds-1', SOURCE, [
      { id: 'ds-9', name: '订单表', columns: ['订单号', '收件人', '备注'] },
    ])
    expect(result).toMatchObject({ missingColumns: [] })
  })

  it('leaves the binding dangling rather than inventing a table', () => {
    // A table cannot be created from a file that carries no rows, and the
    // dangling binding is what `bindingIssue` already reports.
    expect(resolveDataSource('ds-1', SOURCE, [])).toEqual({ unresolved: true })
  })
})

describe('image references', () => {
  const image = {
    id: 'i', type: 'image' as const, xMm: 0, yMm: 0, widthMm: 10, heightMm: 10,
    rotation: 0 as const, assetId: 'sha-abc', fit: 'contain' as const,
  }
  const text = {
    id: 't', type: 'text' as const, xMm: 0, yMm: 0, widthMm: 10, heightMm: 5, rotation: 0 as const,
    content: 'x', fontFamily: 'F', fontSizeMm: 3, bold: false, align: 'left' as const, inverted: false,
  }

  it('rewrites an image element onto the local asset', () => {
    const [mapped] = remapAssetIds([image], new Map([['sha-abc', 'img-1']]))
    expect(mapped).toMatchObject({ assetId: 'img-1' })
  })

  it('leaves everything else untouched, by identity', () => {
    const elements = [text, image]
    const mapped = remapAssetIds(elements, new Map([['sha-abc', 'img-1']]))
    expect(mapped[0]).toBe(text)
  })

  it('leaves an unmapped image alone rather than blanking it', () => {
    const [mapped] = remapAssetIds([image], new Map())
    expect(mapped).toBe(image)
  })
})

describe('the file itself', () => {
  const file = {
    kind: FILE_KIND,
    formatVersion: FORMAT_VERSION,
    templates: [
      {
        id: 't-1', name: '面单', printerKind: 'niimbot', widthMm: 50, heightMm: 30, dpi: 203,
        elements: [], variables: [], dataSourceId: null,
      },
    ],
  }

  it('accepts a minimal file and defaults the optional maps', () => {
    const parsed = exportFileSchema.parse(file)
    expect(parsed.pools).toEqual({})
    expect(parsed.assets).toEqual({})
  })

  it('refuses a JSON that is not one of ours', () => {
    expect(() => exportFileSchema.parse({ ...file, kind: 'something.else' })).toThrow()
  })

  it('refuses an element type it cannot represent', () => {
    // The line between "import and report" and "refuse": a dangling reference
    // is still a design; an element this build has no idea how to draw is not.
    expect(() =>
      exportFileSchema.parse({
        ...file,
        templates: [{ ...file.templates[0], elements: [{ id: 'x', type: 'hologram', xMm: 0, yMm: 0 }] }],
      }),
    ).toThrow()
  })

  it('refuses a file with no templates in it', () => {
    expect(() => exportFileSchema.parse({ ...file, templates: [] })).toThrow()
  })
})
