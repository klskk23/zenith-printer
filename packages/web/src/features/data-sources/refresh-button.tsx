/**
 * Fetch a linked table again. Shared by the list, the editor and the print
 * dialog, so the three cannot drift into behaving differently.
 *
 * Two things it is careful about:
 *
 *   - **Never automatic.** Nothing here polls. A table that changed while
 *     somebody was looking at a list of rows would renumber under them, and the
 *     numbers are how a row selection is expressed.
 *   - **Says what happened, including when nothing did.** Three of the four
 *     outcomes change nothing at all; reporting them as success would leave
 *     somebody printing yesterday's data believing it was today's.
 */
import { useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { ApiRequestError } from '../../api/client.ts'
import { copy } from '../../i18n/index.ts'
import { Alert } from '../../components/ui/alert.tsx'
import { Button } from '../../components/ui/button.tsx'
import { useRefreshDataSource, type DataSource, type RefreshOutcome } from './hooks.ts'

export interface RefreshButtonProps {
  source: DataSource
  /**
   * Called when rows were actually replaced.
   *
   * The print dialog uses it to drop a row selection: the selection is a set of
   * ordinals, and after a replacement those numbers point at different rows.
   */
  onApplied?: (result: Extract<RefreshOutcome, { outcome: 'applied' }>) => void
  onNeedsConfirmation?: (result: Extract<RefreshOutcome, { outcome: 'needsConfirmation' }>) => void
  size?: 'sm' | 'icon'
}

export function RefreshButton({
  source,
  onApplied,
  onNeedsConfirmation,
  size = 'sm',
}: RefreshButtonProps): React.JSX.Element | null {
  const refresh = useRefreshDataSource()
  const [outcome, setOutcome] = useState<RefreshOutcome | null>(null)

  if (source.sourceKind !== 'google-sheets') {
    return null
  }

  const run = (): void => {
    setOutcome(null)
    refresh.mutate(
      { id: source.id },
      {
        onSuccess: (result) => {
          setOutcome(result)
          if (result.outcome === 'applied') {
            onApplied?.(result)
          }
          if (result.outcome === 'needsConfirmation') {
            onNeedsConfirmation?.(result)
          }
        },
      },
    )
  }

  return (
    <>
      <Button
        size={size}
        variant="outline"
        // Disabled while in flight rather than queueing a second read: two
        // writers on one table is how a half-replaced table happens.
        disabled={refresh.isPending}
        aria-label={copy.dataSources.refresh}
        title={copy.dataSources.refreshTitle}
        onClick={run}
        data-refresh
      >
        {size === 'icon' ? (
          <RefreshCw className="h-4 w-4" />
        ) : refresh.isPending ? (
          copy.dataSources.refreshing
        ) : (
          copy.dataSources.refresh
        )}
      </Button>

      {outcome !== null && <RefreshNotice outcome={outcome} />}
      {refresh.error instanceof ApiRequestError && (
        <Alert variant="destructive" className="mt-2 text-xs" data-refresh-error>
          <p className="font-medium">{refresh.error.body.what}</p>
          <p className="mt-1 opacity-90">{refresh.error.body.why}</p>
          <p className="mt-1 font-medium">{refresh.error.body.next}</p>
        </Alert>
      )}
    </>
  )
}

/** What the refresh concluded, in the words the outcome deserves. */
function RefreshNotice({ outcome }: { outcome: RefreshOutcome }): React.JSX.Element | null {
  if (outcome.outcome === 'applied') {
    return (
      <p className="mt-1 text-[11px] text-muted-foreground" data-refresh-applied>
        {copy.dataSources.refreshApplied(outcome.rowsBefore, outcome.rowsAfter)}
        {outcome.columnsAdded.length > 0
          ? ` · ${copy.dataSources.refreshAddedColumns(outcome.columnsAdded)}`
          : ''}
      </p>
    )
  }
  if (outcome.outcome === 'refusedTooManyRows') {
    return (
      <Alert variant="warning" className="mt-2 text-xs" data-refresh-refused>
        {copy.dataSources.refreshTooManyRows(outcome.rowCount, outcome.limit)}
      </Alert>
    )
  }
  if (outcome.outcome === 'failed') {
    // The rows already here are untouched and still print. Saying so is the
    // difference between "this is broken" and "this is not the newest data".
    return (
      <Alert variant="warning" className="mt-2 text-xs" data-refresh-failed>
        {copy.dataSources.refreshFailed(outcome.reason)}
      </Alert>
    )
  }
  // needsConfirmation is handled by whoever owns the confirmation dialog.
  return null
}
