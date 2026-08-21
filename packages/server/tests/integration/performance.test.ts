/**
 * Performance budgets.
 *
 * Two numbers from the spec, both about how long somebody waits:
 *
 *   SC-005 submission is acknowledged within 2 seconds
 *   plan.md a single label renders in under 200ms
 *
 * The hundred-copy end-to-end target (SC-004, five minutes) is not here: it is
 * dominated by how fast paper physically moves, so it belongs in a hardware
 * run, not in a suite that must pass with no printer attached.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import type { FastifyInstance } from 'fastify'
import { labelIrSchema } from '@zenith/shared'
import { buildApp } from '../../src/app.ts'
import { openDatabase } from '../../src/db/index.ts'
import { FixedClock, SequentialIdGenerator } from '../../src/clock.ts'
import { PrinterRepo } from '../../src/db/repositories/printer-repo.ts'
import { renderLabel } from '../../src/render/pipeline.ts'
import { loadFontConfig, FONT_FAMILIES } from '../../src/render/fonts.ts'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '../../../..')
const fonts = loadFontConfig(join(repoRoot, 'fonts'))

const RENDER_BUDGET_MS = 200
const SUBMIT_BUDGET_MS = 2000

/** A label with everything on it: CJK text, a barcode, a rule and a box. */
const RICH_IR = labelIrSchema.parse({
  widthMm: 50,
  heightMm: 30,
  dpi: 203,
  elements: [
    { id: 't', type: 'text', xMm: 2, yMm: 2, widthMm: 44, heightMm: 6, content: '仓库物料标签', fontFamily: FONT_FAMILIES.sans, fontSizeMm: 4, bold: true },
    { id: 'b', type: 'barcode', xMm: 2, yMm: 9, widthMm: 44, heightMm: 11, content: 'ABC-12345', symbology: 'code128' },
    { id: 'l', type: 'line', xMm: 2, yMm: 21, x2Mm: 48, y2Mm: 21, strokeWidthDots: 1 },
    { id: 'r', type: 'rect', xMm: 36, yMm: 22, widthMm: 12, heightMm: 6, strokeWidthDots: 2 },
  ],
})

let app: FastifyInstance

function seedPrinter(): string {
  const repo = new PrinterRepo({ db: app.ctx.db, clock: app.ctx.clock, ids: app.ctx.ids })
  const printer = repo.create({
    name: 'w',
    kind: 'niimbot',
    transport: 'serial',
    address: '/dev/ttyACM0',
    printTaskName: 'B1',
  })
  repo.saveCapabilities(printer.id, {
    dpi: 203,
    printheadPixels: 576,
    densityMin: 1,
    densityMax: 5,
    densityDefault: 3,
    paperTypes: [1],
    printDirection: 'top',
    supportsConsumableLevel: true,
    model: 'B3S_P',
    serial: null,
    firmwareVersion: null,
  })
  return printer.id
}

beforeEach(async () => {
  app = buildApp({
    db: openDatabase({ location: ':memory:' }),
    clock: new FixedClock('2026-08-21T00:00:00Z'),
    idGenerator: new SequentialIdGenerator('p'),
    logLevel: 'error',
    enableQueue: false,
  })
  await app.ready()
})

afterEach(async () => {
  await app.close()
})

function elapsedMs(fn: () => void): number {
  const started = process.hrtime.bigint()
  fn()
  return Number(process.hrtime.bigint() - started) / 1e6
}

describe('rendering', () => {
  it('renders a full label within budget', () => {
    // Warm once: the first call pays for font parsing, which a real server
    // does at boot rather than per label.
    renderLabel({ ir: RICH_IR, fonts })
    expect(elapsedMs(() => void renderLabel({ ir: RICH_IR, fonts }))).toBeLessThan(RENDER_BUDGET_MS)
  })

  it('stays within budget on the median of ten renders', () => {
    renderLabel({ ir: RICH_IR, fonts })
    const samples = Array.from({ length: 10 }, () =>
      elapsedMs(() => void renderLabel({ ir: RICH_IR, fonts })),
    ).sort((a, b) => a - b)
    expect(samples[5]).toBeLessThan(RENDER_BUDGET_MS)
  })

  /**
   * The runner's own timeout has to sit above the budget being asserted.
   *
   * It did not: vitest defaults to five seconds and the budget here is twenty,
   * so the assertion was unreachable — the test was killed at five seconds
   * whatever it was about to conclude. A hundred renders take about three and
   * a half seconds alone and four and a half alongside the rest of the suite,
   * which left an eight percent margin against a limit that had nothing to do
   * with the thing being measured. It went red roughly once in five full runs,
   * always here, and always without an assertion message — because a timeout
   * has none, which is what made it look like noise for so long.
   *
   * Derived from the budget rather than written out, so the two cannot drift
   * apart again.
   */
  it(
    'renders a hundred copies well inside the batch budget',
    () => {
      // Sequence fields make every copy a separate render, so the batch cost is
      // a hundred renders plus transfer — the paper is the slow part, not this.
      renderLabel({ ir: RICH_IR, fonts })
      const total = elapsedMs(() => {
        for (let i = 0; i < 100; i += 1) {
          renderLabel({ ir: RICH_IR, fonts })
        }
      })
      expect(total).toBeLessThan(100 * RENDER_BUDGET_MS)
    },
    100 * RENDER_BUDGET_MS + 10_000,
  )
})

describe('submission', () => {
  it('acknowledges a job well within the budget', async () => {
    // SC-005: nobody should hold a tab open waiting for labels.
    const printerId = seedPrinter()
    const started = process.hrtime.bigint()
    const res = await app.inject({
      method: 'POST',
      url: '/api/print-jobs',
      payload: { printerId, ir: RICH_IR, copies: 100 },
    })
    const took = Number(process.hrtime.bigint() - started) / 1e6

    expect(res.statusCode).toBe(202)
    expect(took).toBeLessThan(SUBMIT_BUDGET_MS)
  })

  it('does not slow down as the copy count grows', async () => {
    // Rendering happens in the runner, not in the request, so a hundred copies
    // must cost the same to accept as one.
    const printerId = seedPrinter()

    const time = async (copies: number): Promise<number> => {
      const started = process.hrtime.bigint()
      await app.inject({
        method: 'POST',
        url: '/api/print-jobs',
        payload: { printerId, ir: RICH_IR, copies },
        headers: { 'idempotency-key': `k-${copies}` },
      })
      return Number(process.hrtime.bigint() - started) / 1e6
    }

    await time(1)
    expect(await time(100)).toBeLessThan(SUBMIT_BUDGET_MS)
  })
})
