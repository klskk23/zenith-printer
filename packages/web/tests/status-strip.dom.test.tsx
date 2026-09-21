/**
 * The status strip at the top of the gallery.
 *
 * With the home page gone, this is where the machines are glanced at. It
 * renders a summary it is handed, so these check that each fact the summary
 * carries reaches the screen in words — and that the three empty states say
 * something rather than nothing.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { StatusStrip } from '../src/app/status-strip.tsx'
import { copy } from '../src/i18n/index.ts'
import type { StatusSummary } from '../src/app/status-summary.ts'

afterEach(cleanup)

const summary = (over: Partial<StatusSummary> = {}): StatusSummary => ({
  printers: [
    { id: 'a', name: '前台机', probed: true, queueState: 'running', pending: 0, consumable: { kind: 'supported' } },
    { id: 'b', name: '仓库机', probed: true, queueState: 'running', pending: 2, consumable: { kind: 'unsupported' } },
    { id: 'c', name: '新机', probed: false, queueState: 'paused', pending: 0, consumable: { kind: 'not-probed' } },
  ],
  queue: { state: 'paused', pending: 2 },
  lastPrint: { jobId: 'j1', labelName: '货架标签', status: 'completed' },
  ...over,
})

describe('the status strip', () => {
  it('names each printer with what the service knows about it', () => {
    render(<StatusStrip summary={summary()} />)
    expect(screen.getByText('前台机')).toBeDefined()
    expect(screen.getAllByText(copy.status.remainingSupported).length).toBe(1)
    expect(screen.getAllByText(copy.status.remainingUnsupported).length).toBe(1)
    expect(screen.getAllByText(copy.status.notProbed).length).toBe(1)
  })

  it('says what the queue is doing and how much is waiting', () => {
    render(<StatusStrip summary={summary()} />)
    expect(screen.getByText(copy.status.queuePaused)).toBeDefined()
    expect(screen.getAllByText(copy.status.pending(2)).length).toBeGreaterThan(0)
  })

  it('says what printed last and how it went', () => {
    render(<StatusStrip summary={summary()} />)
    const last = document.querySelector('[data-last-print]')!
    expect(last.textContent).toContain('货架标签')
    expect(last.textContent).toContain(copy.jobs.status.completed)
  })

  it('says when there are no printers', () => {
    render(<StatusStrip summary={summary({ printers: [], queue: null })} />)
    expect(screen.getByText(copy.status.noPrinters)).toBeDefined()
  })

  it('says when nothing has printed', () => {
    render(<StatusStrip summary={summary({ lastPrint: null })} />)
    expect(screen.getByText(copy.status.noPrints)).toBeDefined()
  })

  it('names an unsaved label honestly in the last print', () => {
    render(<StatusStrip summary={summary({ lastPrint: { jobId: 'j', labelName: null, status: 'failed' } })} />)
    expect(screen.getByText(new RegExp(copy.workspace.untitledDesign))).toBeDefined()
  })
})
