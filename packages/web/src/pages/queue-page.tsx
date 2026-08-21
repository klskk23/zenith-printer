/** Jobs in flight, promoted from a panel in the editor to a page of its own. */
import { copy } from '../i18n/index.ts'
import { JobList } from '../features/jobs/job-list.tsx'

export function QueuePage(): React.JSX.Element {
  return (
    <div className="space-y-3">
      <h2 className="text-sm font-semibold">{copy.workspace.tabs.queue}</h2>
      {/* No printer filter: the queue page is about everything in flight. */}
      <JobList printerId={null} />
    </div>
  )
}
