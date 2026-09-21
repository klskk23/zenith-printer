/** shadcn/ui Badge. Used for the queue count in the sidebar (FR-018). */
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '../../lib/utils.ts'

const badgeVariants = cva(
  'inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium transition-colors',
  {
    variants: {
      variant: {
        // Tints off the ramps, never the accent as a fill: a solid blurple
        // badge would be the loudest thing on the screen.
        default: 'border-accent-700 bg-accent-800 text-accent-100',
        secondary: 'border-neutral-700 bg-neutral-800 text-neutral-100',
        outline: 'border-primary text-primary',
        destructive: 'border-destructive/50 bg-destructive/12 text-destructive',
      },
    },
    defaultVariants: { variant: 'default' },
  },
)

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps): React.JSX.Element {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />
}
