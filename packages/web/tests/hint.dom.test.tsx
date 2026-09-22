/**
 * The `?` beside a control, in its two shapes.
 *
 * A hint has to be reachable three ways, because the people using this product
 * are not all holding a mouse: hover, keyboard focus, and a tap. And a hint
 * carrying something to be carried away — an address to paste into Google's
 * share box — has to let it be selected and copied, which a tooltip cannot do.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { Hint, ValueHint } from '../src/components/ui/hint.tsx'
import { copy } from '../src/i18n/index.ts'

afterEach(cleanup)

const ADDRESS = 'zenithpt@gen-lang-client-0485815917.iam.gserviceaccount.com'

describe('a plain hint', () => {
  const open = (): HTMLElement => {
    render(<Hint label="黑白分界">亮度低于这个值的像素才会被打印。</Hint>)
    return screen.getByRole('button', { name: copy.common.hintFor('黑白分界') })
  }

  it('is a named button, not a bare mark', () => {
    expect(open().querySelector('svg')).not.toBeNull()
  })

  it('shows its sentence on hover, and on keyboard focus', async () => {
    const mark = open()
    fireEvent.pointerEnter(mark)
    fireEvent.focus(mark)
    expect(await screen.findByText(/亮度低于这个值/)).toBeDefined()
  })

  it('shows it on a tap, for a screen with no hover', async () => {
    fireEvent.click(open())
    expect(await screen.findByText(/亮度低于这个值/)).toBeDefined()
  })
})

describe('a hint carrying a value', () => {
  const open = (): void => {
    render(
      <ValueHint label="数据源" value={ADDRESS}>
        把表格分享给（查看者即可）
      </ValueHint>,
    )
    fireEvent.click(screen.getByRole('button', { name: copy.common.hintFor('数据源') }))
  }

  it('shows the value where it can be selected', async () => {
    open()
    const value = await waitFor(() => {
      const node = document.querySelector('[data-hint-value]')
      expect(node).not.toBeNull()
      return node!
    })
    expect(value.textContent).toBe(ADDRESS)
    // `select-all` is what lets somebody drag it out when the clipboard API
    // is missing, which it is on a plain HTTP address.
    expect(value.className).toContain('select-all')
  })

  it('copies it through the document, not the gated clipboard API', async () => {
    // `navigator.clipboard` is undefined on a plain-HTTP LAN address, which is
    // how this service is served; the copy *event* is not gated.
    const execCommand = vi.fn().mockReturnValue(true)
    Object.defineProperty(document, 'execCommand', { value: execCommand, configurable: true })
    open()
    fireEvent.click(await screen.findByText(copy.common.copy))
    expect(execCommand).toHaveBeenCalledWith('copy')
    expect(await screen.findByText(copy.common.copied)).toBeDefined()
  })

  it('leaves the value selected when even that is refused', async () => {
    Object.defineProperty(document, 'execCommand', {
      value: () => {
        throw new Error('nope')
      },
      configurable: true,
    })
    open()
    fireEvent.click(await screen.findByText(copy.common.copy))
    // Still on screen, still selectable: it can be taken by hand.
    expect(document.querySelector('[data-hint-value]')?.textContent).toBe(ADDRESS)
    expect(screen.getByText(copy.common.copy)).toBeDefined()
  })
})
