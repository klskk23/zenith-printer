import { describe, expect, it } from 'vitest'
import { openDatabase } from '../../src/db/index.ts'
import { bindingIssueFor, templatesUsingDataSource } from '../../src/domain/template-refs.ts'
import { DataSourceRepo } from '../../src/db/repositories/data-source-repo.ts'
import { TemplateRepo } from '../../src/db/repositories/template-repo.ts'
import { FixedClock, SequentialIdGenerator } from '../../src/clock.ts'

/**
 * Whether a design can still resolve its references.
 *
 * The reason this is computed and not stored is the whole point of the tests
 * below: a stored copy drifts from the data source, and it drifts in exactly
 * one direction — towards "looks fine, is actually broken".
 */
function harness() {
  const db = openDatabase({ location: ':memory:' })
  const clock = new FixedClock('2026-08-22T00:00:00Z')
  let n = 0
  const ids = new SequentialIdGenerator('id')
  const sources = new DataSourceRepo({ db, clock, ids })
  const templates = new TemplateRepo({ db, clock, ids })

  const design = (dataSourceId: string | null, content = '${收件人}', variables: never[] = []) =>
    templates.create({
      name: `设计${(n += 1)}`,
      printerKind: 'niimbot',
      widthMm: 50,
      heightMm: 30,
      dpi: 203,
      elements: [
        {
          id: 't', type: 'text', xMm: 2, yMm: 2, widthMm: 40, heightMm: 5, rotation: 0,
          content, fontFamily: 'F', fontSizeMm: 3, bold: false, align: 'left', inverted: false,
        },
      ],
      variables,
      dataSourceId,
    })

  return { db, sources, templates, design }
}

describe('a design with no data source', () => {
  it('has no binding issue, whatever its content says', () => {
    const h = harness()
    expect(bindingIssueFor(h.db, h.design(null, '${随便什么}'))).toBeNull()
  })
})

describe('a design bound to a table that is present', () => {
  it('has no issue when every reference is a column', () => {
    const h = harness()
    const source = h.sources.create({
      name: '订单表',
      columns: ['订单号', '收件人'],
      rows: [{ 订单号: 'A', 收件人: '张三' }],
    })
    expect(bindingIssueFor(h.db, h.design(source.id))).toBeNull()
  })

  it('reports a reference no column and no variable covers', () => {
    const h = harness()
    const source = h.sources.create({ name: '订单表', columns: ['订单号'], rows: [] })
    expect(bindingIssueFor(h.db, h.design(source.id))).toEqual({
      kind: 'columnsMissing',
      columns: ['收件人'],
    })
  })

  it('does not report a name the design defines itself', () => {
    const h = harness()
    const source = h.sources.create({ name: '订单表', columns: ['订单号'], rows: [] })
    const template = h.design(source.id, '${sku}', [
      { name: 'sku', kind: 'constant', value: 'X' },
    ] as never)
    expect(bindingIssueFor(h.db, template)).toBeNull()
  })
})

describe('the state that must be visible', () => {
  it('is computed on read: deleting the table changes the answer with no write in between', () => {
    // This is the assertion a stored copy cannot pass. Nothing touches the
    // template row between the two reads.
    const h = harness()
    const source = h.sources.create({ name: '订单表', columns: ['收件人'], rows: [] })
    const template = h.design(source.id)

    expect(bindingIssueFor(h.db, template)).toBeNull()

    h.sources.delete(source.id)

    expect(bindingIssueFor(h.db, h.templates.find(template.id)!)).toEqual({ kind: 'sourceMissing' })
  })

  it('notices a column that a replacement took away', () => {
    const h = harness()
    const source = h.sources.create({ name: '订单表', columns: ['收件人'], rows: [] })
    const template = h.design(source.id)

    h.sources.replace(source.id, ['电话'], [])

    expect(bindingIssueFor(h.db, h.templates.find(template.id)!)).toEqual({
      kind: 'columnsMissing',
      columns: ['收件人'],
    })
  })

  it('does not clear the binding when the table goes', () => {
    // "Bound to a table that is gone" and "never bound to anything" are
    // different situations for whoever has to fix it, and only the first one
    // should produce a warning.
    const h = harness()
    const source = h.sources.create({ name: '订单表', columns: ['收件人'], rows: [] })
    const template = h.design(source.id)

    h.sources.delete(source.id)

    expect(h.templates.find(template.id)?.dataSourceId).toBe(source.id)
  })

  it('clears once the design is rebound to a table of the same shape', () => {
    const h = harness()
    const gone = h.sources.create({ name: '旧表', columns: ['收件人'], rows: [] })
    const template = h.design(gone.id)
    h.sources.delete(gone.id)

    const replacement = h.sources.create({ name: '新表', columns: ['收件人'], rows: [] })
    h.templates.update(
      template.id,
      { ...template, dataSourceId: replacement.id },
      template.version,
    )

    expect(bindingIssueFor(h.db, h.templates.find(template.id)!)).toBeNull()
  })
})

describe('templatesUsingDataSource', () => {
  it('finds designs by their binding, not by scanning content', () => {
    const h = harness()
    const source = h.sources.create({ name: '订单表', columns: ['收件人'], rows: [] })
    const bound = h.design(source.id)
    h.design(null, '${收件人}')

    const found = templatesUsingDataSource(h.db, source.id)
    expect(found.map((t) => t.id)).toEqual([bound.id])
  })

  it('does not mistake a constant that happens to share the table name', () => {
    // The content scan this replaces produced exactly this false positive.
    const h = harness()
    const source = h.sources.create({ name: '订单表', columns: ['收件人'], rows: [] })
    h.design(null, '${订单表}', [{ name: '订单表', kind: 'constant', value: 'X' }] as never)

    expect(templatesUsingDataSource(h.db, source.id)).toEqual([])
  })

  it('lists the columns each design depends on', () => {
    const h = harness()
    const source = h.sources.create({ name: '订单表', columns: ['收件人', '电话'], rows: [] })
    h.design(source.id, '${收件人} ${电话}')

    expect(templatesUsingDataSource(h.db, source.id)[0]?.columns).toEqual(['收件人', '电话'])
  })
})
