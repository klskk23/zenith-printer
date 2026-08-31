/**
 * shadcn/ui Skeleton.
 *
 * For the gap between opening a page and its data arriving. The alternative
 * this replaced was not a blank — it was worse than a blank: the home page read
 * its lists as `data ?? []`, so an unanswered query and an empty table were the
 * same thing, and every visit began by announcing that nothing had been saved
 * and nothing had been printed.
 *
 * `data-slot`, which the rest of this directory does not carry, because that is
 * the only handle a test has on it: a placeholder has no text and no role.
 *
 * No animation. Nothing else in this application animates, and a pulse is the
 * one thing on a static screen that would pull the eye to the part with no
 * information in it.
 */
import { cn } from '../../lib/utils.ts'

export function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>): React.JSX.Element {
  return (
    <div
      data-slot="skeleton"
      aria-hidden
      className={cn('rounded-md bg-muted', className)}
      {...props}
    />
  )
}
