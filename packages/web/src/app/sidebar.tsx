/**
 * The sidebar: the product's name, seven entries, and the printers.
 *
 * One column, always there. The brand sits at its top rather than in a bar
 * across the page, so the sidebar and the name read as one piece of furniture.
 * The printers sit at its foot as one small line — a dot and a count — and
 * open on a click into what the service knows about each (probed or not, and
 * whether the model can report its stock). Three lines of printer detail
 * standing permanently in a narrow column read as clutter; one line that can
 * be asked does not.
 *
 * The column is set loose on purpose: 240px wide, 14px labels, a breath of
 * air between rows. Seven entries do not need to be packed; packed, they read
 * as a list to scan rather than places to go.
 *
 * The order is the design's, not alphabetical: what people come here to do
 * (labels), what feeds it (data sources), what it goes to (printers), what
 * happens to it (queue, history), then presets and settings. The editor has
 * no entry — it needs a label to open, and is reached by clicking one. The
 * API console has none either: a developer's page, reached from settings.
 */
import { ChevronUp, Database, History, ListOrdered, Printer, Settings, SlidersHorizontal, Tag } from 'lucide-react'
import { copy } from '../i18n/index.ts'
import { cn } from '../lib/utils.ts'
import { Badge } from '../components/ui/badge.tsx'
import { Button } from '../components/ui/button.tsx'
import { Popover, PopoverContent, PopoverTrigger } from '../components/ui/popover.tsx'
import { SIDEBAR_KINDS } from './routes.ts'
import { useWorkspace } from './workspace.tsx'
import { Dot } from './status-strip.tsx'
import type { ConnectionState } from './status-bar.tsx'
import type { PrinterStatus } from './status-summary.ts'

const ICONS: Record<(typeof SIDEBAR_KINDS)[number], React.ComponentType<{ className?: string }>> = {
  labels: Tag,
  'data-sources': Database,
  printers: Printer,
  queue: ListOrdered,
  history: History,
  'print-presets': SlidersHorizontal,
  settings: Settings,
}

export interface SidebarProps {
  /** Jobs waiting or printing, across all printers. Hidden when zero. */
  pendingJobCount: number
  printers: readonly PrinterStatus[]
  /** Whether the printer list has answered yet. */
  printersLoading: boolean
  connection: ConnectionState
}

function PrinterLine({ printer }: { printer: PrinterStatus }): React.JSX.Element {
  const stock =
    printer.consumable.kind === 'not-probed'
      ? copy.status.notProbed
      : printer.consumable.kind === 'supported'
        ? copy.status.remainingSupported
        : copy.status.remainingUnsupported
  return (
    <li className="flex items-center gap-n3 text-xs" data-printer-status={printer.id}>
      <Dot live={printer.probed && printer.queueState === 'running'} />
      <span className="truncate text-foreground">{printer.name}</span>
      <span className="ml-auto shrink-0 text-muted-foreground">{stock}</span>
    </li>
  )
}

/**
 * The foot's one line, and the panel it opens.
 *
 * The dot summarises: lit when every printer is probed and running, dark when
 * any is not — the one case worth a glance from another page.
 */
function PrintersDisclosure({
  printers,
  loading,
}: {
  printers: readonly PrinterStatus[]
  loading: boolean
}): React.JSX.Element {
  const allLive = printers.length > 0 && printers.every((p) => p.probed && p.queueState === 'running')
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="row"
          className="justify-between rounded-sm px-n4 py-n3 text-xs text-foreground/72 hover:bg-foreground/6 hover:text-foreground"
          disabled={loading}
          data-sidebar-printers
        >
          <span className="flex items-center gap-n3">
            <Dot live={allLive} />
            <span>{loading ? '…' : copy.status.printersCount(printers.length)}</span>
          </span>
          <ChevronUp className="size-3 opacity-60" aria-hidden />
        </Button>
      </PopoverTrigger>
      <PopoverContent side="top" align="start" className="w-60" data-sidebar-printers-panel>
        {printers.length === 0 ? (
          <span className="text-2xs text-muted-foreground">{copy.status.noPrinters}</span>
        ) : (
          <ul className="flex flex-col gap-n2">
            {printers.map((printer) => (
              <PrinterLine key={printer.id} printer={printer} />
            ))}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  )
}

export function Sidebar({ pendingJobCount, printers, printersLoading, connection }: SidebarProps): React.JSX.Element {
  const { open, page } = useWorkspace()

  // The gallery's entry stays lit while a label is open: the editor is a
  // place inside 「标签」, not a page of its own. Likewise a table inside 数据源.
  const activeKind = page.kind === 'label' ? 'labels' : page.kind === 'data-source' ? 'data-sources' : page.kind

  const connectionLabel =
    connection === 'connecting'
      ? copy.connection.connecting
      : connection === 'connected'
        ? copy.connection.connected
        : copy.connection.disconnected

  return (
    // Nocturne's compact scale for the shell, opened up: rows at 8.4 / 11.2px
    // with 5.6px of air between them.
    <nav className="flex w-60 shrink-0 flex-col border-r border-border px-n4 py-n6" aria-label={copy.app.title}>
      <div className="flex items-center gap-n4 px-n2 pb-n8 text-base font-medium" data-brand>
        <span className="grid size-8 shrink-0 place-items-center rounded-md border border-primary/45 text-primary">
          <Printer className="size-4" aria-hidden />
        </span>
        <span>{copy.app.title}</span>
      </div>

      <ol className="flex flex-col gap-n2">
        {SIDEBAR_KINDS.map((kind) => {
          const isActive = activeKind === kind
          const Icon = ICONS[kind]
          return (
            <li key={kind}>
              <Button
                variant="ghost"
                size="row"
                onClick={() => open({ kind })}
                aria-current={isActive ? 'page' : undefined}
                className={cn(
                  'justify-between rounded-sm px-n4 py-n3 text-sm',
                  // The active entry: accent text on an accent tint, with the
                  // accent as a line down its left edge — never a filled bar.
                  isActive
                    ? 'bg-primary/11 text-primary shadow-[inset_2px_0_0_var(--color-primary)] hover:bg-primary/11'
                    : 'text-foreground/72 hover:bg-foreground/6 hover:text-foreground',
                )}
              >
                <span className="flex items-center gap-n4">
                  <Icon className={cn('size-4 shrink-0', isActive ? 'opacity-100' : 'opacity-75')} aria-hidden />
                  <span data-nav-label>{copy.workspace.pages[kind]}</span>
                </span>
                {kind === 'queue' && pendingJobCount > 0 && (
                  <Badge variant="secondary">{pendingJobCount}</Badge>
                )}
              </Button>
            </li>
          )
        })}
      </ol>

      <div className="flex-1" />

      <div className="flex flex-col gap-n1">
        <PrintersDisclosure printers={printers} loading={printersLoading} />
        <div className="flex items-center gap-n3 px-n4 py-n3 text-xs" data-connection>
          <Dot live={connection === 'connected'} />
          <span className={connection === 'disconnected' ? 'text-destructive' : 'text-muted-foreground'}>
            {connectionLabel}
          </span>
        </div>
      </div>
    </nav>
  )
}
