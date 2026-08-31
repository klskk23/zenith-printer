/**
 * Removing uploaded images nothing points at any more.
 *
 * It sits on the settings page, which opens by saying its settings only affect
 * this browser — so this card says out loud that it does not. A button that
 * deletes files for everybody, unmarked, under that sentence would make the
 * sentence a lie.
 *
 * One click and a confirmation, with no report in between. An image that no
 * design refers to and that is past the grace period cannot be reached from
 * anywhere in the product, so a list of what is about to go would be a screen
 * to click past rather than a decision. The confirmation itself stays:
 * deleting files is not undoable, and the constitution requires an explicit
 * yes for anything that is not (III.0).
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
import { useImagePrune } from './hooks.ts'

/** Bytes as something a person can weigh against the trouble of running this. */
function humanSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`
  }
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export function ImagePruneCard(): React.JSX.Element {
  const [confirming, setConfirming] = useState(false)
  const prune = useImagePrune()
  const result = prune.data

  return (
    <section className="space-y-2 rounded border border-border p-3" data-image-prune>
      <h3 className="text-xs font-semibold">{copy.settings.maintenanceHeading}</h3>
      <p className="text-2xs text-muted-foreground">{copy.settings.maintenanceScope}</p>

      <div className="flex items-center gap-2 pt-1">
        <Button variant="outline" disabled={prune.isPending} onClick={() => setConfirming(true)}>
          {prune.isPending ? copy.settings.pruneRunning : copy.settings.pruneImages}
        </Button>
      </div>

      <p className="text-2xs text-muted-foreground">{copy.settings.pruneImagesHint}</p>

      {prune.isError && (
        <p className="text-2xs text-destructive">{prune.error.message}</p>
      )}

      {result !== undefined && !prune.isPending && (
        <div className="space-y-0.5 text-2xs" data-prune-result>
          <p className={result.removed > 0 ? 'text-foreground' : 'text-muted-foreground'}>
            {result.removed === 0 && result.strayFilesRemoved === 0
              ? copy.settings.pruneNothing
              : copy.settings.pruneDone(result.removed, humanSize(result.bytesFreed))}
          </p>
          {result.strayFilesRemoved > 0 && (
            <p className="text-muted-foreground">{copy.settings.pruneStrays(result.strayFilesRemoved)}</p>
          )}
          {/* What survived, so "it deleted nothing" reads as an answer rather
              than as a failure. */}
          <p className="text-muted-foreground">
            {copy.settings.pruneKept(result.keptReferenced, result.keptTooNew)}
          </p>
        </div>
      )}

      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{copy.settings.pruneConfirmTitle}</AlertDialogTitle>
            {/* Says what goes, what stays, and that there is no way back. */}
            <AlertDialogDescription>{copy.settings.pruneConfirmBody}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{copy.settings.pruneConfirmCancel}</AlertDialogCancel>
            <AlertDialogAction onClick={() => prune.mutate()}>
              {copy.settings.pruneConfirmAction}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  )
}
