/**
 * What version this build is, read from package.json.
 *
 * Every place that shows a version had been typing it again — the OpenAPI
 * document, `zenith --version` — and a copy is only right until the next
 * release forgets one of them. That is not hypothetical: v0.1.1 shipped with
 * the CLI still announcing 0.1.0.
 *
 * package.json is the source of truth by fiat, not by preference: the release
 * workflow refuses a tag that disagrees with it, and the image tag is built
 * from it. Anything that wants to name the running build asks here.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { repoRoot } from './paths.ts'

/**
 * Falls back rather than throwing. A version string is decoration on an error
 * message or an API description, and refusing to start a printer because the
 * manifest could not be read would be the wrong trade.
 */
export function packageVersion(): string {
  try {
    const raw = readFileSync(join(repoRoot, 'package.json'), 'utf8')
    return String((JSON.parse(raw) as { version?: string }).version ?? '0.0.0')
  } catch {
    return '0.0.0'
  }
}
