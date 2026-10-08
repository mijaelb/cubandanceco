// Members area: sign in with an emailed code, then browse the private video library.
// All text is inserted with textContent; videos are YouTube (privacy mode) and only load on click.
const root = document.querySelector('.members');
const API = root.dataset.api;
const LANG = root.dataset.lang || 'en';
const W = JSON.parse(document.getElementById('members-words').textContent);
const login = document.getElementById('members-login');
const help = document.getElementById('members-help');
const lib = document.getElementById('members-library');
const KEY = 'iccd-member';

const h = (tag, attrs = {}, ...kids) => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (['value', 'disabled', 'hidden', 'required'].includes(k)) el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat(Infinity)) if (c != null && c !== false) el.append(c instanceof Node ? c : String(c));
  return el;
};
const saved = { get: (k) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch { /* private mode */ } } };
async function api(path, { body, token } = {}) {
  const r = await fetch(API + path, {
    method: body ? 'POST' : 'GET',
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body && JSON.stringify(body),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(d.message || W['Something went wrong. Please try again.']), { status: r.status });
  return d;
}
const fmtDate = (iso) => (iso ? new Date(iso + 'T12:00:00').toLocaleDateString(LANG, { day: 'numeric', month: 'long', year: 'numeric' }) : '');

// ---------- Sign in ----------
function emailStep(error, email = '') {
  const input = h('input', { type: 'email', id: 'm-email', autocomplete: 'email', required: true, value: email, placeholder: 'name@example.com' });
  const btn = h('button', { type: 'submit', class: 'btn btn-gold' }, W['Send me a code']);
  login.replaceChildren(h('form', { class: 'm-card', onsubmit: async (e) => {
    e.preventDefault();
    btn.disabled = true; btn.textContent = W['Sending…'];
    try {
      await api('/m/code', { body: { email: input.value } });
      sessionStorage.setItem('iccd-member-email', input.value.trim());
      codeStep();
    } catch (err) { emailStep(err.message, input.value); }
  } },
    h('label', { for: 'm-email' }, W.Email),
    h('div', { class: 'm-row' }, input, btn),
    error && h('p', { class: 'm-error', role: 'alert' }, error)));
  if (!error) input.focus();
}

function codeStep(error, note) {
  const email = sessionStorage.getItem('iccd-member-email') || '';
  const input = h('input', { type: 'text', id: 'm-code', inputmode: 'numeric', autocomplete: 'one-time-code', pattern: '[0-9]{6}', maxlength: 6, required: true, placeholder: '000000', class: 'm-code' });
  const btn = h('button', { type: 'submit', class: 'btn btn-gold' }, W['Sign in']);
  const again = h('button', { type: 'button', class: 'm-link', disabled: true, onclick: async () => {
    again.disabled = true;
    try { await api('/m/code', { body: { email } }); codeStep(null, W['If this email is on our list, a code is on its way.']); } catch (err) { codeStep(err.message); }
  } }, W['Send a new code']);
  setTimeout(() => (again.disabled = false), 30000); // no new code for 30 seconds
  login.replaceChildren(h('form', { class: 'm-card', onsubmit: async (e) => {
    e.preventDefault();
    btn.disabled = true; btn.textContent = W['Checking…'];
    try {
      const d = await api('/m/verify', { body: { email, code: input.value } });
      saved.set(KEY, d.token);
      sessionStorage.removeItem('iccd-member-email');
      await open();
    } catch (err) { codeStep(err.message); }
  } },
    h('p', { class: 'm-title' }, W['Check your email']),
    h('p', { class: 'm-email' }, email),
    h('p', {}, W['If this email is on our list, a code is on its way.']),
    h('label', { for: 'm-code' }, W.Code),
    h('div', { class: 'm-row' }, input, btn),
    (error || note) && h('p', { class: error ? 'm-error' : 'm-note', role: 'alert' }, error || note),
    h('p', { class: 'm-links' },
      h('button', { type: 'button', class: 'm-link', onclick: () => { sessionStorage.removeItem('iccd-member-email'); emailStep(); } }, W['Use another email']),
      ' · ', again)));
  input.focus();
}

// ---------- Library ----------
let data = null;
const view = { q: '', teacher: '' };

async function open() {
  const token = saved.get(KEY);
  if (!token) return sessionStorage.getItem('iccd-member-email') ? codeStep() : emailStep();
  try {
    data = await api('/m/library', { token });
  } catch (err) {
    if (err.status === 401) { saved.set(KEY, null); return emailStep(); }
    return emailStep(err.message);
  }
  help.hidden = true;
  login.replaceChildren(h('div', { class: 'm-who' },
    h('span', {}, `${W.Hi} ${data.name.split(' ')[0]}`),
    h('span', { class: 'm-level' }, data.level === 'company' ? W.Company : W.Academy),
    h('button', { type: 'button', class: 'm-link', onclick: () => { saved.set(KEY, null); location.hash = ''; location.reload(); } }, W['Sign out'])));
  lib.hidden = false;
  draw();
}

const thumb = (id) => `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
const match = (it) => {
  const q = view.q.toLowerCase();
  return (!view.teacher || it.teacher.split(/\s*&\s*/).includes(view.teacher)) &&
    (!q || [it.title, it.dance, it.teacher, it.training, ...it.videos.map((v) => v.title)].join(' ').toLowerCase().includes(q));
};
const count = (n) => `${n} ${n === 1 ? W.video : W.videos}`;

function card(it) {
  const first = it.videos[0];
  return h('a', { class: 'm-item', href: `#v-${it.id}` },
    h('div', { class: 'm-thumb' }, first && h('img', { src: thumb(first.id), alt: '', loading: 'lazy', width: 480, height: 360 }), h('span', { class: 'm-count' }, count(it.videos.length))),
    h('div', { class: 'm-body' },
      h('b', {}, it.title),
      h('span', {}, [it.dance !== it.title && it.dance, it.teacher].filter(Boolean).join(' · ')),
      it.type === 'class' && it.date && h('small', {}, fmtDate(it.date))));
}

