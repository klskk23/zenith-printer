/**
 * Layer list.
 *
 * Its real job is selecting an element the canvas cannot reach: once one shape
 * sits entirely under another, clicking will always find the top one. Ordering
 * is the secondary use.
 *
 * Front and back only. With a handful of elements per label, drag-to-reorder is
 * machinery that earns nothing.
 */
import { copy } from '../i18n/index.ts'
import { cn } from '../lib/utils.ts'
import { Button } from '../components/ui/button.tsx'
import type { LabelElement, LabelIR } from '@zenith/shared'
import { bringToFront, isBackmost, isFrontmost, layersTopFirst, sendToBack } from './layers.ts'

/** One line of identifying text, so two barcodes are not both just "barcode". */
function describe(element: LabelElement): string {
  const type = copy.editor.elements[element.type]
  if (!('content' in element)) {
    return type
  }
  const content = element.content
  const firstLine = content.split('\n')[0] ?? ''
  return firstLine.length === 0 ? type : `${type} · ${firstLine.slice(0, 16)}`
}

export interface LayersPanelProps {
  ir: LabelIR
  selectedId: string | null
  onSelect: (id: string) => void
  onChange: (ir: LabelIR) => void
}

export function LayersPanel({ ir, selectedId, onSelect, onChange }: LayersPanelProps): React.JSX.Element {
  const layers = layersTopFirst(ir)

  if (layers.length === 0) {
    return <p className="text-xs text-muted-foreground">{copy.editor.layers.empty}</p>
  }

  return (
    // A capped list, not a fixed one: with three layers it should be three
    // rows tall. That rules out a ScrollArea, whose viewport is sized against
    // its parent and so needs a definite height rather than a maximum — given
    // only `max-height` it grows to fit the content and the root clips it,
    // which looks like a list that has silently lost its last few rows.
    <div className="scrollbar-themed max-h-56 overflow-y-auto">
      <ul className="flex flex-col gap-0.5">
        {layers.map((element) => {
          const selected = element.id === selectedId
          return (
            <li
              key={element.id}
              className={cn(
                'flex items-center justify-between gap-1 rounded px-2 py-1 text-xs',
                selected ? 'bg-muted font-medium' : 'hover:bg-muted/60',
              )}
            >
              <Button
                variant="ghost"
                size="row-inline"
                // The row it sits in already carries the selected and hover
                // backgrounds, so this one only needs to be clickable.
                className="min-w-0 flex-1 truncate hover:bg-transparent"
                onClick={() => onSelect(element.id)}
              >
                {describe(element)}
              </Button>
              <span className="flex shrink-0 gap-0.5">
                <Button
                  size="icon-sm"
                  variant="ghost"
                  title={copy.editor.layers.toFront}
                  disabled={isFrontmost(ir, element.id)}
                  onClick={() => onChange(bringToFront(ir, element.id))}
                >
                  ↑
                </Button>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  title={copy.editor.layers.toBack}
                  disabled={isBackmost(ir, element.id)}
                  onClick={() => onChange(sendToBack(ir, element.id))}
                >
                  ↓
                </Button>
              </span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
