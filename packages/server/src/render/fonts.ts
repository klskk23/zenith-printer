/**
 * Bundled font configuration.
 *
 * Constitution ("Rendering determinism"): the backend renders with
 * `loadSystemFonts: false` and these files only, so a template renders
 * identically on any machine. Binaries live outside git; `scripts/fetch-fonts.sh`
 * places them and `fonts/MANIFEST.sha256` pins their contents.
 */
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { FontConfig } from './pipeline.ts'

export const FONT_FAMILIES = {
  sans: 'Noto Sans CJK SC',
  serif: 'Noto Serif CJK SC',
  mono: 'DejaVu Sans Mono',
} as const

export type FontFamilyKey = keyof typeof FONT_FAMILIES

const FONT_FILES = [
  'NotoSansCJK-Regular.ttc',
  'NotoSerifCJK-Regular.ttc',
  'DejaVuSansMono.ttf',
] as const

export class MissingFontsError extends Error {
  readonly missing: string[]

  constructor(missing: string[]) {
    super(
      `missing bundled font files: ${missing.join(', ')}. ` +
        'Run "npm run fetch-fonts", then verify with "sha256sum -c fonts/MANIFEST.sha256".',
    )
    this.name = 'MissingFontsError'
    this.missing = missing
  }
}

/** Resolve the bundled font set, failing loudly if a file is absent. */
export function loadFontConfig(fontsRoot: string): FontConfig {
  const dir = join(fontsRoot, 'full')
  const paths = FONT_FILES.map((name) => join(dir, name))
  const missing = paths.filter((path) => !existsSync(path))

  if (missing.length > 0) {
    // Failing here beats rendering tofu onto physical stock.
    throw new MissingFontsError(missing)
  }

  return { fontFiles: paths, defaultFontFamily: FONT_FAMILIES.sans }
}
