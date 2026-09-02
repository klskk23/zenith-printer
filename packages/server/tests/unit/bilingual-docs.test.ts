/**
 * The two language versions of a document say the same operational things.
 *
 * A translated pair fails in one direction: somebody edits the language they
 * think in, and the other version keeps promising the old endpoint, the old
 * environment variable, the old row limit. Nothing breaks — the page still
 * renders, the link still resolves — and whoever was reading the stale half
 * finds out by following it.
 *
 * So this compares what a reader could copy or act on, not the prose. The
 * sentences around them are supposed to differ; `/api/rows`, `sys_id` and
 * `10000` are not.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const repoRoot = fileURLToPath(new URL('../../../..', import.meta.url))

/** Every pair of documents that exist in both languages. */
const PAIRS: Array<{ zh: string; en: string }> = [
  { zh: 'docs/nexus-assets.md', en: 'docs/nexus-assets.en.md' },
]

/**
 * The parts a reader types, pastes or matches on.
 *
 * Deliberately narrow. Widening this to every backtick would start reporting
 * the places where one language legitimately names a thing the other explains,
 * and a check that cries wolf is one somebody switches off.
 */
const EXTRACTORS: Record<string, RegExp> = {
  'environment variables': /NEXUS_ASSETS_SERVICE_[A-Z_]+/g,
  endpoints: /(?:GET|POST|PATCH|DELETE) \/api\/[\w/{}.-]+/g,
  'error codes': /`(?:[A-Z][A-Z0-9]*_)+[A-Z0-9]+`/g,
  'field names': /`(?:sys_id|columns|rows|total|offset|limit|copies|presets|templateId|presetId|print_preset_ids|jobId|deduplicated|Idempotency-Key|category_id|include_descendants|parent_id|display_key|path)`/g,
  /** Limits and status codes: the numbers somebody sizes a batch against. */
  numbers: /(?<![\w.])(?:1000|10000|30|401|422|409|202|8080)(?![\w.])/g,
}

const read = (path: string): string => readFileSync(`${repoRoot}${path}`, 'utf8')

const found = (text: string, pattern: RegExp): string[] =>
  [...new Set(text.match(new RegExp(pattern.source, 'g')) ?? [])].sort()

describe.each(PAIRS)('$zh and $en', ({ zh, en }) => {
  const chinese = read(zh)
  const english = read(en)

  it.each(Object.entries(EXTRACTORS))('agree on %s', (_what, pattern) => {
    expect(found(english, pattern)).toEqual(found(chinese, pattern))
  })

  it('each links to the other, so a reader can get across', () => {
    // Two files nobody can navigate between is one document and one orphan.
    expect(chinese).toContain(en.split('/').pop())
    expect(english).toContain(zh.split('/').pop())
  })

  /**
   * The set comparisons above catch a token that appeared or vanished. They
   * cannot catch one that *changed* where the same value occurs elsewhere —
   * `limit=1000` becoming `limit=500` leaves the set of numbers untouched.
   *
   * The values inside code blocks are where that matters, because they are
   * what somebody pastes. Only the unambiguously machine-readable ones:
   * quoted prose inside a sample (`"name": "Router label"`) is supposed to be
   * translated, and demanding otherwise would be demanding a worse document.
   */
  it('agree on every value inside the samples, occurrence for occurrence', () => {
    const values = (text: string): string[] => {
      const blocks = text.match(/```[^\n]*\n[\s\S]*?```/g) ?? []
      return blocks
        .flatMap(
          (block) =>
            block.match(/[a-z_]+=[\w<>.-]+|"[a-z_]+":\s*(?:\d+|true|false|null)|^[A-Z_]+=\S+/gm) ??
            [],
        )
        .sort()
    }
    expect(values(english)).toEqual(values(chinese))
    // Ten or more today; a regex that stopped matching would compare nothing.
    expect(values(chinese).length).toBeGreaterThan(8)
  })

  it('found something to compare', () => {
    // Every check above passes perfectly against two empty files, and a regex
    // that stopped matching would produce exactly that.
    for (const [what, pattern] of Object.entries(EXTRACTORS)) {
      expect(found(chinese, pattern).length, `${what} matched nothing`).toBeGreaterThan(1)
    }
  })
})
