import bn from './bn.json';
import en from './en.json';

export const LANGS = ['bn', 'en'] as const;
export type Lang = (typeof LANGS)[number];
export type Key = keyof typeof bn;

const dict: Record<Lang, Record<string, string>> = { bn, en };

export const otherLang = (lang: Lang): Lang => (lang === 'bn' ? 'en' : 'bn');

export function t(lang: Lang, key: Key): string {
  return dict[lang][key] ?? dict.bn[key];
}

export const useTranslations = (lang: Lang) => (key: Key) => t(lang, key);

export const DOCS_URL = 'https://schoolmanagerp.gitbook.io/schoolmanagerp-docs';
export const APP_URL = 'https://app.schoolmanagerp.com';
export const DEMO_URL = 'https://demo.schoolmanagerp.com/login';
