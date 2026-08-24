/**
 * `zenith --version` and package.json say the same thing.
 *
 * They did not. The CLI carried its version as a string literal in index.ts,
 * so it went on reporting 0.1.0 through the release that made everything else
 * 0.1.1 — nobody would notice until they were reading a bug report that named
 * the wrong build. The server's OpenAPI document already reads package.json
 * rather than repeating it; this is the same rule, applied to the other half.
 *
 * Run as a real process, for two reasons: index.ts parses argv at module
 * scope, so importing it runs the CLI; and the way this breaks after the fix
 * is a relative path that resolves somewhere else, which only a real process
 * started from a real file can show.
 */
import { describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '../../..')
const entry = join(repoRoot, 'packages/cli/src/index.ts')

function declaredVersion(): string {
  const raw = readFileSync(join(repoRoot, 'package.json'), 'utf8')
  return (JSON.parse(raw) as { version: string }).version
}

describe('zenith --version', () => {
  it('reports the version package.json declares', () => {
    const printed = execFileSync(
      process.execPath,
      ['--experimental-strip-types', entry, '--version'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    ).trim()

    expect(printed).toBe(declaredVersion())
  })

  // The assertion above passes either way on the day the two happen to agree,
  // which is every day a literal is correct — and every day before it drifts.
  // So the rule itself is checked: the number is not in the source at all.
  it('does not carry the number in its source', () => {
    const source = readFileSync(entry, 'utf8')
    expect(source).not.toMatch(/\.version\(\s*['"`]\d/)
    expect(source).not.toMatch(/['"`]\d+\.\d+\.\d+['"`]/)
  })
})
