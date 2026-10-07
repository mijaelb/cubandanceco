// Translations: English is the source language. Each src/i18n/<lang>.json maps
// an English string to its translation. Missing entries fall back to English,
// so editing English text in the admin never breaks a page.
const files = import.meta.glob<Record<string, string>>('./[a-z][a-z].json', { eager: true, import: 'default' });
const dict: Record<string, Record<string, string>> = {};
for (const [p, d] of Object.entries(files)) dict[p.slice(2, -5)] = d;

export const LANGS = ['en', ...Object.keys(dict).sort()];
export const DEFAULT_LANG = 'en';

export const langName = (l: string) => {
  const n = new Intl.DisplayNames([l], { type: 'language' }).of(l) || l;
  return n[0].toUpperCase() + n.slice(1);
};

export const useT = (lang: string) => (s: string) => (s && dict[lang]?.[s]) || s;

export const locale = (lang: string) => ({ en: 'en-GB', es: 'es-ES', fr: 'fr-FR', it: 'it-IT', de: 'de-DE', nl: 'nl-NL' })[lang] || lang;
