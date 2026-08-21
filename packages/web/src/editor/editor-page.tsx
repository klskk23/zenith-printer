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
import { symbolFitMm } from './barcode-width.ts'
import { copyElement, duplicateElement, pasteElement } from './clipboard.ts'
import { imageBoxMm, refit } from './autofit.ts'
import { imageFileFrom, naturalSizeOf, useUploadImage } from '../features/images/hooks.ts'
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
  /**
   * The action currently in progress, if any.
   *
   * A ref rather than state: it changes on pointer-down and pointer-up and
   * nothing on screen depends on it, so making it state would re-render the
   * editor twice per drag for no visible effect.
   */
  const gestureKey = useRef<string | null>(null)
  const gestureCount = useRef(0)

  const setIr = useCallback((next: LabelIR, mergeKey: string | null = null) => {
    // An explicit key wins; otherwise the change belongs to whatever gesture is
    // under way, and to nothing when none is.
    setHistory((current) => commit(current, next, mergeKey ?? gestureKey.current))
  }, [])

  /**
   * Edit the design from whatever it is now, rather than from what it was when
   * the callback was created.
   *
   * Needed by anything that finishes after an await: an upload that resolves
   * two seconds later would otherwise commit a label built from the `ir` of two
   * seconds ago, silently discarding everything typed in between.
   */
  const updateIr = useCallback((change: (current: LabelIR) => LabelIR) => {
    setHistory((current) => commit(current, change(current.present), gestureKey.current))
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
  /**
   * State rather than a ref, because the context menu asks whether there is
   * anything to paste. A ref read during render does not schedule one, so the
   * Paste item stayed greyed out after a copy until some unrelated change
   * happened to re-render the editor.
   *
   * Per tab. Copying in one design and pasting into another would have to
   * reconcile two different dot grids, and the element would land somewhere
   * other than where it was cut from.
   */
  const [clipboard, setClipboard] = useState<LabelElement | null>(null)
  const uploadImage = useUploadImage()
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
      if (event.ctrlKey || event.metaKey) {
        const key = event.key.toLowerCase()
        if (key === 'c') {
          event.preventDefault()
          copySelection()
          return
        }
        if (key === 'v') {
          // Only the editor's own clipboard. An image pasted from the system
          // clipboard arrives as a `paste` event with files on it, handled
          // separately, and that event is not cancelled here.
          if (clipboard !== null) {
            event.preventDefault()
            pasteClipboard()
          }
          return
        }
        if (key === 'd') {
          event.preventDefault()
          duplicateSelection()
          return
        }
      }
      if ((event.key === 'Delete' || event.key === 'Backspace') && selectedId !== null) {
        event.preventDefault()
        deleteElement(selectedId)
      }
    },
    // The copy/paste handlers are plain functions redefined each render; `ir`
    // is what they actually read, so it is `ir` that has to be listed.
    [doRedo, doUndo, selectedId, ir, clipboard],
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

  const violations = useMemo(() => inspect(ir, limits), [ir, limits])
  const blocking = blockingViolations(violations)
  const selected = ir.elements.find((element) => element.id === selectedId) ?? null

  const addElement = (type: ElementType): void => {
    // Fitted on the way in: a new text element is 30x5 mm holding about 6x3 mm
    // of glyphs, and a new QR code is a 15 mm square holding about 6 mm of
    // symbol.
    const element = refit(null, createElement(type, ir), ir.dpi)
    setIr({ ...ir, elements: [...ir.elements, element] })
    setSelectedId(element.id)
    setPanel('element')
  }

  /**
   * Apply an edit, refitting the box when the edit changed what fills it.
   *
   * A text element's box is not derived from its text by the renderer —
   * `heightMm` has no effect on the drawing at all, and `widthMm` only places
   * the anchor for centred and right-aligned text. So without this, typing a
   * longer line leaves the selection frame, the overflow check and the layers
   * panel all describing the box the element had when it was created.
   *
   * Only when the content or the font changed. Refitting on every edit would
   * discard a width the user set by hand the next time they nudged the element
   * a millimetre sideways.
   */
  const updateElement = (next: LabelElement, mergeKey: string | null = null): void => {
    const previous = ir.elements.find((e) => e.id === next.id) ?? null
    const fitted = refit(previous, next, ir.dpi)
    setIr({ ...ir, elements: ir.elements.map((e) => (e.id === fitted.id ? fitted : e)) }, mergeKey)
  }

  const deleteElement = (id: string): void => {
    setIr({ ...ir, elements: ir.elements.filter((e) => e.id !== id) })
    setSelectedId(null)
  }

  const copySelection = (): void => {
    const copied = copyElement(ir, selectedId)
    if (copied !== null) {
      setClipboard(copied)
    }
  }

  const pasteClipboard = (): void => {
    if (clipboard === null) {
      return
    }
    const { ir: next, id } = pasteElement(ir, clipboard)
    setIr(next)
    setSelectedId(id)
    setPanel('element')
  }

  /**
   * An image on the system clipboard becomes an image element.
   *
   * A screenshot has no filename and no place on disk, so it is uploaded like
   * any other asset first and the element points at the result. Placed at the
   * label's origin rather than under the pointer: a paste event carries no
   * coordinates, and guessing from the last mouse position puts the image
   * somewhere the user did not click.
   */
  const pasteImageFile = (file: File): void => {
    // Measured alongside the upload rather than before it — a picture the
    // browser cannot decode must still reach the label, in the default box.
    const measuring = naturalSizeOf(file)
    uploadImage.mutate(file, {
      onSuccess: (asset) => {
        const placed = { ...createElement('image', ir), assetId: asset.id } as LabelElement
        // Appended to whatever the label is now, not to the copy captured when
        // the upload started — anything typed while it was in flight stays.
        updateIr((current) => ({ ...current, elements: [...current.elements, placed] }))
        setSelectedId(placed.id)
        setPanel('element')

        void measuring.then((natural) => {
          if (natural.width <= 0 || natural.height <= 0) {
            return
          }
          // The default box is a square and the renderer letterboxes into it,
          // so a screenshot left at that size is drawn as a strip across an
          // element several times its height.
          updateIr((current) => ({
            ...current,
            elements: current.elements.map((e) =>
              e.id === placed.id && 'widthMm' in e ? { ...e, ...imageBoxMm(e, natural, current) } : e,
            ),
          }))
        })
      },
    })
  }

  const handlePaste = (event: ClipboardEvent): void => {
    const target = event.target as HTMLElement | null
    if (
      target !== null &&
      (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
    ) {
      return
    }
    const file = imageFileFrom([...(event.clipboardData?.files ?? [])])
    if (file === null) {
      return
    }
    event.preventDefault()
    pasteImageFile(file)
  }

  /**
   * Listen on the document, not on the editor's own element.
   *
   * A paste event goes to whatever has focus, and after clicking the canvas
   * that is usually the document body — so a handler bound to this element
   * received nothing, and pasting a screenshot appeared to do nothing at all.
   *
   * Only while this tab is the active one. Inactive tabs stay mounted (they
   * keep their undo history), so a document-level listener in each of them
   * would paste the same image into every open design.
   */
  const isActiveTab = workspace.activeTab?.id === tabId
  useEffect(() => {
    if (!isActiveTab) {
      return
    }
    document.addEventListener('paste', handlePaste)
    return () => document.removeEventListener('paste', handlePaste)
  })

  const duplicateSelection = (): void => {
    const result = duplicateElement(ir, selectedId)
    if (result === null) {
      return
    }
    setIr(result.ir)
    setSelectedId(result.id)
    setPanel('element')
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
      if (element === undefined || (element.type !== 'barcode' && element.type !== 'qrcode')) {
        return targetMm
      }
      // QR codes go through the same quantisation as barcodes. They used not
      // to, so dragging one produced any side at all and the renderer then
      // drew the largest that fitted — leaving the symbol adrift inside its
      // own frame.
      return symbolFitMm(element, targetMm, ir.dpi)?.widthMm ?? targetMm
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

  /**
   * Preselect the printer's default profile.
   *
   * A printer is chosen because a roll is loaded in it, and which roll that is
   * is what the default records. Leaving the selector empty meant the canvas
   * kept whatever size it had and no margins were drawn — a design laid out
   * against nothing in particular.
   *
   * Only when nothing is selected: reselecting the default would undo a
   * deliberate choice of a different roll every time the list refetched.
   */
  useEffect(() => {
    if (printerId === null || profileId !== null) {
      return
    }
    const fallback = profiles.data?.find((p) => p.isDefault)
    if (fallback !== undefined) {
      setProfileId(fallback.id)
      applyProfileStock(fallback)
    }
  }, [printerId, profileId, profiles.data])

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
                // Cleared here; the effect below picks this printer's default
                // once its profiles have loaded.
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
              onCopy={copySelection}
              onPaste={pasteClipboard}
              onDuplicate={duplicateSelection}
              canPaste={clipboard !== null}
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
                // One undo entry per gesture. Every pointer move emits a state,
                // each snapped to the grid, so without a key naming the gesture
                // undo walked back one grid step at a time.
                //
                // A fresh key each time, so two drags of the same element in a
                // row stay two separate entries.
                onGestureStart={() => {
                  gestureCount.current += 1
                  gestureKey.current = `gesture-${gestureCount.current}`
                }}
                onGestureEnd={() => {
                  gestureKey.current = null
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

      {printOpen && printer !== null && (
        <PrintDialog
          ir={ir}
          templateId={template?.id ?? null}
          profileId={profileId}
          printer={printer}
          onClose={() => setPrintOpen(false)}
        />
      )}
    </div>
  )
}
