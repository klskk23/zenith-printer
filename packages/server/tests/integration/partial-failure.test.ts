import { describe, expect, it } from 'vitest'
import { createHarness } from '../support/queue-harness.ts'

/**
 * A large batch that fails partway.
 *
 * The number that matters is `pagesPrinted`: it is what a reprint of the
 * remainder is calculated from, and getting it wrong means either reprinting
 * labels that already exist or skipping ones that do not. Null is a distinct
 * answer — "we cannot say" — and must not be quietly turned into zero.
 */
describe('a batch interrupted mid-run', () => {
  it('records the pages that actually came out, not the ones that were asked for', async () => {
    const h = createHarness(() => ({
      failAfterPages: { pages: 137, error: new Error('cable pulled') },
    }))
    const printerId = h.seedPrinter()
    const jobId = h.enqueue(printerId, 500, {
      seqClaims: [{ poolId: 'pool-1', variableName: 'serial', start: 1, end: 500, step: 1, digits: 4 }],
    })

    await h.queue.drain(printerId)

    const job = h.jobs.find(jobId)
    expect(job?.status).toBe('failed')
    expect(job?.pagesPrinted).toBe(137)
  })

  it('leaves a remainder that reprints exactly the labels still owed', async () => {
    const h = createHarness(() => ({ failAfterPages: { pages: 10, error: new Error('cable pulled') } }))
    const printerId = h.seedPrinter()
    const jobId = h.enqueue(printerId, 50, {
      seqClaims: [{ poolId: 'pool-1', variableName: 'serial', start: 1, end: 50, step: 1, digits: 4 }],
    })

    await h.queue.drain(printerId)

    const job = h.jobs.find(jobId)
    expect(job?.requestedCopies).toBe(50)
    expect((job?.requestedCopies ?? 0) - (job?.pagesPrinted ?? 0)).toBe(40)
  })

  it('does not render the pages it never reached', async () => {
    // The other half of streaming: a job that dies at page ten should not have
    // paid for five hundred renders.
    const h = createHarness(() => ({ failAfterPages: { pages: 10, error: new Error('cable pulled') } }))
    const printerId = h.seedPrinter()
    h.enqueue(printerId, 500, {
      seqClaims: [{ poolId: 'pool-1', variableName: 'serial', start: 1, end: 500, step: 1, digits: 4 }],
    })

    await h.queue.drain(printerId)

    expect(h.renderCalls.length).toBeLessThanOrEqual(11)
  })

  it('had rendered nothing before the driver began', async () => {
    const h = createHarness(() => ({ failAfterPages: { pages: 10, error: new Error('cable pulled') } }))
    const printerId = h.seedPrinter()
    h.enqueue(printerId, 500, {
      seqClaims: [{ poolId: 'pool-1', variableName: 'serial', start: 1, end: 500, step: 1, digits: 4 }],
    })

    await h.queue.drain(printerId)

    expect(h.drivers.get(printerId)?.rendersBeforeFirstPage).toBe(0)
  })
})
