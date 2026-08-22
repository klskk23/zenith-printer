/**
 * shadcn/ui Label, over Radix.
 *
 * Radix rather than a bare `<label>` for the `onMouseDown` guard it adds:
 * without it, double-clicking a label selects the surrounding text instead of
 * doing nothing, which looks like a broken click target.
 */
import * as LabelPrimitive from '@radix-ui/react-label'
import { cn } from '../../lib/utils.ts'

export function Label({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof LabelPrimitive.Root>): React.JSX.Element {
  return (
    <LabelPrimitive.Root
      className={cn('text-xs font-medium text-muted-foreground', className)}
      {...props}
    />
  )
}
