/**
 * Which table this design draws its rows from.
 *
 * One data source per design, enforced by there being one field rather than by
 * a rule anybody has to remember. Column names are listed here so they can be
 * inserted rather than typed from memory — a typo in `${收件人}` is only
 * visible as a blank on the canvas.
 */
import { Button } from '../components/ui/button.tsx'
import { Label } from '../components/ui/label.tsx'
import { NONE, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select.tsx'
import { Alert } from '../components/ui/alert.tsx'
import { copy } from '../i18n/index.ts'
import { useDataSources } from '../features/data-sources/hooks.ts'
import { RefreshButton } from '../features/data-sources/refresh-button.tsx'
import type { BindingIssue } from '../features/templates/hooks.ts'

export interface DataSourceBindingProps {
  dataSourceId: string | null
  onChange: (dataSourceId: string | null) => void
  /** Called with `${列名}`, for insertion at the cursor. */
  onInsertReference?: (reference: string) => void
  bindingIssue?: BindingIssue | null
}

export function DataSourceBinding({
  dataSourceId,
  onChange,
  onInsertReference,
  bindingIssue,
}: DataSourceBindingProps): React.JSX.Element {
  const sources = useDataSources()
  const bound = sources.data?.find((candidate) => candidate.id === dataSourceId)

  return (
    <div className="space-y-2" data-data-source-binding>
      <Label className="block space-y-1">
        <span className="text-2xs text-muted-foreground">{copy.dataSources.heading}</span>
        <Select
          value={dataSourceId ?? NONE}
          onValueChange={(value) => onChange(value === NONE ? null : value)}
        >
          <SelectTrigger aria-label={copy.dataSources.heading}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE}>—</SelectItem>
            {sources.data?.map((source) => (
              <SelectItem key={source.id} value={source.id}>
                {source.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Label>

      {bindingIssue !== null && bindingIssue !== undefined && (
        <Alert variant="destructive" className="py-1.5 text-2xs" data-binding-issue>
          <p>
            {bindingIssue.kind === 'sourceMissing'
              ? copy.dataSources.bindingMissing
              : copy.dataSources.bindingColumns(bindingIssue.columns)}
          </p>
          <p className="mt-1 opacity-90">{copy.dataSources.rebindHint}</p>
        </Alert>
      )}

      {/*
        Refresh from here too.
        
        The column names below are what a design writes in `${}`. Somebody adds
        a column in Google while this editor is open, and without this the only
        way to see it is to leave, refresh on the list page, and come back —
        by which point they have probably typed the name from memory instead,
        which is a reference that resolves to nothing.
      */}
      {bound?.sourceKind === 'google-sheets' && (
        <div className="space-y-1">
          <RefreshButton source={bound} />
          <p className="text-2xs text-muted-foreground" data-binding-freshness>
            {bound.lastRefreshedAt === undefined
              ? copy.dataSources.neverRefreshed
              : copy.dataSources.lastRefreshed(new Date(bound.lastRefreshedAt).toLocaleString())}
          </p>
        </div>
      )}

      {bound !== undefined && (
        <div className="space-y-1">
          <p className="text-2xs text-muted-foreground">{copy.dataSources.columns}</p>
          <div className="flex flex-wrap gap-1">
            {bound.columns.map((column) => (
              <Button
                key={column}
                variant="outline"
                size="sm"
                onClick={() => onInsertReference?.(`\${${column}}`)}
              >
                {column}
              </Button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
