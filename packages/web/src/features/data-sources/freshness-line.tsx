/**
 * Where a table's rows came from and how old they are.
 *
 * One component for the two places that show it — the data source list and the
 * design page's binding panel — because they were the same sentence written
 * twice, and only one of them would have been updated.
 *
 * The age is the point. Both places used to print a full timestamp, which is
 * furniture: a table read ten days ago looked exactly like one read this
 * morning, and printing from ten-day-old rows is not something anybody notices
 * until the labels are in their hands.
 */
import { cn } from '../../lib/utils.ts'
import { copy } from '../../i18n/index.ts'
import { ageParts, freshnessOf } from './freshness.ts'
import type { DataSource } from './hooks.ts'

/** How the age reads. Coarse: the question is "can I trust these rows". */
export function freshnessText(source: DataSource, now: Date): string {
  const { ageSeconds } = freshnessOf(source, now)
  if (ageSeconds === null) {
    return copy.dataSources.freshNever
  }
  const { unit, value } = ageParts(ageSeconds)
  switch (unit) {
    case 'now':
      return copy.dataSources.freshJustNow
    case 'minute':
      return copy.dataSources.freshMinutes(value)
    case 'hour':
      return copy.dataSources.freshHours(value)
    default:
      return copy.dataSources.freshDays(value)
  }
}

/** Where the rows come from, in one phrase, or null for a table kept here. */
function originText(source: DataSource): string | null {
  if (source.sourceKind === 'google-sheets') {
    return copy.dataSources.fromGoogle(source.spreadsheetTitle ?? '', source.worksheetTitle ?? '')
  }
  if (source.sourceKind === 'nexus') {
    // The category, not an address: the address is a deployment detail nobody
    // reading this page chose or can change.
    return copy.dataSources.fromLedger(source.name)
  }
  return null
}

export function FreshnessLine({
  source,
  now,
  className,
}: {
  source: DataSource
  /** Injected, so this renders the same thing every time a test looks at it. */
  now: Date
  className?: string
}): React.JSX.Element | null {
  const origin = originText(source)
  if (origin === null) {
    // A table maintained here has no age worth reporting: it is as fresh as
    // whoever last typed into it, and they know when that was.
    return null
  }

  const { stale } = freshnessOf(source, now)

  return (
    <p className={cn('text-2xs text-muted-foreground', className)} data-source-origin>
      {origin}
      {' · '}
      <span className={stale ? 'font-medium text-warning' : undefined} data-freshness>
        {freshnessText(source, now)}
      </span>
      {/* Said, not only coloured: colour alone is not a message somebody can
          read out, and it is not a message at all to anyone who cannot see it. */}
      {stale && <span className="ml-1 text-warning">{copy.dataSources.freshStale}</span>}
    </p>
  )
}
