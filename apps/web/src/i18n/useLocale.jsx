import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react'
import { apiService } from '../services/mockApi'
import de from './locales/de.json'
import en from './locales/en.json'

const LOCALES = { en, de }
const DEFAULT_LOCALE = 'en'

const LocaleContext = createContext(null)

function getNestedValue(obj, path) {
  return path.split('.').reduce((acc, key) => acc?.[key], obj)
}

function interpolate(template, params = {}) {
  if (!template) return ''
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => params[key] ?? '')
}

export function LocaleProvider({ children }) {
  const [locale, setLocaleState] = useState(DEFAULT_LOCALE)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    apiService
      .fetchLocale()
      .then((saved) => {
        const next = LOCALES[saved] ? saved : DEFAULT_LOCALE
        setLocaleState(next)
        document.documentElement.lang = next
      })
      .catch(() => {
        document.documentElement.lang = DEFAULT_LOCALE
      })
      .finally(() => setReady(true))
  }, [])

  const setLocale = useCallback(async (next) => {
    const safeLocale = LOCALES[next] ? next : DEFAULT_LOCALE
    setLocaleState(safeLocale)
    await apiService.saveLocale(safeLocale)
    document.documentElement.lang = safeLocale
  }, [])

  const t = useCallback(
    (key, params) => {
      const strings = LOCALES[locale] ?? LOCALES[DEFAULT_LOCALE]
      const value = getNestedValue(strings, key) ?? getNestedValue(LOCALES.en, key) ?? key
      return typeof value === 'string' ? interpolate(value, params) : value
    },
    [locale],
  )

  const value = useMemo(
    () => ({ locale, setLocale, t, ready }),
    [locale, setLocale, t, ready],
  )

  return (
    <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>
  )
}

export function useLocale() {
  const context = useContext(LocaleContext)
  if (!context) {
    throw new Error('useLocale must be used within LocaleProvider')
  }
  return context
}
