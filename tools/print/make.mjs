// Print materials for fundraising, made from the site's own data:
//   iccd-support-poster-a4.pdf   donation poster (prints well on A3 too)
//   iccd-support-card-a6.pdf     table / reception card
//   iccd-support-story.png       Instagram / WhatsApp story (1080 × 1920)
//   iccd-sponsorship.pdf         two-page offer for businesses and towns
// Usage: node tools/print/make.mjs   → files in public/print/ (cubandance.co/print/…)
// Chrome renders the pages, so the PDFs have real, selectable text and working links.
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import QRCode from 'qrcode';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = join(ROOT, 'public', 'print');
const TMP = join(ROOT, 'tools', 'print', '.tmp');
const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const read = (f) => JSON.parse(readFileSync(join(ROOT, 'src', 'data', f), 'utf8'));
const site = read('site.json'), people = read('people.json'), perf = read('performances.json'), teachers = read('teachers.json');
const file = (p) => pathToFileURL(join(ROOT, p)).href;
const SUPPORT = 'https://cubandance.co/support/';
const HANDLE = site.instagramHandle || '';

// ---------- what the sponsorship offer promises (edit here, then run again) ----------
const SEASON = '2026–2027';
const LEVELS = [
  { name: 'Friend', price: '€250', per: 'per season', gets: ['Your name and link on our website', 'A thank-you story on Instagram'] },
  { name: 'Partner', price: '€750+', per: 'per season', gets: ['Your logo and link on our website', 'A thank-you post and stories on Instagram', 'Thanks on stage at our shows', 'Larger partnerships, such as a training weekend presented by you or a dance workshop for your team, shaped together'] },
];

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const qr = (url, dark = '#14110d') => QRCode.toString(url, { type: 'svg', margin: 0, errorCorrectionLevel: 'M', color: { dark, light: '#0000' } });
const countries = new Set(people.members.map((m) => m.country)).size;
const stat = (label) => site.stats.find((s) => s.label === label)?.value;
const LANGS_LINE = 'Support us · Apóyanos · Nous soutenir · Sostienici · Unterstütze uns · Steun ons';

