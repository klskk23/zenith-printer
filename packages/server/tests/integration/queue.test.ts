import { describe, expect, it } from 'vitest'
import { createHarness, PrinterDeviceError } from '../support/queue-harness.ts'

describe('serial execution', () => {
  it('runs jobs one at a time, in submission order', async () => {
    // Two jobs interleaving on one head produces a stack of labels nobody can
    // sort out. This is the correctness property, not an optimisation.
    const h = createHarness()
    const printerId = h.seedPrinter()
    const first = h.enqueue(printerId, 2)
    const second = h.enqueue(printerId, 3)

    await h.queue.drain(printerId)

    expect(h.jobs.find(first)?.status).toBe('completed')
    expect(h.jobs.find(second)?.status).toBe('completed')
    expect(h.jobs.find(first)?.finishedAt).not.toBeNull()
  })

  it('treats a second drain call while busy as a no-op', async () => {
    const h = createHarness(() => ({ pageDelayMs: 5 }))
    const printerId = h.seedPrinter()
    h.enqueue(printerId, 2)

    const a = h.queue.drain(printerId)
    const b = h.queue.drain(printerId)
    await Promise.all([a, b])

    // One connection, not two: the second call joined the first.
    expect(h.drivers.get(printerId)?.connectCount).toBe(1)
  })

  it('keeps separate printers independent', async () => {
    const h = createHarness()
    const one = h.seedPrinter('one')
    const two = h.seedPrinter('two')
    const jobOne = h.enqueue(one, 1)
    const jobTwo = h.enqueue(two, 1)

    await Promise.all([h.queue.drain(one), h.queue.drain(two)])

    expect(h.jobs.find(jobOne)?.status).toBe('completed')
    expect(h.jobs.find(jobTwo)?.status).toBe('completed')
  })

  it('stops when the queue is empty', async () => {
    const h = createHarness()
    const printerId = h.seedPrinter()
    await expect(h.queue.drain(printerId)).resolves.toBeUndefined()
    expect(h.drivers.size).toBe(0)
  })
})

describe('connection lifecycle', () => {
  it('opens and closes once per job', async () => {
    const h = createHarness()
    const printerId = h.seedPrinter()
    h.enqueue(printerId, 5)

    await h.queue.drain(printerId)

    const driver = h.drivers.get(printerId)
    expect(driver?.calls).toEqual(['connect', 'preflight', 'printPages', 'disconnect'])
  })

  it('releases the connection when printing fails', async () => {
    const h = createHarness(() => ({ failAfterPages: { pages: 1, error: new Error('jam') } }))
    const printerId = h.seedPrinter()
    h.enqueue(printerId, 5)

    await h.queue.drain(printerId)

    expect(h.drivers.get(printerId)?.disconnectCount).toBe(1)
  })
})

describe('unreachable printers', () => {
  it('fails the job immediately without retrying', async () => {
    // FR-047: no internal retry. The printer being off is the daily case, and
    // retrying it just delays the message telling somebody to switch it on.
    const h = createHarness(() => ({ unreachable: true }))
    const printerId = h.seedPrinter()
    const jobId = h.enqueue(printerId, 1)

    await h.queue.drain(printerId)

    const job = h.jobs.find(jobId)
    expect(job?.status).toBe('failed')
    expect(job?.failureCode).toBe('PRINTER_UNREACHABLE')
    expect(h.drivers.get(printerId)?.connectCount).toBe(1)
  })

  it('prints nothing at all', async () => {
    const h = createHarness(() => ({ unreachable: true }))
    const printerId = h.seedPrinter()
    const jobId = h.enqueue(printerId, 10)

    await h.queue.drain(printerId)

    expect(h.jobs.find(jobId)?.pagesPrinted).toBe(0)
  })
})

