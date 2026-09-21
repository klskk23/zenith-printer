/**
 * Saving, for the editor's top bar.
 *
 * There is no picker here any more: the gallery is the picker. What is left
 * is saving the open label.
 * The earlier version carried a permanent name field, three buttons and its own
 * inline error strip — a whole panel wedged into a row of dropdowns. Deleting a
 * template in particular does not belong here; it belongs in the library, next
 * to the list of what would be deleted.
 *
 * Saving carries the `version` the label was loaded with. When the server
 * refuses because somebody saved in between, the save is retried once against
 * their version: the rule is **last save wins**, and the person pressing the
 * button is the last one. The token still exists so that two saves in the
 * same instant cannot interleave on the server; it is not a lock.
 */
import { useState } from 'react'
import { Save } from 'lucide-react'
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
import { useSaveTemplate, useTemplates, type Template } from './hooks.ts'

export interface TemplateBarProps {
  current: Template | null
  buildBody: () => Record<string, unknown>
  onSaved: (template: Template) => void
}

export function TemplateBar({ current, buildBody, onSaved }: TemplateBarProps): React.JSX.Element {
  const templates = useTemplates()
  const save = useSaveTemplate()
  const [naming, setNaming] = useState<string | null>(null)

  const commit = (name: string, asNew: boolean): void => {
    const body = { ...buildBody(), name }
    const onSuccess = (saved: Template): void => {
      setNaming(null)
      onSaved(saved)
    }
    if (asNew || current === null) {
      save.mutate({ body }, { onSuccess })
      return
    }
    save.mutate(
      { id: current.id, version: current.version, body },
      {
        onSuccess,
        onError: (error) => {
          if (!(error instanceof ApiRequestError) || error.status !== 409) {
            return
          }
          // Somebody saved first. Last save wins: take their version number
          // and save over it. Once — a second refusal is shown.
          void templates.refetch().then((result) => {
            const fresh = result.data?.find((t) => t.id === current.id)
            if (fresh !== undefined) {
              save.mutate({ id: current.id, version: fresh.version, body }, { onSuccess })
            }
          })
        },
      },
    )
  }

  return (
    <>
      {/* Default height, matching the selects it sits beside. */}
      <Button
        variant="outline"
        className="gap-1.5"
        disabled={save.isPending}
        // A design with no template behind it has no name yet, so saving asks
        // for one. An existing template saves straight over itself.
        onClick={() => (current === null ? setNaming('') : commit(current.name, false))}
      >
        <Save />
        {current === null ? copy.templates.save : copy.templates.update}
      </Button>

      {current !== null && (
        <Button variant="ghost" disabled={save.isPending} onClick={() => setNaming(current.name)}>
          {copy.templates.saveAs}
        </Button>
      )}

      {/* A form, so a Dialog rather than an AlertDialog — the latter is
          announced as an alert and is meant for a yes/no answer. */}
      <Dialog open={naming !== null} onOpenChange={(open) => !open && setNaming(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{copy.templates.saveDialogTitle}</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-1">
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
        here would give one fault two descriptions. A version conflict is not
        shown at all on the first refusal: it is retried (see `commit`).
      */}
      {save.error instanceof ApiRequestError && (
        // Full width on its own line: an error wedged between dropdowns is
        // both unreadable and pushes everything beside it out of alignment.
        <Alert variant="destructive" className="w-full basis-full text-xs">
          <p className="font-medium">{save.error.body.what}</p>
          <p className="mt-1 opacity-90">{save.error.body.why}</p>
          <p className="mt-1 font-medium">{save.error.body.next}</p>
        </Alert>
      )}
    </>
  )
}
