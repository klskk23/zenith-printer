/**
 * CSV upload, with the two escape hatches that make detection acceptable.
 *
 * Encoding and separator are both guessed, and both guesses fail visibly:
 * mojibake, or one very wide column. Those are "obviously wrong and no idea
 * what to do about it" failures, so the retry has to be right here.
 */
import { useState } from 'react'
import { Button } from '../../components/ui/button.tsx'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog.tsx'
import { Alert } from '../../components/ui/alert.tsx'
import { Input } from '../../components/ui/input.tsx'
import { Label } from '../../components/ui/label.tsx'
import { Progress } from '../../components/ui/progress.tsx'
import { NONE, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../components/ui/select.tsx'
import { copy } from '../../i18n/index.ts'
import { useUploadDataSource, type DataSource } from './hooks.ts'

export interface UploadDialogProps {
  /** Set to replace an existing table rather than create a new one. */
  replace?: DataSource
  onClose: () => void
}

interface ApiFailure {
  code?: string
  what?: string
  why?: string
  next?: string
  details?: { removedColumns?: string[]; affectedTemplates?: Array<{ name: string }> }
}

export function UploadDialog({ replace, onClose }: UploadDialogProps): React.JSX.Element {
  const upload = useUploadDataSource()
  const [file, setFile] = useState<File | null>(null)
  const [name, setName] = useState(replace?.name ?? '')
  const [encoding, setEncoding] = useState('')
  const [delimiter, setDelimiter] = useState('')
  const [failure, setFailure] = useState<ApiFailure | null>(null)

  const removed = failure?.details?.removedColumns ?? []
  const needsReplaceConfirm = failure?.code === 'DATA_SOURCE_COLUMNS_REMOVED'

  const send = (confirm: boolean): void => {
    if (file === null) return
    setFailure(null)
    upload.mutate(
      {
        file,
        ...(replace === undefined ? { name: name.trim() } : {}),
        ...(encoding === '' ? {} : { encoding }),
        ...(delimiter === '' ? {} : { delimiter }),
        ...(replace === undefined ? {} : { replaceId: replace.id, confirm }),
      },
      {
        onSuccess: () => onClose(),
        onError: (err) => setFailure(err as ApiFailure),
      },
    )
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{replace === undefined ? copy.dataSources.upload : copy.dataSources.replace}</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <Label className="block flex flex-col gap-1">
            <span className="text-2xs text-muted-foreground">CSV</span>
            <input
              type="file"
              accept=".csv,text/csv"
              aria-label="CSV"
              onChange={(event) => {
                const picked = event.target.files?.[0] ?? null
                setFile(picked)
                // The file's own name is nearly always what the table should be
                // called, and offering it saves a decision (FR-020).
                if (picked !== null && name.trim().length === 0) {
                  setName(picked.name.replace(/\.[^.]+$/, ''))
                }
              }}
            />
          </Label>

          {replace === undefined && (
            <Label className="block flex flex-col gap-1">
              <span className="text-2xs text-muted-foreground">{copy.dataSources.name}</span>
              <Input value={name} onChange={(event) => setName(event.target.value)} />
            </Label>
          )}

          <div className="flex gap-2">
            <Label className="flex-1 flex flex-col gap-1">
              <span className="text-2xs text-muted-foreground">{copy.dataSources.encoding}</span>
              <Select
                value={encoding === '' ? NONE : encoding}
                onValueChange={(value) => setEncoding(value === NONE ? '' : value)}
              >
                <SelectTrigger aria-label={copy.dataSources.encoding}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>{copy.dataSources.encodingAuto}</SelectItem>
                  <SelectItem value="utf-8">UTF-8</SelectItem>
                  <SelectItem value="gb18030">GB18030 / GBK</SelectItem>
                  <SelectItem value="big5">Big5</SelectItem>
                </SelectContent>
              </Select>
            </Label>
            <Label className="flex-1 flex flex-col gap-1">
              <span className="text-2xs text-muted-foreground">{copy.dataSources.delimiter}</span>
              <Select
                value={delimiter === '' ? NONE : delimiter}
                onValueChange={(value) => setDelimiter(value === NONE ? '' : value)}
              >
                <SelectTrigger aria-label={copy.dataSources.delimiter}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>{copy.dataSources.delimiterAuto}</SelectItem>
                  <SelectItem value=",">,</SelectItem>
                  <SelectItem value=";">;</SelectItem>
                  <SelectItem value={'\t'}>Tab</SelectItem>
                </SelectContent>
              </Select>
            </Label>
          </div>
          <p className="text-2xs text-muted-foreground">{copy.dataSources.retryHint}</p>

          {upload.isPending && (
            <div className="flex flex-col gap-1" data-upload-progress>
              {/*
                Indeterminate: the server parses in one pass and cannot report a
                fraction without buffering twice. What matters at thirty seconds
                is knowing it is still working, not knowing how far along.
              */}
              <Progress />
              <p className="text-2xs text-muted-foreground">{copy.dataSources.uploading}</p>
            </div>
          )}

          {failure !== null && (
            <Alert variant={needsReplaceConfirm ? 'warning' : 'destructive'}>
              <p className="font-medium">{failure.what ?? copy.common.error}</p>
              {failure.why !== undefined && <p className="mt-1 text-xs opacity-90">{failure.why}</p>}
              {failure.next !== undefined && <p className="mt-1 text-xs font-medium">{failure.next}</p>}
              {needsReplaceConfirm && (
                <p className="mt-1 text-xs">
                  {copy.dataSources.replaceWarning(
                    removed,
                    (failure.details?.affectedTemplates ?? []).map((template) => template.name),
                  )}
                </p>
              )}
            </Alert>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            {copy.common.cancel}
          </Button>
          {needsReplaceConfirm ? (
            <Button variant="destructive" onClick={() => send(true)}>
              {copy.dataSources.replaceConfirm}
            </Button>
          ) : (
            <Button disabled={file === null || upload.isPending} onClick={() => send(false)}>
              {copy.common.confirm}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
