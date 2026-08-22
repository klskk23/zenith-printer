/**
 * Linking a Google spreadsheet, in three steps.
 *
 * The third step is the one that earns its keep. A column name becomes the name
 * a design writes in `${}`, so somebody has to see the names before they exist.
 * A spreadsheet whose header is not on the first row is obvious the moment the
 * columns are listed, and invisible everywhere else until a label prints with a
 * column called "本月出货清单".
 *
 * Nothing is created until the last button. The first two steps only read.
 */
import { useState } from 'react'
import { ApiRequestError } from '../../api/client.ts'
import { copy } from '../../i18n/index.ts'
import { Alert } from '../../components/ui/alert.tsx'
import { Button } from '../../components/ui/button.tsx'
import { Input } from '../../components/ui/input.tsx'
import { Label } from '../../components/ui/label.tsx'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog.tsx'
import {
  useCreateLinkedSource,
  useListWorksheets,
  usePreviewWorksheet,
  type WorksheetList,
  type WorksheetPreview,
} from './hooks.ts'

export interface LinkGoogleDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated?: (id: string) => void
}

function Failure({ error }: { error: unknown }): React.JSX.Element | null {
  if (!(error instanceof ApiRequestError)) {
    return null
  }
  // Shown verbatim: the server already worded this, including which address a
  // spreadsheet has to be shared with.
  return (
    <Alert variant="destructive" className="mt-2">
      <p className="font-medium">{error.body.what}</p>
      <p className="mt-1 text-xs opacity-90">{error.body.why}</p>
      <p className="mt-1 text-xs font-medium">{error.body.next}</p>
    </Alert>
  )
}

export function LinkGoogleDialog({
  open,
  onOpenChange,
  onCreated,
}: LinkGoogleDialogProps): React.JSX.Element {
  const [url, setUrl] = useState('')
  const [list, setList] = useState<WorksheetList | null>(null)
  const [worksheetId, setWorksheetId] = useState<number | null>(null)
  const [preview, setPreview] = useState<WorksheetPreview | null>(null)
  const [name, setName] = useState('')

  const listWorksheets = useListWorksheets()
  const previewWorksheet = usePreviewWorksheet()
  const create = useCreateLinkedSource()

  const reset = (): void => {
    setUrl('')
    setList(null)
    setWorksheetId(null)
    setPreview(null)
    setName('')
  }

  const close = (next: boolean): void => {
    if (!next) {
      reset()
    }
    onOpenChange(next)
  }

  const chooseWorksheet = (id: number): void => {
    setWorksheetId(id)
    setPreview(null)
    previewWorksheet.mutate(
      { spreadsheetId: list!.spreadsheetId, worksheetId: id },
      {
        onSuccess: (result) => {
          setPreview(result)
          // The worksheet's own name is the obvious default. Whether it is free
          // was answered by the same request, so a clash is a correction here
          // rather than a failed create later.
          setName(result.suggestedName)
        },
      },
    )
  }

  const nameTaken = preview !== null && preview.nameTaken && name === preview.suggestedName

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="flex max-h-[85vh] max-w-lg flex-col overflow-hidden">
        <DialogHeader>
          <DialogTitle>{copy.dataSources.linkGoogle}</DialogTitle>
          <DialogDescription>
            {preview === null ? copy.dataSources.googleUrlHint : copy.dataSources.googlePreviewHint}
          </DialogDescription>
        </DialogHeader>

        <div className="scrollbar-themed min-h-0 flex-1 space-y-3 overflow-y-auto pr-2">
          {list === null && (
            <div className="space-y-1">
              <Label htmlFor="google-url">{copy.dataSources.googleUrl}</Label>
              <Input
                id="google-url"
                aria-label={copy.dataSources.googleUrl}
                value={url}
                onChange={(event) => setUrl(event.target.value)}
              />
              <Failure error={listWorksheets.error} />
            </div>
          )}

          {list !== null && preview === null && (
            <div className="space-y-1">
              <p className="text-xs font-medium">{copy.dataSources.googlePickWorksheet}</p>
              <p className="text-[11px] text-muted-foreground">{list.spreadsheetTitle}</p>
              <div className="flex flex-col gap-1">
                {list.worksheets.map((worksheet) => (
                  <Button
                    key={worksheet.id}
                    variant="outline"
                    size="row"
                    onClick={() => chooseWorksheet(worksheet.id)}
                  >
                    {worksheet.title}
                  </Button>
                ))}
              </div>
              <Failure error={previewWorksheet.error} />
            </div>
          )}

          {preview !== null && (
            <div className="space-y-3">
              <div className="space-y-1">
                <Label htmlFor="google-name">{copy.dataSources.name}</Label>
                <Input
                  id="google-name"
                  aria-label={copy.dataSources.name}
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                />
                {nameTaken && (
                  <p className="text-[11px] text-destructive">{copy.dataSources.googleNameTaken}</p>
                )}
              </div>

              <div>
                <p className="mb-1 text-[11px] text-muted-foreground">
                  {copy.dataSources.googleTotalRows(preview.totalRows)}
                </p>
                <div className="scrollbar-themed overflow-x-auto rounded border border-border">
                  <table className="w-full text-[11px]">
                    <thead>
                      <tr className="border-b border-border bg-muted/40">
                        {preview.columns.map((column) => (
                          <th key={column} className="px-2 py-1 text-left font-medium">
                            {column}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {preview.sampleRows.map((row, index) => (
                        <tr key={index} className="border-b border-border last:border-0">
                          {preview.columns.map((column) => (
                            <td key={column} className="px-2 py-1 font-mono">
                              {row[column]}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <p className="text-[11px] text-muted-foreground">
                {copy.dataSources.googleReadOnlyNote}
              </p>
              <Failure error={create.error} />
            </div>
          )}
        </div>

        <DialogFooter>
          {list !== null && preview === null && (
            <Button variant="ghost" size="sm" onClick={() => setList(null)}>
              {copy.dataSources.googleBack}
            </Button>
          )}
          {preview !== null && (
            <Button variant="ghost" size="sm" onClick={() => setPreview(null)}>
              {copy.dataSources.googleBack}
            </Button>
          )}

          {list === null && (
            <Button
              size="sm"
              disabled={url.trim() === '' || listWorksheets.isPending}
              onClick={() =>
                listWorksheets.mutate(url.trim(), { onSuccess: (result) => setList(result) })
              }
            >
              {copy.dataSources.googleNext}
            </Button>
          )}

          {preview !== null && (
            <Button
              size="sm"
              disabled={name.trim() === '' || nameTaken || create.isPending}
              onClick={() =>
                create.mutate(
                  {
                    spreadsheetId: list!.spreadsheetId,
                    worksheetId: worksheetId!,
                    name: name.trim(),
                  },
                  {
                    onSuccess: (source) => {
                      onCreated?.(source.id)
                      close(false)
                    },
                  },
                )
              }
            >
              {copy.dataSources.googleCreate}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
