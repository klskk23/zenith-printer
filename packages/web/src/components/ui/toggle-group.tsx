/**
 * shadcn/ui ToggleGroup.
 *
 * For a small set of mutually exclusive choices whose options are worth seeing
 * at once — text alignment being the obvious one. A dropdown hides two of the
 * three answers behind a click and gives no sense of what the choice is about.
 *
 * Items hold either an icon or a short label. Both fit: the item has a minimum
 * width rather than a fixed one, which is what upstream shadcn/ui does and what
 * this copy of it had dropped.
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
        // `min-w` and padding rather than a fixed square. An icon still lands
        // on 28px, and a text label — 「180°」, 「倒序」 — grows instead of
        // spilling over its neighbours, which a fixed `w-7` let it do.
        'inline-flex h-7 min-w-7 items-center justify-center rounded-sm px-1.5 text-sm transition-colors',
        'hover:bg-background/60 focus-visible:outline-none focus-visible:ring-1',
        'data-[state=on]:bg-background data-[state=on]:shadow-sm',
        'disabled:pointer-events-none disabled:opacity-50',
        className,
      )}
      {...props}
    />
  )
}
