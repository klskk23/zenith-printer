/**
 * What the status strip says, decided without rendering it.
 *
 * The strip is the one place the labels page speaks about the machines, so
 * the rules for what it says — and what it refuses to pretend — live in a
 * pure function. The one that matters most: a printer that cannot report
 * its stock is *told about*, not left blank. Blank looks like "no data yet";
 * it means "this model stops mid-batch without warning".
 */
import { describe, expect, it } from 'vitest'
import { summarize } from '../src/app/status-summary.ts'
import type { Printer } from '../src/api/types.ts'
import type { PrintJob } from '../src/features/jobs/hooks.ts'

const printer = (over: Partial<Printer>): Printer =>
  ({
    id: 'p', name: 'P', kind: 'niimbot', transport: 'serial', address: '/dev/a',
    capabilities: null, queueState: 'running', queuePausedReason: null, lastProbedAt: null,
    createdAt: 'T', offsetXDots: 0, offsetYDots: 0,
    ...over,
  }) as Printer

const caps = (supportsConsumableLevel: boolean): Printer['capabilities'] =>
  ({ dpi: 203, printheadPixels: 384, densityMin: 1, densityMax: 5, densityDefault: 3, paperTypes: [1],
    printDirection: 'top', supportsConsumableLevel, model: null, serial: null, firmwareVersion: null })

const job = (over: Partial<PrintJob>): PrintJob =>
  ({
    id: 'j', printerId: 'p', status: 'completed', requestedCopies: 1, pagesPrinted: 1,
    failureCode: null, failureMessage: null,
    snapshot: { templateName: '货架标签', widthMm: 50, heightMm: 30, printerKind: 'niimbot' },
    createdAt: '2026-09-21T09:00:00.000Z', startedAt: null, finishedAt: '2026-09-21T09:00:05.000Z',
    ...over,
  }) as PrintJob

describe('printers', () => {
  it('says whether each has been probed and what it can tell about stock', () => {
    const summary = summarize(
      [
        printer({ id: 'a', name: 'A', capabilities: caps(true) }),
        printer({ id: 'b', name: 'B', capabilities: caps(false) }),
        printer({ id: 'c', name: 'C', capabilities: null }),
      ],
      [],
    )
    expect(summary.printers.map((p) => [p.id, p.consumable.kind])).toEqual([
      ['a', 'supported'],
      ['b', 'unsupported'],
      ['c', 'not-probed'],
    ])
  })

  it('counts each printer\'s own pending jobs', () => {
    const summary = summarize(
      [printer({ id: 'a' }), printer({ id: 'b' })],
      [
        job({ id: '1', printerId: 'a', status: 'queued', finishedAt: null }),
        job({ id: '2', printerId: 'a', status: 'printing', finishedAt: null }),
        job({ id: '3', printerId: 'b', status: 'completed' }),
      ],
    )
    expect(summary.printers.map((p) => p.pending)).toEqual([2, 0])
  })
})

describe('the queue', () => {
  it('is running when every printer runs, and counts what is waiting', () => {
    const summary = summarize(
      [printer({ id: 'a' }), printer({ id: 'b' })],
      [job({ status: 'queued', finishedAt: null }), job({ id: 'k', status: 'failed' })],
    )
    expect(summary.queue).toEqual({ state: 'running', pending: 1 })
  })

  it('is paused when any printer is', () => {
    const summary = summarize([printer({ id: 'a' }), printer({ id: 'b', queueState: 'paused' })], [])
    expect(summary.queue?.state).toBe('paused')
  })

  it('is absent when there are no printers', () => {
    expect(summarize([], []).queue).toBeNull()
  })
})

describe('the last print', () => {
  it('is the most recently finished job, by finish time', () => {
    const summary = summarize(
      [printer({})],
      [
        job({ id: 'older', finishedAt: '2026-09-21T08:00:00.000Z', snapshot: { templateName: '旧', widthMm: 1, heightMm: 1, printerKind: 'niimbot' } }),
        job({ id: 'newer', finishedAt: '2026-09-21T10:00:00.000Z', status: 'failed' }),
        job({ id: 'unfinished', finishedAt: null, status: 'queued', createdAt: '2026-09-21T11:00:00.000Z' }),
      ],
    )
    expect(summary.lastPrint).toEqual({ jobId: 'newer', labelName: '货架标签', status: 'failed' })
  })

  it('names an unsaved label honestly', () => {
    const summary = summarize([printer({})], [job({ snapshot: { templateName: null, widthMm: 1, heightMm: 1, printerKind: 'niimbot' } })])
    expect(summary.lastPrint?.labelName).toBeNull()
  })

  it('is absent when nothing has finished', () => {
    expect(summarize([printer({})], [job({ finishedAt: null, status: 'queued' })]).lastPrint).toBeNull()
  })

  it('copes with data that has not arrived', () => {
    expect(summarize(undefined, undefined)).toEqual({ printers: [], queue: null, lastPrint: null })
  })
})