describe('pre-flight', () => {
  it('refuses a job larger than the remaining stock, before printing anything', async () => {
    // FR-015: the entire point is that nothing is burned before the check.
    const h = createHarness(() => ({ remainingLabels: 42 }))
    const printerId = h.seedPrinter()
    const jobId = h.enqueue(printerId, 80)

    await h.queue.drain(printerId)

    const job = h.jobs.find(jobId)
    expect(job?.status).toBe('failed')
    expect(job?.failureCode).toBe('INSUFFICIENT_CONSUMABLE')
    expect(job?.pagesPrinted).toBe(0)
    expect(h.drivers.get(printerId)?.calls).not.toContain('printPages')
  })

  it('reports both numbers so the user can act', async () => {
    const h = createHarness(() => ({ remainingLabels: 42 }))
    const printerId = h.seedPrinter()
    const jobId = h.enqueue(printerId, 80)

    await h.queue.drain(printerId)

    expect(h.jobs.find(jobId)?.failureMessage).toContain('42')
    expect(h.jobs.find(jobId)?.failureMessage).toContain('80')
  })

  it('prints anyway when the model cannot report stock', async () => {
    // FR-016: refusing to work with third-party media would be worse than
    // losing the advance warning.
    const h = createHarness(() => ({ remainingLabels: null }))
    const printerId = h.seedPrinter()
    const jobId = h.enqueue(printerId, 80)

    await h.queue.drain(printerId)

    expect(h.jobs.find(jobId)?.status).toBe('completed')
  })

  it('fails with the device reason when the lid is open', async () => {
    const h = createHarness(() => ({ blockers: [1] }))
    const printerId = h.seedPrinter()
    const jobId = h.enqueue(printerId, 1)

    await h.queue.drain(printerId)

    expect(h.jobs.find(jobId)?.failureCode).toBe('DEVICE_COVER_OPEN')
  })
})

describe('failure pauses the queue', () => {
  it('pauses the printer after a failure', async () => {
    // FR-021: whatever stopped this job stops the next one too.
    const h = createHarness(() => ({ unreachable: true }))
    const printerId = h.seedPrinter()
    h.enqueue(printerId, 1)

    await h.queue.drain(printerId)

    expect(h.printers.find(printerId)?.queueState).toBe('paused')
  })

  it('leaves the jobs behind it untouched rather than failing them all', async () => {
    const h = createHarness(() => ({ unreachable: true }))
    const printerId = h.seedPrinter()
    const first = h.enqueue(printerId, 1)
    const second = h.enqueue(printerId, 1)

    await h.queue.drain(printerId)

    expect(h.jobs.find(first)?.status).toBe('failed')
    // Still queued, so it can simply run once the fault is cleared — no
    // resubmission, no pile of identical error rows.
    expect(h.jobs.find(second)?.status).toBe('queued')
  })

  it('records why the queue stopped', async () => {
    const h = createHarness(() => ({ remainingLabels: 0 }))
    const printerId = h.seedPrinter()
    h.enqueue(printerId, 5)

    await h.queue.drain(printerId)

    expect(h.printers.find(printerId)?.queuePausedReason).toBe('INSUFFICIENT_CONSUMABLE')
  })

  it('does not start anything while paused', async () => {
    const h = createHarness()
    const printerId = h.seedPrinter()
    h.printers.setQueueState(printerId, 'paused', 'manual')
    h.enqueue(printerId, 1)

    await h.queue.drain(printerId)

    expect(h.drivers.size).toBe(0)
  })

  it('resumes from the next queued job once unpaused', async () => {
    const h = createHarness()
    const printerId = h.seedPrinter()
    h.printers.setQueueState(printerId, 'paused', 'manual')
    const jobId = h.enqueue(printerId, 1)

    await h.queue.drain(printerId)
    expect(h.jobs.find(jobId)?.status).toBe('queued')

    h.printers.setQueueState(printerId, 'running', null)
    await h.queue.drain(printerId)
    expect(h.jobs.find(jobId)?.status).toBe('completed')
  })
})

