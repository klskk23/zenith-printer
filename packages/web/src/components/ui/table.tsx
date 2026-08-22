import { cn } from '../../lib/utils.ts'

/**
 * shadcn/ui Table primitives.
 *
 * Wide tables scroll inside their own container rather than pushing the page
 * sideways — a data source can carry any number of columns, and the column
 * names come from somebody's spreadsheet.
 */
export function Table({ className, ...props }: React.HTMLAttributes<HTMLTableElement>): React.JSX.Element {
  return (
    // Native, like shadcn's own Table: a table is often already inside a
    // scrolling region, and a Radix viewport here would nest two of them.
    <div className="scrollbar-themed relative w-full overflow-x-auto">
      <table className={cn('w-full caption-bottom text-sm', className)} {...props} />
    </div>
  )
}

export function TableHeader({ className, ...props }: React.HTMLAttributes<HTMLTableSectionElement>): React.JSX.Element {
  return <thead className={cn('[&_tr]:border-b', className)} {...props} />
}

export function TableBody({ className, ...props }: React.HTMLAttributes<HTMLTableSectionElement>): React.JSX.Element {
  return <tbody className={cn('[&_tr:last-child]:border-0', className)} {...props} />
}

export function TableRow({ className, ...props }: React.HTMLAttributes<HTMLTableRowElement>): React.JSX.Element {
  return (
    <tr
      className={cn('border-b border-border transition-colors hover:bg-muted/50 data-[state=selected]:bg-muted', className)}
      {...props}
    />
  )
}

export function TableHead({ className, ...props }: React.ThHTMLAttributes<HTMLTableCellElement>): React.JSX.Element {
  return (
    <th
      className={cn('h-9 px-2 text-left align-middle font-medium text-muted-foreground whitespace-nowrap', className)}
      {...props}
    />
  )
}

export function TableCell({ className, ...props }: React.TdHTMLAttributes<HTMLTableCellElement>): React.JSX.Element {
  return <td className={cn('px-2 py-1.5 align-middle', className)} {...props} />
}

export function TableCaption({ className, ...props }: React.HTMLAttributes<HTMLTableCaptionElement>): React.JSX.Element {
  return <caption className={cn('mt-2 text-xs text-muted-foreground', className)} {...props} />
}
