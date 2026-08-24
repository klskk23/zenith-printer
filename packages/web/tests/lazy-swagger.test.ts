/**
 * Swagger UI must stay in a chunk of its own.
 *
 * It is roughly 1.3MB of JavaScript and 180KB of CSS. The people this
 * application exists for are printing labels; almost none of them will open the
 * API console, and a static import would make every one of them download it
 * before the first paint.
 *
 * Checked by reading the source because the cost is invisible to the DOM tests:
 * happy-dom loads whatever it is told to and reports no size. The only place
 * the difference shows is the build output, and by then it has shipped.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const SRC = new URL('../src', import.meta.url).pathname

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) {
      return sourceFiles(path)
    }
    return path.endsWith('.ts') || path.endsWith('.tsx') ? [path] : []
  })
}

/** Lines mentioning the package, with the file they came from. */
function mentions(): Array<{ file: string; line: string }> {
  return sourceFiles(SRC).flatMap((file) =>
    readFileSync(file, 'utf8')
      .split('\n')
      .map((line) => ({ file: file.slice(SRC.length + 1), line: line.trim() }))
      .filter(({ line }) => line.includes('swagger-ui-react')),
  )
}

describe('the API console', () => {
  const found = mentions()

  it('is imported somewhere, so an empty pass cannot look like a passing one', () => {
    expect(found.length).toBeGreaterThan(0)
  })

  it.each(found)('$file loads it dynamically, not at module scope', ({ line }) => {
    expect(
      /\bimport\s*\(/.test(line) || line.startsWith('*') || line.startsWith('//'),
      `"${line}" pulls swagger-ui-react into the main bundle. It is 1.3MB, and ` +
        `everyone who never opens the API console would pay for it on first ` +
        `paint. Load it through React.lazy and a dynamic import().`,
    ).toBe(true)
  })
})
