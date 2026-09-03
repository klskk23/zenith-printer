/**
 * Template library.
 *
 * Opening a template does not edit it here — it opens a design tab, which is
 * the same editor used for one-off labels. One editor, two ways in.
 */
import { useState } from 'react'
import { copy } from '../i18n/index.ts'
import { LayoutTemplate } from 'lucide-react'
import { PageHeader } from '../components/page-header.tsx'
import { Skeleton } from '../components/ui/skeleton.tsx'
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '../components/ui/empty.tsx'
import { Button } from '../components/ui/button.tsx'
import { ConfirmButton } from '../components/ui/confirm-button.tsx'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card.tsx'
import { Input } from '../components/ui/input.tsx'
import {
  useDeleteTemplate,
  useRenameTemplate,
  useTemplates,
  type Template,
} from '../features/templates/hooks.ts'
import { useDataSources } from '../features/data-sources/hooks.ts'
import { ThumbnailFrame } from '../features/templates/thumbnail-frame.tsx'
import { ImportTemplatesButton, exportTemplates } from '../features/templates/template-io.tsx'
import { useWorkspace } from '../app/workspace.tsx'

function matches(template: Template, query: string): boolean {
  return query === '' || template.name.toLowerCase().includes(query.toLowerCase())
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
    <div className="flex flex-col gap-4">
      <PageHeader
        title={copy.workspace.tabs.templates}
        actions={
          <>
            <Input
              className="max-w-56"
              value={query}
              placeholder={copy.templates.searchPlaceholder}
              onChange={(event) => setQuery(event.target.value)}
            />
            <Button
              size="sm"
              variant="outline"
              disabled={(templates.data ?? []).length === 0}
              onClick={() => void exportTemplates([], 'zenith-templates.json')}
            >
              {copy.templates.exportAll}
            </Button>
            <ImportTemplatesButton />
          </>
        }
      />

      {/* Cards, not a line of text: the grid below is cards, and a loading
          state shaped like the thing it is standing in for does not make the
          page jump when the answer arrives. */}
      {templates.isPending && (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(18rem,1fr))] gap-3">
          {Array.from({ length: 3 }, (_unused, index) => (
            <Skeleton key={index} className="h-56" />
          ))}
        </div>
      )}

      {templates.data?.length === 0 && (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <LayoutTemplate />
            </EmptyMedia>
            <EmptyTitle>{copy.templates.empty}</EmptyTitle>
            <EmptyDescription>{copy.templates.emptyDetail}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}

      {/*
        As many cards as fit, never narrower than the floor. Fixed column
        counts gave three very wide cards on a large screen, each holding a
        small label in a lot of nothing; `auto-fill` puts four or five across a
        full-screen window and drops to one on a narrow one, without a
        breakpoint per size. The floor is what stops it from squeezing the
        cards down to where the name no longer fits on a line.
      */}
      <div className="grid grid-cols-[repeat(auto-fill,minmax(18rem,1fr))] gap-3">
        {visible.map((template) => (
          <Card key={template.id}>
            <CardHeader className="pb-2">
              <div className="flex min-w-0 flex-col gap-1">
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
                <p className="text-2xs text-muted-foreground" data-label-size>
                  {template.widthMm} × {template.heightMm} mm
                </p>
              </div>
            </CardHeader>
            <CardContent className="flex flex-col gap-2">
              <ThumbnailFrame template={template} />
              {/*
                Which table this design prints from — the thing worth knowing at
                a glance, now that there are no variable fields to count. Bound
                by id, so the name is looked up fresh every render.
              */}
              <p className="text-2xs text-muted-foreground" data-bound-source>
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
                <p className="text-2xs text-destructive" data-binding-issue>
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
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => void exportTemplates([template.id], `${template.name}.json`)}
                >
                  {copy.templates.export}
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
                <p className="text-2xs text-muted-foreground">{copy.templates.renameHint}</p>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  )
}
