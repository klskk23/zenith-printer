/**
 * Saving designs to a file and reading them back.
 *
 * Two things need saying about this screen. First: importing never refuses
 * over a missing table or a pool under another name — the design comes in and
 * the differences are listed, because a design missing its table is still the
 * design somebody meant to send.
 *
 * Second: the warnings are shown as the server worded them. Rewording them
 * here would give one situation two descriptions, and the command line prints
 * the same sentences.
 */
import { useRef, useState } from 'react'
import { ApiRequestError } from '../../api/client.ts'
import { copy } from '../../i18n/index.ts'
import { Alert } from '../../components/ui/alert.tsx'
import { Button } from '../../components/ui/button.tsx'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog.tsx'
import { fetchExport, useImportTemplates, type ImportWarning } from './hooks.ts'

/** Offer the file to the browser. Revoked immediately; the download is queued. */
function download(name: string, contents: unknown): void {
  const blob = new Blob([JSON.stringify(contents, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = name
  anchor.click()
  URL.revokeObjectURL(url)
}

export async function exportTemplates(ids: readonly string[], filename: string): Promise<void> {
  download(filename, await fetchExport(ids))
}

interface Clash {
  id: string
  name: string
}

export function ImportTemplatesButton(): React.JSX.Element {
  const picker = useRef<HTMLInputElement>(null)
  const load = useImportTemplates()
  const [file, setFile] = useState<unknown>(null)
  const [clashes, setClashes] = useState<Clash[] | null>(null)
  const [warnings, setWarnings] = useState<ImportWarning[] | null>(null)
  const [failure, setFailure] = useState<ApiRequestError | null>(null)

  const run = (contents: unknown, onConflict?: 'overwrite' | 'copy'): void => {
    load.mutate(
      onConflict === undefined ? { file: contents } : { file: contents, onConflict },
      {
        onSuccess: (result) => {
          setClashes(null)
          setFile(null)
          // Shown even when empty, so "it worked" is something the screen says
          // rather than something the absence of an error implies.
          setWarnings(result.warnings)
        },
        onError: (error) => {
          if (error instanceof ApiRequestError && error.body.code === 'TEMPLATE_ALREADY_EXISTS') {
            // Not a failure: a question the caller has to answer, because
            // overwriting cannot be undone.
            setClashes(error.body.details?.templates as Clash[])
            return
          }
          setFailure(error instanceof ApiRequestError ? error : null)
        },
      },
    )
  }

  const onPicked = async (chosen: File | undefined): Promise<void> => {
    if (chosen === undefined) {
      return
    }
    setFailure(null)
    let contents: unknown
    try {
      contents = JSON.parse(await chosen.text())
    } catch {
      // Malformed before it ever reaches the server; say so in the same words.
      setFailure(null)
      setWarnings(null)
      setClashes(null)
      window.alert(copy.templates.importUnreadable)
      return
    }
    setFile(contents)
    run(contents)
  }

  return (
    <>
      <input
        ref={picker}
        type="file"
        accept="application/json,.json"
        className="hidden"
        aria-label={copy.templates.importFile}
        onChange={(event) => {
          void onPicked(event.target.files?.[0])
          // Cleared so choosing the same file twice fires again.
          event.target.value = ''
        }}
      />
      <Button size="sm" variant="outline" onClick={() => picker.current?.click()}>
        {copy.templates.import}
      </Button>

      {/* The one question this screen asks. Overwriting is not reversible. */}
      <Dialog open={clashes !== null} onOpenChange={(next) => !next && setClashes(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{copy.templates.importConflictTitle}</DialogTitle>
            <DialogDescription>{copy.templates.importConflictBody}</DialogDescription>
          </DialogHeader>
          <ul className="max-h-40 overflow-y-auto text-xs scrollbar-themed">
            {(clashes ?? []).map((clash) => (
              <li key={clash.id} className="py-0.5">
                {clash.name}
              </li>
            ))}
          </ul>
          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setClashes(null)}>
              {copy.common.cancel}
            </Button>
            <Button variant="outline" size="sm" onClick={() => run(file, 'copy')}>
              {copy.templates.importAsCopy}
            </Button>
            <Button size="sm" onClick={() => run(file, 'overwrite')}>
              {copy.templates.importOverwrite}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={warnings !== null} onOpenChange={(next) => !next && setWarnings(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{copy.templates.importDoneTitle}</DialogTitle>
            <DialogDescription>
              {(warnings ?? []).length === 0
                ? copy.templates.importCleanBody
                : copy.templates.importWarningsBody}
            </DialogDescription>
          </DialogHeader>
          <ul className="max-h-64 flex flex-col gap-2 overflow-y-auto text-xs scrollbar-themed" data-import-warnings>
            {(warnings ?? []).map((warning, index) => (
              <li key={`${warning.code}-${index}`} className="rounded border border-border p-2">
                <p className="font-medium">{warning.templateName}</p>
                {/* Verbatim: the server already worded this. */}
                <p className="mt-0.5 text-muted-foreground">{warning.message}</p>
              </li>
            ))}
          </ul>
          <DialogFooter>
            <Button size="sm" onClick={() => setWarnings(null)}>
              {copy.common.close}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {failure !== null && (
        <Alert variant="destructive" className="mt-2">
          <p className="font-medium">{failure.body.what}</p>
          <p className="mt-1 text-xs opacity-90">{failure.body.why}</p>
          <p className="mt-1 text-xs font-medium">{failure.body.next}</p>
        </Alert>
      )}
    </>
  )
}
