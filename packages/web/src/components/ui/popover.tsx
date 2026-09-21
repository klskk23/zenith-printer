/**
 * shadcn/ui Popover, over Radix.
 *
 * A small panel anchored to the thing that opened it — for details worth a
 * click but not a page. Drawn as a card at Nocturne's `shadow-md`: a hairline
 * edge and ambient darkness, never a filled block.
 */
import * as PopoverPrimitive from '@radix-ui/react-popover'
import { cn } from '../../lib/utils.ts'

export const Popover = PopoverPrimitive.Root
export const PopoverTrigger = PopoverPrimitive.Trigger

export function PopoverContent({
  className,
  align = 'start',
  sideOffset = 6,
  ...props
}: React.ComponentPropsWithoutRef<typeof PopoverPrimitive.Content>): React.JSX.Element {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        data-slot="popover-content"
        align={align}
        sideOffset={sideOffset}
        className={cn(
          'z-50 w-64 rounded-md bg-popover p-n4 text-popover-foreground shadow-md outline-none',
          className,
        )}
        {...props}
      />
    </PopoverPrimitive.Portal>
  )
}
