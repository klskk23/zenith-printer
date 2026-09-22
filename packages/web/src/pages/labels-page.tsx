/**
 * The labels page — the home page, and the only list of labels.
 *
 * A strip of what the queue is doing, then a gallery. Each tile is a sheet of
 * paper at the label's own proportions (thumbnail-box.ts), drawn from the
 * label's content with the first row of its table filled in
 * (thumbnail-svg.tsx). Clicking a tile opens the editor; there is no "open"
 * button, because the tile is the thing.
 *
 * Deliberately never counts. A number in the heading turns a shelf of labels
 * into a metric, and nobody here is trying to have more of them.
 */
import { useMemo, useState } from 'react'
import { LayoutTemplate } from 'lucide-react'
import { collectReferences } from '@zenith/shared'
import { copy } from '../i18n/index.ts'
import { Button } from '../components/ui/button.tsx'
import { ConfirmButton } from '../components/ui/confirm-button.tsx'
import { Input } from '../components/ui/input.tsx'
import { Skeleton } from '../components/ui/skeleton.tsx'
import { StepBar } from '../app/step-bar.tsx'
import { stepsFor } from '../features/print/flow.ts'
import { Separator } from '../components/ui/separator.tsx'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '../components/ui/empty.tsx'
import { useWorkspace } from '../app/workspace.tsx'
import { StatusStrip } from '../app/status-strip.tsx'
import { summarize } from '../app/status-summary.ts'
import { usePrinters } from '../features/printers/hooks.ts'
import { useJobs } from '../features/jobs/hooks.ts'
import { PausedQueueBanner } from '../features/jobs/paused-banner.tsx'
import { useDeleteTemplate, useFirstRow, useRenameTemplate, useTemplates } from '../features/templates/hooks.ts'
import { useDataSources } from '../features/data-sources/hooks.ts'
import { ImportTemplatesButton, exportTemplates } from '../features/templates/template-io.tsx'
import { galleryItems, tileIr, type GalleryItem } from '../features/templates/gallery-items.ts'
import { thumbnailBoxPx } from '../features/templates/thumbnail-box.ts'
import { thumbnailValues } from '../features/templates/thumbnail-values.ts'
import { ThumbnailSvg } from '../features/templates/thumbnail-svg.tsx'

/** The budget a tile's paper is fitted into. */
const TILE = { maxWidthPx: 240, maxHeightPx: 140 }

function Paper({ item }: { item: GalleryItem }): React.JSX.Element {
  const ir = tileIr(item)
  const firstRow = useFirstRow(item.template.dataSourceId)
  const box = thumbnailBoxPx(item, TILE)
  const values = useMemo(
    () => thumbnailValues(item.template.variables, firstRow, collectReferences(ir)),
    [ir, item.template.variables, firstRow],
  )
  return (
    <div
      className="paper mx-auto flex items-center justify-center overflow-hidden"
      style={{ width: box.widthPx, height: box.heightPx }}
      data-thumbnail-frame
    >
      <ThumbnailSvg ir={ir} values={values} name={item.name} />
    </div>
  )
}

