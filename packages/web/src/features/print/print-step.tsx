/**
 * Choosing what to print: the machine, the settings, the rows, the count.
 *
 * This was a dialog. A dialog is an interruption, and choosing rows out of a
 * table of twelve hundred is not an interruption — it is the work. So it is a
 * page, with the table given the whole of the room below the choices and
 * nothing stranded underneath it.
 *
 * Nothing warns here. The old dialog carried a standing "printing uses paper"
 * notice, a head-width figure and a clipping list above the controls; a warning
 * that is always on screen is one nobody reads. What can actually go wrong is
 * said on the next step, and only when it is about to.
 */
import { useState } from 'react'
import { Minus, Plus } from 'lucide-react'
import { copy } from '../../i18n/index.ts'
import { cn } from '../../lib/utils.ts'
import { Alert } from '../../components/ui/alert.tsx'
import { Button } from '../../components/ui/button.tsx'
import { Input } from '../../components/ui/input.tsx'
import type { Printer } from '../../api/types.ts'
import type { Profile } from '../profiles/hooks.ts'
import { Dot } from '../../app/status-strip.tsx'
import { RowSelectionPanel } from './row-selection.tsx'
import { RefreshButton } from '../data-sources/refresh-button.tsx'
import { isFetched, useDataSources } from '../data-sources/hooks.ts'
import { useAutoRefresh } from '../data-sources/use-auto-refresh.ts'
import type { Selection } from './selection.ts'
import type { Tally } from './flow.ts'

export interface PrintStepProps {
  printers: readonly Printer[]
  printerId: string | null
  onPrinter: (id: string) => void
  profiles: readonly Profile[]
  profileId: string | null
  onProfile: (id: string | null) => void
  dataSourceId: string | null
  selection: Selection
  onSelection: (selection: Selection) => void
  /**
   * Row keys the session has seen, by position, and the way to add to them.
   *
   * Held by the session because the panel only ever has the ten rows it is
   * showing, while a selection can span pages.
   */
  keyByOrdinal: ReadonlyMap<number, string>
  onRowKeys: (update: (current: ReadonlyMap<number, string>) => ReadonlyMap<number, string>) => void
  copies: number
  onCopies: (copies: number) => void
  tally: Tally
  /** Why printing cannot go ahead, or null. */
  blocked: string | null
  /** What a `?preset=` link could not do, said out loud. */
  notices: readonly string[]
  onContinue: () => void
  onBack: () => void
}

/** A choice you can see the reason for: what the machine is, and whether it is ready. */
function Card({
  chosen,
  onChoose,
  title,
  detail,
  lead,
  name,
}: {
  chosen: boolean
  onChoose: () => void
  title: string
  detail: string
  lead?: React.ReactNode
  name: string
}): React.JSX.Element {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={chosen}
      aria-label={title}
      data-card={name}
      data-chosen={chosen ? '' : undefined}
      onClick={onChoose}
      className={cn(
        // Grows to share the row, but never stretches to the full width on
        // its own: a lone card as wide as the page reads as a banner.
        'flex min-w-52 max-w-xs flex-1 flex-col gap-n1 rounded-md border px-n4 py-n3 text-left',
        'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
        chosen ? 'border-primary bg-primary/8' : 'border-border hover:border-foreground/30',
      )}
    >
      <span className="flex items-center gap-n2 truncate text-sm">
        {lead}
        {title}
      </span>
      <span className="truncate text-2xs text-muted-foreground">{detail}</span>
    </button>
  )
}

const stock = (profile: Profile): string =>
  `${profile.labelWidthMm} × ${profile.labelHeightMm} mm · ${copy.profiles.density} ${profile.density}`

