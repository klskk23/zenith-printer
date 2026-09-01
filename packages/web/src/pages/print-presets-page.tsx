/**
 * Print presets.
 *
 * A preset is a name over four decisions — which design, which printer, which
 * print settings, how many copies — so that a system on the other side of an
 * HTTP call can print without knowing any of them. It hands over rows and an
 * id; everything else is decided here, in front of the machine, and can be
 * changed here without the other side being redeployed.
 *
 * Which is why the **id is the most important thing on this page**. It is what
 * gets written into somebody else's configuration, so it is shown in full and
 * can be copied, rather than being an implementation detail the way ids
 * elsewhere in this application are.
 */
import { useState } from 'react'
import { copy } from '../i18n/index.ts'
import { Alert } from '../components/ui/alert.tsx'
import { Button } from '../components/ui/button.tsx'
import { Card, CardContent, CardHeader } from '../components/ui/card.tsx'
import { ConfirmButton } from '../components/ui/confirm-button.tsx'
import { Input } from '../components/ui/input.tsx'
import { Label } from '../components/ui/label.tsx'
import { Skeleton } from '../components/ui/skeleton.tsx'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select.tsx'
import { usePrinters } from '../features/printers/hooks.ts'
import { useTemplates } from '../features/templates/hooks.ts'
import {
  useCreatePrintPreset,
  useDeletePrintPreset,
  usePrintPresets,
} from '../features/print-presets/hooks.ts'

export function PrintPresetsPage(): React.JSX.Element {
  const presets = usePrintPresets()
  const templates = useTemplates()
  const printers = usePrinters()
  const create = useCreatePrintPreset()
  const remove = useDeletePrintPreset()

  const [name, setName] = useState('')
  const [templateId, setTemplateId] = useState<string | null>(null)
  const [printerId, setPrinterId] = useState<string | null>(null)
  const [copies, setCopies] = useState(1)

  const ready = name.trim().length > 0 && templateId !== null && printerId !== null

  return (
    <div className="space-y-3" data-print-presets>
      <h2 className="text-sm font-semibold">{copy.presets.heading}</h2>
      <p className="text-2xs text-muted-foreground">{copy.presets.explain}</p>

      <Card>
        <CardHeader>
          <span className="text-xs font-medium">{copy.presets.addHeading}</span>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="grid gap-2 sm:grid-cols-2">
            <Label className="block space-y-1">
              <span className="text-2xs text-muted-foreground">{copy.presets.name}</span>
              <Input value={name} onChange={(event) => setName(event.target.value)} />
            </Label>
            <Label className="block space-y-1">
              <span className="text-2xs text-muted-foreground">{copy.presets.copies}</span>
              <Input
                type="number"
                min={1}
                max={100}
                value={copies}
                onChange={(event) => setCopies(Math.max(1, Number(event.target.value) || 1))}
              />
            </Label>
            <Label className="block space-y-1">
              <span className="text-2xs text-muted-foreground">{copy.presets.template}</span>
              <Select value={templateId ?? ''} onValueChange={setTemplateId}>
                <SelectTrigger aria-label={copy.presets.template}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(templates.data ?? []).map((template) => (
                    <SelectItem key={template.id} value={template.id}>
                      {template.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Label>
            <Label className="block space-y-1">
              <span className="text-2xs text-muted-foreground">{copy.presets.printer}</span>
              <Select value={printerId ?? ''} onValueChange={setPrinterId}>
                <SelectTrigger aria-label={copy.presets.printer}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(printers.data ?? []).map((printer) => (
                    <SelectItem key={printer.id} value={printer.id}>
                      {printer.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Label>
          </div>

          {create.isError && (
            <Alert variant="destructive" className="text-xs">
              {copy.presets.createFailed}
            </Alert>
          )}

          <Button
            size="sm"
            disabled={!ready || create.isPending}
            onClick={() =>
              create.mutate(
                { name: name.trim(), templateId: templateId!, printerId: printerId!, copies },
                { onSuccess: () => setName('') },
              )
            }
          >
            {copy.presets.add}
          </Button>
        </CardContent>
      </Card>

      {presets.isPending && (
        <div className="space-y-2">
          {Array.from({ length: 2 }, (_unused, index) => (
            <Skeleton key={index} className="h-20" />
          ))}
        </div>
      )}

      {presets.data !== undefined && presets.data.length === 0 && (
        <Alert>{copy.presets.empty}</Alert>
      )}

      {(presets.data ?? []).map((preset) => {
        const template = (templates.data ?? []).find((item) => item.id === preset.templateId)
        const printer = (printers.data ?? []).find((item) => item.id === preset.printerId)
        return (
          <Card key={preset.id} data-preset={preset.id}>
            <CardHeader className="flex-row items-center justify-between gap-2">
              <span className="text-xs font-medium">{preset.name}</span>
              <span className="text-2xs text-muted-foreground">
                {copy.presets.copiesOf(preset.copies)}
              </span>
            </CardHeader>
            <CardContent className="space-y-1">
              <p className="text-2xs text-muted-foreground">
                {template?.name ?? copy.presets.templateGone}
                {' · '}
                {printer?.name ?? copy.presets.printerGone}
              </p>
              {/* The thing that goes into somebody else's configuration, so it
                  is shown whole and selectable rather than truncated the way
                  an id is everywhere else here. */}
              <p className="font-mono text-2xs break-all select-all" data-preset-id>
                {preset.id}
              </p>
              <div className="pt-1">
                <ConfirmButton
                  variant="ghost"
                  size="sm"
                  title={copy.presets.remove}
                  description={copy.presets.removeConfirm}
                  cancelLabel={copy.common.cancel}
                  confirmLabel={copy.presets.remove}
                  onConfirm={() => remove.mutate(preset.id)}
                >
                  {copy.presets.remove}
                </ConfirmButton>
              </div>
            </CardContent>
          </Card>
        )
      })}
    </div>
  )
}
