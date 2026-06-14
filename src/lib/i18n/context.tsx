'use client';

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { messages, type Locale } from './messages';
import { teamName } from './teams';

interface Ctx {
  locale: Locale;
  setLocale: (l: Locale) => void;
  t: (key: string) => string;
  /** 本地化国家队名。 */
  tn: (name: string) => string;
}

const LocaleContext = createContext<Ctx>({
  locale: 'zh',
  setLocale: () => {},
  t: (k) => k,
  tn: (n) => n,
});

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

  const tn = (name: string) => teamName(name, locale);

  return (
    <LocaleContext.Provider value={{ locale, setLocale, t, tn }}>{children}</LocaleContext.Provider>
  );
}

/** 完整 locale 上下文(含 setLocale / tn,设置页与队名翻译用)。 */
export const useLocale = () => useContext(LocaleContext);
/** 仅取翻译函数 t。 */
export const useT = () => useContext(LocaleContext).t;
/** 仅取队名本地化函数 tn。 */
export const useTn = () => useContext(LocaleContext).tn;
