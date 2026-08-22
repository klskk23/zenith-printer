/**
 * shadcn/ui ScrollArea.
 *
 * Radix hides the native scrollbar and draws its own, so a scrolling region
 * looks the same on every platform and follows the theme.
 *
 * **It needs a definite height** (`h-full` under a flex or grid parent, or a
 * fixed `h-*`). The element that actually scrolls is the viewport, sized
 * `height: 100%`, and a percentage against a parent that is `auto` — which is
 * what `max-h-*` alone leaves it — resolves to auto. The viewport then grows to
 * fit its content, the root clips it, and the region does not scroll at all
 * while looking as though its content simply ends. A region that wants a *cap*
 * rather than a height is not a ScrollArea; give it `overflow-y-auto` and the
 * `scrollbar-themed` class.
 *
 * Two more places it is the wrong answer, both because the viewport wraps its
 * children in a `display: table` element:
 *
 *   - anything that centres its content with flex, which that wrapper breaks;
 *   - anything containing its own scroller, such as `ui/table.tsx` and its
 *     `overflow-x-auto` box. The table wrapper is shrink-wrapped to the table's
 *     full width, so it never overflows, never offers a horizontal scrollbar,
 *     and the table is quietly cut off instead.
 *
 * Also not for a region whose scrolling element you need a ref to, or whose
 * wheel handler must be `{ passive: false }` — the scroller is not the element
 * the ref was given to.
 */
import * as ScrollAreaPrimitive from '@radix-ui/react-scroll-area'
import { cn } from '../../lib/utils.ts'

function Scrollbar({
  orientation,
}: {
  orientation: 'vertical' | 'horizontal'
}): React.JSX.Element {
  return (
    <ScrollAreaPrimitive.Scrollbar
      orientation={orientation}
      className={cn(
        'flex touch-none select-none transition-colors',
        orientation === 'vertical'
          ? 'h-full w-2 border-l border-l-transparent p-[1px]'
          : 'h-2 flex-col border-t border-t-transparent p-[1px]',
      )}
    >
      <ScrollAreaPrimitive.Thumb className="relative flex-1 rounded-full bg-border" />
    </ScrollAreaPrimitive.Scrollbar>
  )
}

export function ScrollArea({
  className,
  children,
  orientation = 'vertical',
  ...props
}: React.ComponentPropsWithoutRef<typeof ScrollAreaPrimitive.Root> & {
  orientation?: 'vertical' | 'horizontal' | 'both'
}): React.JSX.Element {
  return (
    <ScrollAreaPrimitive.Root className={cn('relative overflow-hidden', className)} {...props}>
      <ScrollAreaPrimitive.Viewport className="h-full w-full rounded-[inherit]">
        {children}
      </ScrollAreaPrimitive.Viewport>
      {orientation !== 'horizontal' && <Scrollbar orientation="vertical" />}
      {orientation !== 'vertical' && <Scrollbar orientation="horizontal" />}
      <ScrollAreaPrimitive.Corner />
    </ScrollAreaPrimitive.Root>
  )
}
