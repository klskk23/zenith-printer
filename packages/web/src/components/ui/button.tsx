/** shadcn/ui Button. Custom components reuse these tokens rather than restyling. */
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '../../lib/utils.ts'

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground hover:opacity-90',
        outline: 'border border-border bg-background hover:bg-muted',
        ghost: 'hover:bg-muted',
        destructive: 'bg-destructive text-white hover:opacity-90',
      },
      size: {
        default: 'h-9 px-4 py-2',
        sm: 'h-8 rounded-md px-3 text-xs',
        // Square, and the same height as `default` — an icon button sitting in
        // a row of inputs and selects has to line up with them. It used to be
        // h-8, which made every toolbar it appeared in look a pixel out.
        icon: 'h-9 w-9',
        'icon-sm': 'h-8 w-8',
        // Small enough to sit inside a tab strip or a list row without setting
        // the row's height.
        'icon-xs': 'h-5 w-5',
        /**
         * A row in a list or a navigation strip.
         *
         * Full width, left-aligned, height set by its content rather than by
         * the button. Six places had hand-rolled this shape — the sidebar, both
         * halves of the tab strip, the layer list and two cards on the home
         * page — each with its own padding and its own focus behaviour. A size
         * here is cheaper than six near-copies, and it means a row picks up the
         * focus ring and the disabled handling that every other button has.
         */
        row: 'h-auto w-full justify-start px-2.5 py-1.5 text-left text-xs font-normal',
        /** A row that is only as wide as its text — a tab title, a list entry. */
        'row-inline': 'h-auto w-auto justify-start p-0 text-xs font-normal'
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

export function Button({ className, variant, size, asChild = false, ...props }: ButtonProps): React.JSX.Element {
  const Comp = asChild ? Slot : 'button'
  return <Comp className={cn(buttonVariants({ variant, size }), className)} {...props} />
}

export { buttonVariants }
