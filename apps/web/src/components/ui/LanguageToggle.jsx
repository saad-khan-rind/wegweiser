import { ChevronDown, Globe } from 'lucide-react'
import { useLocale } from '../../i18n/useLocale'

const LOCALE_LABELS = {
  en: 'English',
  de: 'Deutsch',
}
const LOCALE_CODES = ['en', 'de']

export function LanguageSelector({ className = '' }) {
  const { locale, setLocale, t } = useLocale()

  return (
    <div className={`relative inline-flex items-center ${className}`}>
      <Globe size={15} className="pointer-events-none absolute left-3 text-slate-400" aria-hidden="true" />
      <select
        value={locale}
        onChange={(e) => setLocale(e.target.value)}
        aria-label={t('language.label')}
        className="min-h-10 max-w-[11rem] cursor-pointer appearance-none rounded-full border border-slate-200 bg-white py-2 pl-9 pr-9 text-sm font-medium text-slate-700 shadow-sm transition-colors hover:border-slate-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-civic-purple focus-visible:ring-offset-1"
      >
        {LOCALE_CODES.map((code) => (
          <option key={code} value={code}>
            {LOCALE_LABELS[code]}
          </option>
        ))}
      </select>
      <ChevronDown
        size={14}
        className="pointer-events-none absolute right-2.5 text-slate-400"
        aria-hidden="true"
      />
    </div>
  )
}

export function LanguageToggle({ className = '' }) {
  const { locale, setLocale, t } = useLocale()

  return (
    <div
      className={`inline-flex rounded-lg border border-slate-200 bg-white p-1 shadow-sm ${className}`}
      role="group"
      aria-label={t('language.label')}
    >
      {LOCALE_CODES.map((lang) => (
        <button
          key={lang}
          type="button"
          onClick={() => setLocale(lang)}
          aria-pressed={locale === lang}
          className={`min-h-9 min-w-11 rounded-md px-3 text-sm font-semibold uppercase transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-civic-purple focus-visible:ring-offset-1 ${
            locale === lang
              ? 'bg-civic-purple text-white'
              : 'text-slate-600 hover:bg-slate-50'
          }`}
        >
          {lang}
        </button>
      ))}
    </div>
  )
}
