/**
 * Clearing every unsaved draft on this browser.
 *
 * Drafts never expire (FR-021), so this is the only way they leave. It is
 * irreversible, so it lists exactly what will go and asks — the same rule as
 * printing and deleting. Saved labels are untouched: clearing a saved label's
 * draft returns it to the server's version, which is what the body says.
 */
import { useState } from 'react'
import { copy } from '../../i18n/index.ts'
import { Button } from '../../components/ui/button.tsx'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '../../components/ui/alert-dialog.tsx'
import { useDrafts } from './use-draft.tsx'

export interface DraftToClear {
  key: string
  /** As the gallery names it: the label's name for a saved label's draft. */
  name: string
  detail: string
  corrupt?: boolean
}

export interface ClearDraftsButtonProps {
  items: readonly DraftToClear[]
  /** The gallery reads the store synchronously; it needs to be told to look again. */
  onCleared: () => void
}

export function ClearDraftsButton({ items, onCleared }: ClearDraftsButtonProps): React.JSX.Element {
  const { store } = useDrafts()
  const [open, setOpen] = useState(false)
  const count = items.length

  return (
    <>
      <Button size="sm" variant="ghost" disabled={count === 0} onClick={() => setOpen(true)}>
        {copy.labels.clearDrafts}
      </Button>
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{copy.labels.clearDraftsTitle}</AlertDialogTitle>
            <AlertDialogDescription>{copy.labels.clearDraftsBody(count)}</AlertDialogDescription>
          </AlertDialogHeader>
          {/* Named, one per line: "5 drafts" is a number, this is what they are. */}
          <ul className="flex max-h-48 flex-col gap-n1 overflow-y-auto text-xs" data-drafts-to-clear>
            {items.map((item) => (
              <li key={item.key} className={item.corrupt ? 'truncate text-destructive' : 'truncate'}>
                {item.name}
                <span className="text-muted-foreground"> {item.detail}</span>
              </li>
            ))}
          </ul>
          <AlertDialogFooter>
            <AlertDialogCancel>{copy.common.cancel}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                store.clear()
                setOpen(false)
                onCleared()
              }}
            >
              {copy.labels.clearDraftsConfirm}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
