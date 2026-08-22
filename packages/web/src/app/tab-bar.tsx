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
import { useTemplates } from '../features/templates/hooks.ts'
import { Button } from '../components/ui/button.tsx'

/**
 * What a tab is called.
 *
 * A design tab opened on a template shows that template's name — otherwise
 * three open designs are all labelled "标签设计" and telling them apart means
 * clicking through them.
 */
function tabTitle(tab: WorkspaceTab, templateName: string | undefined): string {
  if (tab.kind !== 'design') {
    return copy.workspace.tabs[tab.kind]
  }
  if (tab.templateId === null) {
    return copy.workspace.untitledDesign
  }
  // The list may not have loaded yet; the generic name is better than a blank.
  return templateName ?? copy.workspace.tabs.design
}

export function TabBar(): React.JSX.Element {
  const { tabs, state, activate, close } = useWorkspace()
  const templates = useTemplates()
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
      <div data-tab-bar className="flex items-stretch gap-px overflow-x-auto border-b border-border bg-muted/40">
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
              <Button
                variant="ghost"
                size="row-inline"
                // The tab itself already shows hover; a second background
                // inside it reads as two overlapping controls.
                className="gap-1.5 hover:bg-transparent"
                onClick={() => activate(tab.id)}
              >
                {/* Active marker: a dot, never an ×. */}
                <span
                  aria-hidden
                  className={cn('h-1.5 w-1.5 rounded-full', isActive ? 'bg-primary' : 'bg-transparent')}
                />
                <span className="whitespace-nowrap">
                  {tabTitle(tab, templates.data?.find((t) => t.id === tab.templateId)?.name)}
                </span>
                {tab.isDirty && (
                  <span className="text-primary" title={copy.workspace.unsavedMark} aria-label={copy.workspace.unsavedMark}>
                    ●
                  </span>
                )}
              </Button>
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label={copy.workspace.close}
                title={copy.workspace.close}
                className="shrink-0 text-muted-foreground opacity-0 group-hover:opacity-100"
                onClick={() => requestClose(tab)}
              >
                ×
              </Button>
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
