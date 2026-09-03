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
 *
 * The page opens on the list, and both creating and editing happen in a
 * dialog. A form sitting open above the list put five fields in front of
 * somebody whose reason for coming here was almost always to read an id off an
 * existing preset.
 */
import { useState } from 'react'
import { copy } from '../i18n/index.ts'
import { BookmarkPlus } from 'lucide-react'
import { PageHeader } from '../components/page-header.tsx'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '../components/ui/empty.tsx'
import { Button } from '../components/ui/button.tsx'
import { Card, CardContent, CardHeader } from '../components/ui/card.tsx'
import { ConfirmButton } from '../components/ui/confirm-button.tsx'
import { Skeleton } from '../components/ui/skeleton.tsx'
import { usePrinters } from '../features/printers/hooks.ts'
import { useTemplates } from '../features/templates/hooks.ts'
import { useProfiles } from '../features/profiles/hooks.ts'
import { PresetDialog } from '../features/print-presets/preset-dialog.tsx'
import {
  useDeletePrintPreset,
  usePrintPresets,
  type PrintPreset,
} from '../features/print-presets/hooks.ts'

export function PrintPresetsPage(): React.JSX.Element {
  const presets = usePrintPresets()
  const templates = useTemplates()
  const printers = usePrinters()
  const remove = useDeletePrintPreset()

  /**
   * `undefined` means the dialog is creating; a preset means it is editing
   * that one. Held here rather than per card so only one is ever open, and so
   * the dialog is not remounted with every list refetch.
   */
  const [editing, setEditing] = useState<PrintPreset | undefined>(undefined)
  const [dialogOpen, setDialogOpen] = useState(false)

  const openCreate = (): void => {
    setEditing(undefined)
    setDialogOpen(true)
  }
  const openEdit = (preset: PrintPreset): void => {
    setEditing(preset)
    setDialogOpen(true)
  }

  return (
    <div className="flex flex-col gap-3" data-print-presets>
      <PageHeader
        title={copy.presets.heading}
        description={copy.presets.explain}
        actions={
          <Button size="sm" onClick={openCreate}>
            {copy.presets.addOpen}
          </Button>
        }
      />

      <PresetDialog
        // Keyed so the dialog's own state starts from this preset rather than
        // from whichever one was open before it.
        key={editing?.id ?? 'new'}
        preset={editing}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
      />

      {presets.isPending && (
        <div className="flex flex-col gap-2">
          {Array.from({ length: 2 }, (_unused, index) => (
            <Skeleton key={index} className="h-20" />
          ))}
        </div>
      )}

      {presets.data !== undefined && presets.data.length === 0 && (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <BookmarkPlus />
            </EmptyMedia>
            <EmptyTitle>{copy.presets.emptyTitle}</EmptyTitle>
            <EmptyDescription>{copy.presets.empty}</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button size="sm" onClick={openCreate}>
              {copy.presets.addOpen}
            </Button>
          </EmptyContent>
        </Empty>
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
            <CardContent className="flex flex-col gap-1">
              <p className="text-2xs text-muted-foreground">
                {template?.name ?? copy.presets.templateGone}
                {' · '}
                {printer?.name ?? copy.presets.printerGone}
              </p>
              {/* Which settings it prints with. A preset that has been quietly
                  printing at the wrong density is not visible from anywhere
                  else on this page. */}
              <PresetProfileLine preset={preset} />
              {/* The thing that goes into somebody else's configuration, so it
                  is shown whole and selectable rather than truncated the way
                  an id is everywhere else here. */}
              <p className="font-mono text-2xs break-all select-all" data-preset-id>
                {preset.id}
              </p>
              <div className="flex items-center gap-1 pt-1">
                <Button variant="ghost" size="sm" onClick={() => openEdit(preset)}>
                  {copy.presets.edit}
                </Button>
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

/**
 * The print settings one preset uses, named.
 *
 * Its own component because profiles belong to a printer and each preset names
 * a different one — a single list fetched by the page would be the form's
 * printer's profiles, shown against everybody's presets.
 */
function PresetProfileLine({
  preset,
}: {
  preset: { printerId: string; profileId: string | null }
}): React.JSX.Element | null {
  const profiles = useProfiles(preset.profileId === null ? null : preset.printerId)
  if (preset.profileId === null) {
    // Deferring to the printer is the ordinary case and says nothing new: the
    // printer is already named on the line above.
    return null
  }
  const profile = (profiles.data ?? []).find((item) => item.id === preset.profileId)
  if (profiles.isPending) {
    return null
  }
  return (
    <p className="text-2xs text-muted-foreground" data-preset-profile>
      {profile === undefined ? copy.presets.profileGone : copy.presets.profileOf(profile.name)}
    </p>
  )
}
