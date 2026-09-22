/**
 * The three tiers of standing copy, checked over the source.
 *
 * The interface had grown sixty-odd standing explanations. Most of them
 * explained the system to somebody who only wanted to fill in a field, and
 * they sat between that person and the controls for good. The rule that
 * replaced them, written down in `.agents/rules/ux-and-api.md`:
 *
 *   - **Principle** — why it is built this way, or what will not break.
 *     Deleted. The reader is not maintaining this product.
 *   - **How-to** — what goes in this box, what this setting does.
 *     Folded into the `?` beside it, where it is one hover away.
 *   - **Must keep** — errors, confirmations for the irreversible, abnormal
 *     states, empty states. Left exactly where they are, in full.
 *
 * Checked statically because the point is the absence of something: a DOM test
 * can only find what is rendered, and the deleted sentences would come back one
 * at a time without anything noticing.
 *
 * The list is `specs/006-label-print-flow/contracts/hint-tiers.md`.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const SRC = new URL('../src', import.meta.url).pathname

function sources(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) {
      sources(path, out)
    } else if (/\.tsx?$/.test(path) && !path.includes('/i18n/')) {
      out.push(path)
    }
  }
  return out
}

const locales = ['zh-CN', 'en-US'].map((name) => ({
  name,
  text: readFileSync(join(SRC, 'i18n', `${name}.ts`), 'utf8'),
}))
const code = sources(SRC).map((path) => ({ path, text: readFileSync(path, 'utf8') }))

/** Every key that was deleted outright, with the phrase that identified it. */
const DELETED: Array<[string, string]> = [
  ['templates.renameHint', '名称只是给人看的'],
  ['dataSources.renameHint', '改名不影响任何引用'],
  ['dataSources.explain', '一个数据源就是一张表'],
  // Dead since 005 turned a version conflict into last-save-wins.
  ['templates.conflict', '重新载入会用服务器上的版本'],
  ['presets.explain', '一个具名组合'],
  ['presets.editExplain', '因为 id 不变'],
  ['pools.explain', '序号池独立于标签存在'],
  // Dead before this feature touched them: defined, never rendered.
  ['dataSources.keyColumnHint', '刷新前后用哪一列'],
  ['dataSources.pasteHint', '选中一格后按 Ctrl+V'],
  ['printForm.overrideHint', '默认从上次打印之后接续'],
  ['profiles.canvasFollowsProfile', '选择参数后画布尺寸'],
  ['settings.localOnlyHint', '换一个浏览器会回到默认值'],
]

/** Keys that moved behind a `?`; they still exist and are still rendered. */
const BEHIND_A_MARK = [
  'googleShareHint',
  'thresholdHint',
  'halftoneHint',
  'isDefaultHint',
]

/**
 * `marginHint` is in both tiers at once, which is why it is not in the list
 * above: in the print-settings form it is a how-to behind a mark, and on the
 * canvas it is the caption under the margins themselves — a label on a drawing,
 * not a standing paragraph.
 */

/** A sample of the tier that must never be folded away or deleted. */
const KEPT: Array<[string, string]> = [
  ['workspace.disconnectedBanner', '连接已断开'],
  ['dataSources.deleteWarning', '无法恢复'],
  ['dataSources.refreshClearedSelection', '选择被清空'],
  ['settings.pruneConfirmBody', '无法撤销'],
  ['jobs.countManually', '请清点实物'],
  ['dataSources.googleNotConfigured', '需要部署方先配置'],
]

describe('the principle tier', () => {
  it.each(DELETED)('has dropped %s from both locales', (key, phrase) => {
    const leaf = key.split('.')[1]!
    for (const locale of locales) {
      expect(locale.text, `${locale.name} still defines ${key}`).not.toContain(phrase)
    }
    // And nothing reads it any more.
    const readers = code.filter((file) => file.text.includes(`.${leaf}`) && file.text.includes(key.split('.')[0]!))
    expect(readers.filter((file) => file.text.includes(key)).map((file) => file.path)).toEqual([])
  })
})

describe('the how-to tier', () => {
  it.each(BEHIND_A_MARK)('keeps %s, and only behind a mark', (leaf) => {
    expect(locales[0]!.text).toContain(`${leaf}:`)
    const readers = code.filter((file) => file.text.includes(`.${leaf}`))
    expect(readers.length, `${leaf} is not rendered anywhere`).toBeGreaterThan(0)
    for (const file of readers) {
      // Its only reader is a Hint or a ValueHint — never a bare paragraph.
      expect(/<(Value)?Hint\b/.test(file.text), `${file.path} renders ${leaf} outside a hint`).toBe(true)
    }
  })
})

describe('the tier that stays', () => {
  it.each(KEPT)('leaves %s where it is', (key, phrase) => {
    expect(locales[0]!.text).toContain(phrase)
    const leaf = key.split('.')[1]!
    expect(code.some((file) => file.text.includes(`.${leaf}`)), `${key} is no longer rendered`).toBe(true)
  })
})
