/**
 * The labels page — the home page, and the only list of labels.
 *
 * A strip of what the machines are doing, then a gallery. Each tile is a
 * sheet of paper at the label's own proportions (thumbnail-box.ts), drawn
 * from the label's content with the first row of its table filled in
 * (thumbnail-svg.tsx). Unsaved work sits at the top, marked. Clicking a tile
 * opens the editor; there is no "open" button, because the tile is the thing.
 *
 * Deliberately never counts. A number in the heading turns a shelf of labels
 * into a metric, and nobody here is trying to have more of them.
 */
import { useMemo, useState } from 'react'
import { LayoutTemplate } from 'lucide-react'
import { collectReferences } from '@zenith/shared'
import { copy } from '../i18n/index.ts'
import { cn } from '../lib/utils.ts'
import { PageHeader } from '../components/page-header.tsx'
import { Button } from '../components/ui/button.tsx'
import { ConfirmButton } from '../components/ui/confirm-button.tsx'
import { Input } from '../components/ui/input.tsx'
import { Skeleton } from '../components/ui/skeleton.tsx'
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
import { useDrafts } from '../features/drafts/use-draft.tsx'

/** The budget a tile's paper is fitted into. */
const TILE = { maxWidthPx: 240, maxHeightPx: 140 }

function Paper({ item }: { item: GalleryItem }): React.JSX.Element {
  const ir = tileIr(item)
  const dataSourceId = item.template?.dataSourceId ?? null
  const firstRow = useFirstRow(dataSourceId)
  const box = thumbnailBoxPx(item, TILE)
  const values = useMemo(
    () => (ir === null ? {} : thumbnailValues(item.template!.variables, firstRow, collectReferences(ir))),
    [ir, item.template, firstRow],
  )
  return (
    <div
      className="paper mx-auto flex items-center justify-center overflow-hidden"
      style={{ width: box.widthPx, height: box.heightPx }}
      data-thumbnail-frame
    >
      {ir !== null && <ThumbnailSvg ir={ir} values={values} name={item.name ?? copy.labels.untitled} />}
    </div>
  )
}

