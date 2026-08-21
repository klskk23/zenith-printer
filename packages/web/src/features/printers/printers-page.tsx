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
import { copy } from '../../i18n/zh-CN.ts'
import { Alert } from '../../components/ui/alert.tsx'
import { Button } from '../../components/ui/button.tsx'
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card.tsx'
import { Input } from '../../components/ui/input.tsx'
import { Label } from '../../components/ui/label.tsx'
import { Select } from '../../components/ui/select.tsx'
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
    <div className="space-y-1">
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

function AddPrinterForm(): React.JSX.Element {
  const add = useAddPrinter()
  const [kind, setKind] = useState<PrinterKind>('niimbot')
  const [transport, setTransport] = useState<TransportKind>('serial')
  const [name, setName] = useState('')
  const [address, setAddress] = useState('/dev/ttyACM0')
  const [printTaskName, setPrintTaskName] = useState('B1')

  return (
    <Card>
      <CardHeader>
        <CardTitle>{copy.printers.add}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label>{copy.printers.fields.name}</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label>{copy.printers.fields.kind}</Label>
            <Select
              value={kind}
              onChange={(e) => {
                const next = e.target.value as PrinterKind
                setKind(next)
                setTransport(next === 'niimbot' ? 'serial' : 'tcp')
                setAddress(next === 'niimbot' ? '/dev/ttyACM0' : '192.168.1.50:9100')
              }}
            >
              <option value="niimbot">niimbot</option>
              <option value="zpl">zpl</option>
            </Select>
          </div>
        </div>

        <div className="space-y-1">
          <Label>{copy.printers.fields.address}</Label>
          <Input value={address} onChange={(e) => setAddress(e.target.value)} />
          <p className="text-[11px] text-muted-foreground">
            {transport === 'serial' ? copy.printers.hints.serialAddress : copy.printers.hints.tcpAddress}
          </p>
        </div>

        {kind === 'niimbot' && (
          <div className="space-y-1">
            <Label>{copy.printers.fields.printTaskName}</Label>
            <Input value={printTaskName} onChange={(e) => setPrintTaskName(e.target.value)} />
            <p className="text-[11px] text-muted-foreground">{copy.printers.hints.printTaskName}</p>
          </div>
        )}

        <Button
          disabled={name.length === 0 || add.isPending}
          onClick={() =>
            add.mutate({
              name,
              kind,
              transport,
              address,
              ...(kind === 'niimbot' ? { printTaskName } : {}),
            })
          }
        >
          {copy.printers.add}
        </Button>

        <ErrorNotice error={add.error} />
      </CardContent>
    </Card>
  )
}

function PrinterCard({ printer }: { printer: Printer }): React.JSX.Element {
  const probe = useProbePrinter()
  const queue = useSetQueueState()
  const remove = useDeletePrinter()

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
      <CardContent className="space-y-3">
        <CapabilityList printer={printer} />

        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" disabled={probe.isPending} onClick={() => probe.mutate(printer.id)}>
            {probe.isPending ? copy.printers.probing : copy.printers.probe}
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
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              if (window.confirm(copy.printers.confirmRemove)) {
                remove.mutate(printer.id)
              }
            }}
          >
            {copy.printers.remove}
          </Button>
        </div>

        <ErrorNotice error={probe.error ?? remove.error} />
      </CardContent>
    </Card>
  )
}

export function PrintersPage(): React.JSX.Element {
  const printers = usePrinters()

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold">{copy.printers.heading}</h2>

      {printers.isPending && <p className="text-sm text-muted-foreground">{copy.common.loading}</p>}
      {printers.data?.length === 0 && (
        <p className="text-sm text-muted-foreground">{copy.printers.empty}</p>
      )}

      <div className="grid gap-3 md:grid-cols-2">
        {printers.data?.map((printer) => <PrinterCard key={printer.id} printer={printer} />)}
      </div>

      <AddPrinterForm />
    </div>
  )
}
