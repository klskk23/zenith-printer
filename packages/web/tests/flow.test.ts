/**
 * The four steps, as arithmetic.
 *
 * Reachability, the total and the reason printing is blocked are decided here
 * rather than inside a component, because all three are asked in more than one
 * place: the step bar draws them, the print step disables a button by them, the
 * confirm step refuses to open on them. A rule with three readers belongs in a
 * function with tests.
 */
import { describe, expect, it } from 'vitest'
import { blockReason, stepsFor, tally, type StepId } from '../src/features/print/flow.ts'
import { copy } from '../src/i18n/index.ts'

const caps = {
  dpi: 203, printheadPixels: 384, densityMin: 1, densityMax: 5, densityDefault: 3,
  paperTypes: [1], printDirection: 'top' as const, supportsConsumableLevel: true,
  model: 'B1', serial: null, firmwareVersion: null,
}
const printer = (capabilities: typeof caps | null = caps) => ({
  id: 'prn-1', name: '前台机', kind: 'niimbot' as const, transport: 'serial' as const, address: '/dev/a',
  capabilities, queueState: 'running' as const, queuePausedReason: null,
  lastProbedAt: null, createdAt: 'T', offsetXDots: 0, offsetYDots: 0,
})

const states = (input: Parameters<typeof stepsFor>[0]): Record<StepId, string> =>
  Object.fromEntries(stepsFor(input).map((step) => [step.id, step.state])) as Record<StepId, string>

describe('stepsFor', () => {
  it('always lists the four steps in order', () => {
    expect(stepsFor({ page: 'labels', canSubmit: false }).map((s) => s.id))
      .toEqual(['labels', 'design', 'print', 'confirm'])
    expect(stepsFor({ page: 'labels', canSubmit: false }).map((s) => s.ordinal)).toEqual([1, 2, 3, 4])
  })

  it('marks the gallery as the first step', () => {
    expect(states({ page: 'labels', canSubmit: false })).toEqual({
      labels: 'current', design: 'ahead', print: 'ahead', confirm: 'ahead',
    })
  })

  it('marks the design step, with the gallery behind it', () => {
    expect(states({ page: 'label', canSubmit: false })).toEqual({
      labels: 'past', design: 'current', print: 'ahead', confirm: 'ahead',
    })
  })

  it('blocks the confirm step while there is nothing to submit', () => {
    expect(states({ page: 'label-print', canSubmit: false })).toEqual({
      labels: 'past', design: 'past', print: 'current', confirm: 'blocked',
    })
  })

  it('opens the confirm step once there is', () => {
    expect(states({ page: 'label-print', canSubmit: true })).toEqual({
      labels: 'past', design: 'past', print: 'current', confirm: 'ahead',
    })
  })

  it('puts everything behind the confirm step', () => {
    expect(states({ page: 'label-confirm', canSubmit: true })).toEqual({
      labels: 'past', design: 'past', print: 'past', confirm: 'current',
    })
  })
})

describe('tally', () => {
  it('counts one label per copy when no table is bound', () => {
    expect(tally({ boundRows: null, chosenRows: 0, copies: 3 }).labels).toBe(3)
  })

  it('multiplies the chosen rows by the copies', () => {
    expect(tally({ boundRows: 1284, chosenRows: 3, copies: 2 }).labels).toBe(6)
  })

  it('is zero when a bound table has nothing chosen', () => {
    expect(tally({ boundRows: 1284, chosenRows: 0, copies: 2 }).labels).toBe(0)
  })

  it('estimates the time from the count, rounded up', () => {
    // An order of magnitude, never a promise: the capabilities carry no speed.
    expect(tally({ boundRows: null, chosenRows: 0, copies: 1 }).seconds).toBe(2)
    expect(tally({ boundRows: 1284, chosenRows: 3, copies: 1 }).seconds).toBe(4)
    expect(tally({ boundRows: null, chosenRows: 0, copies: 0 }).seconds).toBe(0)
  })
})

describe('blockReason', () => {
  const base = {
    printer: printer(),
    unresolved: [] as readonly string[],
    dataSourceId: null as string | null,
    chosenRows: 0,
    labels: 1,
  }

  it('lets a plain single label through', () => {
    expect(blockReason(base)).toBeNull()
  })

  it('asks for a printer first', () => {
    expect(blockReason({ ...base, printer: null })).toBe(copy.print.needsPrinter)
  })

  it('refuses a printer nobody has probed', () => {
    expect(blockReason({ ...base, printer: printer(null) })).toBe(copy.print.needsProbe)
  })

  it('refuses content with a reference nothing resolves', () => {
    // The label would come out reading "${sku}" — waste that looks like output.
    expect(blockReason({ ...base, unresolved: ['sku'] })).toContain('sku')
  })

  it('asks for rows when a table is bound', () => {
    expect(blockReason({ ...base, dataSourceId: 'ds-1', chosenRows: 0, labels: 0 }))
      .toBe(copy.rowSelection.none)
  })

  it('refuses a batch over the per-job ceiling', () => {
    expect(blockReason({ ...base, dataSourceId: 'ds-1', chosenRows: 2000, labels: 2000 }))
      .toContain('2000')
  })

  it('reports the printer before anything else', () => {
    // Order matters: the first thing to fix should be the first thing said.
    expect(blockReason({ ...base, printer: null, unresolved: ['sku'], dataSourceId: 'ds-1', labels: 0 }))
      .toBe(copy.print.needsPrinter)
  })
})