describe('partial failure', () => {
  it('records how many copies actually came out', async () => {
    // FR-020: the count is the only basis for reprinting exactly the shortfall
    // instead of the whole batch.
    const h = createHarness(() => ({
      failAfterPages: { pages: 37, error: new PrinterDeviceError('lack paper', 2) },
    }))
    const printerId = h.seedPrinter()
    const jobId = h.enqueue(printerId, 80)

    await h.queue.drain(printerId)

    const job = h.jobs.find(jobId)
    expect(job?.status).toBe('failed')
    expect(job?.pagesPrinted).toBe(37)
    expect(job?.failureCode).toBe('DEVICE_LACK_PAPER')
  })

  it('distinguishes a partial count from an unknown one', async () => {
    const h = createHarness(() => ({
      failAfterPages: { pages: 5, error: new PrinterDeviceError('jam', 8) },
    }))
    const printerId = h.seedPrinter()
    const jobId = h.enqueue(printerId, 20)

    await h.queue.drain(printerId)

    // A number, not null: the progress callback did report this far.
    expect(h.jobs.find(jobId)?.pagesPrinted).toBe(5)
  })
})

describe('page building', () => {
  it('renders once and reuses it when every copy is identical', async () => {
    // A hundred references to one bitmap, not a hundred bitmaps.
    const h = createHarness()
    const printerId = h.seedPrinter()
    h.enqueue(printerId, 100)

    await h.queue.drain(printerId)

    expect(h.renderCalls).toEqual([0])
    expect(h.drivers.get(printerId)?.pagesRequested).toBe(100)
  })

  it('renders every copy when a sequence field varies them', async () => {
    const h = createHarness()
    const printerId = h.seedPrinter()
    h.enqueue(printerId, 5, { seqRanges: { serial: { start: 1, end: 6, step: 1, digits: 3 } } })

    await h.queue.drain(printerId)

    expect(h.renderCalls).toEqual([0, 1, 2, 3, 4])
  })

  it('passes the snapshot density through, not a live lookup', async () => {
    const h = createHarness()
    const printerId = h.seedPrinter()
    h.enqueue(printerId, 1)

    await h.queue.drain(printerId)

    expect(h.drivers.get(printerId)?.lastOptions).toMatchObject({ density: 3, labelType: 1 })
  })
})

describe('progress reporting', () => {
  it('persists progress as pages come out', async () => {
    const h = createHarness()
    const printerId = h.seedPrinter()
    const jobId = h.enqueue(printerId, 4)

    await h.queue.drain(printerId)

    expect(h.jobs.find(jobId)?.pagesPrinted).toBe(4)
  })
})

describe('restart recovery', () => {
  it('marks an interrupted job failed with an unknown count', async () => {
    // FR-053: the count at the moment of a crash is genuinely unknowable, and
    // a confident wrong number would cause duplicate or skipped labels.
    const h = createHarness()
    const printerId = h.seedPrinter()
    const jobId = h.enqueue(printerId, 80)
    h.jobs.markStarted(jobId)
    h.jobs.updateProgress(jobId, 37)

    const recovered = h.queue.recoverInterruptedJobs()

    expect(recovered).toHaveLength(1)
    const job = h.jobs.find(jobId)
    expect(job?.status).toBe('failed')
    expect(job?.pagesPrinted).toBeNull()
    expect(job?.failureCode).toBe('JOB_INTERRUPTED_BY_RESTART')
  })

  it('pauses the printer, because its physical state is unknown too', async () => {
    const h = createHarness()
    const printerId = h.seedPrinter()
    const jobId = h.enqueue(printerId, 5)
    h.jobs.markStarted(jobId)

    h.queue.recoverInterruptedJobs()

    expect(h.printers.find(printerId)?.queueState).toBe('paused')
  })

  it('leaves queued jobs alone', async () => {
    const h = createHarness()
    const printerId = h.seedPrinter()
    const queued = h.enqueue(printerId, 1)

    h.queue.recoverInterruptedJobs()

    expect(h.jobs.find(queued)?.status).toBe('queued')
  })

  it('does nothing when there is nothing to recover', async () => {
    const h = createHarness()
    expect(h.queue.recoverInterruptedJobs()).toEqual([])
  })
})
