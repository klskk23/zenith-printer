/**
 * The position correction reaches the print path.
 *
 * It used to be passed only on the preview path. A saved offset therefore moved
 * the preview and left the printed label exactly where it was — the one
 * combination that gives no sign anything is wrong, because the screen agrees
 * with what was asked for.
 *
 * The harness's render stub used to ignore its arguments entirely, which is why
 * nothing noticed.
 */
import { describe, expect, it } from 'vitest'
import { createHarness, SNAPSHOT } from '../support/queue-harness.ts'

describe('the queue passes the correction to the renderer', () => {
  it('passes the offset recorded on the job', async () => {
    const h = createHarness()
    const printerId = h.seedPrinter()
    h.enqueue(printerId, 1, {
      snapshot: { ...SNAPSHOT, offsetXDots: 4, offsetYDots: -3 },
    })

    await h.queue.drain(printerId)

    expect(h.renderOffsets[0]).toEqual({ offsetXDots: 4, offsetYDots: -3 })
  })

  it('passes zero when nothing was corrected', async () => {
    const h = createHarness()
    const printerId = h.seedPrinter()
    h.enqueue(printerId, 1)

    await h.queue.drain(printerId)

    expect(h.renderOffsets[0]).toEqual({ offsetXDots: 0, offsetYDots: 0 })
  })

  it('applies it to every copy in a batch', async () => {
    const h = createHarness()
    const printerId = h.seedPrinter()
    h.enqueue(printerId, 3, {
      snapshot: { ...SNAPSHOT, offsetXDots: 2, offsetYDots: 2 },
      seqRanges: { serial: { start: 1, end: 3, step: 1, digits: 3 } },
    })

    await h.queue.drain(printerId)

    // Per-copy content means one render per copy; each must be corrected.
    expect(h.renderOffsets.length).toBeGreaterThan(1)
    for (const offset of h.renderOffsets) {
      expect(offset).toEqual({ offsetXDots: 2, offsetYDots: 2 })
    }
  })

  /**
   * Taken from the job's snapshot rather than from the printer as it stands
   * now: the correction was captured at submission, and the printer is expected
   * to be recalibrated between then and printing.
   */
  it('uses the snapshot rather than the printer’s current value', async () => {
    const h = createHarness()
    const printerId = h.seedPrinter()
    h.enqueue(printerId, 1, {
      snapshot: { ...SNAPSHOT, offsetXDots: 7, offsetYDots: 0 },
    })

    // Recalibrated after the job was queued.
    h.db.prepare('UPDATE printers SET offset_x_dots = 99 WHERE id = ?').run(printerId)

    await h.queue.drain(printerId)

    expect(h.renderOffsets[0]?.offsetXDots).toBe(7)
  })
})
