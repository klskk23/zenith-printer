/**
 * The data source list.
 *
 * Shows what a design needs to know to pick one: how many rows it has and what
 * its columns are called, since the column names are what get referenced.
 */
import { useState } from 'react'
import { Button } from '../../components/ui/button.tsx'
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card.tsx'
import { ConfirmButton } from '../../components/ui/confirm-button.tsx'
import { Input } from '../../components/ui/input.tsx'
import { copy } from '../../i18n/index.ts'
import { UploadDialog } from './upload-dialog.tsx'
import { useDataSources, useDeleteDataSource, useRenameDataSource, type DataSource } from './hooks.ts'

export interface DataSourcesPageProps {
  onOpen?: (id: string) => void
}

export function DataSourcesPage({ onOpen }: DataSourcesPageProps): React.JSX.Element {
  const sources = useDataSources()
  const rename = useRenameDataSource()
  const remove = useDeleteDataSource()

  const [uploading, setUploading] = useState(false)
  const [replacing, setReplacing] = useState<DataSource | null>(null)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [draftName, setDraftName] = useState('')

  return (
    <div className="space-y-3" data-data-sources-page>
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">{copy.dataSources.heading}</h2>
        <Button size="sm" onClick={() => setUploading(true)}>
          {copy.dataSources.upload}
        </Button>
      </div>

      <p className="text-[11px] text-muted-foreground">{copy.dataSources.explain}</p>

      {sources.data !== undefined && sources.data.length === 0 && (
        <Card>
          <CardContent className="p-4">
            <p className="text-sm text-muted-foreground">{copy.dataSources.empty}</p>
          </CardContent>
        </Card>
      )}

      {sources.data?.map((source) => (
        <Card key={source.id}>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between gap-2">
              {renamingId === source.id ? (
                <div className="flex flex-1 items-center gap-2">
                  <Input
                    aria-label={copy.dataSources.name}
                    value={draftName}
                    onChange={(event) => setDraftName(event.target.value)}
                  />
                  <Button
                    size="sm"
                    onClick={() => {
                      rename.mutate({ id: source.id, name: draftName.trim() })
                      setRenamingId(null)
                    }}
                  >
                    {copy.common.save}
                  </Button>
                </div>
              ) : (
                <CardTitle>{source.name}</CardTitle>
              )}
              <span className="text-xs text-muted-foreground">
                {copy.dataSources.rowCount(source.rowCount)}
              </span>
            </div>
          </CardHeader>
          <CardContent className="space-y-2">
            <p className="text-[11px] text-muted-foreground">
              {copy.dataSources.columns}: {copy.dataSources.columnList(source.columns)}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={() => onOpen?.(source.id)}>
                {copy.dataSources.open}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setRenamingId(source.id)
                  setDraftName(source.name)
                }}
              >
                {copy.dataSources.rename}
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setReplacing(source)}>
                {copy.dataSources.replace}
              </Button>
              <ConfirmButton
                variant="ghost"
                size="sm"
                title={copy.dataSources.deleteTitle(source.name)}
                // Says what is destroyed — the rows — rather than asking whether
                // anybody was using it. A design left dangling is recoverable by
                // rebinding, and is shown a warning rather than blocking this.
                description={copy.dataSources.deleteWarning}
                cancelLabel={copy.common.cancel}
                confirmLabel={copy.dataSources.deleteConfirm}
                onConfirm={() => remove.mutate(source.id)}
              >
                {copy.dataSources.delete}
              </ConfirmButton>
            </div>
            {renamingId === source.id && (
              <p className="text-[11px] text-muted-foreground">{copy.dataSources.renameHint}</p>
            )}
          </CardContent>
        </Card>
      ))}

      {uploading && <UploadDialog onClose={() => setUploading(false)} />}
      {replacing !== null && (
        <UploadDialog replace={replacing} onClose={() => setReplacing(null)} />
      )}
    </div>
  )
}
