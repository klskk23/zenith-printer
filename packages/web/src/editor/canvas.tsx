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
import { irToSvg, layoutGrid, type LabelElement, type LabelIR } from '@zenith/shared'
import { boundsOf, isOutOfBounds } from './guards.ts'
import { cn } from '../lib/utils.ts'

export interface CanvasProps {
  ir: LabelIR
  selectedId: string | null
  onSelect: (id: string | null) => void
  onChange: (ir: LabelIR) => void
  resolveImage?: (assetId: string) => string | undefined
  /** Screen pixels per printer dot. */
  zoom?: number
}

interface DragState {
  elementId: string
  startXMm: number
  startYMm: number
  pointerXDots: number
  pointerYDots: number
}

export function EditorCanvas({
  ir,
  selectedId,
  onSelect,
  onChange,
  resolveImage,
  zoom = 1,
}: CanvasProps): React.JSX.Element {
  const svgRef = useRef<SVGSVGElement>(null)
  const [drag, setDrag] = useState<DragState | null>(null)

  const grid = useMemo(
    () => layoutGrid({ widthMm: ir.widthMm, heightMm: ir.heightMm, dpi: ir.dpi }),
    [ir.widthMm, ir.heightMm, ir.dpi],
  )

  // The shared module owns every pixel the user sees, so what the editor shows
  // and what the printer burns cannot diverge.
  const markup = useMemo(
    () => irToSvg(ir, resolveImage === undefined ? {} : { resolveImage }),
    [ir, resolveImage],
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
        elements: ir.elements.map((element) => {
          if (element.id !== id) {
            return element
          }
          if (element.type === 'line') {
            return {
              ...element,
              xMm: element.xMm + deltaXMm,
              yMm: element.yMm + deltaYMm,
              x2Mm: element.x2Mm + deltaXMm,
              y2Mm: element.y2Mm + deltaYMm,
            }
          }
          return { ...element, xMm: element.xMm + deltaXMm, yMm: element.yMm + deltaYMm }
        }),
      })
    },
    [ir, onChange],
  )

  const handlePointerDown = useCallback(
    (event: React.PointerEvent, element: LabelElement) => {
      event.stopPropagation()
      const point = toDots(event)
      if (point === null) {
        return
      }
      onSelect(element.id)
      const box = boundsOf(element)
      setDrag({
        elementId: element.id,
        startXMm: box.xMm,
        startYMm: box.yMm,
        pointerXDots: point.xDots,
        pointerYDots: point.yDots,
      })
      event.currentTarget.setPointerCapture(event.pointerId)
    },
    [onSelect, toDots],
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
      // Movement is computed in dots and converted once, so dragging lands on
      // the same grid the renderer uses.
      const deltaXMm = ((point.xDots - drag.pointerXDots) * 25.4) / ir.dpi
      const deltaYMm = ((point.yDots - drag.pointerYDots) * 25.4) / ir.dpi
      const element = ir.elements.find((e) => e.id === drag.elementId)
      if (element === undefined) {
        return
      }
      const box = boundsOf(element)
      moveElement(drag.elementId, drag.startXMm + deltaXMm - box.xMm, drag.startYMm + deltaYMm - box.yMm)
    },
    [drag, ir.dpi, ir.elements, moveElement, toDots],
  )

  const endDrag = useCallback(() => setDrag(null), [])

  return (
    <div className="inline-block border border-border bg-white shadow-sm">
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
                data-element-id={element.id}
              />
            )
          })}
        </g>
      </svg>
    </div>
  )
}