function Tile({ item }: { item: GalleryItem }): React.JSX.Element {
  const { open } = useWorkspace()
  const rename = useRenameTemplate()
  const remove = useDeleteTemplate()
  const sources = useDataSources()
  const [renaming, setRenaming] = useState<string | null>(null)
  // The bound source's *current* name, looked up rather than stored: a label
  // binds by id, so the name it was bound under can already be out of date.
  const boundName =
    item.template.dataSourceId === null
      ? undefined
      : sources.data?.find((source) => source.id === item.template.dataSourceId)?.name
  const openIt = (): void => open({ kind: 'label', templateId: item.key })

  return (
    <div className="flex flex-col gap-n3 rounded-md p-n3 hover:bg-foreground/4" data-gallery-tile={item.key}>
      {/* The tile is the thing: name and paper are one button. */}
      <button
        type="button"
        className="flex h-[152px] w-full items-center justify-center rounded-md focus-visible:outline-2"
        onClick={openIt}
        aria-label={item.name}
      >
        <Paper item={item} />
      </button>

      <div className="flex flex-col gap-n1">
        {renaming !== null ? (
          <div className="flex items-center gap-2">
            <Input aria-label={copy.templates.name} value={renaming} onChange={(e) => setRenaming(e.target.value)} />
            <Button
              size="sm"
              disabled={renaming.trim() === ''}
              onClick={() => {
                rename.mutate({ id: item.key, name: renaming.trim() })
                setRenaming(null)
              }}
            >
              {copy.common.save}
            </Button>
          </div>
        ) : (
          <button type="button" className="truncate text-left text-sm" onClick={openIt} aria-label={item.name}>
            {item.name}
          </button>
        )}
        <p className="num text-2xs text-muted-foreground" data-label-size>
          {item.widthMm} × {item.heightMm} mm
        </p>
        <p className="text-2xs text-muted-foreground" data-bound-source>
          {item.template.dataSourceId === null
            ? copy.templates.boundSourceNone
            : copy.templates.boundSource(boundName ?? item.template.dataSourceId)}
        </p>
        {/* Computed on read, never stored — a stored copy drifts towards
            "looks fine, is actually broken" (FR-028a). */}
        {item.template.bindingIssue !== null && (
          <p className="text-2xs text-destructive" data-binding-issue>
            {'! '}
            {item.template.bindingIssue.kind === 'sourceMissing'
              ? copy.dataSources.bindingMissing
              : copy.dataSources.bindingColumns(item.template.bindingIssue.columns)}
          </p>
        )}
      </div>

      <div className="flex flex-wrap gap-1" data-tile-actions>
        {/* First, because it is what most days are for: this label, those
            rows, that machine. Laying the label out is the rarer errand. */}
        <Button
          size="sm"
          variant="ghost"
          onClick={() => open({ kind: 'label-print', templateId: item.key })}
        >
          {copy.flow.steps.print}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setRenaming(item.name)}>
          {copy.templates.rename}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => void exportTemplates([item.key], `${item.name}.json`)}>
          {copy.templates.export}
        </Button>
        <ConfirmButton
          size="sm"
          variant="ghost"
          title={copy.common.confirmTitle}
          description={copy.templates.confirmDelete}
          cancelLabel={copy.common.cancel}
          confirmLabel={copy.templates.remove}
          onConfirm={() => remove.mutate(item.key)}
        >
          {copy.templates.remove}
        </ConfirmButton>
      </div>
    </div>
  )
}

export function LabelsPage(): React.JSX.Element {
  const { open } = useWorkspace()
  const templates = useTemplates()
  const printers = usePrinters()
  const jobs = useJobs(null)
  const [query, setQuery] = useState('')

  const summary = useMemo(() => summarize(printers.data, jobs.data), [printers.data, jobs.data])
  const items = useMemo(() => galleryItems(templates.data ?? []), [templates.data])
  const visible = items.filter((item) => query === '' || item.name.toLowerCase().includes(query.toLowerCase()))

  return (
    <div className="flex flex-col gap-4">
      {/*
        The first of the four steps. It says where this is — which is why the
        page carries no title of its own — and it does not hold anybody back:
        every tile below offers both the editor and the print step.
      */}
      <StepBar steps={stepsFor({ page: 'labels', canSubmit: false })} onGo={() => undefined} />

      {/*
        No page title: the step bar above already says 「标签」, and a heading
        repeating it is furniture. The line it occupied goes to the only thing
        here that changes — the queue, and how the last print went.
      */}
      <div className="flex min-h-9 items-center gap-n3" data-labels-head>
        <StatusStrip summary={summary} loading={jobs.isPending} />
        <div className="ml-auto flex shrink-0 items-center gap-2">
          <Input
              className="max-w-56"
              value={query}
              placeholder={copy.labels.searchPlaceholder}
              onChange={(event) => setQuery(event.target.value)}
            />
          <Button
            size="sm"
            variant="outline"
            disabled={(templates.data ?? []).length === 0}
            onClick={() => void exportTemplates([], 'zenith-labels.json')}
          >
            {copy.templates.exportAll}
          </Button>
          <ImportTemplatesButton />
          <Button size="sm" onClick={() => open({ kind: 'label', templateId: null })}>
            {copy.labels.new}
          </Button>
        </div>
      </div>

      {/* A rule between the head and the labels — fading at the ends, so it
          reads as a pause rather than a box edge. */}
      <Separator fade />
      <PausedQueueBanner />

      {templates.isPending && (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(16rem,1fr))] gap-3">
          {Array.from({ length: 3 }, (_unused, index) => (
            <Skeleton key={index} className="h-56" />
          ))}
        </div>
      )}

      {!templates.isPending && items.length === 0 && (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <LayoutTemplate />
            </EmptyMedia>
            <EmptyTitle>{copy.labels.empty}</EmptyTitle>
            <EmptyDescription>{copy.labels.emptyDetail}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}

      {/* As many tiles as fit, never narrower than the paper budget. */}
      <div className="grid grid-cols-[repeat(auto-fill,minmax(16rem,1fr))] gap-x-n6 gap-y-n8">
        {visible.map((item) => (
          <Tile key={item.key} item={item} />
        ))}
      </div>
    </div>
  )
}
