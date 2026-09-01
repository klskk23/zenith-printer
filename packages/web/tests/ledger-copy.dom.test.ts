/**
 * A ledger-backed table must not be described as a Google spreadsheet.
 *
 * Both origins are read-only here and both are released by unlinking, so the
 * two notices were written once, for Google, and then shown for whatever
 * `isFetched` returned true for. The sentence that came out named the wrong
 * system and sent somebody to the wrong place to fix their data — which is
 * worse than saying nothing, because it reads like an answer.
 *
 * Checked against the copy rather than a rendered page: the point is that no
 * kind can reach a sentence naming another kind's system, and a render test
 * only ever covers the kind it renders.
 */
import { describe, expect, it } from 'vitest'
import { copy as zh } from '../src/i18n/zh-CN.ts'
import { copy as en } from '../src/i18n/en-US.ts'

const KINDS = ['google-sheets', 'nexus'] as const

describe.each([
  ['zh-CN', zh],
  ['en-US', en],
])('%s', (_locale, copy) => {
  it('never tells a ledger source to go to Google', () => {
    for (const said of [
      copy.dataSources.readOnlyNotice('nexus'),
      copy.dataSources.unlinkConfirm('nexus'),
    ]) {
      expect(said).not.toMatch(/Google/i)
    }
  })

  it('still names Google for a spreadsheet', () => {
    // The parametrised version is easy to make generic enough to say nothing.
    // "Change it where it comes from" is not a sentence anybody can act on.
    expect(copy.dataSources.readOnlyNotice('google-sheets')).toMatch(/Google/i)
    expect(copy.dataSources.unlinkConfirm('google-sheets')).toMatch(/Google/i)
  })

  it('says something for every kind that can reach these', () => {
    for (const kind of KINDS) {
      expect(copy.dataSources.readOnlyNotice(kind).length).toBeGreaterThan(10)
      expect(copy.dataSources.unlinkConfirm(kind).length).toBeGreaterThan(10)
    }
  })
})
