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
    // Nocturne's compact scale for the shell: the rows sit at 5.6 / 8.4px.
    <nav className="w-48 shrink-0 border-r border-border px-n3 py-n6">
      <ol className="flex flex-col gap-px">
        {entries.map((kind) => {
          const isActive = activeTab?.kind === kind
          return (
            <li key={kind}>
              <Button
                variant="ghost"
                size="row"
                onClick={() => open(kind === 'design' ? { kind, templateId: null } : { kind })}
                className={cn(
                  'justify-between rounded-sm px-n3 py-n2 text-xs',
                  // The active entry: accent text on an accent tint, with the
                  // accent as a line down its left edge — never a filled bar.
                  isActive
                    ? 'bg-primary/11 text-primary shadow-[inset_2px_0_0_var(--color-primary)] hover:bg-primary/11'
                    : 'text-foreground/72 hover:bg-foreground/6 hover:text-foreground',
                )}
              >
                <span data-nav-label>{copy.workspace.tabs[kind]}</span>
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
