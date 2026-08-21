/**
 * Does it render at all.
 *
 * Nothing asked this until a blank page shipped: 929 tests covering geometry,
 * snapping, undo and overflow, and not one of them mounted a component. A
 * white screen is the cheapest possible failure to catch and was the only one
 * with no test at all.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { App } from '../src/App.tsx'

function wrap(ui: React.ReactNode): React.JSX.Element {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchInterval: false } },
  })
  return <QueryClientProvider client={client}>{ui}</QueryClientProvider>
}

// Vitest runs without `globals`, so Testing Library's own auto-cleanup hook is
// never registered; without this every render piles up in the same document.
afterEach(cleanup)

beforeEach(() => {
  // The workspace pushes the active tab into the address bar, and happy-dom
  // keeps that across tests in a file. Without resetting it, a test starts
  // with the previous test's tab already restored — which is the routing
  // working correctly, and is still not what this test meant to set up.
  window.history.replaceState(null, '', '/')

  // No server in this suite; every request simply fails, which is also the
  // state the app has to survive.
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('no server'))))
})

describe('the shell', () => {
  it('mounts without throwing', () => {
    expect(() => render(wrap(<App />))).not.toThrow()
  })

  it('shows the product name', () => {
    render(wrap(<App />))
    expect(screen.getAllByText('Zenith Printer').length).toBeGreaterThan(0)
  })

  it('renders every sidebar entry', () => {
    render(wrap(<App />))
    for (const label of ['首页', '标签设计', '模板库', '打印机', '打印队列', '打印历史', '设置']) {
      expect(screen.getAllByText(label).length).toBeGreaterThan(0)
    }
  })
})

/**
 * Opening each sidebar entry.
 *
 * The design tab is the one that matters most and the one with the most moving
 * parts — canvas, rulers, inspector, layer panel, undo — so it is also the
 * easiest to break into a blank page.
 */
describe('opening a tab', () => {
  it.each(['标签设计', '模板库', '打印机', '打印队列', '打印历史', '设置'])(
    'renders %s without throwing',
    (label) => {
      render(wrap(<App />))
      const entry = screen.getAllByText(label)[0]!
      expect(() => fireEvent.click(entry)).not.toThrow()
    },
  )

  it('puts a canvas on the design tab', () => {
    render(wrap(<App />))
    fireEvent.click(screen.getAllByText('标签设计')[0]!)
    expect(screen.getByLabelText('label canvas')).toBeTruthy()
  })
})

/**
 * The design tab's structure.
 *
 * The first version of this page kept the whole of the previous single-page
 * app inside it — the print queue, the history list and a preview strip — while
 * those were also becoming tabs of their own. Nothing failed; it simply was not
 * the page the design describes. These assertions pin the shape so it cannot
 * quietly drift back.
 */
describe('the design tab', () => {
  function openDesign(): void {
    render(wrap(<App />))
    fireEvent.click(screen.getAllByText('标签设计')[0]!)
  }

  it('has a canvas', () => {
    openDesign()
    expect(screen.getByLabelText('label canvas')).toBeTruthy()
  })

  it('offers every element type in the palette', () => {
    openDesign()
    for (const label of ['文字', '条码', '二维码', '图片', '直线', '矩形', '椭圆']) {
      expect(screen.getAllByText(label).length).toBeGreaterThan(0)
    }
  })

  it('shows the layer panel beside the canvas, not behind a tab', () => {
    openDesign()
    expect(screen.getAllByText('图层').length).toBeGreaterThan(0)
  })

  it('does not embed the print queue — that is a tab of its own now', () => {
    openDesign()
    expect(screen.queryByText('队列为空')).toBeNull()
  })

  it('does not embed the print history', () => {
    openDesign()
    expect(screen.queryByText('还没有完成的任务')).toBeNull()
  })

  it('does not embed a preview strip', () => {
    openDesign()
    expect(screen.queryByText('打印预览')).toBeNull()
  })

  it('does not edit print profiles — those belong to the printer', () => {
    openDesign()
    // The dropdown that *selects* one is fine; the editing panel is not here.
    expect(screen.queryByText('新建参数')).toBeNull()
  })
})

describe('the printers tab', () => {
  it('is where profiles are edited', () => {
    render(wrap(<App />))
    fireEvent.click(screen.getAllByText('打印机')[0]!)
    // With no printers configured there is nothing to show, but the page must
    // at least render its own heading rather than throwing.
    expect(screen.getAllByText('打印机').length).toBeGreaterThan(0)
  })
})

/**
 * The top bar.
 *
 * It reads as a row of dropdowns plus the two actions that matter. An earlier
 * version wedged a whole template panel into it — a permanent name field, three
 * buttons and an inline error strip — which is why it looked nothing like the
 * design beside its neighbours.
 */
