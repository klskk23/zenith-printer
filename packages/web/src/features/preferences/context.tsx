/**
 * Preferences, available to the whole app.
 *
 * Also the place the chosen language reaches the API client: requests carry
 * `Accept-Language`, and the server words its errors to match. Without that the
 * interface switches to English and the error messages — the half that matters
 * when something is wrong — stay in Chinese.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { setRequestLocale } from '../../api/client.ts'
import { setCopyLocale } from '../../i18n/index.ts'
import { safeLocalStorage } from '../../lib/storage.ts'
import { applyTheme } from './theme.ts'
import {
  DEFAULT_PREFERENCES,
  loadPreferences,
  savePreferences,
  type Preferences,
} from './store.ts'

interface PreferencesApi {
  preferences: Preferences
  update: (changes: Partial<Preferences>) => void
}

const PreferencesContext = createContext<PreferencesApi | null>(null)

export function PreferencesProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const [preferences, setPreferences] = useState<Preferences>(() => {
    const loaded = loadPreferences(safeLocalStorage())
    // Applied during initialisation rather than in an effect: an effect runs
    // after the first render, so the first frame would be in the wrong
    // language and then visibly change.
    setCopyLocale(loaded.language)
    setRequestLocale(loaded.language)
    applyTheme(loaded.theme)
    return loaded
  })

  const update = useCallback((changes: Partial<Preferences>) => {
    setPreferences((current) => {
      const next = { ...current, ...changes }
      savePreferences(safeLocalStorage(), next)
      return next
    })
  }, [])

  // Both halves of the interface follow the same setting: the copy rendered
  // here, and the copy the server words. Switching one without the other leaves
  // the error messages — the half that matters when something is wrong — in the
  // language nobody asked for.
  useEffect(() => {
    setCopyLocale(preferences.language)
    setRequestLocale(preferences.language)
  }, [preferences.language])

  // The theme setting existed and was stored, and nothing ever read it — the
  // dropdown was inert.
  useEffect(() => {
    applyTheme(preferences.theme)
  }, [preferences.theme])

  const api = useMemo(() => ({ preferences, update }), [preferences, update])
  return <PreferencesContext.Provider value={api}>{children}</PreferencesContext.Provider>
}

export function usePreferences(): PreferencesApi {
  const api = useContext(PreferencesContext)
  if (api === null) {
    // Falling back to defaults would hide a missing provider until someone
    // wondered why their settings did nothing.
    throw new Error('usePreferences must be used inside a PreferencesProvider')
  }
  return api
}

export { DEFAULT_PREFERENCES }
