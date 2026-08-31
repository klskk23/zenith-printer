/**
 * The design's variables.
 *
 * Two kinds live here, and only two: a constant, whose value is fixed in the
 * design, and a sequence, which draws from a pool that exists in its own right.
 * Data source columns are deliberately absent — they need no declaration,
 * because the design already names the table it is bound to and `${列名}` is
 * the whole reference.
 *
 * Nothing here binds an element to a variable. Binding was the old model, and
 * it could not express "零件 ${sku} 号"; references are written inline in the
 * content now, and this panel only says what the names mean.
 */
import { useState } from 'react'
import type { VariableDefinition } from '@zenith/shared'
import { Button } from '../components/ui/button.tsx'
import { Input } from '../components/ui/input.tsx'
import { Label } from '../components/ui/label.tsx'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select.tsx'
import { copy } from '../i18n/index.ts'

export interface SequencePoolOption {
  id: string
  name: string
  digits: number
  nextValue: number
}

export interface VariablesPanelProps {
  variables: VariableDefinition[]
  onChange: (variables: VariableDefinition[]) => void
  pools: readonly SequencePoolOption[]
  onCreatePool: () => void
  /** Column names of the bound data source, for the collision warning. */
  columns: readonly string[]
  /** Names the content references but nothing defines. */
  unresolved: readonly string[]
  /**
   * The row of the bound table the canvas is currently drawn against.
   *
   * Zero rows means no table, or an empty one; either way there is nothing to
   * choose between and the control is not offered.
   */
  rowCount: number
  previewOrdinal: number
  onPreviewOrdinalChange: (ordinal: number) => void
  /** That row's cells, so the number field says what it selected. */
  previewValues: Readonly<Record<string, string>>
}

function uniqueName(existing: readonly VariableDefinition[], base: string): string {
  if (!existing.some((v) => v.name === base)) return base
  let n = 2
  while (existing.some((v) => v.name === `${base}${n}`)) n += 1
  return `${base}${n}`
}