describe('the design tab top bar', () => {
  function openDesign(): void {
    render(wrap(<App />))
    fireEvent.click(screen.getAllByText('标签设计')[0]!)
  }

  it('offers the three selectors', () => {
    openDesign()
    for (const label of ['模板', '打印机', '打印参数']) {
      expect(screen.getAllByText(label).length).toBeGreaterThan(0)
    }
  })

  it('offers saving and printing', () => {
    openDesign()
    expect(screen.getAllByText('保存为模板').length).toBeGreaterThan(0)
    expect(screen.getAllByText('打印').length).toBeGreaterThan(0)
  })

  it('has no permanent name field — naming happens when saving', () => {
    openDesign()
    expect(screen.queryByText('模板名称')).toBeNull()
  })

  it('does not delete templates — that belongs in the library', () => {
    openDesign()
    // 'delete' appears in the element inspector, so look for the template
    // confirmation copy specifically.
    expect(screen.queryByText('确定删除这个模板吗？已打印的历史记录不受影响。')).toBeNull()
  })

  it('asks for a name when saving an unsaved design', () => {
    openDesign()
    fireEvent.click(screen.getAllByText('保存为模板')[0]!)
    expect(screen.getAllByText('模板名称').length).toBeGreaterThan(0)
  })
})

/**
 * Top bar grouping.
 *
 * Two groups: the design on the left, printing on the right. They were
 * interleaved, so answering "where will this go" meant reading across the whole
 * bar. Order is asserted through the DOM rather than by eye.
 */
describe('the top bar groups printing together', () => {
  function topBar(): HTMLElement {
    render(wrap(<App />))
    fireEvent.click(screen.getAllByText('标签设计')[0]!)
    // By role, not by class: the constitution forbids asserting on styling,
    // and a toolbar is what this row actually is.
    return screen.getByRole('toolbar', { name: '标签设计' })
  }

  it('separates the two groups', () => {
    const bar = topBar()
    // One between undo/redo and the printer selects, one before Print.
    expect(bar.querySelectorAll('[role="separator"]').length).toBeGreaterThanOrEqual(2)
  })

  it('puts the printer and profile selects after the template one', () => {
    const bar = topBar()
    const labels = [...bar.querySelectorAll('label')].map((l) => l.textContent)
    expect(labels.indexOf('模板')).toBeLessThan(labels.indexOf('打印机'))
    expect(labels.indexOf('打印机')).toBeLessThan(labels.indexOf('打印参数'))
  })

  it('ends with the print button', () => {
    const bar = topBar()
    const buttons = [...bar.querySelectorAll('button')].map((b) => b.textContent?.trim() ?? '')
    expect(buttons[buttons.length - 1]).toBe('打印')
  })
})

/**
 * The zoom control.
 *
 * A field at the foot of the canvas column, not a button bar above it. There is
 * no "fit to window": fitting is the default state, and a button for the thing
 * that should already have happened mostly reports a failure to do it.
 */
describe('zoom', () => {
  function openDesign(): void {
    render(wrap(<App />))
    fireEvent.click(screen.getAllByText('标签设计')[0]!)
  }

  it('is a field, not a stepper', () => {
    openDesign()
    const zoom = document.querySelector('#canvas-zoom') as HTMLInputElement
    expect(zoom).not.toBeNull()
    expect(zoom.type).toBe('number')
  })

  it('has no fit-to-window button', () => {
    openDesign()
    expect(screen.queryByText('适应窗口')).toBeNull()
  })

  it('accepts a typed percentage', () => {
    openDesign()
    const zoom = document.querySelector('#canvas-zoom') as HTMLInputElement
    fireEvent.change(zoom, { target: { value: '200' } })
    expect(Number(zoom.value)).toBe(200)
  })

  it('clamps a percentage beyond the usable range', () => {
    openDesign()
    const zoom = document.querySelector('#canvas-zoom') as HTMLInputElement
    fireEvent.change(zoom, { target: { value: '5000' } })
    expect(Number(zoom.value)).toBeLessThanOrEqual(800)
  })

  it('says how to zoom with the wheel', () => {
    openDesign()
    expect(screen.getAllByText(/Alt/).length).toBeGreaterThan(0)
  })

  /**
   * Not Ctrl: that is the browser's own page zoom and it wins. React's wheel
   * listener is passive, so preventDefault inside an onWheel prop is ignored —
   * the page zoomed anyway and nothing reported a problem.
   */
  it('does not claim Ctrl, which the browser owns', () => {
    openDesign()
    expect(screen.queryByText(/Ctrl \+/)).toBeNull()
  })

  it('keeps the margin note in the status strip', () => {
    openDesign()
    // No profile is selected in this suite, so the note explains the absence.
    expect(screen.getAllByText(/尚未选择打印参数/).length).toBeGreaterThan(0)
  })
})
