import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * A rule about layout, checked by reading the source.
 *
 * Whether something scrolls cannot be asserted in the DOM tests: happy-dom
 * performs no layout, so every element is zero by zero and a region that clips
 * its content looks exactly like one that scrolls. That is how a ScrollArea
 * given only a `max-h-*` reached the print dialog — the suite was green and the
 * dialog could not be scrolled at all.
 *
 * The rule itself is small enough to check statically: Radix's viewport is
 * sized `height: 100%`, so its parent needs a definite height. `max-h-*` is a
 * cap, not a height, and leaves the percentage resolving to auto.
 */
const SRC = new URL('../src', import.meta.url).pathname

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) {
      return sourceFiles(path)
    }
    return path.endsWith('.tsx') ? [path] : []
  })
}

/** Every `<ScrollArea ...>` opening tag, with the file it came from. */
function scrollAreaTags(): Array<{ file: string; tag: string }> {
  return sourceFiles(SRC)
    .filter((file) => !file.endsWith(join('ui', 'scroll-area.tsx')))
    .flatMap((file) => {
      const source = readFileSync(file, 'utf8')
      const tags = source.match(/<ScrollArea[^>]*>/g) ?? []
      return tags.map((tag) => ({ file: file.slice(SRC.length + 1), tag }))
    })
}

describe('scroll regions', () => {
  it('finds the ScrollAreas, so an empty pass cannot look like a passing one', () => {
    expect(scrollAreaTags().length).toBeGreaterThan(0)
  })

  it('never caps a ScrollArea with max-h, which stops it scrolling entirely', () => {
    const capped = scrollAreaTags().filter(({ tag }) => /\bmax-h-/.test(tag))
    expect(capped.map(({ file, tag }) => `${file}: ${tag}`)).toEqual([])
  })

  it('gives every ScrollArea a definite height or an orientation that needs none', () => {
    // A horizontal one is constrained by width instead, which block layout
    // already provides.
    const undefinedHeight = scrollAreaTags().filter(
      ({ tag }) => !/\bh-/.test(tag) && !/orientation="horizontal"/.test(tag),
    )
    expect(undefinedHeight.map(({ file, tag }) => `${file}: ${tag}`)).toEqual([])
  })
})
