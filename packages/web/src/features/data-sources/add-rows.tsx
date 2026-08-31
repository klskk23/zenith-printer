/**
 * The "add rows" bar at the foot of the grid.
 *
 * The library ships one, but it is an unstyled button and a bare number input
 * labelled in English — a different visual language from everything around it,
 * sitting at the bottom of the page where it is impossible to miss.
 *
 * Rebuilt from the same primitives as the rest of the application. The grid
 * takes it as a prop, so this is composition rather than an override.
 */
import { useState } from 'react'
import { Button } from '../../components/ui/button.tsx'
import { Input } from '../../components/ui/input.tsx'
import { copy } from '../../i18n/index.ts'

export interface AddRowsBarProps {
  addRows: (count: number) => void
}

export function AddRowsBar({ addRows }: AddRowsBarProps): React.JSX.Element {
  // Held as text so the field can be empty while being retyped; a number state
  // would snap it back to 1 on the first keystroke of "10".
  const [draft, setDraft] = useState('1')
  const count = Math.max(1, Math.round(Number(draft) || 0))

  return (
    <div className="flex items-center gap-2 border-t border-border pt-2" data-add-rows>
      <Button variant="outline" size="sm" onClick={() => addRows(count)}>
        {copy.dataSources.addRows}
      </Button>
      <Input
        type="number"
        min={1}
        aria-label={copy.dataSources.addRowsCount}
        className="h-8 w-20 text-xs"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => setDraft(String(count))}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            addRows(count)
          }
        }}
      />
      <span className="text-2xs text-muted-foreground">{copy.dataSources.addRowsUnit}</span>
    </div>
  )
}
