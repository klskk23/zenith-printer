/**
 * Client preferences.
 *
 * Everything here is local to this browser. Server configuration — dry-run
 * mode, log level, retention — stays in the deployment layer, because there is
 * no authentication: a global setting in this panel would be a switch anyone on
 * the network could flip for everyone. The dry-run guard in particular is worth
 * exactly as much as the difficulty of turning it off.
 *
 * The page says so out loud, so that someone hunting for a server setting
 * learns where it lives rather than concluding it does not exist.
 */
import { useEffect, useMemo, useState } from 'react'
import { copy } from '../i18n/index.ts'
import { Button } from '../components/ui/button.tsx'
import { Alert } from '../components/ui/alert.tsx'
import { Input } from '../components/ui/input.tsx'
import { Label } from '../components/ui/label.tsx'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select.tsx'
import { Switch } from '../components/ui/switch.tsx'
import { usePreferences } from '../features/preferences/context.tsx'
import { PREFERENCE_KEYS, type Preferences } from '../features/preferences/store.ts'
import { LOCALES } from '../features/preferences/locale.ts'
import { FONT_FAMILIES, type FontFamilyKey } from '../editor/elements.ts'

function Row({ label, children }: { label: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="grid grid-cols-[10rem_1fr] items-center gap-3 py-1.5">
      <Label className="text-xs">{label}</Label>
      <div className="max-w-64">{children}</div>
    </div>
  )
}

export function SettingsPage(): React.JSX.Element {
  const { preferences, update } = usePreferences()

  /**
   * Edits are held until saved.
   *
   * Applying each keystroke immediately made the page impossible to explore:
   * changing the language mid-thought reloaded every label around you, and
   * there was no way back except remembering what it had been. A draft gives
   * the change a moment where it is not yet true.
   */
  const [draft, setDraft] = useState<Preferences>(preferences)

  // Adopt outside changes only while nothing is being edited, so a background
  // update cannot overwrite what someone is in the middle of typing.
  const dirty = useMemo(
    () => PREFERENCE_KEYS.some((key) => draft[key] !== preferences[key]),
    [draft, preferences],
  )
  useEffect(() => {
    if (!dirty) {
      setDraft(preferences)
    }
  }, [preferences])

  const set = <K extends keyof Preferences>(key: K, value: Preferences[K]): void =>
    setDraft((current) => ({ ...current, [key]: value }))

  return (
    <div className="max-w-2xl space-y-4">
      <h2 className="text-sm font-semibold">{copy.settings.heading}</h2>

      <Alert className="text-xs">{copy.settings.scopeNote}</Alert>

      <section className="divide-y divide-border rounded-md border border-border px-3">
        <Row label={copy.settings.language}>
          <Select
            value={draft.language}
            onValueChange={(value) => set('language', value as (typeof LOCALES)[number])}
          >
            <SelectTrigger aria-label={copy.settings.language}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {LOCALES.map((locale) => (
                <SelectItem key={locale} value={locale}>
                  {copy.settings.languageNames[locale]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Row>

        <Row label={copy.settings.defaultSize}>
          <div className="flex items-center gap-2">
            <Input
              type="number"
              step={0.5}
              min={1}
              value={draft.defaultLabelWidthMm}
              onChange={(e) => set('defaultLabelWidthMm', Number(e.target.value) || 1)}
            />
            <span className="text-xs text-muted-foreground">×</span>
            <Input
              type="number"
              step={0.5}
              min={1}
              value={draft.defaultLabelHeightMm}
              onChange={(e) => set('defaultLabelHeightMm', Number(e.target.value) || 1)}
            />
          </div>
        </Row>

        <Row label={copy.settings.defaultDpi}>
          <Input
            type="number"
            step={1}
            min={1}
            value={draft.defaultDpi}
            onChange={(e) => set('defaultDpi', Number(e.target.value) || 203)}
          />
        </Row>

        <Row label={copy.settings.defaultFont}>
          <Select
            value={draft.defaultFontFamily}
            onValueChange={(value) => set('defaultFontFamily', value)}
          >
            <SelectTrigger aria-label={copy.settings.defaultFont}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(FONT_FAMILIES) as FontFamilyKey[]).map((key) => (
                <SelectItem key={key} value={FONT_FAMILIES[key]}>
                  {copy.editor.fonts[key]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Row>

        <Row label={copy.settings.displayUnit}>
          <Select
            value={draft.displayUnit}
            onValueChange={(value) => set('displayUnit', value as 'mm' | 'dot')}
          >
            <SelectTrigger aria-label={copy.settings.displayUnit}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="mm">{copy.settings.displayUnits.mm}</SelectItem>
              <SelectItem value="dot">{copy.settings.displayUnits.dot}</SelectItem>
            </SelectContent>
          </Select>
        </Row>

        <Row label={copy.settings.theme}>
          <Select
            value={draft.theme}
            onValueChange={(value) => set('theme', value as 'light' | 'dark' | 'system')}
          >
            <SelectTrigger aria-label={copy.settings.theme}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="system">{copy.settings.themes.system}</SelectItem>
              <SelectItem value="light">{copy.settings.themes.light}</SelectItem>
              <SelectItem value="dark">{copy.settings.themes.dark}</SelectItem>
            </SelectContent>
          </Select>
        </Row>

        <Row label={copy.settings.pollInterval}>
          <Input
            type="number"
            step={500}
            min={500}
            value={draft.queuePollIntervalMs}
            onChange={(e) => set('queuePollIntervalMs', Number(e.target.value) || 2000)}
          />
        </Row>

        <Row label={copy.settings.alwaysConfirmTabClose}>
          <Switch
            checked={draft.alwaysConfirmTabClose}
            onCheckedChange={(checked) => set('alwaysConfirmTabClose', checked === true)}
          />
        </Row>
      </section>

      <div className="flex items-center gap-2">
        <Button disabled={!dirty} onClick={() => update(draft)}>
          {copy.common.save}
        </Button>
        <Button variant="outline" disabled={!dirty} onClick={() => setDraft(preferences)}>
          {copy.common.cancel}
        </Button>
        {dirty && <span className="text-[11px] text-muted-foreground">{copy.settings.unsaved}</span>}
      </div>

      <p className="text-[11px] text-muted-foreground">{copy.settings.localOnlyHint}</p>

    </div>
  )
}
