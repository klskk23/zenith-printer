/**
 * Print profiles for one printer.
 *
 * Offsets step in dots, because that is the machine's actual resolution and
 * typing multiples of 0.125mm would be absurd (FR-029). The preview reflects
 * the offset immediately, so nobody has to burn a label to see what a nudge
 * did (FR-028).
 */
import { useState } from 'react'
import { ApiRequestError } from '../../api/client.ts'
import type { Capabilities } from '../../api/types.ts'
import { copy } from '../../i18n/index.ts'
import { Alert } from '../../components/ui/alert.tsx'
import { Button } from '../../components/ui/button.tsx'
import { Input } from '../../components/ui/input.tsx'
import { Label } from '../../components/ui/label.tsx'
import { useDeleteProfile, useProfiles, useSaveProfile, type Profile } from './hooks.ts'

export interface ProfilesPanelProps {
  printerId: string
  capabilities: Capabilities | null
  selectedProfileId: string | null
  onSelect: (id: string | null) => void
}


const MARGIN_KEYS = [
  { key: 'marginTopMm', label: copy.profiles.marginTop },
  { key: 'marginRightMm', label: copy.profiles.marginRight },
  { key: 'marginBottomMm', label: copy.profiles.marginBottom },
  { key: 'marginLeftMm', label: copy.profiles.marginLeft },
] as const

export function ProfilesPanel({
  printerId,
  capabilities,
  selectedProfileId,
  onSelect,
}: ProfilesPanelProps): React.JSX.Element {
  const profiles = useProfiles(printerId)
  const save = useSaveProfile(printerId)
  const remove = useDeleteProfile(printerId)
  const [draft, setDraft] = useState<Partial<Profile> | null>(null)

  const editing = draft ?? profiles.data?.find((p) => p.id === selectedProfileId) ?? null

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
            variant={profile.id === selectedProfileId ? 'default' : 'outline'}
            onClick={() => {
              setDraft(null)
              onSelect(profile.id === selectedProfileId ? null : profile.id)
            }}
          >
            {profile.name}
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
              {MARGIN_KEYS.map(({ key, label }) => (
                <div key={key} className="space-y-1">
                  <Label className="text-[11px]">{label}</Label>
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

          <div className="flex gap-2">
            <Button
              size="sm"
              disabled={save.isPending}
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
                    },
                  },
                  { onSuccess: (saved) => { setDraft(null); onSelect(saved.id) } },
                )
              }
            >
              {copy.common.save}
            </Button>
            {editing.id !== undefined && (
              <Button size="sm" variant="ghost" onClick={() => remove.mutate(editing.id!)}>
                {copy.profiles.remove}
              </Button>
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
