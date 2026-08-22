/**
 * shadcn/ui Separator, over Radix.
 *
 * A divider is decorative by default, so Radix marks it `aria-hidden` and
 * keeps it out of the accessibility tree — a screen reader announcing
 * "separator" between every toolbar group is noise.
 */
import * as SeparatorPrimitive from '@radix-ui/react-separator'
import { cn } from '../../lib/utils.ts'

export function Separator({
  className,
  orientation = 'horizontal',
  decorative = true,
  ...props
}: React.ComponentPropsWithoutRef<typeof SeparatorPrimitive.Root>): React.JSX.Element {
  return (
    <SeparatorPrimitive.Root
      data-slot="separator"
      decorative={decorative}
      orientation={orientation}
      className={cn(
        'shrink-0 bg-border',
        orientation === 'horizontal' ? 'h-px w-full' : 'h-full w-px',
        className,
      )}
      {...props}
    />
  )
}
