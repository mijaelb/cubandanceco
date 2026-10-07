// Builds the training brochure from the training passed by the timetable editor.
// All text is inserted with textContent (never as HTML).
const $ = (s) => document.querySelector(s);
const LOGO = document.body.dataset.logo;
const TICKETS = document.body.dataset.tickets;
const HANDLE = document.body.dataset.handle || '';
const EMAIL = document.body.dataset.email || '';
const WHATSAPP = document.body.dataset.whatsapp || '';
const INSTAGRAM = document.body.dataset.instagram || '';
// links work in the PDF; the images have the QR code for the WhatsApp group
const footer = () => h('p', { class: 'foot' }, h('a', { href: 'https://cubandance.co' }, 'cubandance.co'), h('span', {}, '·'), INSTAGRAM ? h('a', { href: INSTAGRAM }, HANDLE) : HANDLE);

function h(tag, attrs = {}, ...kids) {
  const el = tag === 'svg' || tag === 'path' ? document.createElementNS('http://www.w3.org/2000/svg', tag) : document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null && v !== false) (k === 'class' ? el.setAttribute('class', v) : el.setAttribute(k, v));
  for (const c of kids.flat(Infinity)) if (c != null && c !== false) el.append(c instanceof Node ? c : String(c));
  return el;
}
// conga drum = live music
const DRUM = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><ellipse cx="12" cy="4.6" rx="5.6" ry="1.9"/><path d="M6.4 4.6c-1.3 3.4-1.2 7.4.3 11l1.8 5.4h7l1.8-5.4c1.5-3.6 1.6-7.6.3-11"/><path d="M6.3 7.2c3.8 1.6 7.6 1.6 11.4 0" stroke-width="1.3"/><path d="M8.4 8.3v2.6M12 8.8v2.6M15.6 8.3v2.6" stroke-width="1.3"/><path d="M8.6 18.6c2.3.6 4.5.6 6.8 0" stroke-width="1.3"/></svg>';
const drum = () => { const t = document.createElement('template'); t.innerHTML = DRUM; const svg = t.content.firstChild; svg.setAttribute('class', 'drum'); return svg; };
const tag = () => h('span', { class: 'tag' }, 'ICCD');
const logo = () => h('img', { class: 'logo', src: LOGO, alt: '' });
const pattern = (...rows) => h('div', { class: 'pattern', 'aria-hidden': 'true' }, rows.map((r) => h('span', {}, r)));

const date = (s) => new Date(s + 'T12:00:00');
function range(a, b) {
  const x = date(a), y = date(b || a);
  const m = (d) => d.toLocaleString('en-GB', { month: 'long' });
  const yr = y.getFullYear();
  if (!b || a === b) return `${x.getDate()} ${m(x)} ${yr}`;
  return x.getMonth() === y.getMonth() ? `${x.getDate()}–${y.getDate()} ${m(x)} ${yr}` : `${x.getDate()} ${m(x)} – ${y.getDate()} ${m(y)} ${yr}`;
}
// maestros teaching this weekend, in order of first appearance
const maestros = (ev) => [...new Set((ev.schedule || []).flatMap((d) => d.slots.flatMap((s) => (s.classes || []).flatMap((c) => (c.teacher || '').split(/\s*&\s*/)))).filter(Boolean))];
const andList = (list) => (list.length > 1 ? `${list.slice(0, -1).join(', ')} & ${list.at(-1)}` : list[0] || '');

function cover(ev) {
  return h('section', { class: 'page gold cover' },
    pattern(...Array(9).fill(ev.city)),
    h('div', { class: 'content' }, logo(),
      ev.badge && h('p', { class: 'badge' }, ev.badge),
      h('h1', {}, h('span', { 'data-fit': '' }, ev.city), h('span', {}, 'Training'), h('span', {}, 'Schedule')),
      h('p', { class: 'date' }, range(ev.start, ev.end)),
      h('p', { class: 'where' }, [ev.venue, ev.countryCode ? `${ev.city} (${ev.countryCode})` : ev.city].filter(Boolean).join(' · ')),
      maestros(ev).length > 0 && h('p', { class: 'with' }, 'With ', h('b', {}, andList(maestros(ev))))),
    footer());
}

