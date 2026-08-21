/**
 * Label editor.
 *
 * Ties together the canvas, the property panel, variable fields, templates,
 * profiles and the print dialog. The loop it supports: design a label, mark
 * the parts that change, save it, and print batches that differ only where
 * they should.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { LabelElement, LabelIR } from '@zenith/shared'
import { renderBarcodeSvg, isVariableRef } from '@zenith/shared'
import { Printer, Redo2, Undo2 } from 'lucide-react'
import { copy } from '../i18n/index.ts'
import { usePreferences } from '../features/preferences/context.tsx'
import { Alert } from '../components/ui/alert.tsx'
import { Button } from '../components/ui/button.tsx'
import { Card, CardContent, CardHeader } from '../components/ui/card.tsx'
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
  useRememberedLayout,
} from '../components/ui/resizable.tsx'
import { Separator } from '../components/ui/separator.tsx'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs.tsx'
import { Input } from '../components/ui/input.tsx'
import { Label } from '../components/ui/label.tsx'
import { Select } from '../components/ui/select.tsx'
import { usePrinters } from '../features/printers/hooks.ts'
import { PrintDialog } from '../features/print/print-dialog.tsx'
import { TemplateBar } from '../features/templates/template-bar.tsx'
import { useProfiles } from '../features/profiles/hooks.ts'
import { useTemplates, type Template, type VariableField } from '../features/templates/hooks.ts'
import { useWorkspace } from '../app/workspace.tsx'
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

type SidePanel = 'element' | 'fields'

export interface EditorPageProps {
  /** The workspace tab this editor lives in. */
  tabId: string
  /** Template the tab was opened on, if any. */
  templateId: string | null
}

