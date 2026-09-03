/**
 * shadcn/ui Dialog.
 *
 * Distinct from AlertDialog: that one asks a yes/no question about something
 * irreversible and traps focus on the two answers. This one holds a form.
 * Putting an input inside an AlertDialog gets the semantics wrong for screen
 * readers, which announce it as an alert.
 */
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { cn } from '../../lib/utils.ts'

export const Dialog = DialogPrimitive.Root
export const DialogTrigger = DialogPrimitive.Trigger

export function DialogContent({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>): React.JSX.Element {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/50" />
      <DialogPrimitive.Content
        className={cn(
          'fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2',
          'rounded-lg border border-border bg-background p-5 shadow-lg',
          className,
        )}
        {...props}
      />
    </DialogPrimitive.Portal>
  )
}

export function DialogHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>): React.JSX.Element {
  return <div className={cn('flex flex-col gap-1.5', className)} {...props} />
}

export function DialogFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>): React.JSX.Element {
  return <div className={cn('mt-5 flex justify-end gap-2', className)} {...props} />
}

export function DialogTitle({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>): React.JSX.Element {
  return <DialogPrimitive.Title className={cn('text-sm font-semibold', className)} {...props} />
}

export function DialogDescription({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>): React.JSX.Element {
  return <DialogPrimitive.Description className={cn('text-xs text-muted-foreground', className)} {...props} />
}

export const DialogClose = DialogPrimitive.Close
