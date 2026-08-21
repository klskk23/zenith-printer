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
import { copy } from '../../i18n/zh-CN.ts'
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

const MM_PER_INCH = 25.4

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

  const dpi = capabilities?.dpi ?? 203
  const dotMm = MM_PER_INCH / dpi

  const editing = draft ?? profiles.data?.find((p) => p.id === selectedProfileId) ?? null

  const offsetDots = (mm: number): number => Math.round((mm * dpi) / MM_PER_INCH)

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
              offsetXMm: 0,
              offsetYMm: 0,
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

          <div className="grid grid-cols-2 gap-2">
            {(['offsetXMm', 'offsetYMm'] as const).map((key) => (
              <div key={key} className="space-y-1">
                <Label>{key === 'offsetXMm' ? copy.profiles.offsetX : copy.profiles.offsetY}</Label>
                <Input
                  type="number"
                  step={1}
                  value={offsetDots(editing[key] ?? 0)}
                  onChange={(e) => setDraft({ ...editing, [key]: (Number(e.target.value) || 0) * dotMm })}
                />
                <p className="text-[11px] text-muted-foreground">
                  {copy.editor.units.dotsSuffix(offsetDots(editing[key] ?? 0), editing[key] ?? 0)}
                </p>
              </div>
            ))}
          </div>

          <p className="text-[11px] text-muted-foreground">{copy.profiles.offsetHint}</p>

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
                      offsetXMm: editing.offsetXMm ?? 0,
                      offsetYMm: editing.offsetYMm ?? 0,
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
