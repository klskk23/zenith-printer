/**
 * Resolve image assets for server-side rendering.
 *
 * The browser can hand `<image href>` a relative URL and let the network fetch
 * it. resvg cannot: it has no HTTP client, and an unresolved href is skipped
 * silently. That asymmetry is dangerous — the logo appears in the editor,
 * vanishes on paper, and nothing anywhere reports a problem.
 *
 * So the server inlines the bytes as a data URI before rendering.
 */
import { readFileSync } from 'node:fs'
import type { ImageRepo } from '../db/repositories/image-repo.ts'

export type ImageResolver = (assetId: string) => string | undefined

/**
 * Build a resolver backed by the asset store.
 * Soft-deleted assets still resolve, so job history keeps rendering (FR-051).
 * A missing file yields undefined and the element is skipped rather than
 * failing the whole label.
 */
export function createImageResolver(repo: ImageRepo): ImageResolver {
  const cache = new Map<string, string | undefined>()

  return (assetId: string): string | undefined => {
    const cached = cache.get(assetId)
    if (cached !== undefined || cache.has(assetId)) {
      return cached
    }

    let dataUri: string | undefined
    const asset = repo.find(assetId)
    if (asset !== undefined) {
      try {
        const bytes = readFileSync(asset.storagePath)
        dataUri = `data:${asset.mimeType};base64,${bytes.toString('base64')}`
      } catch {
        // The row exists but the file is gone. Skip the element; refusing the
        // whole render would make one missing logo block every label.
        dataUri = undefined
      }
    }

    // A job renders once per copy, so the same logo is otherwise re-read and
    // re-encoded a hundred times.
    cache.set(assetId, dataUri)
    return dataUri
  }
}
