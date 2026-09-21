/**
 * shadcn/ui Separator, over Radix.
 *
 * A divider is decorative by default, so Radix marks it `aria-hidden` and
 * keeps it out of the accessibility tree — a screen reader announcing
 * "separator" between every toolbar group is noise.
 */
import * as SeparatorPrimitive from '@radix-ui/react-separator'
import { cn } from '../../lib/utils.ts'

export interface SeparatorProps
  extends React.ComponentPropsWithoutRef<typeof SeparatorPrimitive.Root> {
  /**
   * Fade the rule out at both ends.
   *
   * For a rule standing on its own between two blocks of content, where a
   * hard edge reads as the side of a box that is not there. A rule inside a
   * control, or one that really is a box edge, stays solid. Horizontal only:
   * the gradient runs along the rule's length.
   */
  fade?: boolean
}

export function Separator({
  className,
  orientation = 'horizontal',
  decorative = true,
  fade = false,
  ...props
}: SeparatorProps): React.JSX.Element {
  return (
    <SeparatorPrimitive.Root
      data-slot="separator"
      decorative={decorative}
      orientation={orientation}
      className={cn(
        'shrink-0',
        fade && orientation === 'horizontal' ? 'separator-fade' : 'bg-border',
        orientation === 'horizontal' ? 'h-px w-full' : 'h-full w-px',
        className,
      )}
      {...props}
    />
  )
}
