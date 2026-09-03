/**
 * One page header, on every page.
 *
 * Each page had grown its own: a bare `<h2>` here, a heading with a button
 * floated beside it there, a paragraph of explanation on three of them and
 * nothing on the rest. Nothing was broken, and every page sat at a slightly
 * different height with its actions in a slightly different place — which is
 * the kind of thing nobody reports and everybody navigates around.
 *
 * The assertions are about the contract the pages rely on: the title is the
 * page's heading (so the sidebar's landmark and a screen reader agree), the
 * description follows it, and the actions sit in the header rather than
 * wherever each page happened to put them.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { PageHeader } from '../src/components/page-header.tsx'
import { Button } from '../src/components/ui/button.tsx'

afterEach(cleanup)

describe('the page header', () => {
  it('makes the title the page heading', () => {
    render(<PageHeader title="打印队列" />)
    expect(screen.getByRole('heading', { name: '打印队列' })).toBeDefined()
  })

  it('carries a description when the page has one to give', () => {
    render(<PageHeader title="打印预设" description="一个具名组合" />)
    expect(screen.getByText('一个具名组合')).toBeDefined()
  })

  it('leaves no empty description behind when it has none', () => {
    // An empty paragraph still takes vertical space, which is how two pages
    // come to sit at different heights for no visible reason.
    const { container } = render(<PageHeader title="打印队列" />)
    expect(container.querySelectorAll('p')).toHaveLength(0)
  })

  it('keeps the actions in the header, beside the title', () => {
    render(<PageHeader title="数据源" actions={<Button>上传 CSV</Button>} />)
    const heading = screen.getByRole('heading', { name: '数据源' })
    const button = screen.getByRole('button', { name: '上传 CSV' })
    expect(heading.closest('[data-page-header]')).toBe(button.closest('[data-page-header]'))
  })
})
