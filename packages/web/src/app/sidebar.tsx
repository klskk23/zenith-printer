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
    <nav className="w-52 shrink-0 border-r border-border px-4 py-5" data-classical-sidebar>
      <ol className="flex flex-col gap-1">
        {entries.map((kind, index) => {
          const isActive = activeTab?.kind === kind
          return (
            <li key={kind}>
              <Button
                variant="ghost"
                size="row"
                onClick={() => open(kind === 'design' ? { kind, templateId: null } : { kind })}
                data-nav-index={String(index + 1).padStart(2, '0')}
                className={cn(
                  'justify-between border-l border-transparent pl-3 classical-nav-item',
                  isActive
                    ? 'border-l-primary bg-transparent font-medium text-foreground'
                    : 'text-muted-foreground hover:border-l-border hover:bg-transparent',
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
      </ol>
    </nav>
  )
}
