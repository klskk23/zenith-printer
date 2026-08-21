/**
 * Label editor.
 *
 * Ties together the canvas, the property panel, variable fields, templates,
 * profiles and the print dialog. The loop it supports: design a label, mark
 * the parts that change, save it, and print batches that differ only where
 * they should.
 */
import { useCallback, useMemo, useRef, useState } from 'react'
import type { LabelElement, LabelIR } from '@zenith/shared'
import { renderBarcodeSvg, isVariableRef } from '@zenith/shared'
import { copy } from '../i18n/index.ts'
import { usePreferences } from '../features/preferences/context.tsx'
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
import type { Profile } from '../features/profiles/hooks.ts'
import { CanvasViewport } from './canvas-viewport.tsx'
import { LayersPanel } from './layers-panel.tsx'
import { ElementContextMenu } from './context-menu.tsx'
import { snapWidth } from './barcode-width.ts'
import { canRedo, canUndo, commit, initUndo, redo, undo } from './undo.ts'
import { Inspector } from './inspector.tsx'
import { VariableFieldPanel } from './variable-field-panel.tsx'
import { ELEMENT_TYPES, createBlankLabel, createElement, type ElementType } from './elements.ts'
import { blockingViolations, inspect } from './guards.ts'

type SidePanel = 'element' | 'layers' | 'fields' | 'profiles'

