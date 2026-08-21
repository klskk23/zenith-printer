/**
 * shadcn/ui Progress.
 *
 * A hundred-copy run takes minutes. "3 / 100" is accurate but gives no sense of
 * how long is left; a bar answers that at a glance.
 *
 * `value` may be null, which is not the same as zero: after a service restart
 * the printed count is genuinely unknown, and a bar sitting at zero would tell
 * someone to reprint the whole batch.
 */
import * as ProgressPrimitive from '@radix-ui/react-progress'
import { cn } from '../../lib/utils.ts'

export function Progress({
  className,
  value,
  ...props
}: React.ComponentPropsWithoutRef<typeof ProgressPrimitive.Root>): React.JSX.Element {
  return (
    <ProgressPrimitive.Root
      value={value}
      className={cn('relative h-1.5 w-full overflow-hidden rounded-full bg-muted', className)}
      {...props}
    >
      <ProgressPrimitive.Indicator
        className={cn(
          'h-full w-full flex-1 transition-transform',
          // An indeterminate bar is striped rather than empty, so "unknown"
          // never looks like "none".
          value === null || value === undefined
            ? 'bg-[repeating-linear-gradient(45deg,var(--color-muted-foreground)_0_6px,transparent_6px_12px)] opacity-50'
            : 'bg-primary',
        )}
        style={{ transform: `translateX(-${100 - (value ?? 100)}%)` }}
      />
    </ProgressPrimitive.Root>
  )
}
