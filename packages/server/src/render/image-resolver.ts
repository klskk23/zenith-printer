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

export type ImageResolver = (assetId: string) => string | undefined

/**
 * The one thing a resolver needs from the asset store.
 *
 * Declared structurally rather than as `ImageRepo`, so callers that have no
 * clock or id generator to hand — a migration, for one — can look assets up
 * without inventing them.
 */
export interface AssetLookup {
  /** Only the two things a data URI is built from, so a caller can supply a
   *  row it read itself without matching the whole repository type. */
  find(assetId: string): { mimeType: string; bytes: Uint8Array } | undefined
}

/**
 * Build a resolver backed by the asset store.
 * Soft-deleted assets still resolve, so job history keeps rendering (FR-051).
 * An asset with no bytes yields undefined and the element is skipped rather
 * than failing the whole label.
 */
export function createImageResolver(repo: AssetLookup): ImageResolver {
  const cache = new Map<string, string | undefined>()

  return (assetId: string): string | undefined => {
    const cached = cache.get(assetId)
    if (cached !== undefined || cache.has(assetId)) {
      return cached
    }

    // The row can exist with no bytes — migration 15 kept the ones whose file
    // had already gone. Skip the element; refusing the whole render would make
    // one missing logo block every label.
    const asset = repo.find(assetId)
    const dataUri =
      asset === undefined
        ? undefined
        : `data:${asset.mimeType};base64,${Buffer.from(asset.bytes).toString('base64')}`

    // A job renders once per copy, so the same logo is otherwise re-read and
    // re-encoded a hundred times.
    cache.set(assetId, dataUri)
    return dataUri
  }
}
