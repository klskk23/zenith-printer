/** shadcn/ui Textarea. Multi-line label text is entered here. */
import { cn } from '../../lib/utils.ts'

export function Textarea({
  className,
  ...props
}: React.TextareaHTMLAttributes<HTMLTextAreaElement>): React.JSX.Element {
  return (
    <textarea
      className={cn(
        'flex min-h-16 w-full rounded-md border border-border bg-background px-3 py-2 text-sm',
        'placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2',
        'disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    />
  )
}
