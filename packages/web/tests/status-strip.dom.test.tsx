/**
 * The status strip at the top of the gallery: the queue, and the last print.
 *
 * The printers moved to the foot of the sidebar; this is what is left, and
 * it renders a summary it is handed, so these check that each fact reaches
 * the screen in words and that the empty states say something.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { StatusStrip } from '../src/app/status-strip.tsx'
import { copy } from '../src/i18n/index.ts'
import type { StatusSummary } from '../src/app/status-summary.ts'

afterEach(cleanup)

const summary = (over: Partial<StatusSummary> = {}): StatusSummary => ({
  printers: [],
  queue: { state: 'paused', pending: 2 },
  lastPrint: { jobId: 'j1', labelName: '货架标签', status: 'completed' },
  ...over,
})

describe('the status strip', () => {
  it('says what the queue is doing and how much is waiting', () => {
    render(<StatusStrip summary={summary()} />)
    expect(screen.getByText(copy.status.queuePaused)).toBeDefined()
    expect(screen.getByText(copy.status.pending(2))).toBeDefined()
  })

  it('says what printed last and how it went', () => {
    render(<StatusStrip summary={summary()} />)
    const last = document.querySelector('[data-last-print]')!
    expect(last.textContent).toContain('货架标签')
    expect(last.textContent).toContain(copy.jobs.status.completed)
  })

  it('says nothing about a queue there are no printers for', () => {
    render(<StatusStrip summary={summary({ queue: null })} />)
    expect(document.querySelector('[data-queue-status]')).toBeNull()
  })

  it('says when nothing has printed', () => {
    render(<StatusStrip summary={summary({ lastPrint: null })} />)
    expect(screen.getByText(copy.status.noPrints)).toBeDefined()
  })

  it('says nothing about the last print while the jobs are still coming', () => {
    render(<StatusStrip summary={summary({ lastPrint: null })} loading />)
    expect(screen.queryByText(copy.status.noPrints)).toBeNull()
  })

  it('names an unsaved label honestly in the last print', () => {
    render(<StatusStrip summary={summary({ lastPrint: { jobId: 'j', labelName: null, status: 'failed' } })} />)
    expect(screen.getByText(new RegExp(copy.workspace.untitledDesign))).toBeDefined()
  })
})
