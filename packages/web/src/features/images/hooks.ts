/**
 * Image assets.
 *
 * An image element in the IR carries an `assetId`, not the bytes: the same
 * picture used on twenty labels is stored once, and the print renderer reads
 * it from disk rather than from a data URI several megabytes long.
 */
import { useMutation } from '@tanstack/react-query'
import { request, upload } from '../../api/client.ts'

/** Mirrors the server's `images` row. */
export interface ImageAsset {
  id: string
  filename: string
  mimeType: string
  sizeBytes: number
}

/** What the server will take; the picker filters to the same list. */
export const ACCEPTED_IMAGE_TYPES = ['image/png', 'image/jpeg'] as const

export const MAX_IMAGE_BYTES = 4 * 1024 * 1024

/**
 * Whether this file is worth sending.
 *
 * Checked here as well as on the server so the user is told immediately, and
 * on the server as well as here because a check only the browser performs is
 * not a check at all.
 */
export function imageRejectionReason(file: File): 'type' | 'size' | null {
  if (!(ACCEPTED_IMAGE_TYPES as readonly string[]).includes(file.type)) {
    return 'type'
  }
  if (file.size > MAX_IMAGE_BYTES) {
    return 'size'
  }
  return null
}

export function useUploadImage() {
  return useMutation({
    mutationFn: (file: File) => upload<ImageAsset>('/images', file),
  })
}

/** The first image on a clipboard or drop, or null if there is none. */
export function imageFileFrom(items: readonly File[]): File | null {
  return items.find((file) => (ACCEPTED_IMAGE_TYPES as readonly string[]).includes(file.type)) ?? null
}

/**
 * The picture's own pixel dimensions.
 *
 * Read in the browser rather than asked of the server: the endpoint stores the
 * bytes and reports the size in bytes, and adding image decoding to it to
 * answer a question the browser can already answer would put a second image
 * decoder in the project.
 *
 * Resolves to a zero size rather than rejecting on a file that will not
 * decode. The upload then fails on its own terms and the user reads the
 * server's wording, instead of two failures for one bad file.
 */
export async function naturalSizeOf(file: File): Promise<{ width: number; height: number }> {
  const url = URL.createObjectURL(file)
  try {
    return await new Promise((resolve) => {
      const image = new Image()
      image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight })
      image.onerror = () => resolve({ width: 0, height: 0 })
      image.src = url
    })
  } finally {
    URL.revokeObjectURL(url)
  }
}

/** What the server reports after a sweep. */
export interface ImagePruneResult {
  outcome: 'planned' | 'removed'
  removed: number
  strayFilesRemoved: number
  keptReferenced: number
  keptTooNew: number
  bytesFreed: number
  minAgeHours: number
}

/**
 * Remove uploaded images no design points at any more.
 *
 * Always `confirm: true` — this hook exists behind a confirmation dialog, and
 * the server's report-only mode is for the command line, where there is no
 * dialog to put the question in. Sending the request twice, once to look and
 * once to act, would only add a round trip: an image nothing references and
 * that is past the grace period cannot be reached from anywhere in the product,
 * so there is nothing for a report to change anybody's mind about.
 */
export function useImagePrune() {
  return useMutation<ImagePruneResult, Error, void>({
    mutationFn: () => request<ImagePruneResult>('/images/prune', { method: 'POST', body: { confirm: true } }),
  })
}
