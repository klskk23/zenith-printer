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
 * Expanded, it shows the rest — every selected row, ten at a time. One label
 * cannot answer the question people open this dialog with, because a barcode's
 * width follows its content: row 87 can overflow while row 1 is perfect, and
 * that is exactly the batch nobody wants to find out about from the roll. Ten
 * at a time because each one is a real server render, and a selection may run
 * to a thousand rows.
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
import { useState } from 'react'
import type { LabelIR } from '@zenith/shared'
import { copy } from '../../i18n/index.ts'
import { Alert } from '../../components/ui/alert.tsx'
import { Button } from '../../components/ui/button.tsx'
import { Pagination } from '../../components/ui/pagination.tsx'
import { previewRequestBody, useLabelPreview, type PreviewRequest } from './use-label-preview.ts'

/** Previews per page. Each is a real render on the server, not a thumbnail. */
const PAGE_SIZE = 10

export interface PreviewProps {
  ir: LabelIR
  printerId: string | null
  profileId: string | null
  /** Copy one's field values, or null while the form is incomplete. */
  variableValues: Record<string, string> | null
  /** The bound table, so the server can resolve the row being drawn. */
  dataSourceId: string | null
  /**
   * The selected rows, in print order — which is ascending ordinal, always.
   *
   * Empty when no table is bound, or when nothing is chosen yet; in both cases
   * the preview falls back to what it has always shown, the label the server
   * draws by default. The first entry is the label that will genuinely come out
   * first (FR-041), and the rest are what expanding reveals.
   */
  rowOrdinals?: readonly number[]
  copies: number
}

export function Preview({
  ir,
  printerId,
  profileId,
  variableValues,
  dataSourceId,
  rowOrdinals = [],
  copies,
}: PreviewProps): React.JSX.Element {
  const [expanded, setExpanded] = useState(false)
  const [page, setPage] = useState(1)

  const ready = printerId !== null && variableValues !== null

  const request = (rowOrdinal: number | undefined): PreviewRequest | null =>
    printerId === null
      ? null
      : { printerId, ir, profileId, variableValues, dataSourceId, rowOrdinal }

  const bodyFor = (rowOrdinal: number | undefined): string | null => {
    const parts = request(rowOrdinal)
    return !ready || parts === null ? null : previewRequestBody(parts)
  }

  const { url, clipped, failed } = useLabelPreview(expanded ? null : bodyFor(rowOrdinals[0]))

  const pageCount = Math.max(1, Math.ceil(rowOrdinals.length / PAGE_SIZE))
  // Clamped rather than reset by an effect: the selection can shrink under a
  // page already open, and a page number past the end shows an empty grid.
  const shownPage = Math.min(page, pageCount)
  const onPage = rowOrdinals.slice((shownPage - 1) * PAGE_SIZE, shownPage * PAGE_SIZE)

  return (
    <div className="flex flex-col gap-2" data-preview>
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">{copy.preview.heading}</h3>
        {/*
          Offered only when there is something more to see. One selected row
          expands to the label already on screen, and no selection at all has
          nothing to expand to.
        */}
        {rowOrdinals.length > 1 && (
          <Button size="sm" variant="ghost" onClick={() => setExpanded(!expanded)}>
            {expanded ? copy.preview.collapse : copy.preview.expand(rowOrdinals.length)}
          </Button>
        )}
      </div>

      {!ready ? (
        <p className="text-xs text-muted-foreground">{copy.preview.needsFields}</p>
      ) : expanded ? (
        <div className="flex flex-col gap-2" data-preview-grid>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {onPage.map((ordinal) => (
              <RowPreview key={ordinal} ordinal={ordinal} body={bodyFor(ordinal)} />
            ))}
          </div>
          <p className="text-2xs text-muted-foreground">
            {copy.preview.ofRows(onPage.length, rowOrdinals.length)}
          </p>
          {pageCount > 1 && (
            <Pagination
              page={shownPage}
              pageCount={pageCount}
              onPageChange={setPage}
              labels={{
                previous: copy.preview.previousPage,
                next: copy.preview.nextPage,
                page: copy.preview.pageNumber,
              }}
            />
          )}
        </div>
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

      {!expanded && clipped && (
        <Alert variant="warning" className="text-xs">
          {copy.preview.clipped}
        </Alert>
      )}
      {copies > 1 && (
        <p className="text-2xs text-muted-foreground">{copy.preview.firstOfMany(copies)}</p>
      )}
      <p className="text-2xs text-muted-foreground">{copy.preview.hint}</p>
    </div>
  )
}

/**
 * One row's label in the expanded grid.
 *
 * Its own component so that each has its own request and its own state: a
 * failure on row 7 leaves the other nine on screen, which is the point of
 * looking at them together.
 */
function RowPreview({ ordinal, body }: { ordinal: number; body: string | null }): React.JSX.Element {
  const { url, clipped, failed } = useLabelPreview(body)
  const label = copy.preview.rowLabel(ordinal)

  return (
    <figure className="flex flex-col gap-1" data-row-preview={ordinal}>
      {failed ? (
        <p className="text-2xs text-muted-foreground">{copy.preview.failed}</p>
      ) : (
        url !== null && (
          <img src={url} alt={label} className="w-full border border-border bg-white" />
        )
      )}
      <figcaption className="flex items-center gap-1 text-2xs text-muted-foreground">
        <span>{label}</span>
        {/* Said per row: which row overflows is the whole reason to be here. */}
        {clipped && <span className="text-warning">{copy.preview.rowClipped}</span>}
      </figcaption>
    </figure>
  )
}
