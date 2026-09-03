/**
 * Finished, failed and cancelled jobs.
 *
 * Separate from the queue on purpose: the queue is for managing what is
 * happening, history is for checking what already happened. The two share no
 * actions.
 */
import { useState } from 'react'
import { copy } from '../i18n/index.ts'
import { PageHeader } from '../components/page-header.tsx'
import { JobHistory, JobHistoryActions } from '../features/jobs/history.tsx'

export function HistoryPage(): React.JSX.Element {
  /**
   * Held here because the header and the list both need it: the control that
   * expands the list sits beside the page title, and the list it expands is
   * below.
   */
  const [expanded, setExpanded] = useState(false)

  return (
    <div className="flex flex-col gap-3">
      <PageHeader
        title={copy.workspace.tabs.history}
        actions={
          <JobHistoryActions
            printerId={null}
            expanded={expanded}
            onExpandedChange={setExpanded}
          />
        }
      />
      <JobHistory printerId={null} expanded={expanded} />
    </div>
  )
}
