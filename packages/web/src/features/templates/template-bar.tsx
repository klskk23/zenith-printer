/**
 * Template selection and saving, for the editor's top bar.
 *
 * Pared down to what the top bar is for: which design is open, and saving it.
 * The earlier version carried a permanent name field, three buttons and its own
 * inline error strip — a whole panel wedged into a row of dropdowns. Deleting a
 * template in particular does not belong here; it belongs in the library, next
 * to the list of what would be deleted.
 *
 * Saving carries the `version` the design was loaded with, so a concurrent edit
 * produces a clear conflict rather than silently discarding somebody's work.
 * Last write wins is acceptable; last write wins *unannounced* is not.
 */
import { useState } from 'react'
import { ApiRequestError } from '../../api/client.ts'
import { copy } from '../../i18n/index.ts'
import { Alert } from '../../components/ui/alert.tsx'
import { Button } from '../../components/ui/button.tsx'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog.tsx'
import { Input } from '../../components/ui/input.tsx'
import { Label } from '../../components/ui/label.tsx'
import { Select } from '../../components/ui/select.tsx'
import { useSaveTemplate, useTemplates, type Template } from './hooks.ts'

export interface TemplateBarProps {
  current: Template | null
  buildBody: () => Record<string, unknown>
  onLoad: (template: Template) => void
  onSaved: (template: Template) => void
}

export function TemplateBar({ current, buildBody, onLoad, onSaved }: TemplateBarProps): React.JSX.Element {
  const templates = useTemplates()
  const save = useSaveTemplate()
  const [naming, setNaming] = useState<string | null>(null)

  const conflict = save.error instanceof ApiRequestError && save.error.status === 409

  const commit = (name: string, asNew: boolean): void => {
    const body = { ...buildBody(), name }
    save.mutate(
      asNew || current === null ? { body } : { id: current.id, version: current.version, body },
      {
        onSuccess: (saved) => {
          setNaming(null)
          onSaved(saved)
        },
      },
    )
  }

  return (
    <>
      <div className="space-y-1">
        <Label>{copy.templates.heading}</Label>
        <Select
          value={current?.id ?? ''}
          onChange={(event) => {
            const found = templates.data?.find((t) => t.id === event.target.value)
            if (found !== undefined) {
              onLoad(found)
            }
          }}
        >
          <option value="">{copy.workspace.untitledDesign}</option>
          {templates.data?.map((template) => (
            <option key={template.id} value={template.id}>
              {template.name}
            </option>
          ))}
        </Select>
      </div>

      <Button
        size="sm"
        variant="outline"
        disabled={save.isPending}
        // A design with no template behind it has no name yet, so saving asks
        // for one. An existing template saves straight over itself.
        onClick={() => (current === null ? setNaming('') : commit(current.name, false))}
      >
        {current === null ? copy.templates.save : copy.templates.update}
      </Button>

      {current !== null && (
        <Button size="sm" variant="ghost" disabled={save.isPending} onClick={() => setNaming(current.name)}>
          {copy.templates.saveAs}
        </Button>
      )}

      {/* A form, so a Dialog rather than an AlertDialog — the latter is
          announced as an alert and is meant for a yes/no answer. */}
      <Dialog open={naming !== null} onOpenChange={(open) => !open && setNaming(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{copy.templates.save}</DialogTitle>
          </DialogHeader>
          <div className="space-y-1">
            <Label>{copy.templates.name}</Label>
            <Input
              autoFocus
              value={naming ?? ''}
              onChange={(event) => setNaming(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && (naming ?? '').trim().length > 0) {
                  commit(naming!.trim(), true)
                }
              }}
            />
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button size="sm" variant="outline">
                {copy.common.cancel}
              </Button>
            </DialogClose>
            <Button
              size="sm"
              disabled={(naming ?? '').trim().length === 0 || save.isPending}
              onClick={() => commit((naming ?? '').trim(), true)}
            >
              {copy.common.save}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/*
        The server already worded this, so it is shown verbatim — rewording it
        here would give one fault two descriptions. The reload button is the one
        thing the server cannot offer: FR-081 wants a way back, and FR-082 wants
        the current edits left alone until the user asks.
      */}
      {save.error instanceof ApiRequestError && (
        <Alert variant="destructive" className="w-full text-xs">
          <p className="font-medium">{save.error.body.what}</p>
          <p className="mt-1 opacity-90">{save.error.body.why}</p>
          <p className="mt-1 font-medium">{save.error.body.next}</p>
          {conflict && current !== null && (
            <Button
              size="sm"
              variant="outline"
              className="mt-2"
              onClick={() => {
                // Explicit, never automatic: reloading replaces what is on
                // screen, and that is the user's call to make.
                void templates.refetch().then(() => {
                  const fresh = templates.data?.find((t) => t.id === current.id)
                  if (fresh !== undefined) {
                    onLoad(fresh)
                  }
                })
              }}
            >
              {copy.templates.reload}
            </Button>
          )}
        </Alert>
      )}
    </>
  )
}