export function EditorPage(): React.JSX.Element {
  const printers = usePrinters()
  const [printerId, setPrinterId] = useState<string | null>(null)
  const [profileId, setProfileId] = useState<string | null>(null)
  // The undo stack owns the IR; `ir` is just its present. Snapshots rather
  // than per-operation inverses, so a new element type is undoable the day it
  // exists instead of the day somebody writes its inverse.
  const { preferences } = usePreferences()
  // A blank label starts at whatever this browser was told to prefer (FR-071).
  const [history, setHistory] = useState(() =>
    initUndo(
      createBlankLabel(preferences.defaultDpi, {
        widthMm: preferences.defaultLabelWidthMm,
        heightMm: preferences.defaultLabelHeightMm,
      }),
    ),
  )
  const ir = history.present
  const coalescing = useRef(false)

  const setIr = useCallback((next: LabelIR) => {
    setHistory((current) => commit(current, next, coalescing.current))
  }, [])

  /** Replace the design outright — loading a template is not an undo step. */
  const resetIr = useCallback((next: LabelIR) => setHistory(initUndo(next)), [])

  const doUndo = useCallback(() => setHistory((current) => undo(current)), [])
  const doRedo = useCallback(() => setHistory((current) => redo(current)), [])

  const [fields, setFields] = useState<VariableField[]>([])
  const [template, setTemplate] = useState<Template | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [panel, setPanel] = useState<SidePanel>('element')

  // Ctrl/Cmd+Z and Ctrl/Cmd+Shift+Z, and Delete for the selection. Bound on the
  // editor rather than the window so a second design tab does not receive them.
  const onKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      const target = event.target as HTMLElement
      // Never steal keys from a field the user is typing in.
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
        return
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault()
        if (event.shiftKey) {
          doRedo()
        } else {
          doUndo()
        }
        return
      }
      if ((event.key === 'Delete' || event.key === 'Backspace') && selectedId !== null) {
        event.preventDefault()
        deleteElement(selectedId)
      }
    },
    [doRedo, doUndo, selectedId],
  )
  const [printOpen, setPrintOpen] = useState(false)

  const printer = printers.data?.find((p) => p.id === printerId) ?? null
  const limits = printer?.capabilities ?? null
  const profiles = useProfiles(printerId)
  const profile = profiles.data?.find((p) => p.id === profileId) ?? null

  /**
   * Choosing a profile sets the canvas to that stock.
   *
   * Elements are left exactly where they are. Rescaling or reflowing them would
   * be making layout decisions on the user's behalf, and the new coordinates
   * would no longer sit on the dot grid — which is the alignment the whole
   * editor works to preserve. Anything now outside the label is flagged as a
   * warning, and the size change is one undo step away.
   */
  const applyProfileStock = useCallback(
    (next: Profile | null) => {
      if (next === null) {
        return
      }
      if (next.labelWidthMm === ir.widthMm && next.labelHeightMm === ir.heightMm) {
        return
      }
      setIr({ ...ir, widthMm: next.labelWidthMm, heightMm: next.labelHeightMm })
    },
    [ir, setIr],
  )

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
    resetIr({
      widthMm: loaded.widthMm,
      heightMm: loaded.heightMm,
      dpi: loaded.dpi,
      elements: loaded.elements,
    })
    setFields(loaded.variableFields)
    setSelectedId(null)
  }

  /**
   * Barcode widths are quantised: width = moduleWidth x moduleCount, and the
   * module count comes from the content. The handle has to land on one of the
   * achievable steps, so it is computed here from the element being dragged.
   */
  const snapBarcodeWidthMm = useCallback(
    (targetMm: number): number => {
      const element = ir.elements.find((e) => e.id === selectedId)
      if (element === undefined || element.type !== 'barcode') {
        return targetMm
      }
      try {
        const content = isVariableRef(element.content) ? 'SAMPLE' : element.content
        const probe = renderBarcodeSvg({
          symbology: element.symbology,
          content,
          heightDots: 10,
          moduleWidthDots: element.moduleWidthDots,
        })
        return snapWidth(targetMm, probe.moduleCount, ir.dpi).widthMm
      } catch {
        // Invalid content has no module count; the guards report that
        // separately, and blocking the drag here would be a second complaint
        // about the same thing.
        return targetMm
      }
    },
    [ir.dpi, ir.elements, selectedId],
  )

  const templateBody = (): Record<string, unknown> => ({
    printerKind: printer?.kind ?? 'niimbot',
    widthMm: ir.widthMm,
    heightMm: ir.heightMm,
    dpi: ir.dpi,
    elements: ir.elements,
    variableFields: fields,
  })

  return (
    <div className="space-y-4" onKeyDown={onKeyDown} tabIndex={-1}>
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
          <div className="flex gap-1">
            <Button
              size="sm"
              variant="outline"
              disabled={!canUndo(history)}
              title={copy.editor.undo}
              onClick={doUndo}
            >
              ↶
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={!canRedo(history)}
              title={copy.editor.redo}
              onClick={doRedo}
            >
              ↷
            </Button>
          </div>
          {/* Overflow warns but never blocks (FR-067); only faults that make the
              job impossible disable this. */}
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

          <ElementContextMenu
            ir={ir}
            selectedId={selectedId}
            onDelete={deleteElement}
            onChange={setIr}
          >
            <CanvasViewport
              ir={ir}
              selectedId={selectedId}
              onSelect={setSelectedId}
              onChange={setIr}
              resolveImage={(assetId) => `/api/images/${assetId}/content`}
              snapBarcodeWidthMm={snapBarcodeWidthMm}
              // Advice, not a boundary: elements can still be placed here.
              margins={profile}
              // A drag emits a state per pointer move; without this the whole
              // history is one drag.
              onGestureStart={() => {
                coalescing.current = false
              }}
              onGestureEnd={() => {
                coalescing.current = false
              }}
            />
          </ElementContextMenu>

          <Preview ir={ir} printerId={printerId} />
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-2">
              <div className="flex gap-1">
                {(['element', 'layers', 'fields', 'profiles'] as SidePanel[]).map((tab) => (
                  <Button
                    key={tab}
                    size="sm"
                    variant={panel === tab ? 'default' : 'ghost'}
                    onClick={() => setPanel(tab)}
                    disabled={tab === 'profiles' && printerId === null}
                  >
                    {tab === 'element'
                      ? copy.editor.heading
                      : tab === 'layers'
                        ? copy.editor.layers.heading
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
              {panel === 'layers' && (
                <LayersPanel ir={ir} selectedId={selectedId} onSelect={setSelectedId} onChange={setIr} />
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
                  onSelect={(id) => {
                    setProfileId(id)
                    applyProfileStock(profiles.data?.find((p) => p.id === id) ?? null)
                  }}
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
