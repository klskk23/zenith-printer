/**
 * Sidebar navigation: eight entries, always there.
 *
 * The order is the design's, not alphabetical: what people come here to do
 * (labels), what feeds it (data sources), what it goes to (printers), what
 * happens to it (queue, history), then the things set up once (presets, the
 * API console, settings). The editor has no entry — it needs a label to
 * open, and is reached by clicking one in the gallery.
 */
import { copy } from '../i18n/index.ts'
import { cn } from '../lib/utils.ts'
import { Badge } from '../components/ui/badge.tsx'
import { SIDEBAR_KINDS } from './routes.ts'
import { useWorkspace } from './workspace.tsx'
import { Button } from '../components/ui/button.tsx'

export interface SidebarProps {
  /** Jobs waiting or printing, across all printers. Hidden when zero. */
  pendingJobCount: number
}

export function Sidebar({ pendingJobCount }: SidebarProps): React.JSX.Element {
  const { open, page } = useWorkspace()

  // The gallery's entry stays lit while a label is open: the editor is a
  // place inside 「标签」, not a page of its own.
  const activeKind = page.kind === 'label' ? 'labels' : page.kind === 'data-source' ? 'data-sources' : page.kind

  return (
    // Nocturne's compact scale for the shell: the rows sit at 5.6 / 8.4px.
    <nav className="w-48 shrink-0 border-r border-border px-n3 py-n6">
      <ol className="flex flex-col gap-px">
        {SIDEBAR_KINDS.map((kind) => {
          const isActive = activeKind === kind
          return (
            <li key={kind}>
              <Button
                variant="ghost"
                size="row"
                onClick={() => open({ kind })}
                aria-current={isActive ? 'page' : undefined}
                className={cn(
                  'justify-between rounded-sm px-n3 py-n2 text-xs',
                  // The active entry: accent text on an accent tint, with the
                  // accent as a line down its left edge — never a filled bar.
                  isActive
                    ? 'bg-primary/11 text-primary shadow-[inset_2px_0_0_var(--color-primary)] hover:bg-primary/11'
                    : 'text-foreground/72 hover:bg-foreground/6 hover:text-foreground',
                )}
              >
                <span data-nav-label>{copy.workspace.pages[kind]}</span>
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
