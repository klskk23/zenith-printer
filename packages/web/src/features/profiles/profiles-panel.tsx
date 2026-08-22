/**
 * Print profiles for one printer.
 *
 * A profile describes the paper: its size, its margins, and how the machine is
 * driven for it. Position correction is not here — it belongs to the printer,
 * because it says where *the machine* lays ink down and changes on every roll
 * reload.
 *
 * The panel owns which profile is being edited. It was written as a controlled
 * component back when the editor hosted it and needed to know the selection;
 * the editor now picks a profile from a dropdown instead, leaving one caller
 * that has no interest in it. Keeping the props meant that caller passed a
 * no-op `onSelect`, so clicking a profile did nothing at all and the edit form
 * — which contains the only delete button — could never be opened.
 */
import { useState } from 'react'
import { ApiRequestError } from '../../api/client.ts'
import type { Capabilities } from '../../api/types.ts'
import { copy } from '../../i18n/index.ts'
import { Alert } from '../../components/ui/alert.tsx'
import { Button } from '../../components/ui/button.tsx'
import { Checkbox } from '../../components/ui/checkbox.tsx'
import { ConfirmButton } from '../../components/ui/confirm-button.tsx'
import { Input } from '../../components/ui/input.tsx'
import { Label } from '../../components/ui/label.tsx'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../components/ui/select.tsx'
import { useDeleteProfile, useProfiles, useSaveProfile, type Profile } from './hooks.ts'

export interface ProfilesPanelProps {
  printerId: string
  capabilities: Capabilities | null
}


/**
 * Keys only; labels are read at render time. A module-level constant holding
 * the text would freeze it at import, before a language has been chosen.
 */
const MARGIN_KEYS = ['marginTopMm', 'marginRightMm', 'marginBottomMm', 'marginLeftMm'] as const

const MARGIN_LABELS = {
  marginTopMm: 'marginTop',
  marginRightMm: 'marginRight',
  marginBottomMm: 'marginBottom',
  marginLeftMm: 'marginLeft',
} as const

