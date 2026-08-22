/**
 * shadcn/ui ScrollArea.
 *
 * Radix hides the native scrollbar and draws its own, so a scrolling region
 * looks the same on every platform and follows the theme. Use it wherever a
 * region scrolls **and nothing needs the scrolling element itself**.
 *
 * It is not always the right answer, and the reason is its internals: the
 * viewport wraps its children in a `display: table` element. That breaks flex
 * centring, and the element that actually scrolls is not the one you passed a
 * ref to. Regions that centre their content, that attach their own wheel
 * handler, or that belong to a third-party component keep the native scrollbar
 * and take the `scrollbar-themed` class instead — the same shape, drawn by the
 * browser.
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
