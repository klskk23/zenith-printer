/** Jobs in flight, promoted from a panel in the editor to a page of its own. */
import { copy } from '../i18n/index.ts'
import { PageHeader } from '../components/page-header.tsx'
import { JobList } from '../features/jobs/job-list.tsx'
import { PausedQueueBanner } from '../features/jobs/paused-banner.tsx'

export function QueuePage(): React.JSX.Element {
  return (
    <div className="flex flex-col gap-3">
      <PageHeader title={copy.workspace.tabs.queue} />
      {/*
        First, because a paused queue is why nothing is happening. The reason was
        recorded and shown nowhere, and resuming lived on the printer page, so
        the queue looked broken rather than held.
      */}
      <PausedQueueBanner />
      {/* No printer filter: the queue page is about everything in flight. */}
      <JobList printerId={null} />
    </div>
  )
}
