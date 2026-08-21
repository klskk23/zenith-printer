/**
 * Client preferences.
 *
 * Local to this browser and nothing else. That boundary is the point: with no
 * authentication, a setting stored on the server is a setting anyone on the
 * network can change for everyone. Dry-run mode in particular is worth exactly
 * as much as the difficulty of switching it off, so it stays in the deployment
 * layer where changing it means having access to the machine.
 *
 * The consequence — preferences do not follow you to another browser — is
 * accepted rather than worked around. Working around it would mean identity,
 * and identity means authentication.
 */
import type { Locale } from './locale.ts'

export interface Preferences {
  language: Locale
  defaultLabelWidthMm: number
  defaultLabelHeightMm: number
  defaultDpi: number
  defaultFontFamily: string
  /** Which unit the editor shows first; both are always available. */
  displayUnit: 'mm' | 'dot'
  theme: 'light' | 'dark' | 'system'
  queuePollIntervalMs: number
  alwaysConfirmTabClose: boolean
}

export const DEFAULT_PREFERENCES: Preferences = {
  language: 'zh-CN',
  defaultLabelWidthMm: 50,
  defaultLabelHeightMm: 30,
  defaultDpi: 203,
  defaultFontFamily: 'Noto Sans CJK SC',
  displayUnit: 'mm',
  /**
   * Dark by default.
   *
   * A label editor is looked at for hours against a white canvas that cannot
   * be darkened — the paper has to look like paper — so the surroundings are
   * the only thing that can give the eyes a rest.
   *
   * `index.html` carries the same default in the script that runs before the
   * first paint. The two have to agree, or a fresh visitor gets a dark page
   * that turns light for a frame and back again.
   */
  theme: 'dark',
  queuePollIntervalMs: 2000,
  alwaysConfirmTabClose: false,
}

/**
 * Keys this store is allowed to hold.
 *
 * Asserted in tests. Without it, "just one server setting, it's convenient"
 * is a one-line change that quietly hands everyone on the network a switch.
 */
export const PREFERENCE_KEYS = Object.keys(DEFAULT_PREFERENCES) as (keyof Preferences)[]

const STORAGE_KEY = 'zenith.preferences'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/**
 * Read preferences, keeping only known keys.
 *
 * Anything unrecognised is dropped rather than carried along: stored data is
 * outside input, and a stale key from an older version should not survive into
 * a shape that no longer expects it.
 */
export function loadPreferences(storage: Pick<Storage, 'getItem'>): Preferences {
  let parsed: unknown
  try {
    const raw = storage.getItem(STORAGE_KEY)
    parsed = raw === null ? null : JSON.parse(raw)
  } catch {
    // Corrupt storage is not worth failing over; defaults are always valid.
    return { ...DEFAULT_PREFERENCES }
  }

  if (!isRecord(parsed)) {
    return { ...DEFAULT_PREFERENCES }
  }

  const result = { ...DEFAULT_PREFERENCES }
  for (const key of PREFERENCE_KEYS) {
    const value = parsed[key]
    if (typeof value === typeof DEFAULT_PREFERENCES[key]) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(result as any)[key] = value
    }
  }
  return result
}

export function savePreferences(storage: Pick<Storage, 'setItem'>, preferences: Preferences): void {
  storage.setItem(STORAGE_KEY, JSON.stringify(preferences))
}
