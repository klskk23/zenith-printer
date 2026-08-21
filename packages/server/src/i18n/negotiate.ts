/**
 * Pick a locale from an Accept-Language header.
 *
 * Deliberately small. Full RFC 4647 matching is not needed for two locales, and
 * the failure mode of a clever implementation — quietly picking the wrong one —
 * is worse than the failure mode of a simple one.
 *
 * Chinese is the fallback: it is the project's default language, and an
 * unrecognised header is far more likely to be a client that never set one than
 * a deliberate request for something else.
 */
import { DEFAULT_LOCALE, LOCALES, type Locale } from './types.ts'

interface Candidate {
  tag: string
  quality: number
}

function parseHeader(header: string): Candidate[] {
  return header
    .split(',')
    .map((part) => {
      const [tag, ...params] = part.trim().split(';')
      const q = params.find((p) => p.trim().startsWith('q='))
      const quality = q === undefined ? 1 : Number(q.trim().slice(2))
      return { tag: (tag ?? '').trim().toLowerCase(), quality: Number.isFinite(quality) ? quality : 0 }
    })
    .filter((candidate) => candidate.tag.length > 0 && candidate.quality > 0)
    .sort((a, b) => b.quality - a.quality)
}

/** `zh`, `zh-cn`, `zh-Hans-CN` all mean the Chinese bundle. */
function matchLocale(tag: string): Locale | undefined {
  const exact = LOCALES.find((locale) => locale.toLowerCase() === tag)
  if (exact !== undefined) {
    return exact
  }
  const primary = tag.split('-')[0]
  return LOCALES.find((locale) => locale.toLowerCase().split('-')[0] === primary)
}

export function negotiateLocale(header: string | undefined): Locale {
  if (header === undefined || header.trim().length === 0) {
    return DEFAULT_LOCALE
  }
  for (const candidate of parseHeader(header)) {
    if (candidate.tag === '*') {
      return DEFAULT_LOCALE
    }
    const matched = matchLocale(candidate.tag)
    if (matched !== undefined) {
      return matched
    }
  }
  return DEFAULT_LOCALE
}
