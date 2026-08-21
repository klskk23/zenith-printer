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
import { copy } from '../i18n/index.ts'
import { Alert } from '../components/ui/alert.tsx'
import { Input } from '../components/ui/input.tsx'
import { Label } from '../components/ui/label.tsx'
import { Select } from '../components/ui/select.tsx'
import { Switch } from '../components/ui/switch.tsx'
import { usePreferences } from '../features/preferences/context.tsx'
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

  return (
    <div className="max-w-2xl space-y-4">
      <h2 className="text-sm font-semibold">{copy.settings.heading}</h2>

      <Alert className="text-xs">{copy.settings.scopeNote}</Alert>

      <section className="divide-y divide-border rounded-md border border-border px-3">
        <Row label={copy.settings.language}>
          <Select
            value={preferences.language}
            onChange={(event) => update({ language: event.target.value as (typeof LOCALES)[number] })}
          >
            {LOCALES.map((locale) => (
              <option key={locale} value={locale}>
                {copy.settings.languageNames[locale]}
              </option>
            ))}
          </Select>
        </Row>

        <Row label={copy.settings.defaultSize}>
          <div className="flex items-center gap-2">
            <Input
              type="number"
              step={0.5}
              min={1}
              value={preferences.defaultLabelWidthMm}
              onChange={(e) => update({ defaultLabelWidthMm: Number(e.target.value) || 1 })}
            />
            <span className="text-xs text-muted-foreground">×</span>
            <Input
              type="number"
              step={0.5}
              min={1}
              value={preferences.defaultLabelHeightMm}
              onChange={(e) => update({ defaultLabelHeightMm: Number(e.target.value) || 1 })}
            />
          </div>
        </Row>

        <Row label={copy.settings.defaultDpi}>
          <Input
            type="number"
            step={1}
            min={1}
            value={preferences.defaultDpi}
            onChange={(e) => update({ defaultDpi: Number(e.target.value) || 203 })}
          />
        </Row>

        <Row label={copy.settings.defaultFont}>
          <Select
            value={preferences.defaultFontFamily}
            onChange={(e) => update({ defaultFontFamily: e.target.value })}
          >
            {(Object.keys(FONT_FAMILIES) as FontFamilyKey[]).map((key) => (
              <option key={key} value={FONT_FAMILIES[key]}>
                {copy.editor.fonts[key]}
              </option>
            ))}
          </Select>
        </Row>

        <Row label={copy.settings.displayUnit}>
          <Select
            value={preferences.displayUnit}
            onChange={(e) => update({ displayUnit: e.target.value as 'mm' | 'dot' })}
          >
            <option value="mm">{copy.settings.displayUnits.mm}</option>
            <option value="dot">{copy.settings.displayUnits.dot}</option>
          </Select>
        </Row>

        <Row label={copy.settings.theme}>
          <Select
            value={preferences.theme}
            onChange={(e) => update({ theme: e.target.value as 'light' | 'dark' | 'system' })}
          >
            <option value="system">{copy.settings.themes.system}</option>
            <option value="light">{copy.settings.themes.light}</option>
            <option value="dark">{copy.settings.themes.dark}</option>
          </Select>
        </Row>

        <Row label={copy.settings.pollInterval}>
          <Input
            type="number"
            step={500}
            min={500}
            value={preferences.queuePollIntervalMs}
            onChange={(e) => update({ queuePollIntervalMs: Number(e.target.value) || 2000 })}
          />
        </Row>

        <Row label={copy.settings.alwaysConfirmTabClose}>
          <Switch
            checked={preferences.alwaysConfirmTabClose}
            onCheckedChange={(checked) => update({ alwaysConfirmTabClose: checked })}
          />
        </Row>
      </section>

      <p className="text-[11px] text-muted-foreground">{copy.settings.localOnlyHint}</p>
    </div>
  )
}