const band = (ev, title) => h('div', { class: 'band' }, pattern(ev.city, 'Training'), h('div', { class: 'head' }, logo(), h('h2', {}, title)));

function info(ev, reminders) {
  const where = [ev.address, ev.note && `(${ev.note.replace(/^\(|\)$/g, '')})`].filter(Boolean).join(' ');
  return h('section', { class: 'page' }, band(ev, 'General info'),
    h('div', { class: 'info' },
      h('h3', {}, 'Training location'),
      h('p', {}, ev.venue), h('p', {}, where),
      ev.time && h('p', { class: 'when' }, ev.time),
      ev.mapUrl ? h('a', { class: 'maps', href: ev.mapUrl }, h('span', {}, 'Open in Maps'), ' ↗') : h('div', { style: 'height:56px' }),
      maestros(ev).length > 0 && h('h3', {}, 'Maestros'),
      maestros(ev).length > 0 && h('p', { class: 'maestros' }, maestros(ev).join(' · ')),
      reminders?.length && h('h3', {}, 'Kind reminders'),
      reminders?.length && h('ul', {}, reminders.map((r) => h('li', {}, r)))),
    footer());
}

// Places the classes of a day on 12 sub-columns, so a class can last several
// slots (`span`) while the others share the rest. Same as src/lib/schedule.ts.
const SUB = 12;
function layoutDay(slots) {
  const taken = slots.map(() => new Set());
  const out = [];
  slots.forEach((s, r) => {
    if (s.isBreak || !s.classes?.length) return;
    const free = [...Array(SUB).keys()].filter((x) => !taken[r].has(x));
    const n = s.classes.length;
    s.classes.forEach((c, i) => {
      const cols = free.slice(Math.round((i * free.length) / n), Math.round(((i + 1) * free.length) / n));
      if (!cols.length) return;
      let rows = 1;
      while (rows < (Number(c.span) || 1) && r + rows < slots.length && !slots[r + rows].isBreak) rows++;
      for (let j = 1; j < rows; j++) cols.forEach((x) => taken[r + j].add(x));
      out.push({ c, row: r, col: cols[0], width: cols.length, rows });
    });
  });
  return out;
}

function schedule(ev, day, index) {
  const d = date(ev.start); d.setDate(d.getDate() + index);
  const longDate = Number.isNaN(d.getTime()) ? day.date : d.toLocaleString('en-GB', { day: 'numeric', month: 'long' });
  const BREAK_H = 50, GAP = 10;
  const nBreaks = day.slots.filter((s) => s.isBreak).length;
  const nRows = day.slots.length - nBreaks;
  const free = 1440 - 386 - 46 - 104 - 130 - (day.slots.length - 1) * GAP - nBreaks * BREAK_H;
  const rowH = Math.max(64, Math.min(118, Math.floor(free / Math.max(nRows, 1))));
  // one grid for the whole day: time column + 12 sub-columns, one row per slot
  const times = day.slots.map((s, r) => s.isBreak
    ? h('div', { class: 'brk', style: `grid-row:${r + 1};grid-column:1/-1` }, h('span', { class: 'brk-time' }, s.time.replace(/\s*[–-]\s*/, ' – ')), h('b', {}, 'Break'))
    : h('div', { class: 'cell time', style: `grid-row:${r + 1};grid-column:1` }, h('span', { class: 'range' }, s.time.replace(/\s*[–-]\s*/, ' – '))));
  const classes = layoutDay(day.slots).map(({ c, row, col, width, rows }) => h('div', {
    // text size from the room the card has: its width (sub-columns), height (slots) and title length
    // one text size for every card, like the website; only the tags move in narrow cards
    class: ['cell', c.companyOnly && 'co', width <= 4 && 'narrow', rows > 1 && 'tall'].filter(Boolean).join(' '),
    style: `grid-row:${row + 1}/span ${rows};grid-column:${col + 2}/span ${width}` },
    h('b', {}, c.title), c.teacher && h('span', {}, c.teacher), (c.companyOnly || c.liveMusic) && h('div', { class: 'flags' }, c.liveMusic && drum(), c.companyOnly && tag())));
  // rows grow when a card needs more room; fit() then makes all rows shorter until the day fits the page
  const template = day.slots.map((s) => (s.isBreak ? `${BREAK_H}px` : 'minmax(var(--row), auto)')).join(' ');
  return h('section', { class: 'page' }, band(ev, 'Schedule'),
    h('div', { class: 'day' },
      h('div', { class: 'dayhead' }, h('b', {}, day.day), h('small', {}, longDate)),
      h('div', { class: 'grid', style: `--row:${rowH}px;grid-template-rows:${template}`, 'data-row': rowH }, times, classes)),
    h('div', { class: 'legend' }, h('span', {}, drum(), 'Live music'), h('span', {}, tag(), 'Company only')));
}