export function ProfilesPanel({ printerId, capabilities }: ProfilesPanelProps): React.JSX.Element {
  const profiles = useProfiles(printerId)
  const save = useSaveProfile(printerId)
  const remove = useDeleteProfile(printerId)
  const [draft, setDraft] = useState<Partial<Profile> | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const saved = profiles.data?.find((p) => p.id === selectedId) ?? null
  const editing = draft ?? saved
  // Nothing is written until Save; Cancel discards the draft and leaves the
  // stored settings untouched.
  const dirty = draft !== null

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">{copy.profiles.heading}</h3>
        <Button
          size="sm"
          variant="outline"
          onClick={() =>
            setDraft({
              name: 'profile',
              density: capabilities?.densityDefault ?? 3,
              labelType: capabilities?.paperTypes[0] ?? 1,
              halftone: 'none',
              threshold: 128,
              labelWidthMm: 50,
              labelHeightMm: 30,
              marginTopMm: 0,
              marginRightMm: 0,
              marginBottomMm: 0,
              marginLeftMm: 0,
              isDefault: false,
            })
          }
        >
          {copy.profiles.add}
        </Button>
      </div>

      {profiles.data?.length === 0 && draft === null && (
        <p className="text-xs text-muted-foreground">{copy.profiles.empty}</p>
      )}

      <div className="flex flex-wrap gap-1">
        {profiles.data?.map((profile) => (
          <Button
            key={profile.id}
            size="sm"
            variant={profile.id === selectedId ? 'default' : 'outline'}
            onClick={() => {
              setDraft(null)
              // Clicking the open one closes it, so the form can be dismissed
              // without saving.
              setSelectedId(profile.id === selectedId ? null : profile.id)
            }}
          >
            {profile.name}
            {profile.isDefault && <span className="ml-1 opacity-70">★</span>}
          </Button>
        ))}
      </div>

      {editing !== null && (
        <div className="space-y-2 rounded-md border border-border p-2">
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label>{copy.profiles.name}</Label>
              <Input
                value={editing.name ?? ''}
                onChange={(e) => setDraft({ ...editing, name: e.target.value })}
              />
            </div>
            <div className="space-y-1">
              <Label>{copy.profiles.density}</Label>
              <Input
                type="number"
                min={capabilities?.densityMin ?? 1}
                max={capabilities?.densityMax ?? 5}
                value={editing.density ?? 3}
                onChange={(e) => setDraft({ ...editing, density: Number(e.target.value) || 1 })}
              />
              {capabilities !== null && (
                <p className="text-[11px] text-muted-foreground">
                  {copy.profiles.densityHint(capabilities.densityMin, capabilities.densityMax)}
                </p>
              )}
            </div>
          </div>

          {/*
            The binarisation cut-off. Adjustable at last: it was reachable only
            through the preview endpoint, so a value could be found for a pale
            logo and then had nowhere to go — the print path used 128 whatever
            the preview had been told.
          */}
          <div className="space-y-1">
            <Label>{copy.profiles.threshold}</Label>
            <Input
              type="number"
              min={1}
              max={255}
              value={editing.threshold ?? 128}
              onChange={(e) =>
                setDraft({
                  ...editing,
                  threshold: Math.min(255, Math.max(1, Number(e.target.value) || 128)),
                })
              }
            />
            <p className="text-[11px] text-muted-foreground">{copy.profiles.thresholdHint}</p>
          </div>

          {/*
            Halftoning, on the profile because it is a property of the stock:
            the same logo wants a hard edge on a coated label and a screen on
            rough paper, and the same design is printed on both.
          */}
          <div className="space-y-1">
            <Label>{copy.profiles.halftone}</Label>
            <Select
              value={editing.halftone ?? 'none'}
              onValueChange={(value) => setDraft({ ...editing, halftone: value as Profile['halftone'] })}
            >
              <SelectTrigger aria-label={copy.profiles.halftone}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(['none', 'floyd-steinberg', 'ordered'] as const).map((mode) => (
                  <SelectItem key={mode} value={mode}>
                    {copy.profiles.halftoneModes[mode]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-[11px] text-muted-foreground">{copy.profiles.halftoneHint}</p>
          </div>

          {/* Stock dimensions. Choosing this profile sets the canvas to them,
              which is the only way to be sure the design matches the paper. */}
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label>{copy.profiles.labelWidth}</Label>
              <Input
                type="number"
                step={0.5}
                min={1}
                value={editing.labelWidthMm ?? 50}
                onChange={(e) => setDraft({ ...editing, labelWidthMm: Number(e.target.value) || 1 })}
              />
            </div>
            <div className="space-y-1">
              <Label>{copy.profiles.labelHeight}</Label>
              <Input
                type="number"
                step={0.5}
                min={1}
                value={editing.labelHeightMm ?? 30}
                onChange={(e) => setDraft({ ...editing, labelHeightMm: Number(e.target.value) || 1 })}
              />
            </div>
          </div>

          <div className="space-y-1">
            <Label>{copy.profiles.margins}</Label>
            <div className="grid grid-cols-4 gap-1.5">
              {MARGIN_KEYS.map((key) => (
                <div key={key} className="space-y-1">
                  <Label className="text-[11px]">{copy.profiles[MARGIN_LABELS[key]]}</Label>
                  <Input
                    type="number"
                    step={0.5}
                    min={0}
                    value={editing[key] ?? 0}
                    onChange={(e) => setDraft({ ...editing, [key]: Math.max(0, Number(e.target.value) || 0) })}
                  />
                </div>
              ))}
            </div>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                const all = editing.marginTopMm ?? 0
                setDraft({
                  ...editing,
                  marginTopMm: all, marginRightMm: all, marginBottomMm: all, marginLeftMm: all,
                })
              }}
            >
              {copy.profiles.marginLinked}
            </Button>
            {/* Said explicitly, because a shaded region normally means "no". */}
            <p className="text-[11px] text-muted-foreground">{copy.profiles.marginHint}</p>
          </div>

          {/*
            The default is what everything else falls back to: the profile the
            editor preselects when a printer is chosen, and the stock the
            calibration page is printed at. Without a control for it the flag
            could never be set, so "default profile" was a concept the system
            referred to and nobody could create.
          */}
          <Label className="flex items-center gap-2 text-sm text-foreground">
            <Checkbox
              checked={editing.isDefault === true}
              onCheckedChange={(checked) => setDraft({ ...editing, isDefault: checked === true })}
            />
            {copy.profiles.isDefault}
          </Label>
          <p className="text-[11px] text-muted-foreground">{copy.profiles.isDefaultHint}</p>

          <div className="flex gap-2">
            <Button
              size="sm"
              disabled={save.isPending || !dirty}
              onClick={() =>
                save.mutate(
                  {
                    ...(editing.id === undefined ? {} : { id: editing.id }),
                    body: {
                      name: editing.name ?? 'profile',
                      density: editing.density ?? 3,
                      labelType: editing.labelType ?? 1,
                      labelWidthMm: editing.labelWidthMm ?? 50,
                      labelHeightMm: editing.labelHeightMm ?? 30,
                      marginTopMm: editing.marginTopMm ?? 0,
                      marginRightMm: editing.marginRightMm ?? 0,
                      marginBottomMm: editing.marginBottomMm ?? 0,
                      marginLeftMm: editing.marginLeftMm ?? 0,
                      isDefault: editing.isDefault ?? false,
                      halftone: editing.halftone ?? 'none',
                      threshold: editing.threshold ?? 128,
                    },
                  },
                  {
                    onSuccess: (saved) => {
                      setDraft(null)
                      setSelectedId(saved.id)
                    },
                  },
                )
              }
            >
              {copy.common.save}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={!dirty}
              onClick={() => {
                setDraft(null)
                // A brand-new profile has nothing to fall back to, so cancelling
                // it closes the form rather than leaving an empty one open.
                if (editing.id === undefined) {
                  setSelectedId(null)
                }
              }}
            >
              {copy.common.cancel}
            </Button>
            {editing.id !== undefined && (
              // Deleting stock settings is not recoverable, and the profile
              // being removed is not named on the button — so it is confirmed.
              <ConfirmButton
                size="sm"
                variant="ghost"
                title={copy.common.confirmTitle}
                description={copy.profiles.confirmRemove(editing.name ?? '')}
                cancelLabel={copy.common.cancel}
                confirmLabel={copy.profiles.remove}
                onConfirm={() =>
                  remove.mutate(editing.id!, {
                    onSuccess: () => {
                      setDraft(null)
                      setSelectedId(null)
                    },
                  })
                }
              >
                {copy.profiles.remove}
              </ConfirmButton>
            )}
          </div>

          {save.error instanceof ApiRequestError && (
            <Alert variant="destructive" className="text-xs">
              <p className="font-medium">{save.error.body.what}</p>
              <p className="mt-1">{save.error.body.next}</p>
            </Alert>
          )}
        </div>
      )}
    </div>
  )
}
