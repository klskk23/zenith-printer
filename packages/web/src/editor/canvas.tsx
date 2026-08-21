/**
 * SVG label editor.
 *
 * The visual layer is produced by `irToSvg` from `@zenith/shared` — the exact
 * string the backend hands to resvg. Interaction is a separate overlay of real
 * DOM nodes on top. Rebuilding the visuals from React components would be a
 * second renderer, and a second renderer is a second set of bugs: the preview
 * would drift from the print and nobody would notice until the labels came out.
 *
 * Canvas is not used, for the same reason. Every shape here is a DOM node, so
 * hit-testing, focus and keyboard nudging come for free.
 */
import { useCallback, useMemo, useRef, useState } from 'react'
import { dotsToMm, irToSvg, layoutGrid, type LabelElement, type LabelIR } from '@zenith/shared'
import { boundsOf, isOutOfBounds } from './guards.ts'
import { angleFromCentre, snapRotation } from './rotation.ts'
import { resizeModeFor, resizeSnapped } from './resize.ts'
import { SNAP_STEP_MM, isSnapBypassed, snapPointMm } from './snapping.ts'
import { translateElement } from './elements.ts'
import { resizePatchFor } from './barcode-width.ts'
import { marginBands, type Margins } from './margins.ts'
import { cn } from '../lib/utils.ts'

export interface CanvasProps {
  ir: LabelIR
  selectedId: string | null
  onSelect: (id: string | null) => void
  onChange: (ir: LabelIR) => void
  resolveImage?: (assetId: string) => string | undefined
  /** Screen pixels per printer dot. */
  zoom?: number
  /** Quantises barcode width to an achievable step; see barcode-width.ts. */
  snapBarcodeWidthMm?: (targetMm: number) => number
  /** Called once per gesture so the undo stack records a drag as one step. */
  onGestureStart?: () => void
  onGestureEnd?: () => void
  /** Margins from the chosen profile. Drawn as advice; never enforced. */
  margins?: Margins | null
  /**
   * The same design with its variable bindings filled in, for drawing only.
   *
   * Interaction still works from `ir`, so an edit made while looking at a
   * sample writes the binding back rather than the sample. Defaults to `ir`
   * for a design that has no bindings.
   */
  drawnIr?: LabelIR
}

type Gesture = 'move' | 'resize' | 'rotate'

interface DragState {
  gesture: Gesture
  elementId: string
  startXMm: number
  startYMm: number
  startWidthMm: number
  startHeightMm: number
  pointerXDots: number
  pointerYDots: number
}

/** Screen size of the interaction handles, in dots so they scale with zoom. */
const HANDLE_DOTS = 7
const ROTATE_ARM_DOTS = 14

