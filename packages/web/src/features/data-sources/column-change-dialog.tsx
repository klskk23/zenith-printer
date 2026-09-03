/**
 * The one refresh that stops and asks.
 *
 * A column name is a reference name — a design writes `${收件人}`. When one
 * disappears, every reference to it resolves to nothing, and a blank where a
 * name used to be is not a failure anybody notices until the labels are in
 * their hands. So the change is described, the designs it would break are
 * named, and nothing is written until somebody says go.
 *
 * Cancelling leaves the table exactly as it was — including its rows, which the
 * refresh had already fetched and then discarded.
 */
import { copy } from '../../i18n/index.ts'
import { Alert } from '../../components/ui/alert.tsx'
import { Button } from '../../components/ui/button.tsx'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog.tsx'
import type { RefreshOutcome } from './hooks.ts'

export interface ColumnChangeDialogProps {
  change: Extract<RefreshOutcome, { outcome: 'needsConfirmation' }> | null
  onCancel: () => void
  onApply: () => void
  applying?: boolean
}

export function ColumnChangeDialog({
  change,
  onCancel,
  onApply,
  applying = false,
}: ColumnChangeDialogProps): React.JSX.Element {
  return (
    <Dialog open={change !== null} onOpenChange={(next) => !next && onCancel()}>
      <DialogContent className="flex max-h-[85vh] flex-col overflow-hidden">
        <DialogHeader>
          <DialogTitle>{copy.dataSources.columnChangeTitle}</DialogTitle>
          <DialogDescription>{copy.dataSources.columnChangeRenameNote}</DialogDescription>
        </DialogHeader>

        {change !== null && (
          <div className="scrollbar-themed min-h-0 flex-1 flex flex-col gap-3 overflow-y-auto pr-2 text-xs">
            <Alert variant="warning" data-removed-columns>
              {copy.dataSources.columnChangeRemoved(change.removedColumns)}
            </Alert>
            {change.addedColumns.length > 0 && (
              <p className="text-muted-foreground" data-added-columns>
                {copy.dataSources.columnChangeAdded(change.addedColumns)}
              </p>
            )}

            {change.affectedTemplates.length > 0 ? (
              <div className="flex flex-col gap-1" data-affected-templates>
                <p className="font-medium">{copy.dataSources.columnChangeAffected}</p>
                <ul className="flex flex-col gap-0.5">
                  {change.affectedTemplates.map((template) => (
                    <li key={template.id} className="rounded border border-border px-2 py-1">
                      {template.name}
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              // Still asks. Losing a column changes the shape of the table, and
              // the person refreshing is not necessarily the person who will
              // design against it tomorrow.
              <p className="text-muted-foreground" data-none-affected>
                {copy.dataSources.columnChangeNoneAffected}
              </p>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={onCancel}>
            {copy.dataSources.columnChangeCancel}
          </Button>
          <Button size="sm" disabled={applying} onClick={onApply}>
            {copy.dataSources.columnChangeApply}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
