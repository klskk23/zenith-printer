/**
 * Finished, failed and cancelled jobs.
 *
 * Separate from the queue on purpose: the queue is for managing what is
 * happening, history is for checking what already happened. The two share no
 * actions.
 */
import { copy } from '../i18n/index.ts'
import { JobHistory } from '../features/jobs/history.tsx'

export function HistoryPage(): React.JSX.Element {
  return (
    <div className="space-y-3">
      <h2 className="text-sm font-semibold">{copy.workspace.tabs.history}</h2>
      <JobHistory printerId={null} />
    </div>
  )
}