const base = `
@font-face { font-family: Anton; src: url(${file('node_modules/@fontsource/anton/files/anton-latin-400-normal.woff2')}) format('woff2'); }
@font-face { font-family: Montserrat; font-weight: 100 900; src: url(${file('node_modules/@fontsource-variable/montserrat/files/montserrat-latin-wght-normal.woff2')}) format('woff2'); }
:root { --ink: #14110d; --gold: #e8c95f; --gold-pale: #f3e2a3; --cream: #fbf1d4; --green: #2b5b3c; --muted: #5c5345; }
* { box-sizing: border-box; margin: 0; padding: 0; }
html, body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
body { font-family: Montserrat, Arial, sans-serif; color: var(--ink); }
.display { font-family: Anton, Impact, sans-serif; font-weight: 400; text-transform: uppercase; line-height: 1.04; letter-spacing: 0.01em; }
.eyebrow { font-weight: 700; text-transform: uppercase; letter-spacing: 0.22em; color: var(--green); display: flex; align-items: center; gap: 0.6em; }
.eyebrow::before { content: ''; width: 1.8em; height: 0.14em; background: currentColor; }
a { color: inherit; text-decoration: none; }
.qr svg { display: block; width: 100%; height: auto; }
.photo { display: block; width: 100%; object-fit: cover; }
`;
const page = (css, body, size) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><style>@page { size: ${size}; margin: 0; } ${base} ${css}</style></head><body>${body}</body></html>`;

// ---------- donation poster (A4) ----------
async function poster() {
  const css = `
  .sheet { width: 210mm; height: 297mm; display: grid; grid-template-rows: 121mm 1fr auto; background: var(--gold); overflow: hidden; }
  .top { position: relative; }
  .top .photo { height: 121mm; object-position: 50% 0%; }
  .top .logo { position: absolute; right: 12mm; top: 9mm; width: 22mm; }
  .main { padding: 12mm 14mm 0; display: grid; grid-template-columns: 1fr 62mm; gap: 10mm; align-content: start; }
  .eyebrow { font-size: 9pt; margin-bottom: 5mm; }
  h1 { font-size: 42pt; margin-bottom: 7mm; }
  .text { font-size: 11.5pt; line-height: 1.55; max-width: 105mm; }
  .give { background: var(--ink); color: var(--cream); border-radius: 6mm; padding: 6mm; display: grid; gap: 4mm; align-self: start; }
  .give .qr { background: var(--cream); border-radius: 3mm; padding: 4mm; }
  .give b { font: 400 17pt/1.05 Anton, sans-serif; text-transform: uppercase; color: var(--gold); }
  .give span { font-size: 9.5pt; line-height: 1.45; }
  .give .url { font-weight: 700; font-size: 10pt; color: var(--gold-pale); }
  .langs { font-size: 9pt; font-weight: 600; color: var(--green); padding: 0 14mm; margin-top: 8mm; }
  .foot { padding: 6mm 14mm 9mm; font-size: 8pt; line-height: 1.5; color: var(--muted); display: flex; justify-content: space-between; gap: 8mm; align-items: end; }
  .foot b { color: var(--ink); }`;
  const body = `<div class="sheet">
    <div class="top"><img class="photo" src="${file('public/images/photos/rome-musicians.webp')}" alt=""><img class="logo" src="${file('public/images/logo.svg')}" alt=""></div>
    <div><div class="main">
      <div><p class="eyebrow">Support us</p><h1 class="display">Keep spreading love for music, dance and culture</h1>
        <p class="text">We are a non-profit association. Every donation goes into training weekends, live music and shows that keep Afro-Cuban folklore alive in Europe.</p></div>
      <a class="give" href="${SUPPORT}"><div class="qr">${await qr(SUPPORT)}</div><b>Scan to donate</b><span>From €5, once or every month. Card, Apple Pay, Google Pay and more.</span><span class="url">cubandance.co/support</span></a>
    </div><p class="langs">${LANGS_LINE}</p></div>
    <div class="foot"><span><b>${esc(site.name)}</b><br>A project of Generación Abbilona, a non-profit cultural association registered in Luxembourg.</span><span>${esc(HANDLE)}</span></div>
  </div>`;
  return page(css, body, 'A4');
}

// ---------- table card (A6) ----------
async function card() {
  const css = `
  .sheet { width: 105mm; height: 148mm; background: var(--gold); padding: 9mm 9mm 7mm; display: grid; grid-template-rows: auto auto 1fr auto; gap: 4mm; overflow: hidden; }
  .logo { width: 14mm; }
  .eyebrow { font-size: 6.5pt; margin-bottom: 2.5mm; }
  h1 { font-size: 19pt; }
  .give { display: grid; grid-template-columns: 38mm 1fr; gap: 4mm; align-items: center; align-self: center; }
  .qr { background: var(--cream); border-radius: 2.5mm; padding: 3mm; }
  .give b { font: 400 13pt/1.05 Anton, sans-serif; text-transform: uppercase; display: block; margin-bottom: 2mm; }
  .give span { font-size: 7.5pt; line-height: 1.45; display: block; }
  .give .url { font-weight: 700; margin-top: 2mm; }
  .foot { font-size: 6pt; line-height: 1.45; color: var(--muted); }`;
  const body = `<div class="sheet">
    <img class="logo" src="${file('public/images/logo.svg')}" alt="">
    <div><p class="eyebrow">Support us</p><h1 class="display">Keep spreading love for music, dance and culture</h1></div>
    <a class="give" href="${SUPPORT}"><div class="qr">${await qr(SUPPORT)}</div><div><b>Scan to donate</b><span>From €5, once or every month.</span><span class="url">cubandance.co/support</span></div></a>
    <p class="foot">${esc(site.name)} · a non-profit cultural association (Luxembourg)<br>${LANGS_LINE}</p>
  </div>`;
  return page(css, body, '105mm 148mm');
}

// ---------- Instagram / WhatsApp story (1080 × 1920 px) ----------
async function story() {
  const css = `
  body { width: 1080px; height: 1920px; }
  .sheet { width: 1080px; height: 1920px; background: var(--ink); color: var(--cream); display: grid; grid-template-rows: 760px 1fr; overflow: hidden; }
  .top { position: relative; }
  .top .photo { height: 760px; object-position: 50% 28%; }
  .top::after { content: ''; position: absolute; inset: 0; background: linear-gradient(to top, var(--ink), transparent 45%); }
  .logo { position: absolute; right: 64px; top: 56px; width: 120px; z-index: 1; }
  .main { padding: 10px 72px 0; display: grid; gap: 36px; align-content: start; }
  .eyebrow { font-size: 28px; color: var(--gold); }
  h1 { font-size: 104px; color: #fff; }
  .text { font-size: 34px; line-height: 1.5; color: #e9dfca; }
  .give { display: grid; grid-template-columns: 330px 1fr; gap: 44px; align-items: center; margin-top: 10px; }
  .qr { background: var(--cream); border-radius: 26px; padding: 30px; }
  .give b { font: 400 64px/1.05 Anton, sans-serif; text-transform: uppercase; color: var(--gold); display: block; margin-bottom: 18px; }
  .give span { font-size: 32px; line-height: 1.45; display: block; }
  .give .url { font-weight: 700; color: var(--gold-pale); margin-top: 14px; }`;
  const body = `<div class="sheet">
    <div class="top"><img class="photo" src="${file('public/images/photos/rome-musicians.webp')}" alt=""><img class="logo" src="${file('public/images/logo.svg')}" alt=""></div>
    <div class="main"><p class="eyebrow">Support us</p><h1 class="display">Keep spreading love for music, dance and culture</h1>
      <p class="text">We are a non-profit association. Every donation goes into training weekends, live music and shows.</p>
      <div class="give"><div class="qr">${await qr(SUPPORT)}</div><div><b>Scan or tap the link</b><span>From €5, once or every month.</span><span class="url">cubandance.co/support</span></div></div>
    </div></div>`;
  return page(css, body, '1080px 1920px');
}

// ---------- sponsorship offer (2 × A4) ----------
async function sponsorship() {
  const maestros = teachers.masters.map((t) => t.name);
  const shows = perf.past.length;
  const numbers = [
    [people.members.length, 'dancers'], [countries, 'countries'], [stat('Training weekends') || '45+', 'training weekends since 2022'],
    [stat('Cities in Europe & Cuba') || '20+', 'cities in Europe & Cuba'], [stat('Instagram followers') || '', 'Instagram followers'],
  ].filter(([v]) => v);
  const css = `
  .sheet { width: 210mm; height: 297mm; overflow: hidden; position: relative; break-after: page; display: flex; flex-direction: column; }
  .sheet:last-child { break-after: auto; }
  .band { background: var(--ink); color: var(--cream); padding: 9mm 14mm; display: flex; align-items: center; gap: 6mm; }
  .band img { width: 16mm; }
  .band p { font-size: 8.5pt; letter-spacing: 0.18em; text-transform: uppercase; font-weight: 700; color: var(--gold); }
  .band small { display: block; font-size: 8pt; letter-spacing: 0.04em; text-transform: none; color: #c2b7a2; font-weight: 500; margin-top: 1mm; }
  .wrap { padding: 9mm 14mm 0; }
  h1 { font-size: 33pt; margin: 3mm 0 5mm; max-width: 170mm; }
  h2 { font-size: 17pt; margin-bottom: 3.5mm; }
  p, li { font-size: 10.5pt; line-height: 1.6; }
  .eyebrow { font-size: 8pt; }
  .hero { height: 82mm; object-position: 50% 28%; }
  .strip { height: 58mm; object-position: 50% 20%; }
  .quote { margin: 9mm 14mm 0; padding: 7mm 0 0; border-top: 0.6mm solid var(--ink); display: flex; justify-content: space-between; align-items: end; gap: 8mm; }
  .quote b { font: 400 22pt/1.05 Anton, sans-serif; text-transform: uppercase; }
  .quote span { font-size: 8.5pt; color: var(--muted); text-align: right; }
  .numbers { display: grid; grid-template-columns: repeat(${numbers.length}, 1fr); background: var(--gold); }
  .numbers div { padding: 5mm 3mm 5mm 5mm; border-right: 0.3mm solid rgba(20,17,13,0.15); }
  .numbers div:last-child { border-right: 0; }
  .numbers b { font: 400 22pt/1 Anton, sans-serif; display: block; }
  .numbers span { font-size: 7.5pt; font-weight: 600; line-height: 1.3; display: block; margin-top: 1.5mm; }
  .cols { display: grid; grid-template-columns: repeat(3, 1fr); gap: 7mm; margin-top: 7mm; }
  .cols h3 { font-size: 10.5pt; margin-bottom: 1.5mm; }
  .cols p { font-size: 9.5pt; color: var(--muted); }
  .levels { display: grid; grid-template-columns: repeat(${LEVELS.length}, 1fr); gap: 5mm; margin-top: 4mm; }
  .level { border: 0.3mm solid rgba(20,17,13,0.18); border-radius: 4mm; padding: 6mm 5mm; display: flex; flex-direction: column; gap: 3mm; }
  .level.main { background: var(--ink); color: var(--cream); border-color: var(--ink); }
  .level .name { font-size: 8pt; letter-spacing: 0.16em; text-transform: uppercase; font-weight: 700; color: var(--green); }
  .level.main .name { color: var(--gold); }
  .level b { font: 400 25pt/1 Anton, sans-serif; }
  .level small { font-size: 8pt; color: var(--muted); }
  .level.main small { color: #c2b7a2; }
  .level ul { list-style: none; display: grid; gap: 2mm; }
  .level li { font-size: 8.8pt; line-height: 1.4; padding-left: 4.5mm; position: relative; }
  .level li::before { content: ''; position: absolute; left: 0; top: 1.6mm; width: 2mm; height: 2mm; border-radius: 50%; background: var(--gold); }
  .why { display: grid; grid-template-columns: 1fr 1fr; gap: 4mm 9mm; margin-top: 3mm; }
  .why li { list-style: none; font-size: 9.5pt; }
  .why li b { display: block; font-size: 10pt; }
  .also { margin-top: 6mm; font-size: 9.5pt; }
  .contact { margin-top: auto; background: var(--gold); padding: 8mm 14mm; display: grid; grid-template-columns: 1fr auto; gap: 8mm; align-items: center; }
  .contact h2 { margin-bottom: 2mm; }
  .contact p { font-size: 10pt; }
  .contact .qr { width: 26mm; }
  .note { font-size: 7.5pt; color: var(--muted); padding: 3mm 14mm 6mm; background: var(--gold); }`;
  const body = `
  <section class="sheet">
    <div class="band"><img src="${file('public/images/logo.svg')}" alt=""><p>Partnership proposal · season ${SEASON}<small>${esc(site.name)} · cubandance.co</small></p></div>
    <img class="photo hero" src="${file('public/images/photos/stage-africa.webp')}" alt="">
    <div class="numbers">${numbers.map(([v, l]) => `<div><b>${esc(v)}</b><span>${esc(l)}</span></div>`).join('')}</div>
    <div class="wrap">
      <p class="eyebrow">Partner with us</p>
      <h1 class="display">Help keep Afro-Cuban folklore alive in Europe</h1>
      <p>${esc(site.intro.text)}</p>
      <div class="cols">
        <div><h3>Training weekends</h3><p>A different European city every month, with live drums and the maestros ${esc(maestros.slice(0, -1).join(', '))} and ${esc(maestros.at(-1))}.</p></div>
        <div><h3>Shows</h3><p>Raíces Cubanas, our full-length Afro-Cuban folkloric show, and ${shows} performances so far at festivals, theatres and cultural events.</p></div>
        <div><h3>Community</h3><p>${people.members.length} dancers from ${countries} countries, ${people.musicians.length} musicians and a team of volunteers, run as a non-profit association.</p></div>
      </div>
    </div>
    <div class="quote"><b>${esc(site.tagline || '')}</b><span>${esc(site.name)}<br>cubandance.co</span></div>
  </section>
  <section class="sheet">
    <div class="band"><img src="${file('public/images/logo.svg')}" alt=""><p>Partnership levels<small>Per season, ${SEASON}</small></p></div>
    <img class="photo strip" src="${file('public/images/photos/training-energy.webp')}" alt="">
    <div class="wrap">
      <h2 class="display">Why partner with us</h2>
      <ul class="why">
        <li><b>An international audience</b>Dancers, families and dance lovers across Europe, every month in a new city.</li>
        <li><b>Culture with roots</b>Taught by former dancers of the Conjunto Folklórico Nacional de Cuba.</li>
        <li><b>Visible online</b>${esc(stat('Instagram followers') || '')} followers on Instagram, plus our website in six languages.</li>
        <li><b>Real impact</b>Your support pays for live music, the maestros' travel, costumes and shows.</li>
      </ul>
      <div class="levels" style="margin-top:9mm">${LEVELS.map((l, i) => `<div class="level${i === LEVELS.length - 1 ? ' main' : ''}"><span class="name">${esc(l.name)}</span><div><b>${esc(l.price)}</b> <small>${esc(l.per)}</small></div><ul>${l.gets.map((g) => `<li>${esc(g)}</li>`).join('')}</ul></div>`).join('')}</div>
      <p class="also"><b>Support in kind is just as welcome:</b> studios and venues, accommodation for the maestros, travel, printing or costumes. We gladly shape a partnership around what suits you.</p>
    </div>
    <div class="contact"><div><h2 class="display">Let's talk</h2><p><a href="mailto:${esc(site.links.email)}"><b>${esc(site.links.email)}</b></a> · <a href="https://cubandance.co">cubandance.co</a>${HANDLE ? ` · <a href="${esc(site.links.instagram)}">${esc(HANDLE)}</a>` : ''}</p></div><a class="qr" href="https://cubandance.co">${await qr('https://cubandance.co')}</a></div>
    <p class="note">${esc(site.name)} is a project of Generación Abbilona, a non-profit cultural association registered in Luxembourg.</p>
  </section>`;
  return page(css, body, 'A4');
}

// ---------- render ----------
mkdirSync(OUT, { recursive: true }); mkdirSync(TMP, { recursive: true });
const chrome = (args) => execFileSync(CHROME, ['--headless=new', '--disable-gpu', '--allow-file-access-from-files', '--hide-scrollbars', '--virtual-time-budget=8000', ...args], { stdio: 'ignore' });
const jobs = [['iccd-support-poster-a4', poster, 'pdf'], ['iccd-support-card-a6', card, 'pdf'], ['iccd-support-story', story, 'png'], ['iccd-sponsorship', sponsorship, 'pdf']];
for (const [name, make, type] of jobs) {
  const html = join(TMP, name + '.html');
  writeFileSync(html, await make());
  const out = join(OUT, `${name}.${type}`);
  if (type === 'pdf') chrome(['--no-pdf-header-footer', `--print-to-pdf=${out}`, pathToFileURL(html).href]);
  else chrome(['--window-size=1080,1920', '--force-device-scale-factor=1', `--screenshot=${out}`, pathToFileURL(html).href]);
  console.log('made', out.replace(ROOT, '').replace(/\\/g, '/'));
}
if (!process.argv.includes('--keep')) rmSync(TMP, { recursive: true, force: true });
