/**
 * The data source list.
 *
 * Shows what a design needs to know to pick one: how many rows it has and what
 * its columns are called, since the column names are what get referenced.
 */
import { ExternalLink } from 'lucide-react'
import { useState } from 'react'
import { Button } from '../../components/ui/button.tsx'
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card.tsx'
import { ConfirmButton } from '../../components/ui/confirm-button.tsx'
import { Input } from '../../components/ui/input.tsx'
import { copy } from '../../i18n/index.ts'
import { UploadDialog } from './upload-dialog.tsx'
import { LinkGoogleDialog } from './link-google-dialog.tsx'
import { ConnectNexusDialog } from './connect-nexus-dialog.tsx'
import { RefreshButton } from './refresh-button.tsx'
import { FreshnessLine } from './freshness-line.tsx'
import { spreadsheetUrl } from './sheet-url.ts'
import { PoolsPanel } from '../sequence-pools/pools-panel.tsx'
import { Skeleton } from '../../components/ui/skeleton.tsx'
import { isFetched, useNexusCategories, useDataSources,
  useGoogleStatus,
  useUnlinkDataSource, useDeleteDataSource, useRenameDataSource, type DataSource } from './hooks.ts'

export interface DataSourcesPageProps {
  onOpen?: (id: string) => void
}

/**
 * A way out to the sheet the rows actually came from.
 *
 * Checking a number against its source is the commonest reason to leave this
 * page, and the alternative was copying the spreadsheet id out of a dialog and
 * assembling the address by hand.
 *
 * An anchor rather than a button with an onClick: opening in a new tab, copying
 * the address and middle-clicking are all things people do to a link, and none
 * of them work on a button. `noopener` because the page it opens has no
 * business getting a handle on this one.
 */
function OpenInGoogle({ source }: { source: DataSource }): React.JSX.Element | null {
  const url = spreadsheetUrl(source)
  if (url === undefined) {
    return null
  }
  return (
    <Button variant="ghost" size="sm" asChild>
      <a href={url} target="_blank" rel="noopener noreferrer">
        <ExternalLink className="h-3.5 w-3.5" />
        {copy.dataSources.openInGoogle}
      </a>
    </Button>
  )
}

