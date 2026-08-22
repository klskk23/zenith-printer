/**
 * A rule about the deployment, checked by reading the source.
 *
 * This service is plain HTTP on a LAN address — that is the design, not a
 * temporary state (see docs/design-consensus.md). A page served that way is
 * **not a secure context**, and a browser withholds a specific set of APIs
 * there. Reading one of them is not a degraded feature; it is a `TypeError`
 * that takes down whatever component touched it.
 *
 * The DOM tests cannot catch this. happy-dom defines the whole platform
 * unconditionally, and so does a developer's own browser on localhost — which
 * is exactly how `crypto.randomUUID()` reached the print dialog and killed it
 * on every machine except the server's own, with 2000 tests green.
 *
 * So it is checked statically, over the source, where the absence is visible.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Both trees that end up in the browser bundle. `@zenith/shared` is imported by
 * the editor as well as by the server, so code that is fine in Node is not
 * necessarily fine there — the constraint follows the bundle, not the package.
 */
const ROOTS = [
  new URL('../src', import.meta.url).pathname,
  new URL('../../shared/src', import.meta.url).pathname,
]

/**
 * What a browser withholds outside a secure context, and what to use instead.
 *
 * Not a complete list of the specification's — a complete list would include
 * things nothing here would ever reach for. These are the ones a label editor
 * plausibly grows a use for.
 */
const WITHHELD: Array<{ pattern: RegExp; use: string }> = [
  { pattern: /\bcrypto\s*\.\s*randomUUID\b/, use: 'randomId() from src/lib/random-id.ts' },
  { pattern: /\bcrypto\s*\.\s*subtle\b/, use: 'nothing — hashing in the browser is not available here' },
  { pattern: /\bnavigator\s*\.\s*clipboard\b/, use: 'the copy/cut/paste events, which are not gated' },
  { pattern: /\bnavigator\s*\.\s*serial\b/, use: 'the server — it owns the serial port' },
  { pattern: /\bnavigator\s*\.\s*bluetooth\b/, use: 'the server' },
  { pattern: /\bnavigator\s*\.\s*usb\b/, use: 'the server' },
  { pattern: /\bnavigator\s*\.\s*mediaDevices\b/, use: 'a file input' },
  { pattern: /\bnavigator\s*\.\s*geolocation\b/, use: 'nothing' },
  { pattern: /\bnavigator\s*\.\s*serviceWorker\b/, use: 'nothing — it cannot register here' },
  { pattern: /\bshow(Open|Save)FilePicker\b|\bshowDirectoryPicker\b/, use: 'an <input type="file"> or a download link' },
]

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) {
      return sourceFiles(path)
    }
    return path.endsWith('.ts') || path.endsWith('.tsx') ? [path] : []
  })
}

describe('secure-context-only browser APIs', () => {
  const files = ROOTS.flatMap((root) => sourceFiles(root).map((file) => ({ root, file })))

  it('finds the source, so an empty pass cannot look like a passing one', () => {
    expect(files.length).toBeGreaterThan(20)
  })

  it.each(WITHHELD)('does not reach for $pattern', ({ pattern, use }) => {
    const offenders = files
      .flatMap(({ root, file }) => {
        const relative = file.slice(root.length + 1)
        return readFileSync(file, 'utf8')
          .split('\n')
          .map((line, index) => ({ relative, line: line.trim(), number: index + 1 }))
      })
      // A comment explaining why something is avoided must not itself trip the
      // check — that would make the explanation unwritable.
      .filter(({ line }) => !line.startsWith('*') && !line.startsWith('//'))
      .filter(({ line }) => pattern.test(line))
      .map(({ relative, number, line }) => `${relative}:${number}  ${line}`)

    expect(offenders, `undefined on http://<lan-ip>:3000 — use ${use}`).toEqual([])
  })
})
