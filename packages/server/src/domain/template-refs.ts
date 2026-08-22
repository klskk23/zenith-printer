/**
 * Which designs depend on a data source, and on which of its columns.
 *
 * The binding is a column on `templates`, so finding the designs is one indexed
 * lookup rather than a scan through every design's content. That also removes a
 * class of false positive the content scan had: a design with a constant that
 * happened to share a name with a data source used to look like a user of it.
 */
import { collectReferences, type LabelIR } from '@zenith/shared'
import type { Database } from '../db/index.ts'

export interface TemplateRef {
  id: string
  name: string
  /** Names the content references, minus the ones the design defines itself. */
  columns: string[]
}

type Row = Record<string, unknown>

function columnsReferenced(row: Row): string[] {
  let elements: unknown
  try {
    elements = JSON.parse(String(row.elements))
  } catch {
    return []
  }
  if (!Array.isArray(elements)) {
    return []
  }

  let declared: string[] = []
  try {
    const variables = JSON.parse(String(row.variables ?? '[]')) as Array<{ name?: unknown }>
    declared = variables.map((variable) => String(variable.name))
  } catch {
    declared = []
  }

  const ir = { widthMm: 0, heightMm: 0, dpi: 203, elements } as unknown as LabelIR
  const own = new Set(declared)
  return collectReferences(ir).filter((name) => !own.has(name))
}

/** Designs bound to this data source. */
export function templatesUsingDataSource(db: Database, sourceId: string): TemplateRef[] {
  return db
    .prepare('SELECT id, name, elements, variables FROM templates WHERE data_source_id = ?')
    .all(sourceId)
    .map((row) => ({
      id: String((row as Row).id),
      name: String((row as Row).name),
      columns: columnsReferenced(row as Row),
    }))
}

/**
 * Designs that would lose a reference if these columns disappeared.
 *
 * Used before replacing a table: the confirmation names the column *and* the
 * designs, which is the information worth having at that moment. Deleting the
 * whole table can say neither, which is why deletion is not gated the same way.
 */
export function templatesBrokenByRemoving(
  db: Database,
  sourceId: string,
  removedColumns: readonly string[],
): TemplateRef[] {
  const removed = new Set(removedColumns)
  return templatesUsingDataSource(db, sourceId)
    .map((template) => ({ ...template, columns: template.columns.filter((name) => removed.has(name)) }))
    .filter((template) => template.columns.length > 0)
}

export type BindingIssue =
  | { kind: 'sourceMissing' }
  | { kind: 'columnsMissing'; columns: string[] }

/**
 * Why a design cannot resolve its references right now.
 *
 * Computed on read, never stored. A stored copy drifts from the data source,
 * and it drifts in exactly one direction: towards "looks fine, is actually
 * broken" (FR-028a).
 */
export function bindingIssueFor(
  db: Database,
  template: { dataSourceId: string | null; elements: unknown; variables: Array<{ name: string }> },
): BindingIssue | null {
  if (template.dataSourceId === null) {
    return null
  }

  const source = db
    .prepare('SELECT columns FROM data_sources WHERE id = ?')
    .get(template.dataSourceId)
  if (source === undefined) {
    return { kind: 'sourceMissing' }
  }

  const columns = new Set(JSON.parse(String((source as Row).columns)) as string[])
  const declared = new Set(template.variables.map((variable) => variable.name))
  const ir = { widthMm: 0, heightMm: 0, dpi: 203, elements: template.elements } as unknown as LabelIR
  const missing = collectReferences(ir).filter(
    (name) => !declared.has(name) && !columns.has(name),
  )

  return missing.length > 0 ? { kind: 'columnsMissing', columns: missing } : null
}
