/**
 * Which uploaded images a stored design still points at.
 *
 * Two tables hold designs — `templates.elements` and `print_jobs.snapshot` —
 * and an image element names its picture by `assetId` rather than carrying the
 * bytes. Everything downstream of "is this picture still in use?" is decided
 * here.
 *
 * There WAS a `ref_count` column for this. Nothing ever incremented it, so it
 * sat at zero for every row and made `delete` remove files that history still
 * needed. A counter maintained by hand at a dozen call sites drifts; asking the
 * data cannot. This walks the documents instead, every time.
 */

export class UnreadableDesignError extends Error {
  constructor(cause: unknown) {
    super(`a stored design could not be parsed: ${cause instanceof Error ? cause.message : String(cause)}`)
    this.name = 'UnreadableDesignError'
  }
}

/**
 * Collect by key, not by shape.
 *
 * A print job's snapshot wraps its elements in more structure than a template
 * does, and that structure has changed before. Matching on the `assetId` key
 * wherever it appears means a future wrapper cannot hide a reference — and a
 * hidden reference is a picture deleted out from under a job's history.
 */
function walk(value: unknown, found: Set<string>): void {
  if (Array.isArray(value)) {
    for (const item of value) {
      walk(item, found)
    }
    return
  }
  if (value === null || typeof value !== 'object') {
    return
  }
  for (const [key, child] of Object.entries(value)) {
    if (key === 'assetId' && typeof child === 'string' && child.length > 0) {
      found.add(child)
    }
    walk(child, found)
  }
}

/**
 * Every asset named by any of these documents.
 *
 * Throws rather than skipping a document it cannot parse. An unreadable row
 * means an unknown reference set, and the failure mode of guessing is to report
 * a live picture as garbage — so refusing to answer is the only safe response.
 */
export function collectAssetIds(documents: Iterable<string>): Set<string> {
  const found = new Set<string>()
  for (const document of documents) {
    let parsed: unknown
    try {
      parsed = JSON.parse(document)
    } catch (err) {
      throw new UnreadableDesignError(err)
    }
    walk(parsed, found)
  }
  return found
}
