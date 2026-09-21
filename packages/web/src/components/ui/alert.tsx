import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '../../lib/utils.ts'

/**
 * A state is a tinted panel with coloured text and a coloured edge — never a
 * solid block. The tint is the state colour at 10%, which on the dark ground
 * is enough to read as "this panel is about something" without competing
 * with the label.
 */
const alertVariants = cva('rounded-md border px-3 py-2 text-sm', {
  variants: {
    variant: {
      default: 'border-border bg-muted text-foreground',
      destructive: 'border-destructive/40 bg-destructive/10 text-destructive',
      warning: 'border-warning/40 bg-warning/10 text-warning',
      // "Happening now": the accent, with the readable step for body text.
      info: 'border-info/40 bg-info/10 text-accent-300',
    },
  },
  defaultVariants: { variant: 'default' },
})

export interface AlertProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof alertVariants> {}

export function Alert({ className, variant, ...props }: AlertProps): React.JSX.Element {
  return <div role="alert" className={cn(alertVariants({ variant }), className)} {...props} />
}
