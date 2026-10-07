// Collects every English string the site can translate and writes
// src/i18n/strings.json (read by the admin's Translations tab).
//  - UI strings: literal t('…') calls and <Layout title="…"> props in src/**/*.astro
//  - Content strings: text values in src/data/*.json
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const walk = (d) => readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : [join(d, f)]));
const ui = new Set();
for (const f of walk('src').filter((f) => f.endsWith('.astro'))) {
  const src = readFileSync(f, 'utf8');
  for (const m of src.matchAll(/\bt\('((?:[^'\\]|\\.)+)'\)/g)) ui.add(m[1]);
  for (const m of src.matchAll(/<Layout[^>]*\btitle="([^"]+)"/g)) ui.add(m[1]);
}

// Keys whose values are names, paths, links or dates — never translated.
// Keep in sync with SKIP in public/admin/admin.js.
const SKIP = new Set(['name', 'shortName', 'organizer', 'teacher', 'venue', 'address', 'city', 'countryCode', 'src', 'photo', 'image', 'images', 'poster', 'url', 'mapUrl', 'ticketUrl', 'start', 'end', 'date', 'links', 'instagramHandle', 'cities']);
const content = new Set();
const visit = (v, key) => {
  if (SKIP.has(key)) return;
  if (typeof v === 'string') { if (/[A-Za-zÀ-ÿ]{2}/.test(v) && !/^(\/|https?:)/.test(v)) content.add(v); }
  else if (Array.isArray(v)) v.forEach((x) => visit(x, key));
  else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) visit(x, k);
};
for (const f of readdirSync('src/data').filter((f) => f.endsWith('.json'))) visit(JSON.parse(readFileSync(join('src/data', f), 'utf8')));

writeFileSync('src/i18n/strings.json', JSON.stringify({ ui: [...ui], content: [...content].filter((s) => !ui.has(s)) }, null, 1) + '\n');
console.log(`strings.json: ${ui.size} UI + ${content.size} content strings`);
