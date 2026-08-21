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
import { ScrollArea } from '../components/ui/scroll-area.tsx'
import { isVariableRef, type LabelElement, type LabelIR } from '@zenith/shared'
import { bringToFront, isBackmost, isFrontmost, layersTopFirst, sendToBack } from './layers.ts'

/** One line of identifying text, so two barcodes are not both just "barcode". */
function describe(element: LabelElement): string {
  const type = copy.editor.elements[element.type]
  if (!('content' in element)) {
    return type
  }
  const content = isVariableRef(element.content) ? `{${element.content.$var}}` : element.content
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
    <ScrollArea className="max-h-56">
      <ul className="space-y-0.5">
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
              <button type="button" className="min-w-0 flex-1 truncate text-left" onClick={() => onSelect(element.id)}>
                {describe(element)}
              </button>
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
    </ScrollArea>
  )
}
