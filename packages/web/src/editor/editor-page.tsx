/**
 * Label editor.
 *
 * Ties together the canvas, the property panel, variable fields, templates,
 * profiles and the print dialog. The loop it supports: design a label, mark
 * the parts that change, save it, and print batches that differ only where
 * they should.
 */
import { useMemo, useState } from 'react'
import type { LabelElement, LabelIR } from '@zenith/shared'
import { copy } from '../i18n/zh-CN.ts'
import { Alert } from '../components/ui/alert.tsx'
import { Button } from '../components/ui/button.tsx'
import { Card, CardContent, CardHeader } from '../components/ui/card.tsx'
import { Input } from '../components/ui/input.tsx'
import { Label } from '../components/ui/label.tsx'
import { Select } from '../components/ui/select.tsx'
import { usePrinters } from '../features/printers/hooks.ts'
import { PrintDialog } from '../features/print/print-dialog.tsx'
import { Preview } from '../features/print/preview.tsx'
import { JobList } from '../features/jobs/job-list.tsx'
import { JobHistory } from '../features/jobs/history.tsx'
import { TemplateBar } from '../features/templates/template-bar.tsx'
import { ProfilesPanel } from '../features/profiles/profiles-panel.tsx'
import { useProfiles } from '../features/profiles/hooks.ts'
import type { Template, VariableField } from '../features/templates/hooks.ts'
import { EditorCanvas } from './canvas.tsx'
import { Inspector } from './inspector.tsx'
import { VariableFieldPanel } from './variable-field-panel.tsx'
import { ELEMENT_TYPES, createBlankLabel, createElement, type ElementType } from './elements.ts'
import { blockingViolations, inspect } from './guards.ts'

type SidePanel = 'element' | 'fields' | 'profiles'

