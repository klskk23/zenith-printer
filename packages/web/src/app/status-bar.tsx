/**
 * Connection state, and the banner a disconnected service raises.
 *
 * The state itself is shown at the foot of the sidebar; the banner sits at
 * the top of the content area, where the failing action actually is. The dot
 * alone is not enough: someone whose save button stopped working will not
 * think to check a small circle in the corner.
 */
import { copy } from '../i18n/index.ts'

export type ConnectionState = 'connecting' | 'connected' | 'disconnected'

/** Shown at the top of the content area, where the failing action actually is. */
export function DisconnectedBanner(): React.JSX.Element {
  return (
    <div className="border-b border-destructive/40 bg-destructive/10 px-4 py-2 text-xs text-destructive">
      {copy.workspace.disconnectedBanner}
    </div>
  )
}
