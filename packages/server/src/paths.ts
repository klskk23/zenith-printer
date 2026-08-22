/**
 * Where the repository root is, worked out once.
 *
 * Three modules computed this themselves, each with a different number of
 * `..` segments because the count depends on how deep the file sits — move
 * such a file one directory and it silently starts resolving somewhere else,
 * taking the bundled fonts with it. Resolved here, relative to this file, so
 * there is one depth to get right.
 */
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '../../..')

/** The bundled fonts. Never the system's — see the rendering-determinism rule. */
export const fontsRoot = join(repoRoot, 'fonts')
