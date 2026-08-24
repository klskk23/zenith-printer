/**
 * Nothing may `SELECT *` from the images table.
 *
 * The bytes live in the row (migration 15), which is what made the uploads
 * directory unnecessary — but it also revives the concern that put the files
 * there in the first place: a multi-megabyte logo riding along on every query
 * that touches the table. Naming columns is the whole answer, so the rule has
 * to hold everywhere rather than mostly.
 *
 * Checked by reading the source because the cost is invisible from outside.
 * SQLite reads the blob into memory and the repository maps columns by hand, so
 * a `SELECT *` returns exactly the same object as a narrow one — the response
 * is identical and only the machine notices. A test that asserted on the
 * response passed happily with `SELECT *` restored, which is how this check
 * came to exist.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const SRC = new URL('../../src', import.meta.url).pathname

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry)
    return statSync(path).isDirectory()
      ? sourceFiles(path)
      : path.endsWith('.ts')
        ? [path]
        : []
  })
}

/** Every `SELECT * FROM images` in the server, with the file it came from. */
function wideReads(): Array<{ file: string; line: string }> {
  return sourceFiles(SRC).flatMap((file) =>
    readFileSync(file, 'utf8')
      .split('\n')
      .map((line) => ({ file: file.slice(SRC.length + 1), line: line.trim() }))
      .filter(({ line }) => /select\s+\*\s+from\s+images\b/i.test(line)),
  )
}

describe('reading the images table', () => {
  it('has source to read, so an empty pass cannot look like a passing one', () => {
    expect(sourceFiles(SRC).length).toBeGreaterThan(20)
  })

  it('never selects every column', () => {
    expect(
      wideReads(),
      'the bytes are in this table now; a wide read pulls every picture into ' +
        'memory to answer a question about filenames',
    ).toEqual([])
  })
})
