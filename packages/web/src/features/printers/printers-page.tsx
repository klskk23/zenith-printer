/**
 * Printer management.
 *
 * The operator types in the address and the command language; everything else
 * comes from probing (FR-024, FR-025). Two things get called out prominently
 * because getting them wrong is expensive:
 *
 *   - the print task value. There is no `P1`; B3S_P uses `B1`, and a wrong
 *     value is rejected with an enum error that does not say what to use.
 *   - whether the model can report remaining stock. Without it there is no
 *     advance warning before running out mid-job (FR-016).
 */
import { useState } from 'react'
import { ApiRequestError } from '../../api/client.ts'
import type { Printer, PrinterKind, TransportKind } from '../../api/types.ts'
import { copy } from '../../i18n/index.ts'
import { Printer as PrinterIcon } from 'lucide-react'
import { PageHeader } from '../../components/page-header.tsx'
import { Alert } from '../../components/ui/alert.tsx'
import { Skeleton } from '../../components/ui/skeleton.tsx'
import { Field, FieldDescription, FieldGroup, FieldLabel } from '../../components/ui/field.tsx'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '../../components/ui/empty.tsx'
import { Button } from '../../components/ui/button.tsx'
import { ConfirmButton } from '../../components/ui/confirm-button.tsx'
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card.tsx'
import { Input } from '../../components/ui/input.tsx'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../components/ui/select.tsx'
import { OffsetPanel } from './offset-panel.tsx'
import { ProfilesPanel } from '../profiles/profiles-panel.tsx'
import { EditPrinterDialog } from './edit-printer-dialog.tsx'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog.tsx'
import {
  useAddPrinter,
  useDeletePrinter,
  usePrinters,
  useProbePrinter,
  useSetQueueState,
} from './hooks.ts'

const MM_PER_INCH = 25.4

function ErrorNotice({ error }: { error: unknown }): React.JSX.Element | null {
  if (!(error instanceof ApiRequestError)) {
    return null
  }
  // Shown verbatim: the server already worded this, and rewording it here
  // would give the same fault two descriptions.
  return (
    <Alert variant={error.needsSomeoneOnSite ? 'warning' : 'destructive'} className="mt-2">
      <p className="font-medium">{error.body.what}</p>
      <p className="mt-1 text-xs opacity-90">{error.body.why}</p>
      <p className="mt-1 text-xs font-medium">{error.body.next}</p>
    </Alert>
  )
}

function CapabilityList({ printer }: { printer: Printer }): React.JSX.Element {
  const c = printer.capabilities
  if (c === null) {
    return <p className="text-xs text-muted-foreground">{copy.printers.notProbed}</p>
  }

  const maxWidthMm = ((c.printheadPixels / c.dpi) * MM_PER_INCH).toFixed(1)
  const rows: [string, string][] = [
    [copy.printers.capabilities.model, c.model ?? '—'],
    [copy.printers.capabilities.dpi, `${c.dpi} dpi`],
    [copy.printers.capabilities.maxWidth, `${maxWidthMm} mm (${c.printheadPixels} dot)`],
    [copy.printers.capabilities.density, `${c.densityMin}–${c.densityMax}`],
    [copy.printers.capabilities.firmware, c.firmwareVersion ?? '—'],
  ]

  return (
    <div className="flex flex-col gap-1">
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
        {rows.map(([term, value]) => (
          <div key={term} className="contents">
            <dt className="text-muted-foreground">{term}</dt>
            <dd className="font-mono">{value}</dd>
          </div>
        ))}
      </dl>
      {c.supportsConsumableLevel ? (
        <p className="text-xs text-muted-foreground">
          {copy.printers.capabilities.consumable}: {copy.printers.capabilities.supported}
        </p>
      ) : (
        // FR-016: the two kinds differ here, and the difference is the user's
        // to know. A model that cannot count its stock will simply stop
        // mid-batch, with no warning beforehand.
        <Alert variant="warning" className="mt-2 text-xs">
          {copy.printers.capabilities.unsupportedHint}
        </Alert>
      )}
    </div>
  )
}

/**
 * Adding a printer, in a dialog.
 *
 * The form used to sit open below the list, so every visit to this page put a
 * five-field form under the printers — and the reason to come here is almost
 * always one of the printers, not a new one. It also grew: the list is what
 * somebody scrolls to, and the form was in the way of getting back to it.
 */
function AddPrinterDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}): React.JSX.Element {
  const add = useAddPrinter()
  const [kind, setKind] = useState<PrinterKind>('niimbot')
  const [transport, setTransport] = useState<TransportKind>('serial')
  const [name, setName] = useState('')
  const [address, setAddress] = useState('/dev/ttyACM0')
  const [printTaskName, setPrintTaskName] = useState('B1')

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-add-printer>
        <DialogHeader>
          <DialogTitle>{copy.printers.add}</DialogTitle>
        </DialogHeader>
        <FieldGroup>
        <div className="grid grid-cols-2 gap-3">
          <Field>
            <FieldLabel>{copy.printers.fields.name}</FieldLabel>
            <Input
              aria-label={copy.printers.fields.name}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </Field>
          <Field>
            <FieldLabel>{copy.printers.fields.kind}</FieldLabel>
            <Select
              value={kind}
              onValueChange={(value) => {
                const next = value as PrinterKind
                setKind(next)
                setTransport(next === 'niimbot' ? 'serial' : 'tcp')
                setAddress(next === 'niimbot' ? '/dev/ttyACM0' : '192.168.1.50:9100')
              }}
            >
              <SelectTrigger aria-label={copy.printers.fields.kind}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="niimbot">niimbot</SelectItem>
                <SelectItem value="zpl">zpl</SelectItem>
              </SelectContent>
            </Select>
          </Field>
        </div>

        <Field>
          <FieldLabel>{copy.printers.fields.address}</FieldLabel>
          <Input
            aria-label={copy.printers.fields.address}
            value={address}
            onChange={(e) => setAddress(e.target.value)}
          />
          <FieldDescription>
            {transport === 'serial' ? copy.printers.hints.serialAddress : copy.printers.hints.tcpAddress}
          </FieldDescription>
        </Field>

        {kind === 'niimbot' && (
          <Field>
            <FieldLabel>{copy.printers.fields.printTaskName}</FieldLabel>
            <Input
              aria-label={copy.printers.fields.printTaskName}
              value={printTaskName}
              onChange={(e) => setPrintTaskName(e.target.value)}
            />
            <FieldDescription>{copy.printers.hints.printTaskName}</FieldDescription>
          </Field>
        )}

        <ErrorNotice error={add.error} />
        </FieldGroup>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {copy.common.cancel}
          </Button>
          <Button
            disabled={name.length === 0 || add.isPending}
            onClick={() =>
              add.mutate(
                {
                  name,
                  kind,
                  transport,
                  address,
                  ...(kind === 'niimbot' ? { printTaskName } : {}),
                },
                { onSuccess: () => onOpenChange(false) },
              )
            }
          >
            {copy.printers.add}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function PrinterCard({ printer }: { printer: Printer }): React.JSX.Element {
  const probe = useProbePrinter()
  const queue = useSetQueueState()
  const remove = useDeletePrinter()
  const [editing, setEditing] = useState(false)
  const [profilesOpen, setProfilesOpen] = useState(false)

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>{printer.name}</CardTitle>
          <span className="text-xs text-muted-foreground">
            {printer.queueState === 'running' ? copy.printers.queue.running : copy.printers.queue.paused}
          </span>
        </div>
        <p className="font-mono text-xs text-muted-foreground">
          {printer.kind} · {printer.address}
          {printer.printTaskName === undefined ? '' : ` · ${printer.printTaskName}`}
        </p>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <CapabilityList printer={printer} />

        <OffsetPanel printer={printer} />

        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" disabled={probe.isPending} onClick={() => probe.mutate(printer.id)}>
            {probe.isPending ? copy.printers.probing : copy.printers.probe}
          </Button>
          {/*
            Profiles belong to the machine, so they are managed here — but in a
            dialog rather than inline. A page listing several printers, each
            with its stock settings unfolded beneath it, buries the thing the
            page is for: seeing at a glance which machines are there and whether
            they are running.
          */}
          <Button size="sm" variant="outline" onClick={() => setProfilesOpen(true)}>
            {copy.printers.manageProfiles}
          </Button>
          <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
            {copy.printers.edit}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() =>
              queue.mutate({
                id: printer.id,
                queueState: printer.queueState === 'running' ? 'paused' : 'running',
              })
            }
          >
            {printer.queueState === 'running' ? copy.printers.queue.pause : copy.printers.queue.resume}
          </Button>
          <ConfirmButton
            size="sm"
            variant="ghost"
            title={copy.common.confirmTitle}
            description={copy.printers.confirmRemove}
            cancelLabel={copy.common.cancel}
            confirmLabel={copy.printers.remove}
            onConfirm={() => remove.mutate(printer.id)}
          >
            {copy.printers.remove}
          </ConfirmButton>
        </div>

        <ErrorNotice error={probe.error ?? remove.error} />

        <EditPrinterDialog printer={printer} open={editing} onOpenChange={setEditing} />

        <Dialog open={profilesOpen} onOpenChange={setProfilesOpen}>
          <DialogContent className="flex max-h-[85vh] flex-col overflow-hidden">
            <DialogHeader>
              <DialogTitle>{copy.printers.manageProfiles}</DialogTitle>
              <DialogDescription>{printer.name}</DialogDescription>
            </DialogHeader>
            {/* Native, for the reason spelled out in `print-dialog.tsx`: a
                ScrollArea given only a max-height has no definite height to
                size its viewport against, so it clips instead of scrolling. */}
            <div className="scrollbar-themed min-h-0 flex-1 overflow-y-auto pr-3">
              <ProfilesPanel printerId={printer.id} capabilities={printer.capabilities} />
            </div>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  )
}

export function PrintersPage(): React.JSX.Element {
  const printers = usePrinters()
  const [adding, setAdding] = useState(false)

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={copy.printers.heading}
        actions={
          <Button size="sm" onClick={() => setAdding(true)}>
            {copy.printers.add}
          </Button>
        }
      />

      <AddPrinterDialog open={adding} onOpenChange={setAdding} />

      {/* Shaped like the cards it stands in for, so the page does not jump
          when the answer arrives. */}
      {printers.isPending && (
        <div className="grid gap-3 md:grid-cols-2">
          <Skeleton className="h-48" />
          <Skeleton className="h-48" />
        </div>
      )}

      {printers.data?.length === 0 && (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <PrinterIcon />
            </EmptyMedia>
            <EmptyTitle>{copy.printers.empty}</EmptyTitle>
            <EmptyDescription>{copy.printers.emptyDetail}</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button size="sm" onClick={() => setAdding(true)}>
              {copy.printers.add}
            </Button>
          </EmptyContent>
        </Empty>
      )}

      <div className="grid gap-3 md:grid-cols-2">
        {printers.data?.map((printer) => <PrinterCard key={printer.id} printer={printer} />)}
      </div>
    </div>
  )
}
