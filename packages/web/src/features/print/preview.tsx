/**
 * Print preview.
 *
 * Renders through the server's real pipeline, so what appears here is the
 * binarised bitmap the head will burn — including the thresholding step, where
 * hairlines and light greys disappear. A prettier client-side approximation
 * would defeat the point of previewing at all.
 */
import { useEffect, useState } from 'react'
import type { LabelIR } from '@zenith/shared'
import { copy } from '../../i18n/index.ts'
import { Alert } from '../../components/ui/alert.tsx'
import { Button } from '../../components/ui/button.tsx'

export interface PreviewProps {
  ir: LabelIR
  printerId: string | null
  /** From the selected profile; shown here so nobody has to test-print to
      judge a nudge (FR-028). */
}

export function Preview({ ir, printerId }: PreviewProps): React.JSX.Element {
  const [url, setUrl] = useState<string | null>(null)
  const [clipped, setClipped] = useState(false)
  const [loading, setLoading] = useState(false)

  const refresh = async (): Promise<void> => {
    if (printerId === null) {
      return
    }
    setLoading(true)
    try {
      const response = await fetch('/api/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // No offset sent: the server uses the printer's own correction, which is
        // what will actually be applied when this prints.
        body: JSON.stringify({ printerId, ir }),
      })
      if (!response.ok) {
        setUrl(null)
        return
      }
      setClipped(response.headers.get('X-Clipped') === 'true')
      const blob = await response.blob()
      setUrl((previous) => {
        if (previous !== null) {
          URL.revokeObjectURL(previous)
        }
        return URL.createObjectURL(blob)
      })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    return () => {
      if (url !== null) {
        URL.revokeObjectURL(url)
      }
    }
  }, [url])

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">{copy.preview.heading}</h3>
        <Button size="sm" variant="outline" disabled={printerId === null || loading} onClick={() => void refresh()}>
          {loading ? copy.preview.loading : copy.preview.refresh}
        </Button>
      </div>

      {url !== null && (
        <img src={url} alt={copy.preview.heading} className="border border-border bg-white" />
      )}

      {clipped && <Alert variant="warning">{copy.preview.clipped}</Alert>}
      <p className="text-[11px] text-muted-foreground">{copy.preview.hint}</p>
    </div>
  )
}
