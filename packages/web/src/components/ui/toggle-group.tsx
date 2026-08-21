/**
 * shadcn/ui ToggleGroup.
 *
 * For a small set of mutually exclusive choices whose options are worth seeing
 * at once — text alignment being the obvious one. A dropdown hides two of the
 * three answers behind a click and gives no sense of what the choice is about.
 */
import * as ToggleGroupPrimitive from '@radix-ui/react-toggle-group'
import { cn } from '../../lib/utils.ts'

export function ToggleGroup({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof ToggleGroupPrimitive.Root>): React.JSX.Element {
  return (
    <ToggleGroupPrimitive.Root
      className={cn('inline-flex items-center gap-0.5 rounded-md bg-muted p-0.5', className)}
      {...props}
    />
  )
}

export function ToggleGroupItem({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof ToggleGroupPrimitive.Item>): React.JSX.Element {
  return (
    <ToggleGroupPrimitive.Item
      className={cn(
        'inline-flex h-7 w-7 items-center justify-center rounded-sm text-sm transition-colors',
        'hover:bg-background/60 focus-visible:outline-none focus-visible:ring-1',
        'data-[state=on]:bg-background data-[state=on]:shadow-sm',
        'disabled:pointer-events-none disabled:opacity-50',
        className,
      )}
      {...props}
    />
  )
}
