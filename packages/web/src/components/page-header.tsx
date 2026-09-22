/**
 * The heading every page opens with.
 *
 * Each page had grown its own arrangement — a bare `<h2>`, or one with a
 * button floated beside it, or one with a paragraph under it — so no two pages
 * put their title and their actions in quite the same place. None of that is a
 * bug and all of it costs the reader something: the eye has to find the
 * controls again on every page.
 *
 * Deliberately not a Card. A page's title is not a thing on the page; giving
 * it a border would make it one, and would put a box around the box the
 * content is already in.
 */
import { cn } from '../lib/utils.ts'

export interface PageHeaderProps {
  title: string
  /** One line on what the page is for. Omitted when the title says it all. */
  description?: string
  /** Buttons that act on the page as a whole, not on any one row. */
  actions?: React.ReactNode
  /**
   * A mark that belongs to the title itself — in practice the page's `?`.
   *
   * Beside the title rather than under it: the explanations that used to sit
   * under a title were read once and then skipped forever, while taking a line
   * of every page for good.
   */
  titleAdornment?: React.ReactNode
  /** Smaller treatment for section headings nested inside a page. */
  compact?: boolean
  className?: string
}

export function PageHeader({
  title,
  description,
  actions,
  titleAdornment,
  compact = false,
  className,
}: PageHeaderProps): React.JSX.Element {
  return (
    <div className={cn('flex flex-col gap-1', className)} data-page-header>
      <div className="flex min-h-8 items-center justify-between gap-3">
        {/* The title gives way, not the controls: a search box that has been
            squeezed to nothing is unusable, whereas a long page title reads
            fine cut short. */}
        {/* Weight 500, never bolder: hierarchy in this palette is size and
            space, and a bold heading on the dark ground reads as shouting. */}
        <div className="flex min-w-0 items-center gap-n2">
          <h2 className={cn('min-w-0 truncate font-medium', compact ? 'text-sm' : 'text-base')}>
            {title}
          </h2>
          {titleAdornment}
        </div>
        {actions !== undefined && (
          <div className="flex shrink-0 items-center justify-end gap-2">{actions}</div>
        )}
      </div>
      {/* Rendered only when there is one — an empty paragraph still takes
          vertical space, which is how two pages come to sit at different
          heights for no reason anybody can see. */}
      {description !== undefined && description.length > 0 && (
        <p className="text-2xs text-muted-foreground">{description}</p>
      )}
    </div>
  )
}
