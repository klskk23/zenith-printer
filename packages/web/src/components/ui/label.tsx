import { cn } from '../../lib/utils.ts'

export function Label({ className, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>): React.JSX.Element {
  return <label className={cn('text-xs font-medium text-muted-foreground', className)} {...props} />
}
