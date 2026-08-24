/**
 * Which uploaded images can go.
 *
 * Pure, so the rules can be argued with in a test rather than against a disk.
 */

export interface StoredImage {
  id: string
  sizeBytes: number
  storagePath: string
  createdAt: string
  /** Set when the image was deleted while history still needed it (FR-051). */
  deletedAt: string | null
}

export interface ImageCleanupPlan {
  /** Rows to drop and files to unlink. */
  remove: StoredImage[]
  /** Still named by a template or a job snapshot. */
  keptReferenced: number
  /** Named by nothing, but too young to be sure — see below. */
  keptTooNew: number
  bytesFreed: number
}

/**
 * @param minAgeMs How old an unreferenced image must be before it counts as
 *   garbage. This is not caution for its own sake: pasting a picture uploads it
 *   immediately, so from the paste until the first save it is referenced by
 *   nothing at all. Sweeping on references alone would empty the picture out of
 *   an editor somebody still has open.
 */
export function planImageCleanup(
  images: readonly StoredImage[],
  referenced: ReadonlySet<string>,
  now: Date,
  minAgeMs: number,
): ImageCleanupPlan {
  const remove: StoredImage[] = []
  let keptReferenced = 0
  let keptTooNew = 0

  for (const image of images) {
    if (referenced.has(image.id)) {
      // Including soft-deleted ones. Being marked is not permission to remove
      // the file — the mark is what keeps it out of the picker while a job's
      // record of what it printed stays renderable.
      keptReferenced += 1
      continue
    }
    const ageMs = now.getTime() - new Date(image.createdAt).getTime()
    if (ageMs < minAgeMs) {
      keptTooNew += 1
      continue
    }
    remove.push(image)
  }

  return {
    remove,
    keptReferenced,
    keptTooNew,
    bytesFreed: remove.reduce((total, image) => total + image.sizeBytes, 0),
  }
}
