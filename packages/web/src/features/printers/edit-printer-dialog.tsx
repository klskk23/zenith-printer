/**
 * Correcting how a printer is reached.
 *
 * An address is not permanent. A networked printer is given a new IP, a USB
 * device node is renumbered when something else is plugged into the machine, a
 * serial port moves. Before this the only way to fix one was to delete the
 * printer and add it again — which discards its profiles, its position
 * correction and the link from every job it has ever run.
 *
 * The kind and the transport are shown but not editable: they decide which
 * driver speaks to the device, so a record that changed them would be a
 * different machine wearing the old one's history. Deleting and re-adding says
 * that plainly, which is the honest way to express it.
 */
import { useEffect, useState } from 'react'
import { ApiRequestError } from '../../api/client.ts'
import { copy } from '../../i18n/index.ts'
import { Alert } from '../../components/ui/alert.tsx'
import { Button } from '../../components/ui/button.tsx'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog.tsx'
import { Input } from '../../components/ui/input.tsx'
import { Label } from '../../components/ui/label.tsx'
import { useUpdatePrinter } from './hooks.ts'
import type { Printer } from '../../api/types.ts'

export interface EditPrinterDialogProps {
  printer: Printer
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function EditPrinterDialog({ printer, open, onOpenChange }: EditPrinterDialogProps): React.JSX.Element {
  const update = useUpdatePrinter()
  const [name, setName] = useState(printer.name)
  const [address, setAddress] = useState(printer.address)
  const [printTaskName, setPrintTaskName] = useState(printer.printTaskName ?? '')

  // Reset when the dialog opens, so a cancelled edit does not persist into the
  // next one, and so a change made elsewhere is picked up.
  useEffect(() => {
    if (open) {
      setName(printer.name)
      setAddress(printer.address)
      setPrintTaskName(printer.printTaskName ?? '')
      update.reset()
    }
    // Keyed on the printer's own fields rather than on `update`, which is a new
    // object every render and would reset the form mid-typing.
  }, [open, printer.name, printer.address, printer.printTaskName])

  const moved = address !== printer.address

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{copy.printers.edit}</DialogTitle>
          <DialogDescription>
            {printer.kind} · {printer.transport}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1">
            <Label>{copy.printers.fields.name}</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </div>

          <div className="space-y-1">
            <Label>{copy.printers.fields.address}</Label>
            <Input value={address} onChange={(e) => setAddress(e.target.value)} />
            <p className="text-2xs text-muted-foreground">
              {printer.transport === 'serial'
                ? copy.printers.hints.serialAddress
                : copy.printers.hints.tcpAddress}
            </p>
          </div>

          {printer.kind === 'niimbot' && (
            <div className="space-y-1">
              <Label>{copy.printers.fields.printTaskName}</Label>
              <Input value={printTaskName} onChange={(e) => setPrintTaskName(e.target.value)} />
              <p className="text-2xs text-muted-foreground">{copy.printers.hints.printTaskName}</p>
            </div>
          )}

          {/*
            Said before saving, not after. The probed numbers describe whatever
            answered at the old address — head width, dpi, density range — and
            printing a label against another machine's figures goes wrong in
            ways nobody checks.
          */}
          {moved && printer.capabilities !== null && (
            <Alert variant="warning" className="text-xs">
              {copy.printers.addressChangeClearsProbe}
            </Alert>
          )}

          {update.error !== null && <ErrorText error={update.error} />}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {copy.common.cancel}
          </Button>
          <Button
            disabled={name.length === 0 || address.length === 0 || update.isPending}
            onClick={() =>
              update.mutate(
                {
                  id: printer.id,
                  changes: {
                    name,
                    address,
                    ...(printer.kind === 'niimbot' && printTaskName.length > 0 ? { printTaskName } : {}),
                  },
                },
                { onSuccess: () => onOpenChange(false) },
              )
            }
          >
            {copy.common.save}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** The server words its own failures; repeating them here would give one fault two descriptions. */
function ErrorText({ error }: { error: unknown }): React.JSX.Element {
  const body = error instanceof ApiRequestError ? error.body : null
  return (
    <Alert variant="destructive" className="text-xs">
      {body === null ? copy.networkError.what : `${body.what} ${body.next}`}
    </Alert>
  )
}
