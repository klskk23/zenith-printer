/**
 * Canonical vocabulary.
 *
 * Constitution Principle III.0: one concept keeps one name across the API,
 * the UI, the logs and the docs. The classic failure is print darkness showing
 * up as `density` in one place and `darkness` or `heat` in another, which
 * quietly breaks every script a user has written.
 *
 * These are the wire names. Anything user-facing is translated in the i18n
 * layer; nothing here is ever shown to a person directly.
 */
export const TERMS = {
  /** Print darkness. Never "darkness", never "heat". */
  density: 'density',
  /** Media type: gap / black mark / continuous. Never "paperType". */
  labelType: 'labelType',
  /** Copies requested for one job. Never "quantity" or "count". */
  copies: 'copies',
  /** Copies physically produced so far. Null means unknown. */
  pagesPrinted: 'pagesPrinted',
  /** Reusable print settings bound to a printer. Never "preset". */
  profile: 'profile',
  /** Reusable label design. Never "layout" or "design". */
  template: 'template',
  /** A named value referenced as ${name}. Never "field" or "placeholder". */
  variable: 'variable',
  /** One table of rows, referenced by a design. Never "dataset" or "sheet". */
  dataSource: 'dataSource',
  /** Standalone counter a design can draw serials from. Never "counter". */
  sequencePool: 'sequencePool',
  /** Which rows of a data source one job prints. Never "filter". */
  rowSelection: 'rowSelection',
  /** Printhead resolution in dots per inch. */
  dpi: 'dpi',
  /** Position correction applied at render time, stored in millimetres. */
  offsetXMm: 'offsetXMm',
  offsetYMm: 'offsetYMm',
} as const

export type Term = keyof typeof TERMS

/** Names that must never appear in code, API fields, logs or UI copy. */
export const FORBIDDEN_SYNONYMS: Readonly<Record<string, Term>> = {
  darkness: 'density',
  heat: 'density',
  paperType: 'labelType',
  mediaType: 'labelType',
  quantity: 'copies',
  count: 'copies',
  preset: 'profile',
  layout: 'template',
  design: 'template',
  placeholder: 'variable',
  field: 'variable',
  variableField: 'variable',
  dataset: 'dataSource',
  sheet: 'dataSource',
  counter: 'sequencePool',
  filter: 'rowSelection',
  resolution: 'dpi',
}
