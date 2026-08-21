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

export interface SidebarProps {
  /** Jobs waiting or printing, across all printers. Hidden when zero. */
  pendingJobCount: number
}

export function Sidebar({ pendingJobCount }: SidebarProps): React.JSX.Element {
  const { open, activeTab } = useWorkspace()

  const entries: TabKind[] = [...TAB_KINDS]

  return (
    <nav className="w-40 shrink-0 border-r border-border p-2">
      <ul className="space-y-0.5">
        {entries.map((kind) => {
          const isActive = activeTab?.kind === kind
          return (
            <li key={kind}>
              <button
                type="button"
                onClick={() => open(kind === 'design' ? { kind, templateId: null } : { kind })}
                className={cn(
                  'flex w-full items-center justify-between rounded-md px-2.5 py-1.5 text-left text-xs transition-colors',
                  isActive ? 'bg-muted font-medium' : 'text-muted-foreground hover:bg-muted/60',
                )}
              >
                <span>{copy.workspace.tabs[kind]}</span>
                {kind === 'queue' && pendingJobCount > 0 && (
                  <Badge variant="secondary">{pendingJobCount}</Badge>
                )}
              </button>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