export function EditorPage(): React.JSX.Element {
  const printers = usePrinters()
  const [printerId, setPrinterId] = useState<string | null>(null)
  const [profileId, setProfileId] = useState<string | null>(null)
  const [ir, setIr] = useState<LabelIR>(() => createBlankLabel(203))
  const [fields, setFields] = useState<VariableField[]>([])
  const [template, setTemplate] = useState<Template | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [panel, setPanel] = useState<SidePanel>('element')
  const [printOpen, setPrintOpen] = useState(false)

  const printer = printers.data?.find((p) => p.id === printerId) ?? null
  const limits = printer?.capabilities ?? null
  const profiles = useProfiles(printerId)
  const profile = profiles.data?.find((p) => p.id === profileId) ?? null

  const violations = useMemo(() => (limits === null ? [] : inspect(ir, limits)), [ir, limits])
  const blocking = blockingViolations(violations)
  const selected = ir.elements.find((element) => element.id === selectedId) ?? null

  const addElement = (type: ElementType): void => {
    const element = createElement(type, ir)
    setIr({ ...ir, elements: [...ir.elements, element] })
    setSelectedId(element.id)
    setPanel('element')
  }

  const updateElement = (next: LabelElement): void => {
    setIr({ ...ir, elements: ir.elements.map((e) => (e.id === next.id ? next : e)) })
  }

  const deleteElement = (id: string): void => {
    setIr({ ...ir, elements: ir.elements.filter((e) => e.id !== id) })
    setSelectedId(null)
  }

  /** Point an element at a variable field, or back at fixed content. */
  const bindElement = (elementId: string, fieldName: string | null): void => {
    setIr({
      ...ir,
      elements: ir.elements.map((element) => {
        if (element.id !== elementId || !('content' in element)) {
          return element
        }
        return {
          ...element,
          content: fieldName === null ? '' : { $var: fieldName },
        } as LabelElement
      }),
    })
  }

  const loadTemplate = (loaded: Template): void => {
    setTemplate(loaded)
    setIr({
      widthMm: loaded.widthMm,
      heightMm: loaded.heightMm,
      dpi: loaded.dpi,
      elements: loaded.elements,
    })
    setFields(loaded.variableFields)
    setSelectedId(null)
  }

  const templateBody = (): Record<string, unknown> => ({
    printerKind: printer?.kind ?? 'niimbot',
    widthMm: ir.widthMm,
    heightMm: ir.heightMm,
    dpi: ir.dpi,
    elements: ir.elements,
    variableFields: fields,
  })

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h2 className="text-lg font-semibold">{copy.editor.heading}</h2>
        <div className="flex items-end gap-2">
          <div className="space-y-1">
            <Label>{copy.print.printer}</Label>
            <Select
              value={printerId ?? ''}
              onChange={(event) => {
                setPrinterId(event.target.value || null)
                setProfileId(null)
              }}
            >
              <option value="">—</option>
              {printers.data?.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </div>
          <Button disabled={blocking.length > 0 || printerId === null} onClick={() => setPrintOpen(true)}>
            {copy.print.action}
          </Button>
        </div>
      </div>

      <TemplateBar
        current={template}
        buildBody={templateBody}
        onLoad={loadTemplate}
        onSaved={(saved) => {
          setTemplate(saved)
          setFields(saved.variableFields)
        }}
      />

      {/* Blocking problems are explained before the print button is reachable;
          overflow is only marked on the canvas. */}
      {violations.map((violation, index) => (
        <Alert key={`${violation.code}-${index}`} variant={violation.blocking ? 'destructive' : 'warning'}>
          {copy.violations[violation.code](violation.values ?? {})}
        </Alert>
      ))}

      <div className="grid gap-4 lg:grid-cols-[auto_340px]">
        <div className="space-y-3">
          <div className="flex flex-wrap items-end gap-2">
            <div className="space-y-1">
              <Label>{copy.editor.canvasWidth}</Label>
              <Input
                type="number"
                step={0.5}
                value={ir.widthMm}
                onChange={(e) => setIr({ ...ir, widthMm: Math.max(1, Number(e.target.value) || 1) })}
                className="w-24"
              />
            </div>
            <div className="space-y-1">
              <Label>{copy.editor.canvasHeight}</Label>
              <Input
                type="number"
                step={0.5}
                value={ir.heightMm}
                onChange={(e) => setIr({ ...ir, heightMm: Math.max(1, Number(e.target.value) || 1) })}
                className="w-24"
              />
            </div>
            <div className="flex flex-wrap gap-1">
              {ELEMENT_TYPES.map((type) => (
                <Button key={type} size="sm" variant="outline" onClick={() => addElement(type)}>
                  {copy.editor.elements[type]}
                </Button>
              ))}
            </div>
          </div>

          <EditorCanvas
            ir={ir}
            selectedId={selectedId}
            onSelect={setSelectedId}
            onChange={setIr}
            resolveImage={(assetId) => `/api/images/${assetId}/content`}
          />

          <Preview
            ir={ir}
            printerId={printerId}
            offsetXMm={profile?.offsetXMm ?? 0}
            offsetYMm={profile?.offsetYMm ?? 0}
          />
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-2">
              <div className="flex gap-1">
                {(['element', 'fields', 'profiles'] as SidePanel[]).map((tab) => (
                  <Button
                    key={tab}
                    size="sm"
                    variant={panel === tab ? 'default' : 'ghost'}
                    onClick={() => setPanel(tab)}
                    disabled={tab === 'profiles' && printerId === null}
                  >
                    {tab === 'element'
                      ? copy.editor.heading
                      : tab === 'fields'
                        ? copy.fields.heading
                        : copy.profiles.heading}
                  </Button>
                ))}
              </div>
            </CardHeader>
            <CardContent>
              {panel === 'element' && (
                <Inspector ir={ir} element={selected} onChange={updateElement} onDelete={deleteElement} />
              )}
              {panel === 'fields' && (
                <VariableFieldPanel
                  element={selected}
                  fields={fields}
                  onChangeFields={setFields}
                  onBindElement={bindElement}
                />
              )}
              {panel === 'profiles' && printerId !== null && (
                <ProfilesPanel
                  printerId={printerId}
                  capabilities={limits}
                  selectedProfileId={profileId}
                  onSelect={setProfileId}
                />
              )}
            </CardContent>
          </Card>

          <JobList printerId={printerId} />

          <JobHistory printerId={printerId} />
        </div>
      </div>

      {printOpen && (
        <PrintDialog
          ir={ir}
          templateId={template?.id ?? null}
          profileId={profileId}
          printers={printers.data ?? []}
          selectedPrinterId={printerId}
          onSelectPrinter={setPrinterId}
          onClose={() => setPrintOpen(false)}
        />
      )}
    </div>
  )
}
