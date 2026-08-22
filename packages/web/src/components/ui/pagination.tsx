/**
 * shadcn/ui Pagination.
 *
 * Two pieces: `pageWindow` decides which numbers to show, and the components
 * draw them. The decision is separated because it is the part with edge cases —
 * a window that slides is easy to get subtly wrong at the ends, and getting it
 * wrong means the last page is unreachable.
 *
 * Rendered as buttons rather than anchors. This is a control inside a dialog,
 * not navigation: there is no URL to link to, and an `<a href="#">` announces
 * itself to a screen reader as a link that goes nowhere.
 */
import { ChevronLeft, ChevronRight, MoreHorizontal } from 'lucide-react'
import { Button } from './button.tsx'
import { cn } from '../../lib/utils.ts'

/** A page number to offer, or a gap where numbers were left out. */
export type PageSlot = number | 'gap'

/**
 * Which page numbers to show around the current one.
 *
 * Always includes the first and last page: they are the two people reach for
 * most, and a window that hides them makes the end of a long table something
 * you have to click your way to.
 *
 * `around` is how many neighbours to keep on each side of the current page.
 */
export function pageWindow(current: number, pageCount: number, around = 1): PageSlot[] {
  if (pageCount <= 1) {
    return [1]
  }

  const wanted = new Set<number>([1, pageCount])
  for (let page = current - around; page <= current + around; page += 1) {
    if (page >= 1 && page <= pageCount) {
      wanted.add(page)
    }
  }

  const pages = [...wanted].sort((a, b) => a - b)
  const slots: PageSlot[] = []
  let previous: number | undefined
  for (const page of pages) {
    // A gap only when something was actually skipped. A "gap" hiding a single
    // page is worse than the page: it costs a click to reach what the ellipsis
    // takes the same width as.
    if (previous !== undefined && page - previous > 1) {
      slots.push(page - previous === 2 ? page - 1 : 'gap')
    }
    slots.push(page)
    previous = page
  }
  return slots
}

export interface PaginationProps {
  page: number
  pageCount: number
  onPageChange: (page: number) => void
  /** Accessible names, so this primitive carries no hardcoded language. */
  labels: { previous: string; next: string; page: (n: number) => string }
  className?: string
}

export function Pagination({
  page,
  pageCount,
  onPageChange,
  labels,
  className,
}: PaginationProps): React.JSX.Element {
  return (
    <nav
      aria-label={labels.page(page)}
      className={cn('flex items-center justify-center gap-1', className)}
      data-pagination
    >
      <Button
        variant="ghost"
        size="icon"
        disabled={page <= 1}
        aria-label={labels.previous}
        onClick={() => onPageChange(page - 1)}
      >
        <ChevronLeft className="h-4 w-4" />
      </Button>

      {pageWindow(page, pageCount).map((slot, index) =>
        slot === 'gap' ? (
          <span
            key={`gap-${index}`}
            aria-hidden
            className="flex h-8 w-8 items-center justify-center text-muted-foreground"
          >
            <MoreHorizontal className="h-4 w-4" />
          </span>
        ) : (
          <Button
            key={slot}
            variant={slot === page ? 'outline' : 'ghost'}
            size="icon"
            aria-label={labels.page(slot)}
            aria-current={slot === page ? 'page' : undefined}
            className={cn('h-8 w-8 text-xs', slot === page && 'font-medium')}
            onClick={() => onPageChange(slot)}
          >
            {slot}
          </Button>
        ),
      )}

      <Button
        variant="ghost"
        size="icon"
        disabled={page >= pageCount}
        aria-label={labels.next}
        onClick={() => onPageChange(page + 1)}
      >
        <ChevronRight className="h-4 w-4" />
      </Button>
    </nav>
  )
}
