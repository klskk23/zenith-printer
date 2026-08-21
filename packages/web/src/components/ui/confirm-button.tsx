/**
 * A button whose action is confirmed first.
 *
 * Three places had drifted to `window.confirm`, which is a different dialog in
 * every browser, ignores the application's theme, and cannot be styled to
 * distinguish "delete this" from "are you sure". Wrapping the shadcn dialog
 * once is cheaper than repeating it at each site, and makes the inconsistency
 * hard to reintroduce.
 */
import { useState } from 'react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from './alert-dialog.tsx'
import { Button, type ButtonProps } from './button.tsx'

export interface ConfirmButtonProps extends Omit<ButtonProps, 'onClick'> {
  title: string
  description: string
  cancelLabel: string
  confirmLabel: string
  onConfirm: () => void
}

export function ConfirmButton({
  title,
  description,
  cancelLabel,
  confirmLabel,
  onConfirm,
  children,
  ...buttonProps
}: ConfirmButtonProps): React.JSX.Element {
  const [open, setOpen] = useState(false)

  return (
    <>
      <Button {...buttonProps} onClick={() => setOpen(true)}>
        {children}
      </Button>
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{title}</AlertDialogTitle>
            <AlertDialogDescription>{description}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{cancelLabel}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                onConfirm()
                setOpen(false)
              }}
            >
              {confirmLabel}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