// QR code for the WhatsApp group (an SVG made at build time, see brochure.astro)
function qrCode() {
  const svg = $('#qr')?.content.querySelector('svg');
  if (!WHATSAPP || !svg) return null;
  return h('a', { class: 'qr', href: WHATSAPP }, svg.cloneNode(true), h('span', {}, 'Scan to join', h('br'), 'the ICCD group'));
}

function closing(ev) {
  return h('section', { class: 'page gold end' },
    pattern(...Array(9).fill(ev.city)),
    h('div', { class: 'content' }, logo(), h('h2', {}, 'Any', h('br'), 'questions?'),
      h('ul', { class: 'ask' },
        WHATSAPP && h('li', {}, h('b', {}, 'WhatsApp'), h('div', {}, h('a', { href: WHATSAPP }, 'Join the ICCD group'))),
        HANDLE && h('li', {}, h('b', {}, 'Instagram'), h('div', {}, INSTAGRAM ? h('a', { href: INSTAGRAM }, HANDLE) : HANDLE)),
        EMAIL && h('li', {}, h('b', {}, 'Email'), h('div', {}, h('a', { href: `mailto:${EMAIL}` }, EMAIL))))),
    h('div', { class: 'book' }, h('p', {}, 'Ready to book your next training?'), h('a', { href: ev.ticketUrl || TICKETS }, 'Get your training ticket ↗')),
    qrCode(),
    footer());
}

// shrink a line until it fits its width (long city names)
function fit() {
  document.querySelectorAll('[data-fit]').forEach((el) => {
    const max = el.parentElement.clientWidth; // the width of the title block
    let size = parseFloat(getComputedStyle(el).fontSize);
    el.style.display = 'inline-block';
    while (el.scrollWidth > max && size > 60) { size -= 2; el.style.fontSize = size + 'px'; }
    el.style.display = 'block';
  });
  // timetable: keep the text size, make the rows shorter until the day ends above the legend
  document.querySelectorAll('.page .grid[data-row]').forEach((grid) => {
    const legend = grid.closest('.page').querySelector('.legend');
    let row = Number(grid.dataset.row);
    while (row > 56 && grid.getBoundingClientRect().bottom > legend.getBoundingClientRect().top - 28) {
      row -= 2; grid.style.setProperty('--row', row + 'px');
    }
  });
}

let data = null;
try { data = JSON.parse(localStorage.getItem('iccd-brochure') || 'null'); } catch { /* ignore */ }
const pages = $('#pages');
if (!data?.event) {
  pages.append(h('p', { class: 'empty' }, 'Open this page from the timetable editor (Export PDF).'));
} else {
  const ev = data.event;
  const days = (ev.schedule || []).filter((d) => d.slots?.length);
  const soon = h('section', { class: 'page' }, band(ev, 'Schedule'), h('div', { class: 'soon' }, h('p', {}, 'The full timetable will be published one week before the training.')));
  pages.append(cover(ev), info(ev, data.reminders), ...(days.length ? days.map((d) => schedule(ev, d, (ev.schedule || []).indexOf(d))) : [soon]), closing(ev));
  document.body.dataset.file = `ICCD-${ev.city}-training-schedule`.replace(/[^\p{L}\p{N}-]+/gu, '-');
  document.title = document.body.dataset.file.replace(/-/g, ' ');
  document.fonts.ready.then(fit);
}
$('#print').addEventListener('click', () => print());
