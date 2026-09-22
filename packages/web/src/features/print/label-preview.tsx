/**
 * What will come out of the machine.
 *
 * Rendered by the server's real pipeline, so what appears is the binarised
 * bitmap the head will burn — through the black/white cut-off, where hairlines
 * and pale tones disappear, and through whatever image tone the settings ask
 * for. A prettier client-side approximation would defeat the point.
 *
 * Collapsed it shows the **first** label of the batch: a sequence counts up and
 * every row differs, so a composite would be a label nobody receives. Expanded
 * it shows the rest, ten at a time — because a barcode's width follows its
 * content, row 87 can overflow while row 1 is perfect, and this is the only
 * place that can be found out before the roll says so. Ten at a time because
 * each one is a real render and a selection may run to a thousand rows.
 *
 * A label bound to nothing has exactly one appearance however many copies are
 * asked for, so there is nothing to expand and no button offering to.
 */
import { useState } from 'react'
import type { LabelIR } from '@zenith/shared'
import { copy } from '../../i18n/index.ts'
import { cn } from '../../lib/utils.ts'
import { Button } from '../../components/ui/button.tsx'
import { Skeleton } from '../../components/ui/skeleton.tsx'
import { previewRequestBody, useLabelPreview } from './use-label-preview.ts'

/** Previews per page. Each is a real render on the server, not a thumbnail. */
export const SHEETS_PER_PAGE = 10

export interface LabelPreviewProps {
  ir: LabelIR
  printerId: string | null
  profileId: string | null
  /** The design's own variables — never the bound table's columns. */
  variableValues: Record<string, string> | null
  dataSourceId: string | null
  /** The chosen rows, in print order (ascending ordinal). */
  rowOrdinals: readonly number[]
  /** What each row is called where it came from, for the caption under it. */
  rowLabel?: (ordinal: number) => string | undefined
}

interface SheetProps extends Omit<LabelPreviewProps, 'rowOrdinals' | 'rowLabel'> {
  ordinal?: number
  caption: React.ReactNode
  /** The big one, when collapsed. */
  large?: boolean
}

function Sheet({ ir, printerId, profileId, variableValues, dataSourceId, ordinal, caption, large = false }: SheetProps): React.JSX.Element {
  const body =
    printerId === null
      ? null
      : previewRequestBody({
          printerId,
          ir,
          profileId,
          variableValues,
          dataSourceId,
          ...(ordinal === undefined ? {} : { rowOrdinal: ordinal }),
        })
  const preview = useLabelPreview(body)
  const ratio = `${ir.widthMm} / ${ir.heightMm}`

  return (
    <figure
      className={cn('flex min-w-0 flex-col gap-n2', large && 'min-h-0 flex-1 items-center')}
      data-sheet={ordinal ?? 1}
    >
      <div
        // Large: sized by the room left over, not by the width of the page —
        // a tall label on a short window would otherwise run off the bottom
        // and sit on top of the facts below it.
        className={cn(
          'paper relative overflow-hidden',
          large ? 'h-full max-h-full w-auto max-w-full' : 'w-full',
        )}
        style={{ aspectRatio: ratio }}
      >
        {preview.url === null ? (
          preview.failed ? (
            // A preview that will not render is not a reason to stop printing;
            // the sheet says so and the button beneath stays live.
            <span className="absolute inset-0 grid place-items-center text-2xs text-neutral-700" data-sheet-failed>
              {copy.preview.failed}
            </span>
          ) : (
            <Skeleton className="absolute inset-0 rounded-none" />
          )
        ) : (
          <img src={preview.url} alt="" className="h-full w-full object-contain" />
        )}
      </div>
      <figcaption
        className={cn('truncate text-2xs', preview.clipped ? 'text-destructive' : 'text-muted-foreground')}
        data-sheet-caption
      >
        {caption}
        {preview.clipped && ` · ${copy.preview.rowClipped}`}
      </figcaption>
    </figure>
  )
}

export function LabelPreview(props: LabelPreviewProps): React.JSX.Element {
  const [expanded, setExpanded] = useState(false)
  const [page, setPage] = useState(1)

  const total = props.rowOrdinals.length
  // One row, or none at all: there is one appearance to look at, and a button
  // promising more would open a page showing the same label again.
  const expandable = props.dataSourceId !== null && total > 1
  const caption = (ordinal: number | undefined, index: number): React.ReactNode => {
    const name = ordinal === undefined ? undefined : props.rowLabel?.(ordinal)
    const which = copy.preview.sheet(index + 1, total === 0 ? 1 : total)
    return name === undefined ? which : `${which} · ${name}`
  }

  if (!expanded) {
    return (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-n4">
        <Sheet
          {...props}
          large
          ordinal={props.rowOrdinals[0]}
          caption={caption(props.rowOrdinals[0], 0)}
        />
        {expandable && (
          <Button variant="ghost" size="sm" onClick={() => setExpanded(true)} data-expand>
            {copy.preview.expandSheets(total)}
          </Button>
        )}
      </div>
    )
  }

  const from = (page - 1) * SHEETS_PER_PAGE
  const shown = props.rowOrdinals.slice(from, from + SHEETS_PER_PAGE)
  const pages = Math.max(1, Math.ceil(total / SHEETS_PER_PAGE))

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-n4">
      <div className="scrollbar-themed min-h-0 flex-1 overflow-y-auto pr-n3">
        <div className="grid grid-cols-[repeat(auto-fill,minmax(18rem,1fr))] gap-n8">
          {shown.map((ordinal, index) => (
            <Sheet key={ordinal} {...props} ordinal={ordinal} caption={caption(ordinal, from + index)} />
          ))}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-n4">
        <Button variant="ghost" size="sm" onClick={() => setExpanded(false)} data-collapse>
          {copy.preview.collapse}
        </Button>
        <span className="text-2xs text-muted-foreground" data-sheet-count>
          {copy.preview.ofSheets(shown.length, total)}
        </span>
        {pages > 1 && (
          <div className="ml-auto flex items-center gap-n2">
            <Button
              variant="outline"
              size="sm"
              disabled={page === 1}
              onClick={() => setPage((current) => current - 1)}
            >
              {copy.preview.previousPage}
            </Button>
            <span className="text-2xs text-muted-foreground">{copy.preview.pageNumber(page)}</span>
            <Button
              variant="outline"
              size="sm"
              disabled={page === pages}
              onClick={() => setPage((current) => current + 1)}
            >
              {copy.preview.nextPage}
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}