function listView(tab) {
  const items = data.items.filter((it) => it.type === tab);
  const teachers = [...new Set(data.items.flatMap((it) => it.teacher.split(/\s*&\s*/)).filter(Boolean))].sort();
  const search = h('input', { type: 'search', placeholder: W.Search, value: view.q, 'aria-label': W.Search, oninput: (e) => { view.q = e.target.value; redraw(); } });
  const who = h('select', { 'aria-label': W['All teachers'], onchange: (e) => { view.teacher = e.target.value; redraw(); } },
    h('option', { value: '' }, W['All teachers']), teachers.map((n) => h('option', { value: n, selected: n === view.teacher || null }, n)));
  const results = h('div', {});
  const redraw = () => {
    const list = items.filter(match);
    if (!items.length) return results.replaceChildren(h('p', { class: 'm-empty' }, W['No videos here yet.']));
    if (!list.length) return results.replaceChildren(h('p', { class: 'm-empty' }, W['Nothing found.']));
    if (tab === 'choreography') return results.replaceChildren(h('div', { class: 'm-grid' }, list.sort((a, b) => a.title.localeCompare(b.title)).map(card)));
    // classes grouped by training weekend, newest first
    const groups = new Map();
    list.sort((a, b) => (b.date || '').localeCompare(a.date || '') || a.title.localeCompare(b.title))
      .forEach((it) => { const g = it.training || W.Other; groups.set(g, [...(groups.get(g) || []), it]); });
    results.replaceChildren(...[...groups].map(([g, list]) => h('section', { class: 'm-group' }, h('h3', { class: 'display' }, g), h('div', { class: 'm-grid' }, list.map(card)))));
  };
  redraw();
  return [h('div', { class: 'm-tools' }, search, teachers.length > 1 && who), results];
}

function detailView(it) {
  const player = (v) => {
    const box = h('div', { class: 'm-player' });
    const start = () => box.replaceChildren(h('iframe', {
      src: `https://www.youtube-nocookie.com/embed/${v.id}?autoplay=1&rel=0&modestbranding=1&playsinline=1`,
      title: v.title || it.title, allow: 'autoplay; encrypted-media; picture-in-picture; fullscreen', allowfullscreen: true, referrerpolicy: 'strict-origin-when-cross-origin',
    }));
    box.append(h('button', { type: 'button', class: 'm-play', onclick: start, 'aria-label': v.title || it.title },
      h('img', { src: thumb(v.id), alt: '', loading: 'lazy' }), h('span', { class: 'm-play-icon', 'aria-hidden': 'true' })));
    return box;
  };
  return [
    h('a', { class: 'm-back', href: it.type === 'class' ? '#classes' : '#choreographies' }, '← ', W.Back),
    h('p', { class: 'eyebrow' }, it.type === 'class' ? W['Class recordings'] : W.Choreographies),
    h('h2', { class: 'display' }, it.title),
    h('p', { class: 'm-meta' }, [it.dance !== it.title && it.dance, it.teacher, it.training, fmtDate(it.date)].filter(Boolean).join(' · ')),
    it.notes && h('div', { class: 'm-notes' }, h('b', {}, W.Notes), h('p', {}, it.notes)),
    h('ol', { class: 'm-videos' }, it.videos.map((v, i) => h('li', {},
      h('p', { class: 'm-vtitle' }, h('span', {}, String(i + 1).padStart(2, '0')), v.title || it.title), player(v)))),
  ];
}

function draw() {
  if (!data) return;
  const hash = location.hash.slice(1);
  const item = hash.startsWith('v-') && data.items.find((it) => it.id === hash.slice(2));
  const n = (t) => data.items.filter((it) => it.type === t).length;
  // open on the tab that has videos (academy dancers may only have class recordings)
  const tab = item ? item.type : hash === 'classes' ? 'class' : hash === 'choreographies' ? 'choreography' : n('choreography') || !n('class') ? 'choreography' : 'class';
  lib.replaceChildren(h('div', { class: 'wrap' },
    h('nav', { class: 'm-tabs', 'aria-label': W.Choreographies },
      h('a', { href: '#choreographies', 'aria-current': tab === 'choreography' ? 'page' : null }, W.Choreographies, h('small', {}, n('choreography'))),
      h('a', { href: '#classes', 'aria-current': tab === 'class' ? 'page' : null }, W['Class recordings'], h('small', {}, n('class')))),
    item ? detailView(item) : listView(tab)));
  if (item) lib.scrollIntoView({ block: 'start' });
}

addEventListener('hashchange', draw);
open();