export function PrintStep(props: PrintStepProps): React.JSX.Element {
  const sources = useDataSources()
  const boundSource = sources.data?.find((source) => source.id === props.dataSourceId)
  const linkedSource = boundSource !== undefined && isFetched(boundSource) ? boundSource : undefined
  const keyColumn = boundSource?.keyColumn ?? null
  /** Fired on arrival, for a table that asked for it. */
  const auto = useAutoRefresh(boundSource)
  const [selectionCleared, setSelectionCleared] = useState(false)

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="scrollbar-themed mx-auto flex w-full max-w-3xl min-h-0 flex-1 flex-col gap-n8 overflow-y-auto pt-n4 pr-2">
        <h1 className="text-xl font-medium">{copy.flow.steps.print}</h1>

        {props.notices.length > 0 && (
          <Alert variant="warning" data-preset-notices>
            {props.notices.join(' ')}
          </Alert>
        )}

        <section className="flex flex-col gap-n3" aria-label={copy.print.printer}>
          <h2 className="text-xs font-medium text-muted-foreground">{copy.print.printer}</h2>
          <div className="flex flex-wrap gap-n3" role="radiogroup" aria-label={copy.print.printer}>
            {props.printers.map((printer) => (
              <Card
                key={printer.id}
                name={`printer:${printer.id}`}
                chosen={printer.id === props.printerId}
                onChoose={() => props.onPrinter(printer.id)}
                title={printer.name}
                lead={<Dot live={printer.capabilities !== null && printer.queueState === 'running'} />}
                detail={
                  printer.capabilities === null
                    ? copy.status.notProbed
                    : [
                        printer.capabilities.model ?? printer.kind,
                        `${printer.capabilities.dpi} dpi`,
                        printer.capabilities.supportsConsumableLevel
                          ? copy.status.remainingSupported
                          : copy.status.remainingUnsupported,
                      ].join(' · ')
                }
              />
            ))}
            {props.printers.length === 0 && (
              <p className="text-xs text-muted-foreground">{copy.status.noPrinters}</p>
            )}
          </div>
        </section>

        <section className="flex flex-col gap-n3" aria-label={copy.profiles.heading}>
          <h2 className="text-xs font-medium text-muted-foreground">{copy.profiles.heading}</h2>
          <div className="flex flex-wrap gap-n3" role="radiogroup" aria-label={copy.profiles.heading}>
            {props.profiles.map((profile) => (
              <Card
                key={profile.id}
                name={`profile:${profile.id}`}
                chosen={profile.id === props.profileId}
                onChoose={() => props.onProfile(profile.id)}
                title={profile.name}
                detail={stock(profile)}
              />
            ))}
            {/* Deferring to the machine is a choice like any other, so it is a
                card like any other rather than an empty selector. */}
            <Card
              name="profile:none"
              chosen={props.profileId === null}
              onChoose={() => props.onProfile(null)}
              title={copy.presets.profileDefault}
              detail={copy.presets.profileDefaultDetail}
            />
          </div>
        </section>

        {props.dataSourceId !== null && (
          <section className="flex flex-col gap-n3" aria-label={copy.rowSelection.heading}>
            {linkedSource !== undefined && (
              <div data-print-refresh>
                <RefreshButton
                  source={linkedSource}
                  onApplied={() => {
                    // A selection made by key survives — the keys still name
                    // the same rows however the table moved. One made by
                    // position cannot: those numbers now point elsewhere.
                    if (props.selection.kind !== 'keys') {
                      props.onSelection({ kind: 'explicit', ordinals: [] })
                      setSelectionCleared(true)
                    }
                  }}
                />
                {auto.failed && (
                  <p className="pt-n2 text-2xs text-warning" data-auto-refresh-failed>
                    {copy.dataSources.autoRefreshFailed}
                  </p>
                )}
                {selectionCleared && (
                  <p className="pt-n2 text-2xs text-muted-foreground" data-selection-cleared>
                    {copy.dataSources.refreshClearedSelection}
                  </p>
                )}
              </div>
            )}
            <RowSelectionPanel
              dataSourceId={props.dataSourceId}
              selection={props.selection}
              onChange={props.onSelection}
              copies={props.copies}
              keyOf={keyColumn === null ? undefined : (ordinal) => props.keyByOrdinal.get(ordinal)}
              onRowsLoaded={(rows) => {
                if (keyColumn === null) {
                  return
                }
                props.onRowKeys((current) => {
                  const next = new Map(current)
                  for (const row of rows) {
                    const key = row.values[keyColumn]
                    if (key !== undefined) {
                      next.set(row.ordinal, key)
                    }
                  }
                  // Same map when nothing was added, so this cannot loop.
                  return next.size === current.size ? current : next
                })
              }}
            />
          </section>
        )}
      </div>

      {/*
        The bar carries the count because the count is what the copies field
        changes: press + and the number beside it moves. Nothing is placed
        below the table — that is the one thing on this page that grows.
      */}
      <div className="flex shrink-0 items-center gap-n3 border-t border-border pt-3">
        <Button variant="outline" size="sm" onClick={props.onBack}>
          {copy.flow.previous}
        </Button>
        <div className="ml-auto flex items-center gap-n4">
          <div className="flex items-center gap-n3">
            <span className="text-xs text-muted-foreground">{copy.print.copiesPerRow}</span>
            <div className="flex items-center">
              <Button
                variant="outline"
                size="icon"
                className="rounded-r-none"
                aria-label={copy.common.decrease}
                disabled={props.copies <= 1}
                onClick={() => props.onCopies(Math.max(1, props.copies - 1))}
              >
                <Minus />
              </Button>
              <Input
                aria-label={copy.print.copiesPerRow}
                type="number"
                min={1}
                max={100}
                value={props.copies}
                onChange={(event) => props.onCopies(Math.max(1, Number(event.target.value) || 1))}
                className="h-9 w-14 rounded-none border-x-0 text-center"
              />
              <Button
                variant="outline"
                size="icon"
                className="rounded-l-none"
                aria-label={copy.common.increase}
                onClick={() => props.onCopies(props.copies + 1)}
              >
                <Plus />
              </Button>
            </div>
          </div>
          <span className="text-xs text-muted-foreground" data-tally>
            {copy.print.tally(props.tally.labels, props.tally.seconds)}
          </span>
          <Button
            size="sm"
            variant="outline"
            className="border-primary text-accent-300"
            disabled={props.blocked !== null}
            title={props.blocked ?? undefined}
            onClick={props.onContinue}
            data-continue
          >
            {copy.flow.next}
          </Button>
        </div>
      </div>

      {props.blocked !== null && (
        <p className="shrink-0 pt-n2 text-right text-2xs text-muted-foreground" data-blocked>
          {props.blocked}
        </p>
      )}
    </div>
  )
}
