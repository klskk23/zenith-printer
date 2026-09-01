/**
 * Connecting a table that reads from an address.
 *
 * Three fields carry the weight, and each is a decision somebody has to
 * understand rather than a box to fill:
 *
 *   - **the address**, used verbatim, filters and all;
 *   - **the key column**, which is what stops rows already chosen from shifting
 *     when the other system inserts or deletes one — the form says so, because
 *     without that sentence it looks like an id field nobody needs;
 *   - **the headers**, where a credential goes. Stored and never shown again.
 *
 * No rows are fetched on submit. The table is created empty and the first
 * refresh fills it, so a producer that is down does not stop the table being
 * made — and the refresh path is where every way a read can fail is already
 * reported properly.
 */
import { useState } from 'react'
import { ApiRequestError } from '../../api/client.ts'
import { copy } from '../../i18n/index.ts'
import { Alert } from '../../components/ui/alert.tsx'
import { Button } from '../../components/ui/button.tsx'
import { Input } from '../../components/ui/input.tsx'
import { Label } from '../../components/ui/label.tsx'
import { Textarea } from '../../components/ui/textarea.tsx'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog.tsx'
import { parseHeaderLines, useCreateHttpSource } from './hooks.ts'

export function ConnectHttpDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}): React.JSX.Element {
  const [name, setName] = useState('')
  const [url, setUrl] = useState('')
  const [keyColumn, setKeyColumn] = useState('')
  const [headerText, setHeaderText] = useState('')
  const create = useCreateHttpSource()

  const ready = name.trim().length > 0 && url.trim().length > 0 && keyColumn.trim().length > 0

  const submit = (): void => {
    create.mutate(
      {
        name: name.trim(),
        url: url.trim(),
        keyColumn: keyColumn.trim(),
        headers: parseHeaderLines(headerText),
      },
      {
        onSuccess: () => {
          setName('')
          setUrl('')
          setKeyColumn('')
          setHeaderText('')
          onOpenChange(false)
        },
      },
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-connect-http>
        <DialogHeader>
          <DialogTitle>{copy.dataSources.httpTitle}</DialogTitle>
          <DialogDescription>{copy.dataSources.httpExplain}</DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <Label className="block space-y-1">
            <span className="text-2xs text-muted-foreground">{copy.dataSources.name}</span>
            <Input value={name} onChange={(event) => setName(event.target.value)} />
          </Label>

          <Label className="block space-y-1">
            <span className="text-2xs text-muted-foreground">{copy.dataSources.httpUrl}</span>
            <Input
              value={url}
              placeholder={copy.dataSources.httpUrlPlaceholder}
              onChange={(event) => setUrl(event.target.value)}
            />
          </Label>

          <Label className="block space-y-1">
            <span className="text-2xs text-muted-foreground">{copy.dataSources.keyColumnLabel}</span>
            <Input value={keyColumn} onChange={(event) => setKeyColumn(event.target.value)} />
            {/* Said here rather than left to be discovered: without this
                sentence it reads as an id field nobody needs. */}
            <span className="block text-2xs text-muted-foreground">
              {copy.dataSources.keyColumnHint}
            </span>
          </Label>

          <Label className="block space-y-1">
            <span className="text-2xs text-muted-foreground">{copy.dataSources.httpHeaders}</span>
            <Textarea
              rows={3}
              value={headerText}
              onChange={(event) => setHeaderText(event.target.value)}
            />
            <span className="block text-2xs text-muted-foreground">
              {copy.dataSources.httpHeadersHint}
            </span>
          </Label>

          {create.isError && (
            <Alert variant="destructive" className="text-xs">
              {create.error instanceof ApiRequestError
                ? create.error.body.what
                : copy.dataSources.httpTitle}
            </Alert>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {copy.common.cancel}
          </Button>
          <Button disabled={!ready || create.isPending} onClick={submit}>
            {copy.dataSources.httpCreate}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
