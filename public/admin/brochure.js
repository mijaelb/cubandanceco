// Builds the training brochure from the training passed by the timetable editor.
// All text is inserted with textContent (never as HTML).
const $ = (s) => document.querySelector(s);
const LOGO = document.body.dataset.logo;
const TICKETS = document.body.dataset.tickets;

function h(tag, attrs = {}, ...kids) {
  const el = tag === 'svg' || tag === 'path' ? document.createElementNS('http://www.w3.org/2000/svg', tag) : document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null && v !== false) (k === 'class' ? el.setAttribute('class', v) : el.setAttribute(k, v));
  for (const c of kids.flat(Infinity)) if (c != null && c !== false) el.append(c instanceof Node ? c : String(c));
  return el;
}
const drum = () => h('svg', { class: 'drum', viewBox: '0 0 24 24', 'aria-hidden': 'true' },
  h('path', { d: 'M7 3h10l-1.6 18H8.6z', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.4', 'stroke-linejoin': 'round' }),
  h('path', { d: 'M7.4 7.5h9.2M8 13h8', stroke: 'currentColor', 'stroke-width': '1.1' }));
const tag = () => h('span', { class: 'tag' }, 'ICCD');
const logo = () => h('img', { class: 'logo', src: LOGO, alt: '' });
const pattern = (...rows) => h('div', { class: 'pattern', 'aria-hidden': 'true' }, rows.map((r) => h('span', {}, r)));

const date = (s) => new Date(s + 'T12:00:00');
function range(a, b) {
  const x = date(a), y = date(b || a);
  const m = (d) => d.toLocaleString('en-GB', { month: 'long' });
  if (!b || a === b) return `${x.getDate()} ${m(x)}`;
  return x.getMonth() === y.getMonth() ? `${x.getDate()} - ${y.getDate()} ${m(x)}` : `${x.getDate()} ${m(x)} - ${y.getDate()} ${m(y)}`;
}

function cover(ev) {
  return h('section', { class: 'page gold cover' },
    pattern(...Array(9).fill(ev.city)),
    h('div', { class: 'content' }, logo(),
      h('h1', {}, h('span', { 'data-fit': '710' }, ev.city), h('span', {}, 'Training'), h('span', {}, 'Schedule')),
      h('p', { class: 'date' }, range(ev.start, ev.end))));
}

const band = (ev, title) => h('div', { class: 'band' }, pattern(ev.city, 'Training'), h('div', { class: 'head' }, logo(), h('h2', {}, title)));

function info(ev, reminders) {
  const where = [ev.address, ev.note && `(${ev.note.replace(/^\(|\)$/g, '')})`].filter(Boolean).join(' ');
  return h('section', { class: 'page' }, band(ev, 'General info'),
    h('div', { class: 'info' },
      h('h3', {}, 'Training location'),
      h('p', {}, ev.venue), h('p', {}, where),
      ev.time && h('p', { class: 'when' }, ev.time),
      ev.mapUrl ? h('a', { class: 'maps', href: ev.mapUrl }, 'Open in Maps', h('span', {}, '↗')) : h('div', { style: 'height:70px' }),
      reminders?.length && h('h3', {}, 'Kind reminders'),
      reminders?.length && h('ul', {}, reminders.map((r) => h('li', {}, r)))));
}

function schedule(ev, day) {
  const cols = Math.max(1, ...day.slots.map((s) => (s.isBreak ? 1 : s.classes.length)));
  const BREAK_H = 46;
  const nBreaks = day.slots.filter((s) => s.isBreak).length;
  const nRows = day.slots.length - nBreaks;
  const free = 1440 - 386 - 52 - 98 - 150 - (day.slots.length - 1) * 10 - nBreaks * BREAK_H;
  const rowH = Math.min(94, Math.floor(free / Math.max(nRows, 1)));
  const heights = day.slots.map((s) => `${s.isBreak ? BREAK_H : rowH}px`).join(' ');
  const grid = h('div', { class: 'grid', style: `grid-template-columns: 147px repeat(${cols}, 1fr); grid-template-rows: ${heights}` });
  for (const s of day.slots) {
    if (s.isBreak) { grid.append(h('div', { class: 'brk', style: 'display:grid;place-items:center' }, 'Break')); continue; }
    grid.append(h('div', { class: 'cell time' }, s.time.replace(/\s*[–-]\s*/, ' - ')));
    s.classes.forEach((c) => {
      const small = cols >= 3 || c.title.length > 16;
      grid.append(h('div', { class: `cell${c.companyOnly ? ' co' : ''}${small ? ' small' : ''}${c.title.length > 24 ? ' xs' : ''}`, style: s.classes.length === 1 ? `grid-column: span ${cols}` : null },
        h('b', {}, c.title), c.teacher && h('span', {}, c.teacher),
        c.companyOnly && tag(), c.liveMusic && drum()));
    });
    for (let i = s.classes.length; i < cols && s.classes.length > 1; i++) grid.append(h('div'));
  }
  return h('section', { class: 'page' }, band(ev, 'Schedule'),
    h('div', { class: 'day' },
      h('div', { class: 'dayhead' }, h('small', {}, day.date), h('b', {}, day.day)),
      grid),
    h('div', { class: 'legend' }, h('span', {}, drum(), 'Live Music'), h('span', {}, tag(), 'Company only')));
}

function closing(ev) {
  return h('section', { class: 'page gold end' },
    pattern(...Array(9).fill(ev.city)),
    h('div', { class: 'content' }, logo(), h('h2', {}, 'Any', h('br'), 'question ?')),
    h('div', { class: 'book' }, h('p', {}, 'Ready to book your next training ?'), h('a', { href: ev.ticketUrl || TICKETS }, 'Get your training ticket ↗')));
}

// shrink a line until it fits its width (long city names)
function fit() {
  document.querySelectorAll('[data-fit]').forEach((el) => {
    const max = Number(el.dataset.fit);
    let size = parseFloat(getComputedStyle(el).fontSize);
    el.style.display = 'inline-block';
    while (el.scrollWidth > max && size > 60) { size -= 4; el.style.fontSize = size + 'px'; }
    el.style.display = 'block';
  });
}

let data = null;
try { data = JSON.parse(localStorage.getItem('iccd-brochure') || 'null'); } catch { /* ignore */ }
const pages = $('#pages');
if (!data?.event) {
  pages.append(h('p', { class: 'empty' }, 'Open this page from the timetable editor (Export PDF).'));
} else {
  const ev = data.event;
  document.title = `${ev.city} training schedule · ICCD`;
  pages.append(cover(ev), info(ev, data.reminders), ...(ev.schedule || []).map((d) => schedule(ev, d)), closing(ev));
  document.fonts.ready.then(fit);
}
$('#print').addEventListener('click', () => print());
