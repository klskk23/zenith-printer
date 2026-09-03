/**
 * Creating or editing a preset, in a dialog.
 *
 * One component for both, because they are the same four decisions and the
 * only difference is whether an id already exists. Written twice they would
 * have drifted, and the half that drifts is the edit form — the one nobody
 * looks at until a printer has already been replaced.
 *
 * **The id is the one thing not editable here.** It is written into somebody
 * else's configuration; a preset that could change it would be a different
 * preset wearing the old one's name. Everything else is editable precisely so
 * that the id never has to change.
 *
 * A patch sends all four fields, not only the ones that were touched. The
 * dialog opened on the current values, so all four are what somebody just
 * looked at and accepted — and sending a subset once meant relying on the
 * server to leave the rest alone, which it did not.
 */
import { useEffect, useState } from 'react'
import { ApiRequestError } from '../../api/client.ts'
import { copy } from '../../i18n/index.ts'
import { Alert } from '../../components/ui/alert.tsx'
import { Button } from '../../components/ui/button.tsx'
import { Input } from '../../components/ui/input.tsx'
import { Label } from '../../components/ui/label.tsx'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select.tsx'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog.tsx'
import { usePrinters } from '../printers/hooks.ts'
import { useTemplates } from '../templates/hooks.ts'
import { useProfiles } from '../profiles/hooks.ts'
import { useCreatePrintPreset, useUpdatePrintPreset, type PrintPreset } from './hooks.ts'

/**
 * The sentinel for "let the printer decide".
 *
 * Radix reserves the empty string for "nothing chosen", which is a different
 * thing: deferring to the printer is a decision somebody made, and it has to
 * be selectable so a preset can be moved back to it.
 */
export const DEFAULT_PROFILE = '__printer_default__'

export function PresetDialog({
  preset,
  open,
  onOpenChange,
}: {
  /** The preset being edited, or undefined to create one. */
  preset?: PrintPreset
  open: boolean
  onOpenChange: (open: boolean) => void
}): React.JSX.Element {
  const templates = useTemplates()
  const printers = usePrinters()
  const create = useCreatePrintPreset()
  const update = useUpdatePrintPreset()

  const [name, setName] = useState('')
  const [templateId, setTemplateId] = useState<string | null>(null)
  const [printerId, setPrinterId] = useState<string | null>(null)
  const [profileId, setProfileId] = useState<string | null>(null)
  const [copies, setCopies] = useState(1)

  const profiles = useProfiles(printerId)

  /**
   * Reset on open, so a cancelled edit is not still sitting there next time
   * and a change made elsewhere is picked up.
   *
   * Keyed on the preset's own fields rather than on the object, which is a new
   * one on every refetch and would clear the form mid-typing.
   */
  useEffect(() => {
    if (!open) {
      return
    }
    setName(preset?.name ?? '')
    setTemplateId(preset?.templateId ?? null)
    setPrinterId(preset?.printerId ?? null)
    setProfileId(preset?.profileId ?? null)
    setCopies(preset?.copies ?? 1)
    create.reset()
    update.reset()
  }, [
    open,
    preset?.id,
    preset?.name,
    preset?.templateId,
    preset?.printerId,
    preset?.profileId,
    preset?.copies,
  ])

  const choosePrinter = (next: string): void => {
    setPrinterId(next)
    // Profiles belong to a printer: an id from another machine would name
    // settings this one cannot print with.
    setProfileId(next === preset?.printerId ? (preset?.profileId ?? null) : null)
  }

  const pending = create.isPending || update.isPending
  const error = create.error ?? update.error
  const ready = name.trim().length > 0 && templateId !== null && printerId !== null

  const submit = (): void => {
    if (!ready) {
      return
    }
    const body = { name: name.trim(), templateId, printerId, profileId, copies }
    const done = { onSuccess: () => onOpenChange(false) }
    if (preset === undefined) {
      create.mutate(body, done)
    } else {
      update.mutate({ id: preset.id, changes: body }, done)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-preset-dialog>
        <DialogHeader>
          <DialogTitle>
            {preset === undefined ? copy.presets.addHeading : copy.presets.editHeading}
          </DialogTitle>
          <DialogDescription>
            {preset === undefined ? copy.presets.explain : copy.presets.editExplain}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <Label className="block flex flex-col gap-1">
            <span className="text-2xs text-muted-foreground">{copy.presets.name}</span>
            <Input
              aria-label={copy.presets.name}
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </Label>

          <Label className="block flex flex-col gap-1">
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

          <Label className="block flex flex-col gap-1">
            <span className="text-2xs text-muted-foreground">{copy.presets.printer}</span>
            <Select value={printerId ?? ''} onValueChange={choosePrinter}>
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

          {/* Only once a printer is chosen: profiles belong to one, and an
              empty dropdown reads as a dead end rather than as a question that
              has not been asked yet. */}
          {printerId !== null && (
            <Label className="block flex flex-col gap-1">
              <span className="text-2xs text-muted-foreground">{copy.presets.profile}</span>
              <Select
                value={profileId ?? DEFAULT_PROFILE}
                onValueChange={(next) => setProfileId(next === DEFAULT_PROFILE ? null : next)}
              >
                <SelectTrigger aria-label={copy.presets.profile}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={DEFAULT_PROFILE}>{copy.presets.profileDefault}</SelectItem>
                  {(profiles.data ?? []).map((profile) => (
                    <SelectItem key={profile.id} value={profile.id}>
                      {profile.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Label>
          )}

          <Label className="block flex flex-col gap-1">
            <span className="text-2xs text-muted-foreground">{copy.presets.copies}</span>
            <Input
              aria-label={copy.presets.copies}
              type="number"
              min={1}
              max={100}
              value={copies}
              onChange={(event) => setCopies(Math.max(1, Number(event.target.value) || 1))}
            />
          </Label>

          {error !== null && (
            <Alert variant="destructive" className="text-xs">
              {error instanceof ApiRequestError
                ? error.body.what
                : preset === undefined
                  ? copy.presets.createFailed
                  : copy.presets.saveFailed}
            </Alert>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {copy.common.cancel}
          </Button>
          <Button disabled={!ready || pending} onClick={submit}>
            {copy.presets.save}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
