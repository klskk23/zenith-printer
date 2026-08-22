/**
 * The private key has exactly one reference in the codebase.
 *
 * Two of the spec's requirements — the key never reaches a log, and never
 * reaches a response — are properties of the whole program, which no ordinary
 * test can observe. What can be observed is the thing that makes them true:
 * the key goes from a file into the auth library and is touched nowhere else.
 * One reference means there is no third place for it to escape from.
 *
 * This is a static check, and it says so. It cannot prove the key is safe; it
 * can prove that the argument for why it is safe still holds.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const SRC = new URL('../../src', import.meta.url).pathname
const ALLOWED = join('integrations', 'google-sheets-client.ts')

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry)
    return statSync(path).isDirectory() ? sourceFiles(path) : path.endsWith('.ts') ? [path] : []
  })
}

describe('the service-account private key', () => {
  it('is referenced in exactly one file', () => {
    const touching = sourceFiles(SRC).filter((file) =>
      /\bprivate_key\b|\bprivateKey\b/.test(readFileSync(file, 'utf8')),
    )
    expect(touching.map((file) => file.slice(SRC.length + 1))).toEqual([ALLOWED])
  })

  it('is not read by anything that builds an HTTP response', () => {
    const apiFiles = sourceFiles(join(SRC, 'api'))
    expect(apiFiles.length).toBeGreaterThan(0)
    for (const file of apiFiles) {
      expect(readFileSync(file, 'utf8')).not.toMatch(/private_key|privateKey/)
    }
  })

  it('finds the file it is meant to be guarding, so an empty pass is impossible', () => {
    // Without this, renaming the client would make the first assertion pass by
    // finding nothing at all.
    expect(sourceFiles(SRC).some((file) => file.endsWith(ALLOWED))).toBe(true)
  })
})
