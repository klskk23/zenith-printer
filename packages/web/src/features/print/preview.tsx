/**
 * Print preview.
 *
 * Rendered by the server's real pipeline, so what appears is the binarised
 * bitmap the head will burn — through the black/white cut-off, where hairlines
 * and pale tones disappear, and through whatever image tone the profile asks
 * for. A prettier client-side approximation would defeat the point of
 * previewing at all.
 *
 * It shows the **first** label of a batch. A sequence field counts up, so the
 * copies genuinely differ; the first is one that will actually be printed,
 * where a composite would be a label nobody receives.
 *
 * It renders the design on screen, edits included. It used to render the saved
 * template instead, on the grounds that a job submitted with a `templateId`
 * prints the stored version — true, but it made the preview useless for the
 * thing a preview is for: seeing the change you just made. The divergence is
 * now stated in the dialog instead of being silently resolved in favour of the
 * thing the user is not looking at.
 *
 * The profile id is still sent, so the cut-off and the image tone are the ones
 * that will be used.
 */
import { useEffect, useState } from 'react'
import type { LabelIR } from '@zenith/shared'
import { copy } from '../../i18n/index.ts'
import { Alert } from '../../components/ui/alert.tsx'

export interface PreviewProps {
  ir: LabelIR
  printerId: string | null
  profileId: string | null
  /** Copy one's field values, or null while the form is incomplete. */
  variableValues: Record<string, string> | null
  copies: number
}

export function Preview({
  ir,
  printerId,
  profileId,
  variableValues,
  copies,
}: PreviewProps): React.JSX.Element {
  const [url, setUrl] = useState<string | null>(null)
  const [clipped, setClipped] = useState(false)
  const [failed, setFailed] = useState(false)

  const ready = printerId !== null && variableValues !== null
  const body = JSON.stringify({
    printerId,
    ir,
    ...(profileId === null ? {} : { profileId }),
    ...(variableValues === null ? {} : { variableValues }),
  })

  useEffect(() => {
    if (!ready) {
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
  }, [body, ready])

  // Released on unmount only. Revoking on every change would pull the image
  // out from under the render that is still showing it.
  useEffect(() => {
    return () => {
      if (url !== null) {
        URL.revokeObjectURL(url)
      }
    }
  }, [url])

  return (
    <div className="space-y-2" data-preview>
      <h3 className="text-sm font-semibold">{copy.preview.heading}</h3>

      {!ready ? (
        <p className="text-xs text-muted-foreground">{copy.preview.needsFields}</p>
      ) : failed ? (
        <Alert variant="warning" className="text-xs">
          {copy.preview.failed}
        </Alert>
      ) : (
        url !== null && (
          <img
            src={url}
            alt={copy.preview.heading}
            className="max-w-full border border-border bg-white"
          />
        )
      )}

      {clipped && (
        <Alert variant="warning" className="text-xs">
          {copy.preview.clipped}
        </Alert>
      )}
      {copies > 1 && (
        <p className="text-[11px] text-muted-foreground">{copy.preview.firstOfMany(copies)}</p>
      )}
      <p className="text-[11px] text-muted-foreground">{copy.preview.hint}</p>
    </div>
  )
}
