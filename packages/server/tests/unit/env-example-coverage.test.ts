/**
 * Every environment variable the code reads is documented in `.env.example`.
 *
 * That file is the only place a deployer finds out a knob exists. Nothing
 * breaks when it falls behind — the service starts, the tests pass, and the
 * feature is simply invisible to the person deploying it, who has no way to
 * discover a variable nobody wrote down. It went out of date the first time
 * this repo added an integration, and it would have gone out of date again.
 *
 * Read out of the source rather than kept as a list here, because a list would
 * be one more thing to forget in the same commit.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = fileURLToPath(new URL('../../../..', import.meta.url))

/**
 * Not deployment settings, so not documented as such.
 *
 * `NODE_ENV` and `VITEST` are set by the toolchain; `CI` by whatever runs it.
 * Writing them into a file headed "deployment settings" would suggest somebody
 * is supposed to choose them.
 */
const AMBIENT = new Set(['NODE_ENV', 'VITEST', 'CI', 'TZ'])

/** Both spellings: `process.env.X`, and the injected `env.X` in config.ts. */
const READS = /\benv\.([A-Z][A-Z0-9_]{2,})\b/g

function sourceFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) {
      out.push(...sourceFiles(path))
    } else if (path.endsWith('.ts') || path.endsWith('.tsx')) {
      out.push(path)
    }
  }
  return out
}

function variablesRead(): Set<string> {
  const found = new Set<string>()
  for (const pkg of ['server', 'cli', 'shared', 'web']) {
    const dir = join(repoRoot, 'packages', pkg, 'src')
    for (const file of sourceFiles(dir)) {
      // Comments say a variable's name while explaining it — including in the
      // error messages that tell somebody which one to set. Those are not
      // reads, and counting them would make the test demand documentation for
      // names nothing actually looks at.
      const code = readFileSync(file, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/[^\n]*/g, '')
      for (const match of code.matchAll(READS)) {
        const name = match[1]!
        if (!AMBIENT.has(name)) {
          found.add(name)
        }
      }
    }
  }
  return found
}

describe('.env.example', () => {
  it('documents every variable the code reads', () => {
    const example = readFileSync(join(repoRoot, '.env.example'), 'utf8')
    const undocumented = [...variablesRead()].filter((name) => !example.includes(name)).sort()
    expect(undocumented).toEqual([])
  })

  it('found the variables to check in the first place', () => {
    // Without this the test above passes loudly when the scan breaks — an
    // empty set documents itself perfectly.
    expect(variablesRead().size).toBeGreaterThan(5)
  })
})
