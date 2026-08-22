/**
 * Application shell.
 *
 * Status bar, tab bar, sidebar, content area. The structural rule this file
 * exists to enforce: **every open tab stays mounted**, and only its visibility
 * changes. Rendering just the active tab would be simpler and would silently
 * discard the selection, zoom level and undo history that switching back is
 * supposed to restore.
 */
import { useQuery } from '@tanstack/react-query'
import { request } from './api/client.ts'
import { copy } from './i18n/index.ts'
import { cn } from './lib/utils.ts'
import { Alert } from './components/ui/alert.tsx'
import { DisconnectedBanner, StatusBar, type ConnectionState } from './app/status-bar.tsx'
import { Sidebar } from './app/sidebar.tsx'
import { TabBar } from './app/tab-bar.tsx'
import { WorkspaceProvider, useWorkspace } from './app/workspace.tsx'
import type { WorkspaceTab } from './app/workspace-state.ts'
import { EditorPage } from './editor/editor-page.tsx'
import { PrintersPage } from './features/printers/printers-page.tsx'
import { useJobs } from './features/jobs/hooks.ts'
import { IndexPage } from './pages/index-page.tsx'
import { TemplatesPage } from './pages/templates-page.tsx'
import { QueuePage } from './pages/queue-page.tsx'
import { HistoryPage } from './pages/history-page.tsx'
import { SettingsPage } from './pages/settings-page.tsx'
import { DataSourcesPage } from './features/data-sources/data-sources-page.tsx'
import { DataSourceEditor } from './features/data-sources/data-source-editor.tsx'
import { PreferencesProvider } from './features/preferences/context.tsx'

/** The list, wired so opening a table lands in its editor tab. */
function DataSourcesPageTab(): React.JSX.Element {
  const { open } = useWorkspace()
  return <DataSourcesPage onOpen={(id) => open({ kind: 'data-source', dataSourceId: id })} />
}

function TabContent({ tab }: { tab: WorkspaceTab }): React.JSX.Element {
  switch (tab.kind) {
    case 'index':
      return <IndexPage />
    case 'design':
      // The tab knows which template it was opened on; the editor has to be
      // told, or it starts blank and the template has to be picked again.
      return <EditorPage tabId={tab.id} templateId={tab.templateId} />
    case 'templates':
      return <TemplatesPage />
    case 'data-sources':
      return <DataSourcesPageTab />
    case 'data-source':
      return <DataSourceEditor dataSourceId={tab.dataSourceId ?? ''} tabId={tab.id} />
    case 'printers':
      return <PrintersPage />
    case 'queue':
      return <QueuePage />
    case 'history':
      return <HistoryPage />
    case 'settings':
      return <SettingsPage />
  }
}

function Workspace({ connection }: { connection: ConnectionState }): React.JSX.Element {
  const { tabs, state, atSoftLimit } = useWorkspace()
  const jobs = useJobs(null)

  const pending = (jobs.data ?? []).filter(
    (job) => job.status === 'queued' || job.status === 'printing',
  ).length

  return (
    // Fixed to the viewport rather than growing with content: the editor's
    // resizable columns need a height to divide, and a page that scrolls as a
    // whole would give them an unbounded one.
    <div className="flex h-screen flex-col overflow-hidden">
      <StatusBar connection={connection} />
      <TabBar />

      <div className="flex min-h-0 flex-1">
        <Sidebar pendingJobCount={pending} />

        <main className="flex min-h-0 min-w-0 flex-1 flex-col">
          {connection === 'disconnected' && <DisconnectedBanner />}
          {atSoftLimit && (
            <Alert variant="warning" className="m-4 text-xs">
              {copy.workspace.softLimitWarning}
            </Alert>
          )}

          {/*
            Every tab is rendered; only the active one is visible. `hidden`
            keeps the others mounted, which is the whole point — unmounting
            them would throw away exactly the state a user expects to find
            when they switch back.
          */}
          {tabs.map((tab) => (
            <div
              key={tab.id}
              className={cn(
                'min-h-0 flex-1 p-4',
                // `hidden` rather than unmounting: an inactive tab keeps its
                // selection, zoom and undo history, which is the whole promise
                // of switching away and back.
                // The page-level scroller, shared by every tab. Left native:
                // some tabs (the designer) manage their own scrolling inside
                // it, and nesting Radix viewports makes the inner one unable to
                // reach the outer.
                tab.id === state.activeId ? 'scrollbar-themed overflow-auto' : 'hidden',
              )}
            >
              <TabContent tab={tab} />
            </div>
          ))}
        </main>
      </div>
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
