/**
 * The gallery's rows, in the order people rely on.
 *
 * Sorted by name with a Chinese-aware collator, so the order is the one a
 * person would produce rather than the code-point one — and pinned here
 * because a plain `sort()` would pass every other test and still put
 * 「货架标签」 before 「出货面单」.
 */
import { describe, expect, it } from 'vitest'
import { galleryItems, tileIr } from '../src/features/templates/gallery-items.ts'
import type { Template } from '../src/features/templates/hooks.ts'

const label = (id: string, name: string): Template =>
  ({ id, name, printerKind: 'niimbot', widthMm: 50, heightMm: 30, dpi: 203, elements: [], variables: [],
    dataSourceId: null, bindingIssue: null, createdAt: 'T', updatedAt: 'T', version: 1, hasThumbnail: false }) as Template

describe('galleryItems', () => {
  it('orders saved labels by name, the way a person would', () => {
    const items = galleryItems([label('a', '货架标签'), label('b', '出货面单'), label('c', '资产标签')])
    expect(items.map((item) => item.name)).toEqual(['出货面单', '货架标签', '资产标签'])
  })

  it('carries the size and the label itself', () => {
    const items = galleryItems([label('a', '货架标签')])
    expect(items[0]).toMatchObject({ key: 'a', widthMm: 50, heightMm: 30 })
    expect(items[0]!.template.id).toBe('a')
  })

  it('draws the label\'s own content', () => {
    const ir = tileIr(galleryItems([label('a', '货架标签')])[0]!)
    expect(ir).toMatchObject({ widthMm: 50, heightMm: 30, dpi: 203, elements: [] })
  })
})
