/** shadcn/ui Textarea. Multi-line label text is entered here. */
import { cn } from '../../lib/utils.ts'

export function Textarea({
  className,
  ...props
}: React.TextareaHTMLAttributes<HTMLTextAreaElement>): React.JSX.Element {
  return (
    <textarea
      className={cn(
        'flex min-h-16 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm hover:border-foreground/45 focus-visible:border-ring focus-visible:outline-none',
        'placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2',
        'disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    />
  )
}
