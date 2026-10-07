import { existsSync, readFileSync } from 'node:fs';
import { imageSize } from 'image-size';
import { join } from 'node:path';

const BASE = import.meta.env.BASE_URL.replace(/\/$/, '');

/** Prefix a site-relative path with the deploy base (GitHub Pages sub-path). */
export const url = (p = '/') => (/^(https?:|mailto:|#)/.test(p) ? p : BASE + (p.startsWith('/') ? p : '/' + p));

/** srcset from the size variants (-300, -800, -2400) that exist next to an image in /public. */
export function srcset(src: string) {
  const m = src.match(/^(.*)\.(webp|jpe?g|png)$/);
  if (!m) return undefined;
  const set = ['-300', '-800', '', '-2400']
    .map((v) => `${m[1]}${v}.${m[2]}`)
    .map((p) => [p, dims(p).width] as const)
    .filter(([, w]) => w)
    .map(([p, w]) => `${url(p)} ${w}w`);
  return set.length > 1 ? set.join(', ') : undefined;
}

/** Intrinsic size of an image in /public (so the browser can reserve space while it loads). */
export function dims(src: string) {
  const file = join(process.cwd(), 'public', src);
  if (!src.startsWith('/') || !existsSync(file)) return {};
  try { const { width, height } = imageSize(readFileSync(file)); return { width, height }; } catch { return {}; }
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
