'use client';

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { messages, type Locale } from './messages';

interface Ctx {
  locale: Locale;
  setLocale: (l: Locale) => void;
  t: (key: string) => string;
}

const LocaleContext = createContext<Ctx>({ locale: 'zh', setLocale: () => {}, t: (k) => k });

export function LocaleProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>('zh');

  useEffect(() => {
    const saved = localStorage.getItem('locale');
    if (saved === 'zh' || saved === 'en') setLocaleState(saved);
  }, []);

  const setLocale = (l: Locale) => {
    setLocaleState(l);
    try {
      localStorage.setItem('locale', l);
    } catch {
      /* localStorage 不可用时忽略 */
    }
  };

  const t = (key: string): string => {
    let cur: unknown = messages[locale];
    for (const p of key.split('.')) {
      if (cur && typeof cur === 'object') cur = (cur as Record<string, unknown>)[p];
      else return key;
    }
    return typeof cur === 'string' ? cur : key;
  };

  return <LocaleContext.Provider value={{ locale, setLocale, t }}>{children}</LocaleContext.Provider>;
}

/** 完整 locale 上下文(含 setLocale,设置页用)。 */
export const useLocale = () => useContext(LocaleContext);
/** 仅取翻译函数 t。 */
export const useT = () => useContext(LocaleContext).t;
