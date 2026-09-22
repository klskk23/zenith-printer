/**
 * Application shell.
 *
 * Sidebar and one page. There is no tab bar and no top bar: the product's
 * name and the printers live in the sidebar, which is always there — which is
 * why the editor's own "back" is a courtesy, not the only way out. Leaving a
 * page with unsaved edits asks once; confirming abandons them.
 */
import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { request } from './api/client.ts'
import { DisconnectedBanner, type ConnectionState } from './app/status-bar.tsx'
import { Sidebar } from './app/sidebar.tsx'
import { summarize } from './app/status-summary.ts'
import { WorkspaceProvider, useWorkspace } from './app/workspace.tsx'
import { stepOf, type PageDescriptor } from './app/routes.ts'
import { EditorPage } from './editor/editor-page.tsx'
import { PrintersPage } from './features/printers/printers-page.tsx'
import { usePrinters } from './features/printers/hooks.ts'
import { useJobs } from './features/jobs/hooks.ts'
import { LabelsPage } from './pages/labels-page.tsx'
import { QueuePage } from './pages/queue-page.tsx'
import { HistoryPage } from './pages/history-page.tsx'
import { SettingsPage } from './pages/settings-page.tsx'
import { ApiDocsPage } from './pages/api-docs-page.tsx'
import { PrintPresetsPage } from './pages/print-presets-page.tsx'
import { DataSourcesPage } from './features/data-sources/data-sources-page.tsx'
import { DataSourceEditor } from './features/data-sources/data-source-editor.tsx'
import { PreferencesProvider } from './features/preferences/context.tsx'
import { copy } from './i18n/index.ts'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from './components/ui/alert-dialog.tsx'

/**
 * Asked once, only when leaving would lose something: unsaved edits on the
 * open page. Staying is the way to keep them — save, then leave.
 */
function LeaveDialog(): React.JSX.Element {
  const { pendingLeave, confirmLeave, stay } = useWorkspace()
  return (
    <AlertDialog open={pendingLeave !== null} onOpenChange={(open) => !open && stay()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{copy.workspace.leaveTitle}</AlertDialogTitle>
          <AlertDialogDescription>{copy.workspace.leaveBody}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={stay}>{copy.workspace.leaveStay}</AlertDialogCancel>
          <AlertDialogAction onClick={confirmLeave}>{copy.workspace.leaveAnyway}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

/** The list, wired so opening a table lands in its editor. */
function DataSourcesPageRoute(): React.JSX.Element {
  const { open } = useWorkspace()
  return <DataSourcesPage onOpen={(id) => open({ kind: 'data-source', dataSourceId: id })} />
}

function Page({ page }: { page: PageDescriptor }): React.JSX.Element {
  switch (page.kind) {
    case 'labels':
      return <LabelsPage />
    case 'label':
    case 'label-print':
    case 'label-confirm':
      // One instance across all three steps and across a save. The key never
      // changes, so React keeps the component mounted: the content on the
      // canvas, the undo stack, the chosen machine and the ticked rows survive
      // stepping back and forth, and the first save simply points the page at
      // the new template id.
      return (
        <EditorPage
          key="label"
          step={stepOf(page.kind) ?? 'design'}
          templateId={page.templateId ?? null}
          presetId={page.presetId}
        />
      )
    case 'data-sources':
      return <DataSourcesPageRoute />
    case 'data-source':
      return <DataSourceEditor dataSourceId={page.dataSourceId ?? ''} />
    case 'printers':
      return <PrintersPage />
    case 'queue':
      return <QueuePage />
    case 'print-presets':
      return <PrintPresetsPage />
    case 'api-docs':
      return <ApiDocsPage />
    case 'history':
      return <HistoryPage />
    case 'settings':
      return <SettingsPage />
  }
}

function Workspace({ connection }: { connection: ConnectionState }): React.JSX.Element {
  const { page } = useWorkspace()
  const jobs = useJobs(null)
  const printers = usePrinters()
  const summary = useMemo(() => summarize(printers.data, jobs.data), [printers.data, jobs.data])

  return (
    // Fixed to the viewport rather than growing with content: the editor's
    // resizable columns need a height to divide, and a page that scrolls as a
    // whole would give them an unbounded one.
    <div className="flex h-screen overflow-hidden">
      <LeaveDialog />
      <Sidebar
        pendingJobCount={summary.queue?.pending ?? 0}
        printers={summary.printers}
        printersLoading={printers.isPending}
        connection={connection}
      />

      <main className="flex min-h-0 min-w-0 flex-1 flex-col">
        {connection === 'disconnected' && <DisconnectedBanner />}
        {/* The page-level scroller. Left native: the designer manages its
            own scrolling inside it, and nesting Radix viewports makes the
            inner one unable to reach the outer. */}
        <div className="scrollbar-themed min-h-0 flex-1 overflow-auto p-4">
          <Page page={page} />
        </div>
      </main>
    </div>
  )
}

export function App(): React.JSX.Element {
  const health = useQuery({
    queryKey: ['health'],
    queryFn: () => request<{ status: string }>('/health'),
  })

  const connection: ConnectionState = health.isPending
    ? 'connecting'
    : health.isError
      ? 'disconnected'
      : 'connected'

  return (
    // Preferences wrap the workspace because the chosen language has to reach
    // the API client before any request goes out.
    <PreferencesProvider>
      <WorkspaceProvider>
        <Workspace connection={connection} />
      </WorkspaceProvider>
    </PreferencesProvider>
  )
}