export function EditorPage({ tabId, templateId }: EditorPageProps): React.JSX.Element {
  const printers = usePrinters()
  const [printerId, setPrinterId] = useState<string | null>(null)
  const [profileId, setProfileId] = useState<string | null>(null)
  // The undo stack owns the IR; `ir` is just its present. Snapshots rather
  // than per-operation inverses, so a new element type is undoable the day it
  // exists instead of the day somebody writes its inverse.
  const { preferences } = usePreferences()
  const workspace = useWorkspace()
  const allTemplates = useTemplates()
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

  // Column widths persist per browser; see resizable.tsx for why they are not
  // part of the preferences store.
  const columnLayout = useRememberedLayout('zenith.editor.columns')

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

  /**
   * Load the template the tab was opened on.
   *
   * The workspace records which template a design tab is for; without this the
   * editor never found out, so opening one from the library produced an empty
   * "untitled design" and the template had to be picked again by hand.
   *
   * Keyed on the id rather than the object: re-running on every refetch would
   * discard whatever the user had typed since.
   */
  useEffect(() => {
    if (templateId === null || template?.id === templateId) {
      return
    }
    const found = allTemplates.data?.find((t) => t.id === templateId)
    if (found !== undefined) {
      loadTemplate(found)
    }
  }, [templateId, allTemplates.data])

  /**
   * Report unsaved work to the workspace.
   *
   * This drives the tab's unsaved marker, the confirmation on closing it and
   * the browser's leave prompt — none of which did anything before, because
   * nothing ever set the flag.
   */
  const isDirty = template === null ? ir.elements.length > 0 : history.past.length > 0
  useEffect(() => {
    workspace.setDirty(tabId, isDirty)
  }, [tabId, isDirty])

  const templateBody = (): Record<string, unknown> => ({
    printerKind: printer?.kind ?? 'niimbot',
    widthMm: ir.widthMm,
    heightMm: ir.heightMm,
    dpi: ir.dpi,
    elements: ir.elements,
    variableFields: fields,
  })

  return (
    <div className="flex h-full flex-col" onKeyDown={onKeyDown} tabIndex={-1}>
      {/*
        Top bar, in two groups: what this design *is* on the left — which
        template, and saving it — and everything about printing on the right.
        They were interleaved before, so answering "where will this go" meant
        reading across the whole bar.
      */}
      <div
        role="toolbar"
        aria-label={copy.editor.heading}
        aria-orientation="horizontal"
        className="flex flex-wrap items-end gap-3 border-b border-border pb-3"
      >
        <TemplateBar
          current={template}
          buildBody={templateBody}
          onLoad={loadTemplate}
          onSaved={(saved) => {
            setTemplate(saved)
            setFields(saved.variableFields)
            // The tab now *is* this template's tab: its title, its address and
            // any later save all refer to the same thing.
            workspace.setTemplate(tabId, saved.id)
            setHistory(initUndo({ ...ir }))
          }}
        />

        {/*
          Everything about printing, grouped at the far end and fenced off from
          the document controls on the left. The dropdowns choose what to print
          on; the button prints. Putting them together means the whole answer to
          "where is this going" sits in one place instead of at both ends of the
          bar.
        */}
        <div className="ml-auto flex items-end gap-2">
          <div className="flex items-end gap-1">
            <Button
              size="icon"
              variant="outline"
              disabled={!canUndo(history)}
              aria-label={copy.editor.undo}
              title={copy.editor.undo}
              onClick={doUndo}
            >
              <Undo2 className="h-4 w-4" />
            </Button>
            <Button
              size="icon"
              variant="outline"
              disabled={!canRedo(history)}
              aria-label={copy.editor.redo}
              title={copy.editor.redo}
              onClick={doRedo}
            >
              <Redo2 className="h-4 w-4" />
            </Button>
          </div>

          <Separator orientation="vertical" className="h-9" />

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

          {/*
            A profile is chosen here, not edited here: it belongs to the printer
            and its settings live on the printer page. Choosing one resizes the
            canvas to that stock, because designing on a canvas that is not the
            paper produces a label nobody notices is wrong until it prints.
          */}
          <div className="space-y-1">
            <Label>{copy.profiles.heading}</Label>
            <Select
              value={profileId ?? ''}
              disabled={printerId === null}
              onChange={(event) => {
                const id = event.target.value || null
                setProfileId(id)
                applyProfileStock(profiles.data?.find((p) => p.id === id) ?? null)
              }}
            >
              <option value="">—</option>
              {profiles.data?.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} · {p.labelWidthMm}×{p.labelHeightMm}mm
                </option>
              ))}
            </Select>
          </div>

          <Separator orientation="vertical" className="h-9" />

          {/* Overflow warns but never blocks (FR-067); only faults that make
              the job impossible disable this. */}
          <Button
            className="gap-1.5"
            disabled={blocking.length > 0 || printerId === null}
            onClick={() => setPrintOpen(true)}
          >
            <Printer className="h-4 w-4" />
            {copy.print.action}
          </Button>
        </div>
      </div>

      {/*
        Three resizable columns. Their useful widths depend on the label being
        worked on — many elements wants a taller layer list, a barcode-heavy
        design wants a wider property panel — so fixed widths would be wrong for
        both. Sizes persist per browser.
      */}
      <ResizablePanelGroup orientation="horizontal" className="min-h-0 flex-1 pt-3" {...columnLayout}>
        {/* Left: what the label is, what can go on it, and what is on it. */}
        <ResizablePanel id="left" defaultSize="16" minSize="12" maxSize="30">
          <aside className="h-full space-y-4 overflow-y-auto pr-3">
            <section className="space-y-1.5">
              <h3 className="text-xs font-semibold">{copy.editor.canvas}</h3>
              <div className="space-y-1">
                <Label className="text-[11px]">{copy.editor.canvasWidth}</Label>
                <Input
                  type="number"
                  step={0.5}
                  value={ir.widthMm}
                  onChange={(e) => setIr({ ...ir, widthMm: Math.max(1, Number(e.target.value) || 1) })}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-[11px]">{copy.editor.canvasHeight}</Label>
                <Input
                  type="number"
                  step={0.5}
                  value={ir.heightMm}
                  onChange={(e) => setIr({ ...ir, heightMm: Math.max(1, Number(e.target.value) || 1) })}
                />
              </div>
              <p className="text-[11px] text-muted-foreground">{ir.dpi} dpi</p>
            </section>

            <Separator />

            <section className="space-y-1.5">
              <h3 className="text-xs font-semibold">{copy.editor.addElement}</h3>
              <div className="grid grid-cols-2 gap-1">
                {ELEMENT_TYPES.map((type) => (
                  <Button key={type} size="sm" variant="outline" onClick={() => addElement(type)}>
                    {copy.editor.elements[type]}
                  </Button>
                ))}
              </div>
            </section>

            <Separator />

            <section className="space-y-1.5">
              <h3 className="text-xs font-semibold">{copy.editor.layers.heading}</h3>
              <LayersPanel ir={ir} selectedId={selectedId} onSelect={setSelectedId} onChange={setIr} />
            </section>
          </aside>
        </ResizablePanel>

        <ResizableHandle withHandle />

        {/* Centre: rulers, canvas, zoom. */}
        <ResizablePanel id="canvas" defaultSize="60" minSize="30">
          {/* The viewport owns its height, centring and scrolling; a second
              scroll container here would nest two scrollbars. */}
          <div className="flex h-full min-h-0 flex-col">
            <ElementContextMenu
              ir={ir}
              selectedId={selectedId}
              onDelete={deleteElement}
              onChange={setIr}
              className="flex min-h-0 flex-1 flex-col"
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
                marginNote={
                  profile === null ? copy.profiles.noProfileSelected : copy.profiles.marginHint
                }
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
          </div>
        </ResizablePanel>

        <ResizableHandle withHandle />

        {/* Right: the selected element, and the fields it can be bound to. */}
        <ResizablePanel id="right" defaultSize="24" minSize="16" maxSize="40">
          <aside className="h-full overflow-y-auto pl-3">
            <Card>
              {/*
                Radix Tabs unmounts the inactive panel, which is fine here — both
                panels read from state that lives above them, so there is nothing
                in either one to lose. The workspace tab bar is the opposite case
                and deliberately does not use this.
              */}
              <Tabs value={panel} onValueChange={(value) => setPanel(value as SidePanel)}>
                <CardHeader className="pb-2">
                  <TabsList>
                    <TabsTrigger value="element">{copy.editor.properties}</TabsTrigger>
                    <TabsTrigger value="fields">{copy.fields.heading}</TabsTrigger>
                  </TabsList>
                </CardHeader>
                <CardContent>
                  <TabsContent value="element" className="mt-0">
                    <Inspector ir={ir} element={selected} onChange={updateElement} onDelete={deleteElement} />
                  </TabsContent>
                  <TabsContent value="fields" className="mt-0">
                    <VariableFieldPanel
                      element={selected}
                      fields={fields}
                      onChangeFields={setFields}
                      onBindElement={bindElement}
                    />
                  </TabsContent>
                </CardContent>
              </Tabs>
            </Card>
          </aside>
        </ResizablePanel>
      </ResizablePanelGroup>

      {/*
        Problems along the bottom rather than pushing the canvas down. A design
        being dragged around produces and clears warnings constantly, and a
        banner that reflows the editor each time is unusable.
      */}
      {violations.length > 0 && (
        <div className="mt-3 space-y-1 border-t border-border pt-2">
          {violations.map((violation, index) => (
            <Alert
              key={`${violation.code}-${index}`}
              variant={violation.blocking ? 'destructive' : 'warning'}
              className="py-1.5 text-xs"
            >
              {copy.violations[violation.code](violation.values ?? {})}
            </Alert>
          ))}
        </div>
      )}

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
