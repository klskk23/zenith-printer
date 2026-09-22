/**
 * The design step's two bars.
 *
 * The top of the page is the step bar and nothing else: where you are, and the
 * way out. Everything about a machine — which one, which settings — moved to
 * the print step, where the question is actually being asked. What is left
 * about *this label* sits at the foot: save it, save it as something else, or
 * carry on to printing.
 *
 * Undo and redo went to the canvas, because that is what they reverse.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, screen, within } from '@testing-library/react'
import { copy } from '../src/i18n/index.ts'
import { openNewLabel, renderApp, stubApi } from './support/app.tsx'

const PRINTER = {
  id: 'prn-1', name: '前台机', kind: 'niimbot', transport: 'serial', address: '/dev/ttyACM0',
  capabilities: {
    dpi: 203, printheadPixels: 384, densityMin: 1, densityMax: 5, densityDefault: 3,
    paperTypes: [1], printDirection: 'top', supportsConsumableLevel: true,
    model: 'B1', serial: null, firmwareVersion: null,
  },
  queueState: 'running', queuePausedReason: null, lastProbedAt: '2026-09-01T00:00:00.000Z',
  createdAt: '2026-09-01T00:00:00.000Z', offsetXDots: 0, offsetYDots: 0,
}

beforeEach(() => {
  stubApi((url) => {
    if (url.includes('/profiles')) return { profiles: [] }
    if (url.includes('/printers')) return { printers: [PRINTER] }
    if (url.endsWith('/templates')) return { templates: [] }
    if (url.includes('/print-jobs')) return { jobs: [] }
    return undefined
  })
})

afterEach(cleanup)

async function open(): Promise<void> {
  renderApp('/')
  await openNewLabel()
}

describe('the design step', () => {
  it('has the step bar at the top and nothing else', async () => {
    await open()
    const bar = screen.getByRole('toolbar', { name: copy.flow.heading })
    // Four steps and what this label is. No machine, and no back symbol —
    // the first step is the way out.
    expect(bar.querySelector('[data-back]')).toBeNull()
    expect(bar.querySelectorAll('[data-step]')).toHaveLength(4)
    expect(bar.textContent).not.toContain(copy.print.printer)
  })

  it('leaves the machine and its settings to the print step', async () => {
    await open()
    for (const gone of [copy.print.printer, copy.profiles.heading]) {
      expect(screen.queryByRole('combobox', { name: gone })).toBeNull()
    }
  })

  it('puts undo and redo with the drawing', async () => {
    await open()
    const foot = screen.getByRole('toolbar', { name: copy.editor.heading })
    for (const name of [copy.editor.undo, copy.editor.redo]) {
      const button = screen.getByRole('button', { name })
      expect(button).toBeDefined()
      // Not in the bar at the foot — beside the canvas.
      expect(foot.contains(button)).toBe(false)
    }
  })

  it('keeps undo and redo off the panel edge', async () => {
    await open()
    const row = screen.getByRole('button', { name: copy.editor.undo }).parentElement!
    expect(row.className).toContain('px-n3')
  })

  it('offers saving and the way on, in that order', async () => {
    await open()
    const foot = screen.getByRole('toolbar', { name: copy.editor.heading })
    const buttons = [...foot.querySelectorAll('button')].map((b) => b.textContent?.trim() ?? '')
    expect(buttons).toContain(copy.templates.save)
    expect(buttons[buttons.length - 1]).toBe(copy.flow.next)
  })

  it('reaches the print step from that bar', async () => {
    await open()
    const foot = screen.getByRole('toolbar', { name: copy.editor.heading })
    within(foot).getByText(copy.flow.next).click()
    expect(await screen.findByRole('radiogroup', { name: copy.print.printer })).toBeDefined()
  })
})
