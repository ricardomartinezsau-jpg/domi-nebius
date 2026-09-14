'use client'

import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { translate, type Locale } from '@/lib/ui-copy'

const LocaleContext = createContext({ locale: 'en' as Locale, t: (text: string) => translate('en', text) })

export function LocaleProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocale] = useState<Locale>('en')
  useEffect(() => {
    try { if (localStorage.getItem('domi.locale') === 'es') setLocale('es') } catch { /* English remains usable without storage. */ }
  }, [])
  useEffect(() => { document.documentElement.lang = locale }, [locale])
  const t = useCallback((text: string) => translate(locale, text), [locale])
  return <LocaleContext.Provider value={{ locale, t }}>
    <div className="language-bar"><label htmlFor="domi-language">{locale === 'en' ? 'Language' : 'Idioma'}</label>
      <select id="domi-language" value={locale} onChange={event => {
        const next = event.target.value === 'es' ? 'es' : 'en'
        setLocale(next)
        try { localStorage.setItem('domi.locale', next) } catch { /* Preference lasts for this tab. */ }
      }}><option value="en">English</option><option value="es">Español</option></select>
    </div>
    {children}
  </LocaleContext.Provider>
}
export const useLocale = () => useContext(LocaleContext)
