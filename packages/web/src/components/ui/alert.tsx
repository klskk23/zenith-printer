import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '../../lib/utils.ts'

const alertVariants = cva('rounded-md border px-3 py-2 text-sm', {
  variants: {
    variant: {
      default: 'border-border bg-muted text-foreground',
      destructive: 'border-destructive/40 bg-destructive/10 text-destructive',
      // Was `text-amber-800` on a fixed amber tint: a dark brown, chosen for
      // white paper, printed onto a near-black background in dark mode. The
      // token follows the theme.
      warning: 'border-warning/40 bg-warning/10 text-warning',
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
