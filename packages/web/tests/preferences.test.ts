/**
 * Client preferences.
 *
 * Two properties are worth pinning: they survive a reload, and they contain
 * nothing that affects anybody else.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  DEFAULT_PREFERENCES,
  PREFERENCE_KEYS,
  loadPreferences,
  savePreferences,
  type Preferences,
} from '../src/features/preferences/store.ts'

/** Minimal stand-in; the real one is the browser's. */
function memoryStorage(initial?: string) {
  const map = new Map<string, string>()
  if (initial !== undefined) {
    map.set('zenith.preferences', initial)
  }
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => {
      map.set(key, value)
    },
  }
}

describe('defaults', () => {
  it('returns them when nothing is stored', () => {
    expect(loadPreferences(memoryStorage())).toEqual(DEFAULT_PREFERENCES)
  })

  it('defaults to Chinese, the project language', () => {
    expect(DEFAULT_PREFERENCES.language).toBe('zh-CN')
  })

  it('never returns a partial object', () => {
    const loaded = loadPreferences(memoryStorage('{"language":"en-US"}'))
    for (const key of PREFERENCE_KEYS) {
      expect(loaded[key]).toBeDefined()
    }
  })
})

describe('round trip', () => {
  it('survives a reload', () => {
    const storage = memoryStorage()
    const changed: Preferences = { ...DEFAULT_PREFERENCES, language: 'en-US', defaultLabelWidthMm: 40 }
    savePreferences(storage, changed)
    expect(loadPreferences(storage)).toEqual(changed)
  })

  it('keeps values that were not touched', () => {
    const storage = memoryStorage()
    savePreferences(storage, { ...DEFAULT_PREFERENCES, displayUnit: 'dot' })
    expect(loadPreferences(storage).defaultDpi).toBe(DEFAULT_PREFERENCES.defaultDpi)
  })
})

describe('bad stored data', () => {
  it('falls back to defaults rather than throwing', () => {
    expect(loadPreferences(memoryStorage('not json at all'))).toEqual(DEFAULT_PREFERENCES)
  })

  it('ignores a value of the wrong type', () => {
    const loaded = loadPreferences(memoryStorage('{"defaultDpi":"three hundred"}'))
    expect(loaded.defaultDpi).toBe(DEFAULT_PREFERENCES.defaultDpi)
  })

  it('drops keys it does not recognise', () => {
    // Stored data is outside input; a stale key from an older version should
    // not survive into a shape that no longer expects it.
    const loaded = loadPreferences(memoryStorage('{"language":"en-US","legacyThing":true}'))
    expect(loaded).not.toHaveProperty('legacyThing')
    expect(loaded.language).toBe('en-US')
  })

  it('survives a null payload', () => {
    expect(loadPreferences(memoryStorage('null'))).toEqual(DEFAULT_PREFERENCES)
  })
})

/**
 * FR-070 as an explicit allow-list.
 *
 * There is no authentication, so a server-side setting exposed here would be a
 * switch anybody on the network can flip for everybody. The dry-run guard in
 * particular is worth exactly as much as the difficulty of turning it off —
 * putting it in a settings panel would be worth nothing.
 */
describe('scope', () => {
  const FORBIDDEN = [
    'dryRun',
    'zenithDryRun',
    'logLevel',
    'historyRetentionDays',
    'serverPort',
    'databasePath',
    'fontPath',
    'printerAddress',
  ]

  it.each(FORBIDDEN)('has no %s', (key) => {
    expect(PREFERENCE_KEYS).not.toContain(key)
  })

  it('holds exactly the documented keys and no others', () => {
    expect([...PREFERENCE_KEYS].sort()).toEqual([
      'alwaysConfirmTabClose',
      'defaultDpi',
      'defaultFontFamily',
      'defaultLabelHeightMm',
      'defaultLabelWidthMm',
      'displayUnit',
      'language',
      'queuePollIntervalMs',
    ])
  })

  it('stores nothing on the server', () => {
    // The whole module takes a Storage; there is no request in it anywhere.
    const storage = memoryStorage()
    savePreferences(storage, DEFAULT_PREFERENCES)
    expect(storage.getItem('zenith.preferences')).toContain('language')
  })
})


/** The web package's HTML shell, wherever the runner happens to be rooted. */
function shellHtml(): string {
  return join(dirname(fileURLToPath(import.meta.url)), '..', 'index.html')
}

describe('the HTML shell', () => {
  /**
   * There used to be a script here that set the theme attribute before the
   * first paint, because the stylesheet held two palettes and the page would
   * otherwise render light and flip. With one palette there is nothing to
   * flip between, and the script — with its own second copy of a default that
   * had to be kept in step — is gone.
   */
  it('sets no palette before the bundle loads', () => {
    const html = readFileSync(shellHtml(), 'utf8')
    expect(html).not.toContain('data-theme')
  })

  it('reads no storage of its own', () => {
    // The shell used to parse the preferences blob to find the theme. Nothing
    // in it needs storage now, and a second reader of that key was a second
    // thing to keep in step with the store's shape.
    const html = readFileSync(shellHtml(), 'utf8')
    expect(html).not.toContain('localStorage')
  })
})
