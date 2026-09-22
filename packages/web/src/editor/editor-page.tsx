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

import { Redo2, Undo2 } from 'lucide-react'
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
import { usePrinters } from '../features/printers/hooks.ts'
import { PrintStep } from '../features/print/print-step.tsx'
import { ConfirmStep } from '../features/print/confirm-step.tsx'
import { blockReason, stepsFor, tally } from '../features/print/flow.ts'
import { EMPTY, selectedCount, type Selection } from '../features/print/selection.ts'
import { StepBar } from '../app/step-bar.tsx'
import { TemplateBar } from '../features/templates/template-bar.tsx'
import { useProfiles } from '../features/profiles/hooks.ts'
import { useTemplates, type Template } from '../features/templates/hooks.ts'
import { usePrintPresets } from '../features/print-presets/hooks.ts'
import { useWorkspace } from '../app/workspace.tsx'
import type { Profile } from '../features/profiles/hooks.ts'
import { CanvasViewport } from './canvas-viewport.tsx'
import { LayersPanel } from './layers-panel.tsx'
import { ElementContextMenu } from './context-menu.tsx'
import { symbolFitMm } from './barcode-width.ts'
import { copyElement, duplicateElement, pasteElement } from './clipboard.ts'
import { imageBoxMm, refit, refitReferences } from './autofit.ts'
import { clampOrdinal, designValues, previewIr } from './preview-values.ts'
import type { VariableDefinition } from '@zenith/shared'
import { imageFileFrom, naturalSizeOf, useUploadImage } from '../features/images/hooks.ts'
import { canRedo, canUndo, commit, initUndo, redo, undo } from './undo.ts'
import { Inspector } from './inspector.tsx'
import { VariablesPanel } from './variables-panel.tsx'
import { PreviewValues } from './preview-row-picker.tsx'
import { DataSourceBinding } from './data-source-binding.tsx'
import { useDataSourceRows, useDataSources } from '../features/data-sources/hooks.ts'
import { useSequencePools } from '../features/sequence-pools/hooks.ts'
import { ELEMENT_TYPES, createBlankLabel, createElement, type ElementType } from './elements.ts'
import { blockingViolations, inspect } from './guards.ts'

type SidePanel = 'element' | 'variables'

export interface EditorPageProps {
  /**
   * Which of the label's three steps to show.
   *
   * One component across all three: the content on the canvas, the undo stack,
   * the chosen machine and the ticked rows are this session's, and stepping is
   * choosing which of them is on screen — not loading another page.
   */
  step: 'design' | 'print' | 'confirm'
  /** The saved label this page is for, if any. */
  templateId: string | null
  /**
   * A print preset to open with, from `?preset=` in the address.
   *
   * Sets the printer, the print settings and the copy count once, and then has
   * no further say: somebody who changes any of them is not to be overruled by
   * a link they followed a minute ago.
   */
  presetId?: string
}

