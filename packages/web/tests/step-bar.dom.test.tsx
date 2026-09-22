/**
 * The step bar: where you are, what is behind you, what is not yet open.
 *
 * What is pinned: four steps always drawn, exactly one current, the ones behind
 * are buttons and the ones ahead are not, the way back is a symbol with no word
 * beside it (but still has an accessible name), and the right end carries what
 * this step is about rather than repeating the step's own name.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { StepBar } from '../src/app/step-bar.tsx'
import { copy } from '../src/i18n/index.ts'
import { stepsFor } from '../src/features/print/flow.ts'

afterEach(cleanup)

const bar = (overrides: Partial<React.ComponentProps<typeof StepBar>> = {}): HTMLElement => {
  render(
    <StepBar
      steps={stepsFor({ page: 'label-print', canSubmit: false })}
      onGo={() => undefined}
      onBack={() => undefined}
      context="种子路由器 · 60×40 mm"
      {...overrides}
    />,
  )
  return screen.getByRole('toolbar', { name: copy.flow.heading })
}

describe('the step bar', () => {
  it('draws the four steps, in order, numbered', () => {
    const steps = [...bar().querySelectorAll('[data-step]')]
    expect(steps.map((node) => node.getAttribute('data-step'))).toEqual([
      'labels', 'design', 'print', 'confirm',
    ])
    expect(steps.map((node) => node.textContent)).toEqual([
      `1${copy.flow.steps.labels}`,
      `2${copy.flow.steps.design}`,
      `3${copy.flow.steps.print}`,
      `4${copy.flow.steps.confirm}`,
    ])
  })

  it('marks exactly one step as current', () => {
    const current = [...bar().querySelectorAll('[data-state="current"]')]
    expect(current).toHaveLength(1)
    expect(current[0]!.getAttribute('data-step')).toBe('print')
    expect(current[0]!.getAttribute('aria-current')).toBe('step')
  })

  it('makes the steps behind you clickable and says which one was clicked', () => {
    const onGo = vi.fn()
    const node = bar({ onGo })
    fireEvent.click(node.querySelector('[data-step="design"] button')!)
    expect(onGo).toHaveBeenCalledWith('design')
  })

  it('offers no button for a step that is not open yet', () => {
    const node = bar()
    expect(node.querySelector('[data-step="confirm"] button')).toBeNull()
    expect(node.querySelector('[data-step="confirm"]')?.getAttribute('data-state')).toBe('blocked')
  })

  it('opens the last step once there is something to submit', () => {
    const node = bar({ steps: stepsFor({ page: 'label-print', canSubmit: true }) })
    expect(node.querySelector('[data-step="confirm"]')?.getAttribute('data-state')).toBe('ahead')
    expect(node.querySelector('[data-step="confirm"] button')).toBeNull()
  })

  it('gives the way back a symbol and no word', () => {
    const onBack = vi.fn()
    const node = bar({ onBack })
    const back = node.querySelector('[data-back]') as HTMLButtonElement
    // No text — but a name a screen reader and a tooltip can both use.
    expect(back.textContent?.trim()).toBe('')
    expect(back.getAttribute('aria-label')).toBe(copy.flow.back)
    expect(back.getAttribute('title')).toBe(copy.flow.back)
    expect(back.querySelector('svg')).not.toBeNull()
    fireEvent.click(back)
    expect(onBack).toHaveBeenCalled()
  })

  it('leaves the way back out on the first step', () => {
    const node = bar({ steps: stepsFor({ page: 'labels', canSubmit: false }), onBack: undefined })
    expect(node.querySelector('[data-back]')).toBeNull()
  })

  it('carries what this step is about at its right end', () => {
    expect(bar().querySelector('[data-step-context]')?.textContent).toContain('种子路由器')
  })

  it('keeps only the current step’s name on a narrow viewport', () => {
    // The names of three other steps are what overflows first; the numbers are
    // enough to say "four steps, you are on the third".
    const node = bar()
    const design = node.querySelector('[data-step="design"] [data-step-name]')!
    const print = node.querySelector('[data-step="print"] [data-step-name]')!
    expect(design.className).toContain('max-[1100px]:hidden')
    expect(print.className).not.toContain('max-[1100px]:hidden')
  })
})