export function EditorCanvas({
  ir,
  selectedId,
  onSelect,
  onChange,
  resolveImage,
  zoom = 1,
  snapBarcodeWidthMm,
  onGestureStart,
  onGestureEnd,
  margins = null,
  drawnIr,
}: CanvasProps): React.JSX.Element {
  const svgRef = useRef<SVGSVGElement>(null)
  const [drag, setDrag] = useState<DragState | null>(null)
  const selectedElement = ir.elements.find((element) => element.id === selectedId) ?? null

  const grid = useMemo(
    () => layoutGrid({ widthMm: ir.widthMm, heightMm: ir.heightMm, dpi: ir.dpi }),
    [ir.widthMm, ir.heightMm, ir.dpi],
  )

  // The shared module owns every pixel the user sees, so what the editor shows
  // and what the printer burns cannot diverge.
  /**
   * The drawing, with variable bindings filled in.
   *
   * `irToSvg` refuses to render a `$var` it was not given a value for, and
   * rightly: printing a label with a hole where a part number belongs is worse
   * than refusing. But the editor is where bindings are *made*, so the moment
   * an element was bound the canvas threw out of React's render pass and
   * blanked the application. Standing values are what the designer needs to
   * see anyway — a box the width of "ABC-12345" rather than of nothing.
   *
   * Resolved into a copy. The stored IR keeps the binding, so an edit made
   * while looking at a sample writes back the binding.
   *
   * `skipUnrenderable` covers the other states a half-typed symbol passes
   * through — an empty QR code, an EAN-13 three digits in.
   */
  const markup = useMemo(
    () =>
      irToSvg(drawnIr ?? ir, {
        skipUnrenderable: true,
        ...(resolveImage === undefined ? {} : { resolveImage }),
      }),
    [ir, drawnIr, resolveImage],
  )
  const inner = useMemo(() => markup.replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, ''), [markup])

  const toDots = useCallback(
    (event: React.PointerEvent): { xDots: number; yDots: number } | null => {
      const svg = svgRef.current
      if (svg === null) {
        return null
      }
      const rect = svg.getBoundingClientRect()
      return {
        xDots: ((event.clientX - rect.left) / rect.width) * grid.widthDots,
        yDots: ((event.clientY - rect.top) / rect.height) * grid.heightDots,
      }
    },
    [grid.widthDots, grid.heightDots],
  )

  const moveElement = useCallback(
    (id: string, deltaXMm: number, deltaYMm: number) => {
      onChange({
        ...ir,
        elements: ir.elements.map((element) =>
          element.id === id ? translateElement(element, deltaXMm, deltaYMm) : element,
        ),
      })
    },
    [ir, onChange],
  )

  const beginGesture = useCallback(
    (event: React.PointerEvent, element: LabelElement, gesture: Gesture) => {
      event.stopPropagation()
      const point = toDots(event)
      if (point === null) {
        return
      }
      onSelect(element.id)
      const box = boundsOf(element)
      setDrag({
        gesture,
        elementId: element.id,
        startXMm: box.xMm,
        startYMm: box.yMm,
        startWidthMm: box.widthMm,
        startHeightMm: box.heightMm,
        pointerXDots: point.xDots,
        pointerYDots: point.yDots,
      })
      event.currentTarget.setPointerCapture(event.pointerId)
      onGestureStart?.()
    },
    [onGestureStart, onSelect, toDots],
  )

  const handlePointerDown = useCallback(
    (event: React.PointerEvent, element: LabelElement) => beginGesture(event, element, 'move'),
    [beginGesture],
  )

  const handlePointerMove = useCallback(
    (event: React.PointerEvent) => {
      if (drag === null) {
        return
      }
      const point = toDots(event)
      if (point === null) {
        return
      }
      const element = ir.elements.find((e) => e.id === drag.elementId)
      if (element === undefined) {
        return
      }

      // Everything is computed in dots and converted once, so a gesture lands
      // on the same grid the renderer uses rather than accumulating error.
      const deltaXMm = dotsToMm(point.xDots - drag.pointerXDots, ir.dpi)
      const deltaYMm = dotsToMm(point.yDots - drag.pointerYDots, ir.dpi)
      const bypass = isSnapBypassed(event)

      if (drag.gesture === 'rotate') {
        const box = boundsOf(element)
        const centre = {
          x: grid.xToDots(box.xMm) + grid.lengthToDots(box.widthMm) / 2,
          y: grid.yToDots(box.yMm) + grid.lengthToDots(box.heightMm) / 2,
        }
        // Snapped on the way in, so the element can never come to rest at an
        // angle the renderer would have to resample.
        const rotation = snapRotation(angleFromCentre(centre, { x: point.xDots, y: point.yDots }))
        if (rotation !== element.rotation) {
          onChange({
            ...ir,
            elements: ir.elements.map((e) => (e.id === element.id ? { ...e, rotation } : e)),
          })
        }
        return
      }

      if (drag.gesture === 'resize') {
        if (!('widthMm' in element)) {
          return
        }
        // Snapped on the way in, so the type's own rule gets the last word —
        // see `resizeSnapped`.
        const size = resizeSnapped(
          {
            mode: resizeModeFor(element),
            original: { widthMm: drag.startWidthMm, heightMm: drag.startHeightMm },
            desired: {
              widthMm: drag.startWidthMm + deltaXMm,
              heightMm: drag.startHeightMm + deltaYMm,
            },
            lockAspect: event.shiftKey,
            snapWidthMm: snapBarcodeWidthMm,
          },
          { grid, bypass },
        )
        // Not just the size: a barcode or QR code is sized by its module
        // width, and writing the box alone grew the frame around a symbol that
        // never moved.
        const patch = resizePatchFor(element, size, ir.dpi)
        onChange({
          ...ir,
          elements: ir.elements.map((e) =>
            e.id === element.id && 'widthMm' in e ? ({ ...e, ...patch } as LabelElement) : e,
          ),
        })
        return
      }

      const box = boundsOf(element)
      const target = snapPointMm(
        { xMm: drag.startXMm + deltaXMm, yMm: drag.startYMm + deltaYMm },
        { grid, bypass },
      )
      moveElement(drag.elementId, target.xMm - box.xMm, target.yMm - box.yMm)
    },
    [drag, grid, ir, moveElement, onChange, snapBarcodeWidthMm, toDots],
  )

  const endDrag = useCallback(() => {
    if (drag !== null) {
      onGestureEnd?.()
    }
    setDrag(null)
  }, [drag, onGestureEnd])

  return (
    // Paper is white in either theme: the preview's job is to look like what
    // comes out of the printer, and inverting it would make it lie.
    <div data-label-canvas className="inline-block border border-border shadow-sm">
      <svg
        ref={svgRef}
        width={grid.widthDots * zoom}
        height={grid.heightDots * zoom}
        viewBox={`0 0 ${grid.widthDots} ${grid.heightDots}`}
        onPointerDown={() => onSelect(null)}
        onPointerMove={handlePointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        role="application"
        aria-label="label canvas"
      >
        {/*
          The grid the editor snaps to, drawn so that snapping is something the
          user can see rather than a correction applied behind their back. It
          was invisible before, which — together with a step of one dot, below
          the width of the lines drawn over it — is why snapping was reported
          as not implemented at all.

          Under the label content and not hit-testable: it is a backdrop, not a
          layer of the design.
        */}
        <defs>
          <pattern
            id="layout-grid"
            width={grid.lengthToDots(SNAP_STEP_MM)}
            height={grid.lengthToDots(SNAP_STEP_MM)}
            patternUnits="userSpaceOnUse"
          >
            <path
              d={`M ${grid.lengthToDots(SNAP_STEP_MM)} 0 L 0 0 0 ${grid.lengthToDots(SNAP_STEP_MM)}`}
              fill="none"
              stroke="#cbd5e1"
              strokeWidth={0.5}
            />
          </pattern>
          {/* Every fifth line, so the eye can count millimetres without doing so. */}
          <pattern
            id="layout-grid-major"
            width={grid.lengthToDots(SNAP_STEP_MM * 5)}
            height={grid.lengthToDots(SNAP_STEP_MM * 5)}
            patternUnits="userSpaceOnUse"
          >
            <path
              d={`M ${grid.lengthToDots(SNAP_STEP_MM * 5)} 0 L 0 0 0 ${grid.lengthToDots(SNAP_STEP_MM * 5)}`}
              fill="none"
              stroke="#94a3b8"
              strokeWidth={0.75}
            />
          </pattern>
        </defs>
        <rect
          width={grid.widthDots}
          height={grid.heightDots}
          fill="url(#layout-grid)"
          pointerEvents="none"
          data-layout-grid
        />
        <rect
          width={grid.widthDots}
          height={grid.heightDots}
          fill="url(#layout-grid-major)"
          pointerEvents="none"
        />

        {/*
          Margin bands, over the grid but under everything else. Hatched rather
          than filled so it reads as advice: elements can be placed here and are
          simply flagged as close to the edge.
        */}
        {margins !== null && (
          <>
            <defs>
              <pattern id="margin-hatch" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                <line x1="0" y1="0" x2="0" y2="8" stroke="#94a3b8" strokeWidth="1.5" opacity="0.45" />
              </pattern>
            </defs>
            {marginBands(margins, grid).map((band, index) => (
              <rect
                key={index}
                x={band.xDots}
                y={band.yDots}
                width={band.widthDots}
                height={band.heightDots}
                fill="url(#margin-hatch)"
                pointerEvents="none"
              />
            ))}
          </>
        )}

        {/* Rendered by the shared module; never re-implemented here. */}
        <g dangerouslySetInnerHTML={{ __html: inner }} />

        {/* Interaction overlay: one real DOM node per element. */}
        <g>
          {ir.elements.map((element) => {
            const box = boundsOf(element)
            const x = (box.xMm * ir.dpi) / 25.4
            const y = (box.yMm * ir.dpi) / 25.4
            const width = Math.max((box.widthMm * ir.dpi) / 25.4, 4)
            const height = Math.max((box.heightMm * ir.dpi) / 25.4, 4)
            const selected = element.id === selectedId
            const overflowing = isOutOfBounds(element, ir)

            return (
              <rect
                key={element.id}
                x={x}
                y={y}
                width={width}
                height={height}
                fill="transparent"
                // FR-006: overflow is marked, never blocked — dragging past
                // the edge is a normal intermediate state.
                stroke={selected ? '#2563eb' : overflowing ? '#dc2626' : 'transparent'}
                strokeWidth={selected || overflowing ? 2 : 0}
                strokeDasharray={overflowing && !selected ? '4 2' : undefined}
                className={cn('cursor-move', selected && 'cursor-grab')}
                onPointerDown={(event) => handlePointerDown(event, element)}
                onContextMenu={() => {
                  // Select what was right-clicked, then let the event carry on
                  // to the ContextMenu trigger wrapping the canvas.
                  //
                  // Calling preventDefault() here suppressed the menu entirely:
                  // Radix opens on the `contextmenu` default action, so
                  // cancelling it in a child means right-clicking an element —
                  // the only place the menu is useful — did nothing, while
                  // right-clicking bare canvas still worked.
                  onSelect(element.id)
                }}
                data-element-id={element.id}
              />
            )
          })}
        </g>

        {/* Handles for the selected element only, so the canvas stays readable. */}
        {selectedElement !== null && (() => {
          const box = boundsOf(selectedElement)
          const x = grid.xToDots(box.xMm)
          const y = grid.yToDots(box.yMm)
          const w = grid.lengthToDots(box.widthMm)
          const h = grid.lengthToDots(box.heightMm)
          const half = HANDLE_DOTS / 2
          const resizable = 'widthMm' in selectedElement

          return (
            <g>
              {resizable && (
                <rect
                  x={x + w - half}
                  y={y + h - half}
                  width={HANDLE_DOTS}
                  height={HANDLE_DOTS}
                  fill="#ffffff"
                  stroke="#2563eb"
                  strokeWidth={1.5}
                  className="cursor-nwse-resize"
                  onPointerDown={(event) => beginGesture(event, selectedElement, 'resize')}
                  data-handle="resize"
                />
              )}

              {/* Rotation arm rises from the top edge; the drag snaps to right
                  angles, so it cannot come to rest anywhere else. */}
              <line
                x1={x + w / 2}
                y1={y}
                x2={x + w / 2}
                y2={y - ROTATE_ARM_DOTS}
                stroke="#2563eb"
                strokeWidth={1}
              />
              <circle
                cx={x + w / 2}
                cy={y - ROTATE_ARM_DOTS}
                r={half}
                fill="#ffffff"
                stroke="#2563eb"
                strokeWidth={1.5}
                className="cursor-grab"
                onPointerDown={(event) => beginGesture(event, selectedElement, 'rotate')}
                data-handle="rotate"
              />
            </g>
          )
        })()}
      </svg>
    </div>
  )
}