export function EditorPage({ step, templateId, presetId }: EditorPageProps): React.JSX.Element {
  const printers = usePrinters()
  const [printerId, setPrinterId] = useState<string | null>(null)
  const [profileId, setProfileId] = useState<string | null>(null)
  /** Copies the print dialog opens on; a preset may raise it above one. */

  const presets = usePrintPresets()
  /**
   * What the link could not do, said out loud.
   *
   * A link that promises a printer and a count, and lands on the defaults,
   * looks exactly like one that worked — the way somebody finds out otherwise
   * is by holding the labels.
   */
  const [presetNotices, setPresetNotices] = useState<readonly string[]>([])
  /** The preset's profile, waiting for that printer's profiles to arrive. */
  const [pendingProfileId, setPendingProfileId] = useState<string | null>(null)
  /** Applied once, whatever the outcome. */
  const presetApplied = useRef(false)
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

  const [variables, setVariables] = useState<VariableDefinition[]>([])
  const [dataSourceId, setDataSourceId] = useState<string | null>(null)
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
  /**
   * The print choices, held by the session rather than by the step that makes
   * them: the confirm step reads them, and "print again" clears the rows while
   * keeping the machine.
   */
  const [selection, setSelection] = useState<Selection>(EMPTY)
  const [copies, setCopies] = useState(1)
  /**
   * Every row key this session has seen, by position. Accumulated here because
   * the selection panel only ever holds the ten rows it is showing.
   */
  const [keyByOrdinal, setKeyByOrdinal] = useState<ReadonlyMap<number, string>>(new Map())

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
   *
   * `quiet` is for the preset link: the roll it names is applied on arrival,
   * before the person has touched anything, and that must not read as an
   * edit — or every link from the asset ledger would open a label that asks
   * "keep your changes?" on the way out. The size is set, the history is not.
   */
  const applyProfileStock = useCallback(
    (next: Profile | null, { quiet = false }: { quiet?: boolean } = {}) => {
      if (next === null) {
        return
      }
      if (next.labelWidthMm === ir.widthMm && next.labelHeightMm === ir.heightMm) {
        return
      }
      if (quiet) {
        setHistory((current) => ({
          ...current,
          present: { ...current.present, widthMm: next.labelWidthMm, heightMm: next.labelHeightMm },
        }))
        return
      }
      setIr({ ...ir, widthMm: next.labelWidthMm, heightMm: next.labelHeightMm })
    },
    [ir, setIr],
  )

  const violations = useMemo(() => inspect(ir, limits), [ir, limits])

  /**
   * The design as the canvas should draw it.
   *
   * Evaluation never throws: a design mid-edit is full of states that are not
   * printable yet, and the editor has to survive all of them. Unresolved names
   * are reported below the canvas and block printing; they do not stop drawing.
   */
  /**
   * A row of the bound table, so `${列名}` draws as what it will say.
   *
   * Without it every data-source reference renders blank, and the canvas is
   * the only place the layout can be judged.
   *
   * Which row is the operator's choice, defaulting to the first — which is all
   * this ever used to offer. The first row is rarely the interesting one: the
   * layout question is whether the longest name still fits, or what the design
   * does with the empty cell further down.
   *
   * Held here rather than in the design. It changes what is drawn and nothing
   * else, so it is not saved, and it starts again at row one whenever the
   * table changes underneath it.
   */
  const sources = useDataSources()
  const pools = useSequencePools().data ?? []
  const boundSource = sources.data?.find((source) => source.id === dataSourceId)
  const columns = boundSource?.columns ?? []
  const rowCount = boundSource?.rowCount ?? 0
  const [previewOrdinal, setPreviewOrdinal] = useState(1)
  // Clamped on read rather than corrected by an effect: a refresh can shorten
  // the table under a choice already made, and asking for row 9 of 3 would
  // return nothing and blank every reference on the canvas.
  const shownOrdinal = clampOrdinal(previewOrdinal, rowCount)
  const previewRow = useDataSourceRows(dataSourceId, shownOrdinal, 1).data?.rows[0]?.values ?? {}

  // Rebinding replaces the table; an ordinal from the old one points at a
  // different row, or at none.
  useEffect(() => {
    setPreviewOrdinal(1)
  }, [dataSourceId])

  const values = useMemo(
    () => ({ ...previewRow, ...designValues(variables) }),
    [variables, JSON.stringify(previewRow)],
  )
  /**
   * Keep reference-bearing boxes in step with the values behind them.
   *
   * `refit` covers an edit to an element. This covers the other way the
   * content changes: binding a column, or editing the constant a barcode
   * points at. Without it the symbol redraws at its new size and its frame —
   * the thing that says whether it fits the label — stays where it was.
   *
   * Applied **quietly** — it never lands in the undo stack, and it never makes
   * a label count as edited. Nobody did it: the box follows the content the
   * way a shadow follows a hand. It used to commit, which meant that merely
   * opening a label bound to a table made the first row arrive, resize a
   * barcode's frame, and leave the page claiming unsaved work before anybody
   * had touched anything — so the question on the way out was asked every
   * single time, about nothing.
   *
   * What somebody actually changed is tracked elsewhere: elements by the undo
   * stack, variables and the binding by comparison with the stored label.
   */
  useEffect(() => {
    setHistory((current) => {
      const next = refitReferences(current.present, values)
      return next === current.present ? current : { ...current, present: next }
    })
  }, [values])

  const preview = useMemo(() => previewIr(ir, values), [ir, values])
  const drawn = preview.ir
  const blocking = blockingViolations(violations)

  /**
   * The three steps' shared arithmetic.
   *
   * `address` is this label's identity in the address bar; stepping keeps it
   * so a link followed with `?preset=` still names the preset four steps in.
   */
  const address = {
    templateId: template?.id ?? templateId,
    ...(presetId === undefined ? {} : { presetId }),
  }
  const chosenRows = dataSourceId === null ? 0 : selectedCount(selection, rowCount)
  /**
   * The chosen rows in print order — ascending ordinal, never tick order.
   *
   * The previews on the confirm step walk this list, so the first one is the
   * label that genuinely comes out first. A selection made by key only yields
   * the rows whose page has been loaded: a key on a page nobody opened cannot
   * be turned into a position, and showing fewer previews than will print is
   * better than showing the wrong ones.
   */
  const rowOrdinals = useMemo(() => {
    if (dataSourceId === null) {
      return []
    }
    if (selection.kind === 'all') {
      return Array.from({ length: rowCount }, (_unused, index) => index + 1)
    }
    if (selection.kind === 'keys') {
      const byKey = new Map([...keyByOrdinal].map(([ordinal, key]) => [key, ordinal] as const))
      return selection.keys
        .map((key) => byKey.get(key))
        .filter((ordinal): ordinal is number => ordinal !== undefined)
        .sort((a, b) => a - b)
    }
    return [...selection.ordinals].sort((a, b) => a - b)
  }, [dataSourceId, selection, rowCount, keyByOrdinal])
  const counts = tally({ boundRows: dataSourceId === null ? null : rowCount, chosenRows, copies })
  const blocked =
    // A design the machine cannot print at all — a canvas wider than the head,
    // a barcode with no content — stops printing before any of the choices
    // matter, and says so in the words the editor already uses for it.
    blocking.length > 0
      ? copy.violations[blocking[0]!.code](blocking[0]!.values ?? {})
      : blockReason({
          printer,
          unresolved: preview.unresolved,
          dataSourceId,
          chosenRows,
          labels: counts.labels,
        })
  /**
   * Somebody opened the confirm address without anything to confirm — a
   * bookmark, a refresh, a typed URL. Send them one step back rather than
   * showing a summary of nothing; `replaceState` inside the workspace keeps
   * this out of the history, so Back does not bounce.
   */
  useEffect(() => {
    if (step === 'confirm' && blocked !== null && !printers.isPending) {
      workspace.open({ ...address, kind: 'label-print' }, { replace: true })
    }
    // Deliberately narrow: this watches the guard's own conditions, not the
    // address object it navigates with, which is rebuilt every render.
  }, [step, blocked, printers.isPending])

  const steps = stepsFor({
    page: step === 'print' ? 'label-print' : step === 'confirm' ? 'label-confirm' : 'label',
    canSubmit: blocked === null,
  })
  const selected = ir.elements.find((element) => element.id === selectedId) ?? null

  const addElement = (type: ElementType): void => {
    // Fitted on the way in: a new text element is 30x5 mm holding about 6x3 mm
    // of glyphs, and a new QR code is a 15 mm square holding about 6 mm of
    // symbol.
    const element = refit(null, createElement(type, ir), ir.dpi, values)
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
    const fitted = refit(previous, next, ir.dpi, values)
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
  useEffect(() => {
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

  /**
   * Rename a field, and take every element bound to it along.
   *
   * A binding is by name, so renaming the field without rewriting them leaves
   * each one pointing at something that no longer exists — the element draws
   * as nothing, and nothing on screen says why. The two halves belong in one
   * step for undo as well: reversing a rename has to reverse the rebinding.
   *
   * Identified by position, because the name is the thing being edited. Every
   * keystroke is a rename; the shared merge key folds them into one entry.
   */
  // Renaming a variable no longer rewrites element content: references are
  // written by hand inside the content, so the editor has no business editing
  // somebody's text. The unresolved-name warning tells them what broke.

  const loadTemplate = (loaded: Template): void => {
    setTemplate(loaded)
    resetIr({
      widthMm: loaded.widthMm,
      heightMm: loaded.heightMm,
      dpi: loaded.dpi,
      elements: loaded.elements,
    })
    setVariables(loaded.variables)
    setDataSourceId(loaded.dataSourceId)
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
      return symbolFitMm(element, targetMm, ir.dpi, values)?.widthMm ?? targetMm
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
  /**
   * Whether leaving would lose something somebody did.
   *
   * Three sources, because three things are editable and only one of them is
   * in the undo stack: the elements (history), the design's own variables, and
   * which table it is bound to. An unsaved label is dirty as soon as it has
   * anything on it.
   */
  const isDirty =
    template === null
      ? ir.elements.length > 0
      : history.past.length > 0 ||
        dataSourceId !== template.dataSourceId ||
        JSON.stringify(variables) !== JSON.stringify(template.variables)

  /**
   * Report unsaved edits to the shell.
   *
   * Leaving is abandoning: the shell asks before navigating away and the
   * browser asks before a reload, and neither knows there is anything to
   * lose unless it is told.
   */
  useEffect(() => {
    workspace.setDirty(isDirty)
  }, [isDirty])

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
    // Held off while a preset's own profile is still waiting for that
    // printer's list: applying the default first would move the canvas to one
    // stock and then to another, leaving a size change in the undo stack that
    // nobody made.
    if (printerId === null || profileId !== null || pendingProfileId !== null) {
      return
    }
    const fallback = profiles.data?.find((p) => p.isDefault)
    if (fallback !== undefined) {
      setProfileId(fallback.id)
      // Quietly: choosing a machine on the print step is not editing the
      // label. The canvas follows the stock so the preview is honest, but
      // nobody should be asked whether to keep changes they never made.
      applyProfileStock(fallback, { quiet: true })
    }
  }, [printerId, profileId, pendingProfileId, profiles.data])

  /**
   * Apply the preset the address arrived with — once, and never again.
   *
   * Waits for the presets and the printers, because "no such preset" and "not
   * fetched yet" look identical in an empty list, and announcing the first
   * while the second is true is how a working link gets reported as broken.
   *
   * Every branch below still opens the design. A link that names a deleted
   * printer is a link with one wrong reference, not a reason to refuse a
   * label somebody asked to see.
   */
  useEffect(() => {
    if (presetId === undefined || presetApplied.current) {
      return
    }
    if (!presets.isSuccess || !printers.isSuccess) {
      return
    }
    presetApplied.current = true

    const preset = presets.data.find((item) => item.id === presetId)
    if (preset === undefined) {
      setPresetNotices([copy.editor.preset.missing])
      return
    }

    const notices: string[] = []
    if (preset.templateId !== templateId) {
      /**
       * The address wins.
       *
       * Swapping the label out from under somebody who clicked a specific one
       * is worse than the settings being wrong: they would print the other
       * label believing it was this one. The preset's other three fields are
       * still applied — they are what the link was for.
       */
      const other = allTemplates.data?.find((item) => item.id === preset.templateId)
      notices.push(copy.editor.preset.otherTemplate(other?.name ?? preset.templateId))
    }

    if (printers.data.some((item) => item.id === preset.printerId)) {
      setPrinterId(preset.printerId)
      if (preset.profileId !== null) {
        // Resolved in the effect below: this printer's profiles have not been
        // fetched yet at this point.
        setPendingProfileId(preset.profileId)
      }
    } else {
      // Left unselected on purpose. Falling back to whichever printer happens
      // to be first produces labels on the wrong machine, and the print button
      // is disabled until one is chosen, which says so without printing
      // anything to find out.
      notices.push(copy.editor.preset.printerGone)
    }

    setCopies(preset.copies)
    setPresetNotices(notices.length > 0 ? notices : [copy.editor.preset.applied(preset.name)])
  }, [presetId, presets.isSuccess, presets.data, printers.isSuccess, printers.data, templateId, allTemplates.data])

  /** The preset's profile, once that printer's profiles have arrived. */
  useEffect(() => {
    if (pendingProfileId === null || !profiles.isSuccess) {
      return
    }
    const wanted = profiles.data.find((item) => item.id === pendingProfileId)
    setPendingProfileId(null)
    if (wanted === undefined) {
      setPresetNotices((current) => [...current, copy.editor.preset.profileGone])
      return
    }
    setProfileId(wanted.id)
    // The same resize as choosing it by hand — a design laid out on a canvas
    // that is not the paper prints wrong — but quietly: arriving by link is
    // not editing.
    applyProfileStock(wanted, { quiet: true })
  }, [pendingProfileId, profiles.isSuccess, profiles.data, applyProfileStock])

  const templateBody = (): Record<string, unknown> => ({
    printerKind: printer?.kind ?? 'niimbot',
    widthMm: ir.widthMm,
    heightMm: ir.heightMm,
    dpi: ir.dpi,
    elements: ir.elements,
    variables,
    dataSourceId,
  })

  return (
    // `tabIndex={-1}` so the shortcuts below have somewhere to be heard, and
    // `focus:outline-none` because that focus is not navigation. Clicking the
    // canvas focuses this container — it is the nearest focusable ancestor —
    // and the first keystroke afterwards flips the browser into keyboard
    // modality, at which point :focus-visible starts matching a full-page
    // element and draws a box around the whole designer. Pressing Delete looked
    // like it was outlining the screen.
    <div
      className="flex h-full flex-col focus:outline-none"
      onKeyDown={onKeyDown}
      tabIndex={-1}
    >
      <StepBar
        steps={steps}
        onGo={(id) => workspace.open({ ...address, kind: id === 'labels' ? 'labels' : id === 'design' ? 'label' : 'label-print' })}
        context={
          template === null ? copy.workspace.untitledDesign : `${template.name} · ${ir.widthMm}×${ir.heightMm} mm`
        }
      />

      {step === 'print' ? (
        <PrintStep
          printers={printers.data ?? []}
          printerId={printerId}
          onPrinter={(id) => {
            setPrinterId(id)
            // Cleared here; the effect below picks this printer's default
            // once its profiles have loaded.
            setProfileId(null)
          }}
          profiles={profiles.data ?? []}
          profileId={profileId}
          onProfile={(id) => {
            setProfileId(id)
            // Also quiet, and for the same reason: this is a printing
            // decision made on the printing step.
            applyProfileStock(profiles.data?.find((candidate) => candidate.id === id) ?? null, {
              quiet: true,
            })
          }}
          dataSourceId={dataSourceId}
          selection={selection}
          onSelection={setSelection}
          keyByOrdinal={keyByOrdinal}
          onRowKeys={setKeyByOrdinal}
          copies={copies}
          onCopies={setCopies}
          tally={counts}
          blocked={blocked}
          notices={presetNotices}
          onContinue={() => workspace.open({ ...address, kind: 'label-confirm' })}
          onBack={() => workspace.open({ ...address, kind: 'label' })}
        />
      ) : step === 'confirm' ? (
        <ConfirmStep
          ir={ir}
          template={template}
          templateId={template?.id ?? null}
          printer={printer}
          profile={profiles.data?.find((candidate) => candidate.id === profileId) ?? null}
          profileId={profileId}
          // The design's own variables only. `values` also carries the row the
          // *canvas* is standing in for, and that row is a preview convenience.
          variableValues={designValues(variables)}
          dataSourceId={dataSourceId}
          selection={selection}
          chosenRows={chosenRows}
          rowOrdinals={rowOrdinals}
          keyByOrdinal={keyByOrdinal}
          copies={copies}
          tally={counts}
          blocked={blocked}
          onBack={() => workspace.open({ ...address, kind: 'label-print' })}
          onAgain={() => {
            setSelection(EMPTY)
            workspace.open({ ...address, kind: 'label-print' })
          }}
          onLabels={() => workspace.open({ kind: 'labels' })}
          onQueue={() => workspace.open({ kind: 'queue' })}
        />
      ) : (
        <>
      {/*
        Three resizable columns. Their useful widths depend on the label being
        worked on — many elements wants a taller layer list, a barcode-heavy
        design wants a wider property panel — so fixed widths would be wrong for
        both. Sizes persist per browser.
      */}
      <ResizablePanelGroup orientation="horizontal" className="min-h-0 flex-1 pt-3" {...columnLayout}>
        {/* Left: what the label is, what can go on it, and what is on it. */}
        <ResizablePanel id="left" defaultSize="16" minSize="12" maxSize="30">
          {/* Same as the right column: a side panel is a place a table can
              end up, and one of the two being a ScrollArea is a trap laid for
              whoever puts one here next. */}
          <div className="scrollbar-themed h-full overflow-y-auto">
            <aside className="flex flex-col gap-4 pr-3">
            <section className="flex flex-col gap-1.5">
              <h3 className="text-xs font-medium">{copy.editor.canvas}</h3>
              <div className="flex flex-col gap-1">
                <Label className="text-2xs">{copy.editor.canvasWidth}</Label>
                <Input
                  // The label beside it carries no `for`, so without this the
                  // field has no accessible name at all.
                  aria-label={copy.editor.canvasWidth}
                  type="number"
                  step={0.5}
                  value={ir.widthMm}
                  onChange={(e) => setIr({ ...ir, widthMm: Math.max(1, Number(e.target.value) || 1) })}
                />
              </div>
              <div className="flex flex-col gap-1">
                <Label className="text-2xs">{copy.editor.canvasHeight}</Label>
                <Input
                  aria-label={copy.editor.canvasHeight}
                  type="number"
                  step={0.5}
                  value={ir.heightMm}
                  onChange={(e) => setIr({ ...ir, heightMm: Math.max(1, Number(e.target.value) || 1) })}
                />
              </div>
              <p className="text-2xs text-muted-foreground">{ir.dpi} dpi</p>
            </section>

            <Separator />

            <section className="flex flex-col gap-1.5">
              <h3 className="text-xs font-medium">{copy.editor.addElement}</h3>
              <div className="grid grid-cols-2 gap-1">
                {ELEMENT_TYPES.map((type) => (
                  <Button key={type} size="sm" variant="outline" onClick={() => addElement(type)}>
                    {copy.editor.elements[type]}
                  </Button>
                ))}
              </div>
            </section>

            <Separator />

            <section className="flex flex-col gap-1.5">
              <h3 className="text-xs font-medium">{copy.editor.layers.heading}</h3>
              <LayersPanel ir={ir} selectedId={selectedId} onSelect={setSelectedId} onChange={setIr} />
            </section>
          </aside>
          </div>
        </ResizablePanel>

        <ResizableHandle withHandle />

        {/* Centre: rulers, canvas, zoom. */}
        <ResizablePanel id="canvas" defaultSize="60" minSize="30">
          {/* The viewport owns its height, centring and scrolling; a second
              scroll container here would nest two scrollbars. */}
          <div className="flex h-full min-h-0 flex-col">
            {/*
              Undo and redo belong to the canvas, not to the page: they reverse
              what was just done *here*. They sat in the top bar because the top
              bar was where every control lived; with printing gone from it,
              they can sit where the drawing is.
            */}
            {/* Inset from the panel's edge: the buttons sat flush against the
                divider on the left, which read as a rendering fault. */}
            <div className="flex shrink-0 items-center gap-n2 border-b border-border px-n3 pb-n3 pt-n1">
              <Button
                size="icon"
                variant="outline"
                disabled={!canUndo(history)}
                aria-label={copy.editor.undo}
                title={copy.editor.undo}
                onClick={doUndo}
              >
                <Undo2 />
              </Button>
              <Button
                size="icon"
                variant="outline"
                disabled={!canRedo(history)}
                aria-label={copy.editor.redo}
                title={copy.editor.redo}
                onClick={doRedo}
              >
                <Redo2 />
              </Button>

            </div>
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
                // The drawing gets bindings filled in; interaction keeps the
                // stored design, so editing while looking at a sample writes
                // back the binding.
                drawnIr={drawn}
                values={values}
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
          {/*
            A plain scroller, not a ScrollArea.

            Radix wraps a viewport's children in a `display: table` element, so
            anything inside it is shrink-wrapped to its own content width. The
            data-source table in the variables panel scrolls sideways on its
            own — `w-full overflow-x-auto` — and `w-full` against a
            shrink-to-fit parent is circular: the box takes the table's full
            width, never overflows, never offers a scrollbar, and pushes the
            whole column past the edge of the window instead. `ui/scroll-area.tsx`
            says as much at the top; this is the case it was warning about.
          */}
          <div className="scrollbar-themed h-full overflow-y-auto">
            <aside className="pl-3">
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
                    <TabsTrigger value="variables">{copy.variables.heading}</TabsTrigger>
                  </TabsList>
                </CardHeader>
                <CardContent>
                  <TabsContent value="element" className="mt-0">
                    <Inspector
                      ir={ir}
                      element={selected}
                      values={values}
                      onChange={updateElement}
                      onDelete={deleteElement}
                    />
                  </TabsContent>
                  <TabsContent value="variables" className="mt-0 flex flex-col gap-3">
                    {/*
                      The design's own variables first.

                      They were last, under a data-source panel and a ten-row
                      table with its own pager — so "add a constant" sat a
                      screen of scrolling below somebody else's stock list. What
                      a design *declares* is the smaller, more permanent thing;
                      the table is reference material for looking at it.
                    */}
                    <VariablesPanel
                      variables={variables}
                      onChange={setVariables}
                      pools={pools}
                      onCreatePool={() => setPanel('variables')}
                      columns={columns}
                      unresolved={preview.unresolved}
                    />
                    <DataSourceBinding
                      dataSourceId={dataSourceId}
                      onChange={setDataSourceId}
                      bindingIssue={template?.bindingIssue ?? null}
                      // Appends to the selected element rather than typing at
                      // a cursor: the panel does not own the content field, and
                      // a column name typed from memory is a reference that
                      // silently resolves to nothing.
                      onInsertReference={
                        selected !== null && 'content' in selected
                          ? (reference) =>
                              updateElement({ ...selected, content: selected.content + reference })
                          : undefined
                      }
                    />
                    <PreviewValues
                      rowCount={rowCount}
                      dataSourceId={dataSourceId}
                      ordinal={shownOrdinal}
                      onChange={setPreviewOrdinal}
                      values={previewRow}
                      columns={columns}
                    />
                  </TabsContent>
                </CardContent>
              </Tabs>
            </Card>
          </aside>
          </div>
        </ResizablePanel>
      </ResizablePanelGroup>

      {/*
        What a `?preset=` link did, or could not do. Alongside the violations
        rather than as a toast: it describes the state the editor is in, and
        that is still true five minutes later when somebody finally looks at
        the printer selector.
      */}
      {presetNotices.length > 0 && (
        <div className="mt-3 flex flex-col gap-1" data-preset-notice>
          {presetNotices.map((notice) => (
            <Alert key={notice} variant="warning" className="py-1.5 text-xs">
              {notice}
            </Alert>
          ))}
        </div>
      )}

      {/*
        Problems along the bottom rather than pushing the canvas down. A design
        being dragged around produces and clears warnings constantly, and a
        banner that reflows the editor each time is unusable.
      */}
      {violations.length > 0 && (
        <div className="mt-3 flex flex-col gap-1 border-t border-border pt-2">
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

      {/*
        The design step's own bar: what this label *is* (saving it) on the
        left, and the way on to printing at the right. Everything about the
        machine moved to the print step, where the question is actually asked.
      */}
      <div
        role="toolbar"
        aria-label={copy.editor.heading}
        aria-orientation="horizontal"
        className="flex shrink-0 items-center gap-n3 border-t border-border pt-3"
      >
        <TemplateBar
          current={template}
          buildBody={templateBody}
          onSaved={(saved) => {
            setTemplate(saved)
            setVariables(saved.variables)
            setDataSourceId(saved.dataSourceId)
            // Nothing is unsaved any more; the page is now this label's page,
            // so its address and any later save refer to the same thing.
            setHistory(initUndo({ ...ir }))
            workspace.setDirty(false)
            if (templateId !== saved.id) {
              workspace.open({ kind: 'label', templateId: saved.id })
            }
          }}
        />
        <div className="ml-auto flex items-center gap-n4">
          <Button
            variant="outline"
            size="sm"
            onClick={() => workspace.open({ ...address, kind: 'label-print' })}
            data-continue
          >
            {copy.flow.next}
          </Button>
        </div>
      </div>
        </>
      )}
    </div>
  )
}
