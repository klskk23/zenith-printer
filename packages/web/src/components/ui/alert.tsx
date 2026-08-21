import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '../../lib/utils.ts'

const alertVariants = cva('rounded-md border px-3 py-2 text-sm', {
  variants: {
    variant: {
      default: 'border-border bg-muted text-foreground',
      destructive: 'border-destructive/40 bg-destructive/10 text-destructive',
      warning: 'border-amber-500/40 bg-amber-500/10 text-amber-800',
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
