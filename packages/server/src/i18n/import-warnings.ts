/**
 * What an import has to say about itself.
 *
 * Worded here, on the server, and sent as text alongside the structured code.
 * The same rule the error bodies follow: the side that knows what happened
 * words it once, and the browser and the command line both show that wording
 * rather than each inventing their own. One fault, one description.
 *
 * The `code` travels too, so a script can branch without matching prose.
 */
import type { ImportWarning } from '../domain/template-io.ts'
import type { Locale } from './types.ts'

type Detail = ImportWarning['detail']

const list = (value: Detail[string] | undefined): string =>
  Array.isArray(value) ? value.join('、') : String(value ?? '')

const listEn = (value: Detail[string] | undefined): string =>
  Array.isArray(value) ? value.join(', ') : String(value ?? '')

const zh: Record<ImportWarning['code'], (d: Detail) => string> = {
  DATA_SOURCE_MISSING: (d) =>
    `本机没有它绑定的数据源「${String(d.sourceName)}」，需要这些列：${list(d.columns)}。设计已导入，绑一张同形状的表即可使用`,
  DATA_SOURCE_MATCHED_BY_NAME: (d) =>
    `已绑到本机同名的数据源「${String(d.sourceName)}」——同名不一定是同一张表，请确认`,
  DATA_SOURCE_COLUMNS_DIFFER: (d) =>
    `「${String(d.sourceName)}」里没有这些列：${list(d.columns)}。设计里引用它们的地方会取不到值`,
  SEQUENCE_POOL_MATCHED_BY_NAME: (d) =>
    `变量「${String(d.variable)}」已指向本机同名的序号池「${String(d.poolName)}」——它的号会从那个计数器继续，请确认不是另一条产品线的`,
  SEQUENCE_POOL_CREATED: (d) =>
    `已新建序号池「${String(d.poolName)}」，从 ${String(d.firstNumber)} 开始`,
  LABEL_WIDER_THAN_ANY_PRINTER: (d) =>
    `标签宽 ${String(d.widthMm)} mm，超过本机最宽的打印机（${String(d.maxLabelWidthMm)} mm）。设计已导入，换台够宽的机器才能打`,
}

const en: Record<ImportWarning['code'], (d: Detail) => string> = {
  DATA_SOURCE_MISSING: (d) =>
    `The data source it was bound to, "${String(d.sourceName)}", is not on this machine. It expects these columns: ${listEn(d.columns)}. The design is imported; bind a table of the same shape to use it`,
  DATA_SOURCE_MATCHED_BY_NAME: (d) =>
    `Bound to "${String(d.sourceName)}" on this machine, matched by name — the same name is not necessarily the same table, so please check`,
  DATA_SOURCE_COLUMNS_DIFFER: (d) =>
    `"${String(d.sourceName)}" does not have these columns: ${listEn(d.columns)}. References to them will resolve to nothing`,
  SEQUENCE_POOL_MATCHED_BY_NAME: (d) =>
    `Variable "${String(d.variable)}" now points at the pool named "${String(d.poolName)}" on this machine — its serials continue from that counter, so check it is not another product line's`,
  SEQUENCE_POOL_CREATED: (d) =>
    `Created the sequence pool "${String(d.poolName)}", starting at ${String(d.firstNumber)}`,
  LABEL_WIDER_THAN_ANY_PRINTER: (d) =>
    `The label is ${String(d.widthMm)} mm wide, more than the widest printer here can image (${String(d.maxLabelWidthMm)} mm). The design is imported; printing it needs a wider machine`,
}

export function renderWarning(warning: ImportWarning, locale: Locale): string {
  const table = locale === 'en-US' ? en : zh
  return table[warning.code](warning.detail)
}
