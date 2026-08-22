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
import { Select } from '../components/ui/select.tsx'
import { Alert } from '../components/ui/alert.tsx'
import { copy } from '../i18n/index.ts'
import { useDataSources } from '../features/data-sources/hooks.ts'
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
        <span className="text-[11px] text-muted-foreground">{copy.dataSources.heading}</span>
        <Select
          value={dataSourceId ?? ''}
          onChange={(event) => onChange(event.target.value === '' ? null : event.target.value)}
        >
          <option value="">—</option>
          {sources.data?.map((source) => (
            <option key={source.id} value={source.id}>
              {source.name}
            </option>
          ))}
        </Select>
      </Label>

      {bindingIssue !== null && bindingIssue !== undefined && (
        <Alert variant="destructive" className="py-1.5 text-[11px]" data-binding-issue>
          <p>
            {bindingIssue.kind === 'sourceMissing'
              ? copy.dataSources.bindingMissing
              : copy.dataSources.bindingColumns(bindingIssue.columns)}
          </p>
          <p className="mt-1 opacity-90">{copy.dataSources.rebindHint}</p>
        </Alert>
      )}

      {bound !== undefined && (
        <div className="space-y-1">
          <p className="text-[11px] text-muted-foreground">{copy.dataSources.columns}</p>
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
