import { cn } from '../../lib/utils.ts'

export function Select({ className, ...props }: React.SelectHTMLAttributes<HTMLSelectElement>): React.JSX.Element {
  return (
    <select
      className={cn(
        'flex h-9 w-full rounded-md border border-border bg-background px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 disabled:opacity-50',
        className,
      )}
      {...props}
    />
  )
}
