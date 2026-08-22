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
import { useDeleteTemplate, useTemplates, type Template } from '../features/templates/hooks.ts'
import { useWorkspace } from '../app/workspace.tsx'

function matches(template: Template, query: string): boolean {
  return query === '' || template.name.toLowerCase().includes(query.toLowerCase())
}

export function TemplatesPage(): React.JSX.Element {
  const { open } = useWorkspace()
  const templates = useTemplates()
  const remove = useDeleteTemplate()
  const [query, setQuery] = useState('')

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
              <CardTitle>{template.name}</CardTitle>
              <p className="text-[11px] text-muted-foreground">
                {template.widthMm} × {template.heightMm} mm · {template.dpi} dpi · {template.printerKind}
              </p>
            </CardHeader>
            <CardContent className="space-y-2">
              <p className="text-[11px] text-muted-foreground">
                {copy.templates.fieldCount(template.variables.length)}
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
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  )
}