export function VariablesPanel({
  variables,
  onChange,
  pools,
  onCreatePool,
  columns,
  unresolved,
  rowCount,
  previewOrdinal,
  onPreviewOrdinalChange,
  previewValues,
}: VariablesPanelProps): React.JSX.Element {
  // Held locally while typing. Writing straight through remounted the row on
  // every keystroke, which took the focus with it — one character per click.
  const [draftNames, setDraftNames] = useState<Record<number, string>>({})

  const columnSet = new Set(columns)

  const patch = (index: number, changes: Partial<VariableDefinition>): void => {
    onChange(
      variables.map((variable, at) =>
        at === index ? ({ ...variable, ...changes } as VariableDefinition) : variable,
      ),
    )
  }

  const add = (kind: VariableDefinition['kind']): void => {
    const name = uniqueName(variables, kind === 'constant' ? 'sku' : 'serial')
    onChange([
      ...variables,
      kind === 'constant'
        ? { name, kind: 'constant', value: '' }
        : { name, kind: 'sequence', poolId: pools[0]?.id ?? '' },
    ])
  }

  return (
    <div className="space-y-3" data-variables-panel>
      {/*
        Which row of the bound table the canvas stands in for.
        Above the variables rather than below, because it explains what is
        already on screen: `${列名}` has no value while a design is being
        written, and the canvas has been substituting row one since it could
        substitute anything. Row one is still the default — the point is only
        that it is no longer the only one available, since the layout question
        is usually about the longest name or the empty cell, not the first row.
      */}
      {rowCount > 0 && (
        <section className="space-y-1 rounded-md border border-dashed border-border p-2" data-preview-row>
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-medium">{copy.variables.tempHeading}</span>
            <Input
              type="number"
              min={1}
              max={rowCount}
              className="h-7 w-20"
              aria-label={copy.variables.tempRow}
              value={previewOrdinal}
              // Not clamped here. The value handed back is the clamped one,
              // so the field corrects itself on the next render and there is
              // one place that decides what is in range.
              onChange={(event) => onPreviewOrdinalChange(Number(event.target.value))}
            />
            <span className="text-[11px] text-muted-foreground">
              {copy.variables.tempRowOf(rowCount)}
            </span>
          </div>

          {columns.length > 0 && (
            <dl className="space-y-0.5 text-[11px]">
              {columns.map((column) => {
                const value = previewValues[column] ?? ''
                return (
                  <div key={column} className="flex gap-2">
                    <dt className="shrink-0 text-muted-foreground">{column}</dt>
                    {/* An empty cell is stated, not left blank: "row 87 has no
                        name" is the case worth stepping through the table to
                        find, and a blank line hides it. */}
                    <dd className={value === '' ? 'truncate text-muted-foreground' : 'truncate'}>
                      {value === '' ? copy.variables.tempEmptyCell : value}
                    </dd>
                  </div>
                )
              })}
            </dl>
          )}

          <p className="text-[11px] text-muted-foreground">{copy.variables.tempHint}</p>
        </section>
      )}

      {variables.length === 0 && (
        <p className="text-[11px] text-muted-foreground">{copy.variables.empty}</p>
      )}

      {variables.map((variable, index) => {
        const shadowed = columnSet.has(variable.name)
        return (
          // Keyed by position, not by name: the name is what this row edits,
          // and keying by it remounts the input on every keystroke.
          <div key={index} className="space-y-1 rounded-md border border-border p-2">
            <div className="flex items-center gap-2">
              <Input
                aria-label={copy.variables.name}
                value={draftNames[index] ?? variable.name}
                onChange={(event) => setDraftNames({ ...draftNames, [index]: event.target.value })}
                onBlur={(event) => {
                  const next = event.target.value.trim()
                  setDraftNames({ ...draftNames, [index]: undefined as unknown as string })
                  if (next.length > 0 && next !== variable.name) patch(index, { name: next })
                }}
              />
              <Button
                variant="ghost"
                size="sm"
                aria-label={copy.variables.remove}
                onClick={() => onChange(variables.filter((_unused, at) => at !== index))}
              >
                {copy.variables.remove}
              </Button>
            </div>

            {variable.kind === 'constant' ? (
              <Label className="block space-y-1">
                <span className="text-[11px] text-muted-foreground">{copy.variables.value}</span>
                <Input
                  value={variable.value}
                  onChange={(event) => patch(index, { value: event.target.value })}
                />
              </Label>
            ) : (
              <Label className="block space-y-1">
                <span className="text-[11px] text-muted-foreground">{copy.variables.pool}</span>
                <Select
                  value={variable.poolId}
                  onValueChange={(value) => patch(index, { poolId: value })}
                >
                  <SelectTrigger aria-label={copy.variables.pool}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {pools.map((pool) => (
                      <SelectItem key={pool.id} value={pool.id}>
                        {copy.variables.poolOption(pool.name, pool.nextValue, pool.digits)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Label>
            )}

            <p className="text-[11px] text-muted-foreground">
              {copy.variables.referenceHint(variable.name)}
            </p>

            {shadowed && (
              // Refused rather than resolved by precedence: a precedence rule
              // would let somebody change what an existing label prints by
              // adding a column, with no way to know what they shadowed.
              <p className="text-[11px] text-destructive">{copy.variables.collides(variable.name)}</p>
            )}
          </div>
        )
      })}

      <div className="flex gap-2">
        <Button variant="outline" size="sm" onClick={() => add('constant')}>
          {copy.variables.addConstant}
        </Button>
        <Button variant="outline" size="sm" onClick={() => add('sequence')} disabled={pools.length === 0}>
          {copy.variables.addSequence}
        </Button>
        <Button variant="ghost" size="sm" onClick={onCreatePool}>
          {copy.variables.newPool}
        </Button>
      </div>

      {unresolved.length > 0 && (
        <p className="text-[11px] text-destructive" data-unresolved>
          {copy.variables.unresolved(unresolved.join('、'))}
        </p>
      )}
    </div>
  )
}
