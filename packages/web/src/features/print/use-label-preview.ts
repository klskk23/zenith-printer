/**
 * One preview image, rendered by the server's real pipeline.
 *
 * Split out of the preview component when the dialog grew a second way to show
 * labels — a grid of them, one per selected row. Both go through here, so the
 * grid cannot drift into rendering something the single preview would not:
 * same body, same endpoint, same handling of a failure.
 */
import { useEffect, useState } from 'react'
import type { LabelIR } from '@zenith/shared'

export interface PreviewRequest {
  printerId: string
  ir: LabelIR
  profileId: string | null
  /**
   * The design's own variables — constants and sequences.
   *
   * *Not* the bound table's columns. Those come from `dataSourceId` and
   * `rowOrdinal` below, resolved server-side against the row being drawn;
   * sending them here would override every row with the same values and make
   * a grid of different rows come back looking identical.
   *
   * Null while the form is incomplete.
   */
  variableValues: Record<string, string> | null
  /** The bound table, without which `rowOrdinal` has nothing to index. */
  dataSourceId: string | null
  /** Which row of that table to draw; undefined means the first. */
  rowOrdinal?: number
}

export interface PreviewState {
  url: string | null
  /** Something did not fit the label. */
  clipped: boolean
  failed: boolean
}

/**
 * The request body, as a string.
 *
 * Serialised by the caller so the effect below can depend on it directly. An
 * object would be a new reference on every render and would re-render the
 * label on every keystroke in the dialog.
 */
export function previewRequestBody(request: PreviewRequest): string {
  return JSON.stringify({
    printerId: request.printerId,
    ir: request.ir,
    ...(request.profileId === null ? {} : { profileId: request.profileId }),
    ...(request.dataSourceId === null ? {} : { dataSourceId: request.dataSourceId }),
    ...(request.variableValues === null ? {} : { variableValues: request.variableValues }),
    ...(request.rowOrdinal === undefined ? {} : { rowOrdinal: request.rowOrdinal }),
  })
}

/** Null means "not ready to ask yet" — no request goes out, nothing is shown. */
export function useLabelPreview(body: string | null): PreviewState {
  const [url, setUrl] = useState<string | null>(null)
  const [clipped, setClipped] = useState(false)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    if (body === null) {
      return
    }
    let cancelled = false

    void fetch('/api/preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // No offset sent: the server uses the printer's own correction, which is
      // what will actually be applied when this prints.
      body,
    })
      .then(async (response) => {
        if (cancelled) {
          return
        }
        if (!response.ok) {
          setFailed(true)
          return
        }
        setFailed(false)
        setClipped(response.headers.get('X-Clipped') === 'true')
        const objectUrl = URL.createObjectURL(await response.blob())
        setUrl((previous) => {
          if (previous !== null) {
            URL.revokeObjectURL(previous)
          }
          return objectUrl
        })
      })
      .catch(() => {
        if (!cancelled) {
          setFailed(true)
        }
      })

    return () => {
      cancelled = true
    }
  }, [body])

  // Released on unmount only. Revoking on every change would pull the image
  // out from under the render that is still showing it.
  useEffect(() => {
    return () => {
      if (url !== null) {
        URL.revokeObjectURL(url)
      }
    }
  }, [url])

  return { url, clipped, failed }
}
