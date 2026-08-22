/**
 * Driving a Radix Select in tests.
 *
 * The native `<select>` this replaced could be steered with a single
 * `fireEvent.change`. Radix builds a button plus a portalled listbox, so
 * opening and choosing are two steps — and there is **no hidden native select
 * to fall back on** unless the trigger is inside a form with a `name`. A test
 * that still reaches for `querySelector('select')` will find nothing and pass
 * for the wrong reason.
 */
import { fireEvent, screen, within } from '@testing-library/react'

/** Every Radix select trigger currently on screen, in document order. */
export function selectTriggers(root: ParentNode = document): HTMLElement[] {
  return [...root.querySelectorAll('button[role="combobox"]')] as HTMLElement[]
}

export function selectTrigger(name: string | RegExp): HTMLElement {
  return screen.getByRole('combobox', { name })
}

/** What the trigger currently displays. */
export function selectedText(trigger: HTMLElement): string {
  return trigger.textContent ?? ''
}

/** Open the listbox. Radix opens on pointerdown, not on click. */
export function openSelect(trigger: HTMLElement): void {
  fireEvent.pointerDown(trigger, { pointerType: 'mouse', button: 0, ctrlKey: false })
}

/** Open and choose by visible label. */
export function chooseOption(trigger: HTMLElement, label: string | RegExp): void {
  openSelect(trigger)
  fireEvent.click(screen.getByRole('option', { name: label }))
}

/** The labels currently offered by an open listbox. */
export function optionLabels(): string[] {
  return [...document.querySelectorAll('[role="option"]')].map((node) => node.textContent ?? '')
}

/** Open, read the options, and leave it open for further assertions. */
export function openedOptions(trigger: HTMLElement): string[] {
  openSelect(trigger)
  return optionLabels()
}

export { within }
