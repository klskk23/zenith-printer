/**
 * Top status bar.
 *
 * A disconnected service also raises a banner in the content area. The dot
 * alone is not enough: someone whose save button stopped working will not
 * think to check a small circle in the corner.
 */
import { copy } from '../i18n/index.ts'
import { cn } from '../lib/utils.ts'

export type ConnectionState = 'connecting' | 'connected' | 'disconnected'

export function StatusBar({ connection }: { connection: ConnectionState }): React.JSX.Element {
  const label =
    connection === 'connecting'
      ? copy.connection.connecting
      : connection === 'connected'
        ? copy.connection.connected
        : copy.connection.disconnected

  return (
    <header className="flex items-center justify-between border-b border-border px-4 py-2">
      <div>
        <h1 className="text-sm font-bold">{copy.app.title}</h1>
      </div>
      <div className="flex items-center gap-2 text-xs">
        <span
          aria-hidden
          className={cn(
            'h-2 w-2 rounded-full',
            connection === 'connected' ? 'bg-primary' : connection === 'connecting' ? 'bg-muted-foreground' : 'bg-destructive',
          )}
        />
        <span className={cn(connection === 'disconnected' ? 'text-destructive' : 'text-muted-foreground')}>
          {label}
        </span>
      </div>
    </header>
  )
}

/** Shown at the top of the content area, where the failing action actually is. */
export function DisconnectedBanner(): React.JSX.Element {
  return (
    <div className="border-b border-destructive/40 bg-destructive/10 px-4 py-2 text-xs text-destructive">
      {copy.workspace.disconnectedBanner}
    </div>
  )
}
