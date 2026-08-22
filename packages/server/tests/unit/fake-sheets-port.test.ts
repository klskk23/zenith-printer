/**
 * The fake that stands in for Google in every test.
 *
 * Worth testing in its own right: every other test in this feature trusts it,
 * so a fake that quietly returns the wrong shape would make a whole suite green
 * about nothing. `failWith` matters most — `timeout` and `rateLimited` are
 * nearly impossible to produce on demand against the real service, and they are
 * exactly the failures whose handling nobody would otherwise exercise.
 */
import { describe, expect, it } from 'vitest'
import { fakeSheetsPort } from '../../src/integrations/fake-sheets-port.ts'
import { SHEETS_ERROR_KINDS, SheetsError } from '../../src/domain/google-sheets.ts'

const SHEET = {
  title: '出货台账',
  worksheets: [
    { id: 0, title: '本月出货' },
    { id: 77, title: '存档' },
  ],
}

describe('the fake sheets port', () => {
  it('lists the worksheets it was given', async () => {
    const port = fakeSheetsPort({ spreadsheets: { 'sheet-1': SHEET } })
    await expect(port.listWorksheets('sheet-1')).resolves.toEqual(SHEET)
  })

  it('returns the values for one worksheet', async () => {
    const port = fakeSheetsPort({
      spreadsheets: { 'sheet-1': SHEET },
      values: { 'sheet-1/本月出货': [['订单号'], ['A-001']] },
    })
    await expect(port.readWorksheet('sheet-1', '本月出货')).resolves.toEqual([['订单号'], ['A-001']])
  })

  it('reports an unknown spreadsheet as not found, not as an empty one', async () => {
    // An empty answer would look like a legitimately empty sheet, and the
    // caller would go on to create a zero-column data source from it.
    const port = fakeSheetsPort({})
    await expect(port.listWorksheets('nope')).rejects.toMatchObject({ kind: 'notFound' })
  })

  it('reports an unknown worksheet as missing', async () => {
    const port = fakeSheetsPort({ spreadsheets: { 'sheet-1': SHEET } })
    await expect(port.readWorksheet('sheet-1', '不存在')).rejects.toMatchObject({
      kind: 'worksheetMissing',
    })
  })

  it('can produce every failure the contract names', async () => {
    // The whole point of the fake. If a kind cannot be produced here, the code
    // that handles it has no test anywhere.
    for (const kind of SHEETS_ERROR_KINDS) {
      const port = fakeSheetsPort({ failWith: kind })
      await expect(port.listWorksheets('sheet-1')).rejects.toBeInstanceOf(SheetsError)
      await expect(port.readWorksheet('sheet-1', 'x')).rejects.toMatchObject({ kind })
    }
  })

  it('counts its calls, so "did not touch Google" is assertable', async () => {
    const port = fakeSheetsPort({ spreadsheets: { 'sheet-1': SHEET } })
    await port.listWorksheets('sheet-1')
    await port.listWorksheets('sheet-1')
    expect(port.calls.listWorksheets).toBe(2)
    expect(port.calls.readWorksheet).toBe(0)
  })
})
