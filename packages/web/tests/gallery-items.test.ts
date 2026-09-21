/**
 * How the gallery is put together from two lists that know nothing of each
 * other: the labels the server has, and the drafts this browser has.
 *
 * The order is the rule people rely on — anything unsaved is at the top,
 * where it cannot be forgotten — so it is decided here and not by whatever
 * order the two lists happened to arrive in.
 */
import { describe, expect, it } from 'vitest'
import { galleryItems } from '../src/features/templates/gallery-items.ts'
import type { Template } from '../src/features/templates/hooks.ts'
import type { DraftIndexEntry } from '../src/features/drafts/schema.ts'

const label = (id: string, name: string): Template =>
  ({ id, name, printerKind: 'niimbot', widthMm: 50, heightMm: 30, dpi: 203, elements: [], variables: [],
    dataSourceId: null, bindingIssue: null, createdAt: 'T', updatedAt: 'T', version: 1, hasThumbnail: false }) as Template

const entry = (draftId: string, templateId: string | null, createdAt: string, name: string | null = null): DraftIndexEntry =>
  ({ draftId, templateId, name, widthMm: 40, heightMm: 20, createdAt, updatedAt: createdAt })

describe('galleryItems', () => {
  it('puts unsaved labels first, newest first, then saved labels by name', () => {
    const items = galleryItems(
      [label('b', '出货面单'), label('a', '货架标签')],
      [entry('d-old', null, '2026-09-20T00:00:00.000Z'), entry('d-new', null, '2026-09-21T00:00:00.000Z')],
      [],
    )
    expect(items.map((item) => [item.key, item.kind])).toEqual([
      ['d-new', 'unsaved-new'],
      ['d-old', 'unsaved-new'],
      ['b', 'saved'],
      ['a', 'saved'],
    ])
  })

  it('marks a saved label that has a draft', () => {
    const items = galleryItems([label('a', '货架标签')], [entry('a', 'a', 'T')], [])
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ key: 'a', kind: 'saved-with-draft', name: '货架标签' })
  })

  it('shows a draft whose label the server no longer has', () => {
    const items = galleryItems([], [entry('gone', 'gone', 'T', '旧标签')], [])
    expect(items[0]).toMatchObject({ key: 'gone', kind: 'orphan-draft', name: '旧标签', widthMm: 40, heightMm: 20 })
  })

  it('shows a draft that cannot be read, so it can be cleared', () => {
    const items = galleryItems([], [], ['bad'])
    expect(items[0]).toMatchObject({ key: 'bad', kind: 'corrupt-draft' })
  })

  it('names an unsaved label by what was typed, or as untitled', () => {
    const items = galleryItems([], [entry('d1', null, 'T', '试打'), entry('d2', null, 'T')], [])
    expect(items.map((item) => item.name)).toEqual(['试打', null])
  })

  it('lets a saved label\'s draft size override the saved size', () => {
    // The draft may have resized the label; the tile should show what the
    // person will find when they open it.
    const items = galleryItems([label('a', '货架标签')], [entry('a', 'a', 'T')], [])
    expect(items[0]).toMatchObject({ widthMm: 40, heightMm: 20 })
  })
})
