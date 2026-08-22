/**
 * Template library.
 *
 * Opening a template does not edit it here — it opens a design tab, which is
 * the same editor used for one-off labels. One editor, two ways in.
 */
import { useState } from 'react'
import { copy } from '../i18n/index.ts'
import { Alert } from '../components/ui/alert.tsx'
import { Button } from '../components/ui/button.tsx'
import { ConfirmButton } from '../components/ui/confirm-button.tsx'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card.tsx'
import { Input } from '../components/ui/input.tsx'
import {
  thumbnailUrl,
  useDeleteTemplate,
  useRenameTemplate,
  useTemplates,
  type Template,
} from '../features/templates/hooks.ts'
import { useDataSources } from '../features/data-sources/hooks.ts'
import { thumbnailBoxPx } from '../features/templates/thumbnail-box.ts'
import { useWorkspace } from '../app/workspace.tsx'

function matches(template: Template, query: string): boolean {
  return query === '' || template.name.toLowerCase().includes(query.toLowerCase())
}

/**
 * The design's picture, sized to the label's own shape.
 *
 * Drawn when the design was saved, not on every visit: the library lists every
 * template at once, and rendering each card on demand is a resvg pass per
 * card, per visit, for a picture that only changes when somebody edits the
 * design.
 *
 * The frame takes the label's proportions rather than being one fixed box — a
 * 100 x 10 strip letterboxed into a square is a hairline in an empty frame,
 * and a portrait label is a sliver. Its size is fixed before the image
 * arrives, so a shelf of cards does not jump as they load.
 */
function ThumbnailFrame({ template }: { template: Template }): React.JSX.Element {
  const box = thumbnailBoxPx(template, { maxWidthPx: 96, maxHeightPx: 56 })
  return (
    <div
      className="flex shrink-0 items-center justify-center overflow-hidden rounded border border-border bg-white"
      style={{ width: box.widthPx, height: box.heightPx }}
      data-thumbnail-frame
      title={template.hasThumbnail ? undefined : copy.templates.thumbnailMissing}
    >
      {template.hasThumbnail ? (
        <img
          src={thumbnailUrl(template)}
          alt={copy.templates.thumbnailAlt(template.name)}
          loading="lazy"
          className="max-h-full max-w-full object-contain"
          data-thumbnail
        />
      ) : (
        // No room for a sentence at this size, so the frame carries the
        // explanation as its tooltip and shows the shape alone.
        <span className="text-[11px] text-muted-foreground" data-no-thumbnail aria-hidden>
          —
        </span>
      )}
    </div>
  )
}

export function TemplatesPage(): React.JSX.Element {
  const { open } = useWorkspace()
  const templates = useTemplates()
  const remove = useDeleteTemplate()
  const rename = useRenameTemplate()
  const sources = useDataSources()
  const [query, setQuery] = useState('')
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [draftName, setDraftName] = useState('')

  /**
   * The bound source's *current* name, looked up rather than stored.
   *
   * A design binds by id, so the name it was bound under can already be
   * out of date. `undefined` means the source is gone, which the binding
   * warning below says properly — this line stays quiet about it rather than
   * saying it a second time in weaker words.
   */
  const boundName = (template: Template): string | undefined =>
    template.dataSourceId === null
      ? undefined
      : sources.data?.find((source) => source.id === template.dataSourceId)?.name

  const visible = (templates.data ?? []).filter((template) => matches(template, query))

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold">{copy.workspace.tabs.templates}</h2>
        <Input
          className="max-w-56"
          value={query}
          placeholder={copy.templates.searchPlaceholder}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>

      {templates.isPending && <p className="text-xs text-muted-foreground">{copy.common.loading}</p>}
      {templates.data?.length === 0 && <Alert>{copy.index.noTemplates}</Alert>}

      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
        {visible.map((template) => (
          <Card key={template.id}>
            <CardHeader className="pb-2">
              {/*
                Title on the left, picture on the right. Beside the name rather
                than above the details: the name and the shape are the two
                things a glance at a library is looking for, and putting the
                picture in the body pushed everything that says what the design
                *does* below the fold of the card.
              */}
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1 space-y-1">
                  {renamingId === template.id ? (
                    <div className="flex items-center gap-2">
                      <Input
                        aria-label={copy.templates.name}
                        value={draftName}
                        onChange={(event) => setDraftName(event.target.value)}
                      />
                      <Button
                        size="sm"
                        disabled={draftName.trim() === ''}
                        onClick={() => {
                          rename.mutate({ id: template.id, name: draftName.trim() })
                          setRenamingId(null)
                        }}
                      >
                        {copy.common.save}
                      </Button>
                    </div>
                  ) : (
                    <CardTitle className="truncate">{template.name}</CardTitle>
                  )}
                  {/*
                    Millimetres only. The dpi and the printer kind used to be
                    shown here as though they said where this design could be
                    printed; neither does any more — the dot grid comes from
                    whichever printer it is sent to, and both drivers take a
                    bitmap. Leaving them on the card is what led people to
                    re-save a design that was never wrong.
                  */}
                  <p className="text-[11px] text-muted-foreground" data-label-size>
                    {template.widthMm} × {template.heightMm} mm
                  </p>
                </div>

                <ThumbnailFrame template={template} />
              </div>
            </CardHeader>
            <CardContent className="space-y-2">
              {/*
                Which table this design prints from — the thing worth knowing at
                a glance, now that there are no variable fields to count. Bound
                by id, so the name is looked up fresh every render.
              */}
              <p className="text-[11px] text-muted-foreground" data-bound-source>
                {template.dataSourceId === null
                  ? copy.templates.boundSourceNone
                  : copy.templates.boundSource(boundName(template) ?? template.dataSourceId)}
              </p>
              {/*
                The design cannot resolve its references right now. Computed on
                read from the data source's current state, never stored — a
                stored copy drifts towards "looks fine, is actually broken"
                (FR-028a).
              */}
              {template.bindingIssue !== null && (
                <p className="text-[11px] text-destructive" data-binding-issue>
                  {'! '}
                  {template.bindingIssue.kind === 'sourceMissing'
                    ? copy.dataSources.bindingMissing
                    : copy.dataSources.bindingColumns(template.bindingIssue.columns)}
                </p>
              )}
              <div className="flex flex-wrap gap-1.5">
                <Button size="sm" onClick={() => open({ kind: 'design', templateId: template.id })}>
                  {copy.templates.open}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setRenamingId(template.id)
                    setDraftName(template.name)
                  }}
                >
                  {copy.templates.rename}
                </Button>
                <ConfirmButton
                  size="sm"
                  variant="ghost"
                  title={copy.common.confirmTitle}
                  description={copy.templates.confirmDelete}
                  cancelLabel={copy.common.cancel}
                  confirmLabel={copy.templates.remove}
                  onConfirm={() => remove.mutate(template.id)}
                >
                  {copy.templates.remove}
                </ConfirmButton>
              </div>
              {renamingId === template.id && (
                <p className="text-[11px] text-muted-foreground">{copy.templates.renameHint}</p>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  )
}
