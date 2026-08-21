/**
 * The tab bar.
 *
 * Two visual details are load-bearing:
 *
 *   - "active" and "close" use different marks. The wireframe used `[x]` for
 *     the active tab, but `×` reads as a close button everywhere else, and a
 *     user who clicks it to switch tabs would instead lose their work.
 *   - the bar scrolls sideways rather than squeezing tabs. Squeezing shrinks
 *     titles until every tab looks the same.
 */
import { useState } from 'react'
import { copy } from '../i18n/index.ts'
import { cn } from '../lib/utils.ts'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '../components/ui/alert-dialog.tsx'
import { useWorkspace } from './workspace.tsx'
import type { WorkspaceTab } from './workspace-state.ts'

function tabTitle(tab: WorkspaceTab): string {
  if (tab.kind !== 'design') {
    return copy.workspace.tabs[tab.kind]
  }
  return tab.templateId === null ? copy.workspace.untitledDesign : copy.workspace.tabs.design
}

export function TabBar(): React.JSX.Element {
  const { tabs, state, activate, close } = useWorkspace()
  const [pendingClose, setPendingClose] = useState<WorkspaceTab | null>(null)

  const requestClose = (tab: WorkspaceTab): void => {
    // Unsaved work is the only thing worth interrupting someone for.
    if (tab.isDirty) {
      setPendingClose(tab)
      return
    }
    close(tab.id)
  }

  return (
    <>
      <div className="flex items-stretch gap-px overflow-x-auto border-b border-border bg-muted/40">
        {tabs.map((tab) => {
          const isActive = tab.id === state.activeId
          return (
            <div
              key={tab.id}
              className={cn(
                'group flex shrink-0 items-center gap-2 border-r border-border px-3 py-1.5 text-xs',
                isActive ? 'bg-background font-medium' : 'text-muted-foreground hover:bg-background/60',
              )}
            >
              <button type="button" className="flex items-center gap-1.5" onClick={() => activate(tab.id)}>
                {/* Active marker: a dot, never an ×. */}
                <span
                  aria-hidden
                  className={cn('h-1.5 w-1.5 rounded-full', isActive ? 'bg-primary' : 'bg-transparent')}
                />
                <span className="whitespace-nowrap">{tabTitle(tab)}</span>
                {tab.isDirty && (
                  <span className="text-primary" title={copy.workspace.unsavedMark} aria-label={copy.workspace.unsavedMark}>
                    ●
                  </span>
                )}
              </button>
              <button
                type="button"
                aria-label={copy.workspace.close}
                title={copy.workspace.close}
                className="rounded px-1 text-muted-foreground opacity-0 transition-opacity hover:bg-muted group-hover:opacity-100"
                onClick={() => requestClose(tab)}
              >
                ×
              </button>
            </div>
          )
        })}
      </div>

      <AlertDialog open={pendingClose !== null} onOpenChange={(open) => !open && setPendingClose(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{copy.workspace.confirmCloseTitle}</AlertDialogTitle>
            <AlertDialogDescription>{copy.workspace.confirmCloseBody}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{copy.workspace.confirmCloseCancel}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (pendingClose !== null) {
                  close(pendingClose.id)
                }
                setPendingClose(null)
              }}
            >
              {copy.workspace.confirmCloseConfirm}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
