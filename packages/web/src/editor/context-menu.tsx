/**
 * Right-click menu for canvas elements.
 *
 * Delete has no confirmation. That is only acceptable because undo covers
 * every edit — a confirm dialog on every deletion would be worse for the
 * common case and no safer for the rare one.
 */
import { copy } from '../i18n/index.ts'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuCheckboxItem,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '../components/ui/context-menu.tsx'
import { bringToFront, isBackmost, isFrontmost, sendToBack } from './layers.ts'
import { setInverted } from './invert.ts'
import type { LabelIR } from '@zenith/shared'

export interface ElementContextMenuProps {
  ir: LabelIR
  selectedId: string | null
  onDelete: (id: string) => void
  onChange: (ir: LabelIR) => void
  onCopy: () => void
  onPaste: () => void
  onDuplicate: () => void
  /** False when nothing has been copied yet, so Paste is offered honestly. */
  canPaste: boolean
  children: React.ReactNode
  /** Applied to the trigger wrapper, which sits in the layout flow. */
  className?: string
}

export function ElementContextMenu({
  ir,
  selectedId,
  onDelete,
  onChange,
  onCopy,
  onPaste,
  onDuplicate,
  canPaste,
  children,
  className,
}: ElementContextMenuProps): React.JSX.Element {
  const target = ir.elements.find((element) => element.id === selectedId) ?? null

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div className={className}>{children}</div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem disabled={target === null} onSelect={onCopy}>
          {copy.editor.contextMenu.copy}
        </ContextMenuItem>
        <ContextMenuItem disabled={!canPaste} onSelect={onPaste}>
          {copy.editor.contextMenu.paste}
        </ContextMenuItem>
        <ContextMenuItem disabled={target === null} onSelect={onDuplicate}>
          {copy.editor.contextMenu.duplicate}
        </ContextMenuItem>
        {/* A toggle rather than two entries: the menu says what the element
            is now, and choosing it changes that. Disabled for the types that
            have no such field — barcodes, QR codes and images. */}
        <ContextMenuCheckboxItem
          disabled={target === null || !('inverted' in target)}
          checked={target !== null && 'inverted' in target && target.inverted}
          onSelect={() =>
            target !== null &&
            'inverted' in target &&
            onChange(setInverted(ir, target.id, !target.inverted))
          }
        >
          {copy.editor.contextMenu.invert}
        </ContextMenuCheckboxItem>
        <ContextMenuSeparator className="my-1 h-px bg-border" />
        <ContextMenuItem disabled={target === null} onSelect={() => target && onDelete(target.id)}>
          {copy.editor.contextMenu.delete}
        </ContextMenuItem>
        <ContextMenuSeparator className="my-1 h-px bg-border" />
        <ContextMenuItem
          disabled={target === null || isFrontmost(ir, target.id)}
          onSelect={() => target && onChange(bringToFront(ir, target.id))}
        >
          {copy.editor.contextMenu.toFront}
        </ContextMenuItem>
        <ContextMenuItem
          disabled={target === null || isBackmost(ir, target.id)}
          onSelect={() => target && onChange(sendToBack(ir, target.id))}
        >
          {copy.editor.contextMenu.toBack}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}
