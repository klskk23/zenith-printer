/**
 * Deciding which uploaded images are garbage.
 *
 * Two rules, and the second one is the whole reason this is not a one-liner:
 *
 *   1. An image is live if any stored design still names it.
 *   2. A young image is live even when nothing names it. Pasting a picture
 *      uploads it immediately, so between the paste and the first save it sits
 *      on the server referenced by nothing at all. Sweeping on reference count
 *      alone would delete the picture out from under somebody's open editor.
 */
import { describe, expect, it } from 'vitest'
import {
  UnreadableDesignError,
  collectAssetIds,
} from '../../src/domain/image-references.ts'
import { planImageCleanup, type StoredImage } from '../../src/domain/image-cleanup.ts'

const NOW = new Date('2026-08-23T12:00:00.000Z')
const HOUR = 60 * 60 * 1000

function image(over: Partial<StoredImage> = {}): StoredImage {
  return {
    id: 'img-1',
    sizeBytes: 1000,
    storagePath: '/data/uploads/img-1.png',
    createdAt: new Date(NOW.getTime() - 48 * HOUR).toISOString(),
    deletedAt: null,
    ...over,
  }
}

/** A stored design, as the templates and print_jobs tables hold it. */
function design(...assetIds: string[]): string {
  return JSON.stringify([
    { id: 'a', type: 'rect', xMm: 1, yMm: 1 },
    ...assetIds.map((assetId, i) => ({ id: `i${i}`, type: 'image', assetId, fit: 'contain' })),
  ])
}

describe('collecting the assets a design names', () => {
  it('finds the ones an image element points at', () => {
    expect(collectAssetIds([design('img-1', 'img-2')])).toEqual(new Set(['img-1', 'img-2']))
  })

  it('returns nothing for a design with no pictures', () => {
    expect(collectAssetIds([design()])).toEqual(new Set())
  })

  it('merges across documents and does not double count', () => {
    expect(collectAssetIds([design('img-1'), design('img-1', 'img-2')])).toEqual(
      new Set(['img-1', 'img-2']),
    )
  })

  it('finds an assetId however deeply it is nested', () => {
    // A print job's snapshot wraps the elements in more structure than a
    // template does, and that structure has changed before. Walking for the
    // key rather than for a known shape means a future wrapper cannot quietly
    // hide a reference — and a hidden reference is a deleted picture.
    const snapshot = JSON.stringify({
      templateName: 't',
      ir: { elements: [{ type: 'image', assetId: 'img-9' }] },
      pages: [{ overrides: { nested: { deeper: [{ assetId: 'img-8' }] } } }],
    })
    expect(collectAssetIds([snapshot])).toEqual(new Set(['img-9', 'img-8']))
  })

  it('ignores an assetId that is not a string', () => {
    expect(collectAssetIds([JSON.stringify({ assetId: 42 })])).toEqual(new Set())
    expect(collectAssetIds([JSON.stringify({ assetId: null })])).toEqual(new Set())
  })

  it('refuses a document it cannot read instead of reporting no references', () => {
    // The dangerous direction. An unreadable row means an unknown reference
    // set; carrying on would report its pictures as garbage and delete them.
    expect(() => collectAssetIds(['{not json'])).toThrow(UnreadableDesignError)
  })
})

describe('planning the sweep', () => {
  const plan = (images: StoredImage[], referenced: string[], minAgeMs = 24 * HOUR) =>
    planImageCleanup(images, new Set(referenced), NOW, minAgeMs)

  it('removes an old image nothing names', () => {
    const result = plan([image({ id: 'img-1' })], [])
    expect(result.remove.map((i) => i.id)).toEqual(['img-1'])
    expect(result.bytesFreed).toBe(1000)
  })

  it('keeps an image a design still names', () => {
    const result = plan([image({ id: 'img-1' })], ['img-1'])
    expect(result.remove).toEqual([])
    expect(result.keptReferenced).toBe(1)
  })

  it('keeps a young image even though nothing names it', () => {
    // The one that matters: pasted into an editor tab that has not been saved.
    const fresh = image({ id: 'img-1', createdAt: new Date(NOW.getTime() - HOUR).toISOString() })
    const result = plan([fresh], [])
    expect(result.remove).toEqual([])
    expect(result.keptTooNew).toBe(1)
  })

  it('treats the age limit as inclusive at the boundary', () => {
    const exactly = image({ createdAt: new Date(NOW.getTime() - 24 * HOUR).toISOString() })
    expect(plan([exactly], []).remove).toHaveLength(1)
    const justUnder = image({ createdAt: new Date(NOW.getTime() - 24 * HOUR + 1).toISOString() })
    expect(plan([justUnder], []).remove).toHaveLength(0)
  })

  it('keeps a soft-deleted image that history still names', () => {
    // Soft deletion exists so a job's record of what it printed stays
    // renderable (FR-051). Being marked is not permission to remove the file.
    const marked = image({ id: 'img-1', deletedAt: NOW.toISOString() })
    expect(plan([marked], ['img-1']).remove).toEqual([])
  })

  it('removes a soft-deleted image nothing names any more', () => {
    const marked = image({ id: 'img-1', deletedAt: NOW.toISOString() })
    expect(plan([marked], []).remove.map((i) => i.id)).toEqual(['img-1'])
  })

  it('adds up what would be freed, so the report is worth reading', () => {
    const result = plan(
      [
        image({ id: 'a', sizeBytes: 100 }),
        image({ id: 'b', sizeBytes: 250 }),
        image({ id: 'c', sizeBytes: 999 }),
      ],
      ['c'],
    )
    expect(result.remove.map((i) => i.id).sort()).toEqual(['a', 'b'])
    expect(result.bytesFreed).toBe(350)
    expect(result.keptReferenced).toBe(1)
  })

  it('reports an empty plan rather than failing when there is nothing to do', () => {
    const result = plan([], [])
    expect(result).toMatchObject({ remove: [], bytesFreed: 0, keptReferenced: 0, keptTooNew: 0 })
  })
})
