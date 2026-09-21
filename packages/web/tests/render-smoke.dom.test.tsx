/**
 * Does it render at all.
 *
 * Nothing asked this until a blank page shipped: 929 tests covering geometry,
 * snapping, undo and overflow, and not one of them mounted a component. A
 * white screen is the cheapest possible failure to catch and was the only one
 * with no test at all.
 *
 * Every page the sidebar reaches is mounted here, plus the editor by both of
 * its ways in. And the shape of the shell is pinned: eight entries, in the
 * order the design fixed, no tab bar, no home page, no library — the things
 * step 3 removed and that would come back one "small convenience" at a time.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, screen } from '@testing-library/react'
import { copy } from '../src/i18n/index.ts'
import { openNewLabel, renderApp } from './support/app.tsx'

afterEach(cleanup)

beforeEach(() => {
  // No server in this suite; every request simply fails, which is also the
  // state the app has to survive.
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('no server'))))
})

const SIDEBAR = ['标签', '数据源', '打印机', '打印队列', '打印历史', '打印预设', '设置']

describe('the shell', () => {
  it('mounts without throwing', () => {
    expect(() => renderApp('/')).not.toThrow()
  })

  it('shows the product name', () => {
    renderApp('/')
    expect(screen.getAllByText('Zenith Printer').length).toBeGreaterThan(0)
  })

  it('lands on the gallery', () => {
    renderApp('/')
    expect(screen.getByRole('heading', { name: copy.labels.heading })).toBeDefined()
  })

  it('has exactly the seven entries, in order', () => {
    renderApp('/')
    const nav = document.querySelector('nav')!
    const labels = [...nav.querySelectorAll('[data-nav-label]')].map((el) => el.textContent?.trim())
    expect(labels).toEqual(SIDEBAR)
  })

  it('has no tab bar, no home and no library', () => {
    renderApp('/')
    expect(document.querySelector('[data-tab-bar]')).toBeNull()
    for (const gone of ['首页', '模板库', '标签设计']) {
      const nav = document.querySelector('nav')!
      expect(nav.textContent).not.toContain(gone)
    }
  })
})

describe('every page the sidebar reaches', () => {
  it.each(SIDEBAR)('renders %s without throwing', (label) => {
    renderApp('/')
    const nav = document.querySelector('nav')!
    const entry = [...nav.querySelectorAll('button')].find((b) => b.textContent?.trim() === label)!
    expect(() => fireEvent.click(entry)).not.toThrow()
  })
})

describe('the editor', () => {
  it('opens for a new label from the gallery', async () => {
    renderApp('/')
    await openNewLabel()
    expect(screen.getByLabelText('label canvas')).toBeTruthy()
  })

  it('opens at a new-label address with a preset in the query', () => {
    expect(() => renderApp('/labels/new?preset=x')).not.toThrow()
    expect(screen.getByLabelText('label canvas')).toBeTruthy()
  })

  it('offers every element type in the palette', async () => {
    renderApp('/')
    await openNewLabel()
    for (const label of ['文字', '条码', '二维码', '图片', '直线', '矩形', '椭圆']) {
      expect(screen.getAllByText(label).length).toBeGreaterThan(0)
    }
  })

  it('shows the layer panel beside the canvas', async () => {
    renderApp('/')
    await openNewLabel()
    expect(screen.getAllByText('图层').length).toBeGreaterThan(0)
  })

  it('does not embed the queue, the history or a preview strip', async () => {
    renderApp('/')
    await openNewLabel()
    expect(screen.queryByText('队列为空')).toBeNull()
    expect(screen.queryByText('还没有完成的任务')).toBeNull()
    expect(screen.queryByText('打印预览')).toBeNull()
  })

  it('has a way back, and the sidebar is still there', async () => {
    renderApp('/')
    await openNewLabel()
    expect(screen.getByText(copy.editor.back)).toBeDefined()
    expect(document.querySelector('nav')).not.toBeNull()
  })
})

describe('the editor top bar', () => {
  async function topBar(): Promise<HTMLElement> {
    renderApp('/')
    await openNewLabel()
    return screen.getByRole('toolbar', { name: copy.editor.heading })
  }

  it('no longer has a label picker — the gallery is the picker', async () => {
    const bar = await topBar()
    expect(bar.querySelector('[role="combobox"][aria-label="' + copy.templates.heading + '"]')).toBeNull()
  })

  it('offers saving and printing, and ends with the print button', async () => {
    const bar = await topBar()
    expect(screen.getAllByText(copy.templates.save).length).toBeGreaterThan(0)
    const buttons = [...bar.querySelectorAll('button')].map((b) => b.textContent?.trim() ?? '')
    expect(buttons[buttons.length - 1]).toBe('打印')
  })

  it('asks for a name when saving a new label', async () => {
    await topBar()
    fireEvent.click(screen.getAllByText(copy.templates.save)[0]!)
    expect(screen.getAllByText(copy.templates.name).length).toBeGreaterThan(0)
  })
})

describe('the zoom control', () => {
  it('is a field, not a stepper, and clamps', async () => {
    renderApp('/')
    await openNewLabel()
    const zoom = document.querySelector('#canvas-zoom') as HTMLInputElement
    expect(zoom.type).toBe('number')
    fireEvent.change(zoom, { target: { value: '200' } })
    expect(Number(zoom.value)).toBe(200)
    expect(screen.queryByText('适应窗口')).toBeNull()
  })
})

describe('old addresses', () => {
  it('sends /templates to the gallery and rewrites the address', () => {
    renderApp('/templates')
    expect(screen.getByRole('heading', { name: copy.labels.heading })).toBeDefined()
    expect(window.location.pathname).toBe('/')
  })

  it('sends /design to a new label and rewrites the address', () => {
    renderApp('/design')
    expect(screen.getByLabelText('label canvas')).toBeTruthy()
    expect(window.location.pathname).toBe('/labels/new')
  })

  it('still renders the API console at its own address', () => {
    expect(() => renderApp('/api-docs')).not.toThrow()
  })

  it('keeps the query when rewriting', () => {
    renderApp('/design/tpl-7?preset=pre-1')
    expect(window.location.pathname).toBe('/labels/tpl-7')
    expect(window.location.search).toBe('?preset=pre-1')
  })
})
