/**
 * Character-encoding detection for uploaded CSV files.
 *
 * No dependency: Node ships with full ICU, so `TextDecoder` already speaks
 * GB18030 and Big5. Adding iconv-lite would install a second copy of a
 * capability that is already present, which the constitution asks us not to do
 * without a reason.
 *
 * Detection is best-effort by design, and the user can always override it. The
 * failure being guarded against is mojibake — a screen full of `锟斤拷`, which
 * is obviously wrong and gives no clue what to do about it.
 */

/** Tried in this order. UTF-8 first because it is both the most likely and the
 *  most self-verifying: invalid sequences are detectable, which the others are
 *  not. */
export const ENCODINGS = ['utf-8', 'gb18030', 'big5'] as const
export type Encoding = (typeof ENCODINGS)[number]

const REPLACEMENT = '�'

export class DecodeFailedError extends Error {
  readonly tried: readonly string[]

  constructor(tried: readonly string[]) {
    super(`could not decode the file as any of: ${tried.join(', ')}`)
    this.name = 'DecodeFailedError'
    this.tried = tried
  }
}

function decodeStrictly(bytes: Uint8Array, encoding: string): string | null {
  try {
    const text = new TextDecoder(encoding, { fatal: false }).decode(bytes)
    // A replacement character means the bytes were not this encoding. Accepting
    // it would store mojibake and print it onto labels.
    return text.includes(REPLACEMENT) ? null : text
  } catch {
    return null
  }
}

export interface DecodeResult {
  text: string
  encoding: string
}

/**
 * Decode, or say which encodings were tried.
 *
 * An explicit `requested` encoding is used as given and never second-guessed:
 * the user asking for GB18030 after seeing mojibake knows something detection
 * does not.
 */
export function decodeCsv(bytes: Uint8Array, requested?: string): DecodeResult {
  if (requested !== undefined && requested.length > 0) {
    const text = decodeStrictly(bytes, requested)
    if (text === null) {
      throw new DecodeFailedError([requested])
    }
    return { text, encoding: requested }
  }

  for (const encoding of ENCODINGS) {
    const text = decodeStrictly(bytes, encoding)
    if (text !== null) {
      return { text, encoding }
    }
  }

  throw new DecodeFailedError(ENCODINGS)
}
