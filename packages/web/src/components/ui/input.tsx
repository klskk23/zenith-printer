import { cn } from '../../lib/utils.ts'

export function Input({ className, ...props }: React.InputHTMLAttributes<HTMLInputElement>): React.JSX.Element {
  return (
    <input
      className={cn(
        'flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm transition-colors placeholder:text-muted-foreground hover:border-foreground/45 focus-visible:border-ring focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-45',
        className,
      )}
      {...props}
    />
  )
}
