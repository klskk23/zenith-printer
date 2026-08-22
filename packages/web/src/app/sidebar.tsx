/**
 * Sidebar navigation.
 *
 * Every entry opens a tab; an entry already open switches to it rather than
 * making a second one. Designs are the exception — two design tabs is a normal
 * way to compare variants, so that entry always opens a fresh one.
 */
import { copy } from '../i18n/index.ts'
import { cn } from '../lib/utils.ts'
import { Badge } from '../components/ui/badge.tsx'
import { TAB_KINDS, type TabKind } from './routes.ts'
import { useWorkspace } from './workspace.tsx'
import { Button } from '../components/ui/button.tsx'

export interface SidebarProps {
  /** Jobs waiting or printing, across all printers. Hidden when zero. */
  pendingJobCount: number
}

export function Sidebar({ pendingJobCount }: SidebarProps): React.JSX.Element {
  const { open, activeTab } = useWorkspace()

  // The data source *editor* is reached from the list, never from here: it
  // needs a table to edit, and an entry that opened an empty one would be a
  // dead end.
  const entries: TabKind[] = TAB_KINDS.filter((kind) => kind !== 'data-source')

  return (
    <nav className="w-40 shrink-0 border-r border-border p-2">
      <ul className="space-y-0.5">
        {entries.map((kind) => {
          const isActive = activeTab?.kind === kind
          return (
            <li key={kind}>
              <Button
                variant="ghost"
                size="row"
                onClick={() => open(kind === 'design' ? { kind, templateId: null } : { kind })}
                className={cn(
                  // `justify-between` rather than the size's `justify-start`:
                  // the queue count sits at the far end of the row.
                  'justify-between',
                  isActive ? 'bg-muted font-medium' : 'text-muted-foreground hover:bg-muted/60',
                )}
              >
                <span>{copy.workspace.tabs[kind]}</span>
                {kind === 'queue' && pendingJobCount > 0 && (
                  <Badge variant="secondary">{pendingJobCount}</Badge>
                )}
              </Button>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