function Tile({ item }: { item: GalleryItem }): React.JSX.Element {
  const { open } = useWorkspace()
  const rename = useRenameTemplate()
  const remove = useDeleteTemplate()
  const { store } = useDrafts()
  const sources = useDataSources()
  const [renaming, setRenaming] = useState<string | null>(null)
  // The bound source's *current* name, looked up rather than stored: a label
  // binds by id, so the name it was bound under can already be out of date.
  const boundName =
    item.template === null || item.template.dataSourceId === null
      ? undefined
      : sources.data?.find((source) => source.id === item.template!.dataSourceId)?.name

  const unsaved = item.kind !== 'saved'
  const name = item.name ?? copy.labels.untitled
  const openIt = (): void =>
    open(
      item.templateId === null
        ? { kind: 'label', templateId: null, draftId: item.key }
        : { kind: 'label', templateId: item.templateId, ...(item.kind === 'orphan-draft' ? { draftId: item.key } : {}) },
    )

  return (
    <div
      className={cn('flex flex-col gap-n3 rounded-md p-n3', 'hover:bg-foreground/4')}
      data-gallery-tile={item.key}
      data-unsaved={unsaved ? 'true' : undefined}
    >
      {/* The tile is the thing: name and paper are one button. */}
      <button
        type="button"
        className="flex h-[152px] w-full items-center justify-center rounded-md focus-visible:outline-2"
        onClick={openIt}
        aria-label={name}
        disabled={item.kind === 'corrupt-draft'}
      >
        <Paper item={item} />
      </button>

      <div className="flex flex-col gap-n1">
        {renaming !== null && item.templateId !== null ? (
          <div className="flex items-center gap-2">
            <Input aria-label={copy.templates.name} value={renaming} onChange={(e) => setRenaming(e.target.value)} />
            <Button
              size="sm"
              disabled={renaming.trim() === ''}
              onClick={() => {
                rename.mutate({ id: item.templateId!, name: renaming.trim() })
                setRenaming(null)
              }}
            >
              {copy.common.save}
            </Button>
            <span className="text-2xs text-muted-foreground">{copy.templates.renameHint}</span>
          </div>
        ) : (
          <button type="button" className="flex items-center gap-n2 text-left text-sm" onClick={openIt} aria-label={name}>
            <span className="truncate">{name}</span>
            {unsaved && <span aria-hidden className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />}
          </button>
        )}
        <p className="flex flex-wrap gap-x-n3 text-2xs text-muted-foreground" data-label-size>
          <span className="num">
            {item.widthMm} × {item.heightMm} mm
          </span>
          {item.kind === 'unsaved-new' && <span className="text-accent-300">{copy.labels.unsaved}</span>}
          {item.kind === 'saved-with-draft' && <span className="text-accent-300">{copy.labels.savedWithDraft}</span>}
          {item.kind === 'orphan-draft' && <span className="text-warning">{copy.labels.orphan}</span>}
          {item.kind === 'corrupt-draft' && <span className="text-destructive">{copy.labels.corrupt}</span>}
        </p>
        {item.template !== null && (
          <p className="text-2xs text-muted-foreground" data-bound-source>
            {item.template.dataSourceId === null
              ? copy.templates.boundSourceNone
              : copy.templates.boundSource(boundName ?? item.template.dataSourceId)}
          </p>
        )}
        {/* Computed on read, never stored — a stored copy drifts towards
            "looks fine, is actually broken" (FR-028a). */}
        {item.template !== null && item.template.bindingIssue !== null && (
          <p className="text-2xs text-destructive" data-binding-issue>
            {'! '}
            {item.template.bindingIssue.kind === 'sourceMissing'
              ? copy.dataSources.bindingMissing
              : copy.dataSources.bindingColumns(item.template.bindingIssue.columns)}
          </p>
        )}
      </div>

      {item.templateId !== null && item.kind !== 'orphan-draft' && (
        <div className="flex flex-wrap gap-1">
          <Button size="sm" variant="ghost" onClick={() => setRenaming(item.name ?? '')}>
            {copy.templates.rename}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => void exportTemplates([item.templateId!], `${name}.json`)}>
            {copy.templates.export}
          </Button>
          <ConfirmButton
            size="sm"
            variant="ghost"
            title={copy.common.confirmTitle}
            description={copy.templates.confirmDelete}
            cancelLabel={copy.common.cancel}
            confirmLabel={copy.templates.remove}
            onConfirm={() => {
              remove.mutate(item.templateId!)
              store.remove(item.key)
            }}
          >
            {copy.templates.remove}
          </ConfirmButton>
        </div>
      )}
      {(item.kind === 'corrupt-draft' || item.kind === 'orphan-draft') && (
        <div className="flex flex-wrap gap-1">
          <Button size="sm" variant="ghost" onClick={() => store.remove(item.key)}>
            {copy.labels.discardDraft}
          </Button>
        </div>
      )}
    </div>
  )
}

export function LabelsPage(): React.JSX.Element {
  const { open } = useWorkspace()
  const templates = useTemplates()
  const printers = usePrinters()
  const jobs = useJobs(null)
  const { store } = useDrafts()
  const [query, setQuery] = useState('')
  // Read on every render: the store is synchronous and the list is small,
  // and a cached copy is exactly how a cleared draft would keep its tile.
  const drafts = store.list()

  const summary = useMemo(() => summarize(printers.data, jobs.data), [printers.data, jobs.data])
  const items = useMemo(
    () => galleryItems(templates.data ?? [], drafts.entries, drafts.corrupt),
    [templates.data, drafts.entries, drafts.corrupt],
  )
  const visible = items.filter(
    (item) => query === '' || (item.name ?? copy.labels.untitled).toLowerCase().includes(query.toLowerCase()),
  )

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={copy.labels.heading}
        actions={
          <>
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
          </>
        }
      />

      <PausedQueueBanner />
      <StatusStrip summary={summary} loading={{ printers: printers.isPending, jobs: jobs.isPending }} />

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
