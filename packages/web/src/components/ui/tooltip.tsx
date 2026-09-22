/**
 * shadcn/ui Tooltip, over Radix.
 *
 * A sentence that belongs to one control and is not worth the room it would
 * take standing under it. Radix opens it on hover *and* on keyboard focus,
 * which is the reason to use it rather than the `title` attribute: that one is
 * drawn by the operating system, in a light box, after a delay nobody can set.
 *
 * What it must never hold is a value somebody has to carry away — its text
 * cannot be selected and it vanishes when the pointer leaves. Those go in a
 * `ValueHint`, which is a Popover.
 */
import * as TooltipPrimitive from '@radix-ui/react-tooltip'
import { cn } from '../../lib/utils.ts'

export const TooltipProvider = TooltipPrimitive.Provider
export const Tooltip = TooltipPrimitive.Root
export const TooltipTrigger = TooltipPrimitive.Trigger

export function TooltipContent({
  className,
  sideOffset = 6,
  ...props
}: React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Content>): React.JSX.Element {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        data-slot="tooltip-content"
        sideOffset={sideOffset}
        className={cn(
          'z-50 max-w-72 rounded-md bg-popover px-n4 py-n3 text-2xs leading-relaxed text-popover-foreground shadow-md',
          className,
        )}
        {...props}
      />
    </TooltipPrimitive.Portal>
  )
}
