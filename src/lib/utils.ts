import { existsSync } from 'node:fs';
import { join } from 'node:path';

const BASE = import.meta.env.BASE_URL.replace(/\/$/, '');

/** Prefix a site-relative path with the deploy base (GitHub Pages sub-path). */
export const url = (p = '/') => (/^(https?:|mailto:|#)/.test(p) ? p : BASE + (p.startsWith('/') ? p : '/' + p));

/** Build a srcset from the `-800` / `-2400` siblings that exist next to an image in /public. */
export function srcset(src: string) {
  const m = src.match(/^(.*)\.(webp|jpe?g|png)$/);
  if (!m) return undefined;
  const has = (s: string) => existsSync(join(process.cwd(), 'public', `${m[1]}${s}.${m[2]}`));
  const set = [has('-800') && `${url(`${m[1]}-800.${m[2]}`)} 800w`, `${url(src)} 1600w`, has('-2400') && `${url(`${m[1]}-2400.${m[2]}`)} 2400w`];
  return set.filter(Boolean).length > 1 ? set.filter(Boolean).join(', ') : undefined;
}

const d = (s: string) => new Date(s + 'T12:00:00');

/** "10–11 Oct" (or "31 Oct – 1 Nov") in the page language. */
export function dateRange(start: string, end: string, loc = 'en-GB') {
  const a = d(start), b = d(end || start);
  const m = (x: Date) => x.toLocaleString(loc, { month: 'short' }).replace('.', '');
  if (!end || start === end) return `${a.getDate()} ${m(a)}`;
  return a.getMonth() === b.getMonth() ? `${a.getDate()}–${b.getDate()} ${m(a)}` : `${a.getDate()} ${m(a)} – ${b.getDate()} ${m(b)}`;
}

export const fullDate = (s: string, loc = 'en-GB') => d(s).toLocaleDateString(loc, { day: 'numeric', month: 'long', year: 'numeric' });

/** Link to a page in a given language: English lives at the root, others under /<lang>/. */
export const link = (lang: string, page = '') => url(`${lang === 'en' ? '' : '/' + lang}/${page}`);

/** Items (trainings `start`/`end`, shows `date`) that are today or later, soonest first. */
export const upcoming = <T extends Record<string, any>>(list: T[]) => {
  const today = new Date().toISOString().slice(0, 10);
  const k = (e: T): string => e.start || e.date;
  return list.filter((e) => (e.end || k(e)) >= today).sort((a, b) => k(a).localeCompare(k(b)));
};

export const slug = (s: string) => s.toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "").replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

export const paragraphs = (s: string) => s.split(/\n\s*\n/).filter(Boolean);
