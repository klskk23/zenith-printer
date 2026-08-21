/**
 * Template save / load strip.
 *
 * Saving carries the `updatedAt` the design was loaded with, so a concurrent
 * edit produces a clear conflict rather than silently discarding somebody's
 * work. Last write wins is acceptable; last write wins *unannounced* is not.
 */
import { useState } from 'react'
import { ApiRequestError } from '../../api/client.ts'
import { copy } from '../../i18n/zh-CN.ts'
import { Alert } from '../../components/ui/alert.tsx'
import { Button } from '../../components/ui/button.tsx'
import { Input } from '../../components/ui/input.tsx'
import { Select } from '../../components/ui/select.tsx'
import { useDeleteTemplate, useSaveTemplate, useTemplates, type Template } from './hooks.ts'

export interface TemplateBarProps {
  current: Template | null
  buildBody: () => Record<string, unknown>
  onLoad: (template: Template) => void
  onSaved: (template: Template) => void
}

export function TemplateBar({ current, buildBody, onLoad, onSaved }: TemplateBarProps): React.JSX.Element {
  const templates = useTemplates()
  const save = useSaveTemplate()
  const remove = useDeleteTemplate()
  const [name, setName] = useState('')

  const conflict = save.error instanceof ApiRequestError && save.error.status === 409

  const doSave = (asNew: boolean): void => {
    const body = { ...buildBody(), name: name || current?.name || 'label' }
    save.mutate(
      asNew || current === null
        ? { body }
        : { id: current.id, updatedAt: current.updatedAt, body },
      { onSuccess: onSaved },
    )
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-end gap-2">
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">{copy.templates.load}</label>
          <Select
            value={current?.id ?? ''}
            onChange={(event) => {
              const found = templates.data?.find((t) => t.id === event.target.value)
              if (found !== undefined) {
                onLoad(found)
                setName(found.name)
              }
            }}
          >
            <option value="">—</option>
            {templates.data?.map((template) => (
              <option key={template.id} value={template.id}>
                {template.name}
              </option>
            ))}
          </Select>
        </div>

        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">{copy.templates.name}</label>
          <Input value={name} onChange={(event) => setName(event.target.value)} className="w-48" />
        </div>

        <Button size="sm" disabled={save.isPending} onClick={() => doSave(current === null)}>
          {current === null ? copy.templates.save : copy.templates.update}
        </Button>
        {current !== null && (
          <>
            <Button size="sm" variant="outline" disabled={save.isPending} onClick={() => doSave(true)}>
              {copy.templates.saveAs}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                if (window.confirm(copy.templates.confirmRemove)) {
                  remove.mutate(current.id)
                }
              }}
            >
              {copy.templates.remove}
            </Button>
          </>
        )}
      </div>

      {conflict && <Alert variant="destructive">{copy.templates.conflict}</Alert>}
      {save.error instanceof ApiRequestError && !conflict && (
        <Alert variant="destructive">
          <p className="font-medium">{save.error.body.what}</p>
          <p className="mt-1 text-xs">{save.error.body.next}</p>
        </Alert>
      )}
    </div>
  )
}