export function DataSourcesPage({ onOpen }: DataSourcesPageProps): React.JSX.Element {
  // One instant for the whole render, so two rows cannot report ages a
  // millisecond apart and disagree about which of them is stale.
  const now = new Date()
  const sources = useDataSources()
  const rename = useRenameDataSource()
  const remove = useDeleteDataSource()

  const [uploading, setUploading] = useState(false)
  const [connecting, setConnecting] = useState(false)
  const nexus = useNexusCategories()
  const [linking, setLinking] = useState(false)
  const google = useGoogleStatus()
  const unlink = useUnlinkDataSource()
  const [replacing, setReplacing] = useState<DataSource | null>(null)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [draftName, setDraftName] = useState('')

  return (
    <div className="space-y-3" data-data-sources-page>
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">{copy.dataSources.heading}</h2>
        <div className="flex items-center gap-2">
          {/*
            Disabled rather than hidden when no Google identity is configured:
            somebody looking for the feature should learn that it exists and
            what is missing, not conclude it was never built.
          */}
          <Button
            size="sm"
            variant="outline"
            disabled={google.data?.configured !== true}
            title={google.data?.configured === true ? undefined : copy.dataSources.googleNotConfigured}
            onClick={() => setLinking(true)}
          >
            {copy.dataSources.linkGoogle}
          </Button>
          {/*
            Hidden entirely when the deployment has not configured the ledger —
            the same answer the Google entry gives, and for the same reason: a
            button that cannot work is worse than no button.

            **Shown when the call failed**, though. Configured-and-broken is a
            different thing from not configured: the first is somebody's fault
            to fix and the second is their decision, and hiding the entry for
            both turns a fixable fault into a feature that appears not to
            exist. That is how it failed in the field — the ledger was
            configured and unreachable, the entry vanished, and the sentence
            naming the reason was behind a button that was no longer there.

            An error can only come from a deployment that configured it: with
            neither variable set the endpoint answers `configured: false`
            rather than failing.
          */}
          {(nexus.data?.configured === true || nexus.isError) && (
            <Button size="sm" variant="outline" onClick={() => setConnecting(true)}>
              {copy.dataSources.addNexus}
            </Button>
          )}
          <Button size="sm" onClick={() => setUploading(true)}>
            {copy.dataSources.upload}
          </Button>
        </div>
      </div>

      <p className="text-2xs text-muted-foreground">{copy.dataSources.explain}</p>
      {/* Says which address to share with, so the answer is on the page rather
          than only inside a failure message. */}
      {google.data?.configured === true && google.data.clientEmail !== null && (
        <p className="text-2xs text-muted-foreground" data-google-robot>
          {copy.dataSources.googleShareWith(google.data.clientEmail)}
        </p>
      )}
      {google.data?.configured === false && (
        <p className="text-2xs text-muted-foreground">{copy.dataSources.googleNotConfigured}</p>
      )}

      <LinkGoogleDialog open={linking} onOpenChange={setLinking} />
      <ConnectNexusDialog open={connecting} onOpenChange={setConnecting} />

      {/* Same rule as the home page: the empty state waits until the answer is
          in. Here it already did — this renders nothing at all meanwhile, which
          is a blank where a list is about to be. */}
      {sources.isPending && (
        <div className="space-y-2">
          {Array.from({ length: 3 }, (_unused, index) => (
            <Skeleton key={index} className="h-14" />
          ))}
        </div>
      )}

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
            <p className="text-2xs text-muted-foreground">
              {copy.dataSources.columns}: {copy.dataSources.columnList(source.columns)}
            </p>
            {/* Where it came from and how fresh it is. Staleness is invisible
                unless it is written down, and printing yesterday's rows is not
                something anybody notices until the labels are in hand. */}
            <FreshnessLine source={source} now={now} />
            <div className="flex flex-wrap gap-2">
              {/* A linked table opens into a grid nothing can be typed into,
                  so calling this "edit" promised something the next screen
                  refused — and the only way to find that out was to click it.
                  The button still goes to the same place; it just says what
                  will be possible when it gets there. */}
              <Button variant="outline" size="sm" onClick={() => onOpen?.(source.id)}>
                {isFetched(source) ? copy.dataSources.view : copy.dataSources.open}
              </Button>
              <RefreshButton source={source} />
              <OpenInGoogle source={source} />
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
              {/* Replacing is an edit, and a linked table's contents are not
                  ours to edit — the next refresh would undo it silently. */}
              {source.sourceKind === 'local' && (
                <Button variant="ghost" size="sm" onClick={() => setReplacing(source)}>
                  {copy.dataSources.replace}
                </Button>
              )}
              {isFetched(source) && (
                <ConfirmButton
                  variant="ghost"
                  size="sm"
                  title={copy.dataSources.unlinkTitle}
                  // Says what it costs and what it keeps. A confirmation that
                  // only asks "are you sure" tells nobody anything.
                  description={copy.dataSources.unlinkConfirm(source.sourceKind)}
                  cancelLabel={copy.common.cancel}
                  confirmLabel={copy.dataSources.unlinkGo}
                  onConfirm={() => unlink.mutate(source.id)}
                >
                  {copy.dataSources.unlink}
                </ConfirmButton>
              )}
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
              <p className="text-2xs text-muted-foreground">{copy.dataSources.renameHint}</p>
            )}
          </CardContent>
        </Card>
      ))}

      {/*
        Sequence pools sit here, with the tables.
        
        They used to be on the settings page, which opens by saying its settings
        only affect this browser — and a pool is server state that everybody
        draws serials from. Both of these are places a variable gets its value,
        which is what the design references; that is the thing they have in
        common, and settings was never it.
      */}
      <PoolsPanel />

      {uploading && <UploadDialog onClose={() => setUploading(false)} />}
      {replacing !== null && (
        <UploadDialog replace={replacing} onClose={() => setReplacing(null)} />
      )}
    </div>
  )
}
