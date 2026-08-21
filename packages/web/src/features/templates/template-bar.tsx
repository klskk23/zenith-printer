/**
 * Template save / load strip.
 *
 * Saving carries the `version` the design was loaded with, so a concurrent
 * edit produces a clear conflict rather than silently discarding somebody's
 * work. Last write wins is acceptable; last write wins *unannounced* is not.
 */
import { useState } from 'react'
import { ApiRequestError } from '../../api/client.ts'
import { copy } from '../../i18n/index.ts'
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
        : { id: current.id, version: current.version, body },
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

      {/*
        The server already worded this, so it is shown verbatim — rewording it
        here would give one fault two descriptions. The reload button is the
        one thing the server cannot offer: FR-081 wants a way back, and FR-082
        wants the current edits left alone until the user asks.
      */}
      {save.error instanceof ApiRequestError && (
        <Alert variant="destructive">
          <p className="font-medium">{save.error.body.what}</p>
          <p className="mt-1 text-xs opacity-90">{save.error.body.why}</p>
          <p className="mt-1 text-xs font-medium">{save.error.body.next}</p>
          {conflict && current !== null && (
            <Button
              size="sm"
              variant="outline"
              className="mt-2"
              onClick={() => {
                // Explicit, never automatic: reloading replaces what is on
                // screen, and that is the user's call to make.
                const latest = templates.data?.find((t) => t.id === current.id)
                if (latest !== undefined) {
                  void templates.refetch().then(() => {
                    const fresh = templates.data?.find((t) => t.id === current.id) ?? latest
                    onLoad(fresh)
                  })
                }
              }}
            >
              {copy.templates.reload}
            </Button>
          )}
        </Alert>
      )}
    </div>
  )
}
