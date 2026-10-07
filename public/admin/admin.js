// ICCD admin panel.
// Edits the JSON files in src/data and src/i18n directly in the GitHub repository
// using the editor's own fine-grained token. Every "Publish" is one git commit;
// GitHub Actions then rebuilds the site. No server, no database, no passwords here.
// Security: all content is rendered with textContent/DOM APIs (never innerHTML).

const API = 'https://api.github.com';
const BRANCH = 'main';
const SITE = (document.body.dataset.site || '/').replace(/\/$/, '');
const app = document.getElementById('app');

// ---------- Content schema (what can be edited, and how) ----------
const T = (label, help) => ({ type: 'text', label, help });
const A = (label, help) => ({ type: 'textarea', label, help });
const D = (label, help) => ({ type: 'date', label, help });
const U = (label, help) => ({ type: 'url', label, help });
const I = (label, help) => ({ type: 'image', label, help });
const B = (label, help) => ({ type: 'bool', label, help });
const S = (label, help, long) => ({ type: 'strings', label, help, long });
const IL = (label, help) => ({ type: 'imagelist', label, help });
const O = (label, fields) => ({ type: 'object', label, fields });
const L = (label, item, fields, summary, help) => ({ type: 'list', label, item, fields, summary, help });

const person = { name: T('Name'), role: T('Role'), photo: I('Photo', 'Portrait, ideally 4:5'), bio: A('Biography', 'Leave an empty line between paragraphs') };
const show = { date: D('Date', 'Used for sorting and to hide past shows'), when: T('Date text (optional)', 'Shown instead of the date, e.g. "2–4 April 2027"'), title: T('Title'), production: T('Production (optional)', 'Write "Raíces Cubanas" to also list it on the Raíces Cubanas page'), city: T('City, country'), venue: T('Venue (optional)'), url: U('Tickets link (optional)') };

const SECTIONS = [
  {
    id: 'trainings', title: 'Trainings', file: 'src/data/trainings.json',
    help: 'Trainings disappear from the website automatically after their last day.',
    schema: {
      events: L('Training weekends', 'training', {
        start: D('First day'), end: D('Last day'), city: T('City'), country: T('Country'), countryCode: T('Country code', 'e.g. NL'),
        badge: T('Badge (optional)', 'e.g. "4th anniversary weekend"'), note: T('Note (optional)', 'e.g. "40 min by train from Rotterdam"'),
        time: T('Time', 'e.g. Saturday 1 pm – Sunday 5 pm'), venue: T('Venue'), address: T('Address'),
        mapUrl: U('Google Maps link'), ticketUrl: U('Tickets link', 'Leave empty to use the main Weezevent link'),
        schedule: L('Schedule (optional)', 'day', {
          day: T('Day', 'e.g. Saturday'), date: T('Date', 'e.g. 10/10'),
          slots: L('Time slots', 'time slot', {
            time: T('Time', 'e.g. 13:00 – 14:00'), isBreak: B('This is a break'),
            classes: L('Classes', 'class', { title: T('Class'), teacher: T('Teacher'), liveMusic: B('Live music'), companyOnly: B('Company only (ICCD)') }, (c) => `${c.title} · ${c.teacher}`),
          }, (s) => `${s.time}${s.isBreak ? ' · Break' : ''}`),
        }, (d) => `${d.day} ${d.date}`),
      }, (e) => `${e.start} · ${e.city}`),
      season: T('Season', 'e.g. 2026 – 2027'),
      intro: A('Introduction'), level: A('Who is it for?'), scheduleNote: A('Schedule note'),
      included: S("What's included"), reminders: S('Kind reminders'),
      history: L('Past trainings archive', 'past training', { start: D('First day'), end: D('Last day'), city: T('City'), country: T('Country'), note: T('Note (optional)') }, (e) => `${e.start} · ${e.city}`, 'Trainings from the list above are added here automatically once they are over'),
    },
  },
  {
    id: 'show', title: 'Raíces Cubanas', file: 'src/data/show.json',
    schema: {
      title: T('Title'), subtitle: T('Subtitle'), poster: I('Poster'), lead: A('Lead text'), text: A('Description'),
      parts: L('Parts of the show', 'part', { label: T('Label'), title: T('Title'), image: I('Image'), text: A('Text') }, (p) => p.title),
      bookingText: A('Booking text'),
    },
  },
  {
    id: 'performances', title: 'Performances', file: 'src/data/performances.json',
    help: 'Every show the company performs. Tag a performance with the production "Raíces Cubanas" to also show it on that page.',
    schema: {
      upcoming: L('Upcoming performances', 'performance', show, (s) => `${s.when || s.date} · ${s.title}`, 'They move out of this list automatically after their date'),
      past: L('Past performances', 'performance', show, (s) => `${s.when || s.date} · ${s.title}`, 'Newest first'),
      intro: A('Introduction'), bookingText: A('Booking text'),
    },
  },
  {
    id: 'teachers', title: 'Teachers', file: 'src/data/teachers.json',
    schema: { masters: L('Masters', 'teacher', person, (p) => p.name), guests: L('Joining this season', 'teacher', person, (p) => p.name), visiting: S('Guest masters who have taught with us') },
  },
  {
    id: 'people', title: 'Company & musicians', file: 'src/data/people.json',
    schema: {
      team: L('Organisation team', 'person', { name: T('Name'), role: T('Role'), photo: I('Photo', 'Portrait, ideally 4:5') }, (m) => `${m.name} · ${m.role}`),
      teamIntro: A('Team introduction'),
      members: L('Company members', 'member', { name: T('Name'), country: T('Country'), photo: I('Photo', 'Portrait, ideally 4:5') }, (m) => `${m.name} · ${m.country}`),
      musicians: L('Musicians', 'musician', { name: T('Name'), role: T('Instruments / role'), country: T('Country'), photo: I('Photo') }, (m) => m.name),
      membersIntro: A('Members introduction'), musiciansIntro: A('Musicians introduction'),
    },
  },
  {
    id: 'gallery', title: 'Gallery', file: 'src/data/gallery.json',
    schema: {
      photos: L('Photos', 'photo', { src: I('Photo'), alt: T('Description', 'Short description for accessibility and the lightbox'), category: T('Category', 'Stage, Cuba, Training, Costumes…') }, (p) => `${p.category} · ${p.alt}`),
      video: O('Documentary video', { title: T('Title'), text: A('Text'), src: T('Video file', 'e.g. /video/our-story.mp4'), poster: I('Poster image') }),
    },
  },
  {
    id: 'faq', title: 'FAQ', file: 'src/data/faq.json',
    schema: { items: L('Questions', 'question', { q: T('Question'), a: A('Answer') }, (f) => f.q) },
  },
  {
    id: 'about', title: 'About page', file: 'src/data/about.json',
    schema: {
      story: S('Our story (paragraphs)', '', true),
      pillars: L('What we do', 'pillar', { title: T('Title'), text: A('Text') }, (p) => p.title),
      mission: S('Mission (paragraphs)', '', true),
      exchange: O('Cultural exchange', { title: T('Title'), text: A('Text'), images: IL('Images') }),
      paths: L('Academy & Company', 'path', { title: T('Title'), text: A('Text'), image: I('Image') }, (p) => p.title),
    },
  },
  {
    id: 'site', title: 'Home & settings', file: 'src/data/site.json',
    schema: {
      announcement: O('Announcement bar (top of every page)', { text: T('Text', 'Leave empty to hide the bar'), url: T('Link', 'A page like "trainings" or a full https:// link') }),
      hero: O('Home hero', { eyebrow: T('Small line above the title'), title: T('Title'), text: A('Text'), images: IL('Slideshow images') }),
      intro: O('Who we are', { title: T('Small title'), text: A('Text') }),
      family: O('Family quote', { title: T('Small title'), text: A('Quote'), image: I('Background image') }),
      tagline: T('Tagline'),
      stats: L('Numbers', 'number', { value: T('Value'), label: T('Label') }, (s) => `${s.value} ${s.label}`),
      styles: S('Dance styles (moving banner)'),
      links: O('Links', { tickets: U('Tickets (Weezevent)'), whatsapp: U('WhatsApp group'), instagram: U('Instagram'), facebook: U('Facebook'), tiktok: U('TikTok'), email: T('Contact e-mail', 'Shown in the footer'), bookingEmail: T('Booking e-mail', 'Used for show bookings'), instagramFeed: U('Instagram feed (Behold JSON URL)', 'Shows your latest posts on the home page; updated once a day') }),
      instagramHandle: T('Instagram handle'),
      name: T('Company name'), description: A('Search engine description'),
    },
  },
  { id: 'translations', title: 'Translations' },
];

// Keys whose values are never translated (keep in sync with scripts/strings.mjs)
const SKIP = new Set(['name', 'shortName', 'organizer', 'teacher', 'venue', 'address', 'city', 'countryCode', 'src', 'photo', 'image', 'images', 'poster', 'url', 'mapUrl', 'ticketUrl', 'start', 'end', 'date', 'links', 'instagramHandle', 'cities']);

// ---------- State ----------
const store = (remember) => (remember ? localStorage : sessionStorage);
const state = {
  token: sessionStorage.getItem('iccd-token') || localStorage.getItem('iccd-token') || '',
  repo: localStorage.getItem('iccd-repo') || document.body.dataset.repo || '',
  files: {}, // path -> { data, sha, snap }
  uploads: new Map(), // '/uploads/x.webp' -> Blob
  images: [], langs: [], section: 'trainings', lang: '',
};

// ---------- Helpers ----------
function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (['value', 'checked', 'disabled', 'open', 'hidden'].includes(k)) el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat(Infinity)) if (c != null && c !== false) el.append(c instanceof Node ? c : String(c));
  return el;
}
const slug = (s) => s.toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '').replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 40) || 'image';
const toB64 = (bytes) => { let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(s); };
const fromB64 = (b64) => new TextDecoder().decode(Uint8Array.from(atob(b64.replace(/\n/g, '')), (c) => c.charCodeAt(0)));
const json = (d) => JSON.stringify(d, null, 2) + '\n';
const dirtyFiles = () => Object.entries(state.files).filter(([, f]) => json(f.data) !== f.snap);
const isDirty = () => dirtyFiles().length > 0 || state.uploads.size > 0;

async function gh(path, opts = {}) {
  const r = await fetch(API + path, {
    ...opts,
    headers: { Authorization: `Bearer ${state.token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', ...(opts.body ? { 'Content-Type': 'application/json' } : {}) },
  });
  if (!r.ok) throw new Error(`${r.status}: ${(await r.json().catch(() => ({}))).message || r.statusText}`);
  return r.status === 204 ? null : r.json();
}
const repo = (p) => `/repos/${state.repo}${p}`;
const post = (p, body, method = 'POST') => gh(repo(p), { method, body: JSON.stringify(body) });

async function loadFile(path, fallback) {
  try {
    const r = await gh(repo(`/contents/${path}?ref=${BRANCH}`));
    const data = JSON.parse(fromB64(r.content));
    state.files[path] = { data, sha: r.sha, snap: json(data) };
  } catch (e) {
    if (!fallback || !e.message.startsWith('404')) throw e;
    state.files[path] = { data: fallback, sha: null, snap: '' }; // new file
  }
  return state.files[path].data;
}

// Image previews: pending uploads come from memory; others from the live site,
// falling back to the repository (for images that are committed but not yet deployed).
const blobUrls = new Map();
function imgSrc(path) {
  if (!path) return '';
  if (state.uploads.has(path)) {
    if (!blobUrls.has(path)) blobUrls.set(path, URL.createObjectURL(state.uploads.get(path)));
    return blobUrls.get(path);
  }
  return /^https?:/.test(path) ? path : SITE + path;
}
const rawUrl = (path) => `https://raw.githubusercontent.com/${state.repo}/${BRANCH}/public${path}`;

async function processImage(file) {
  const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const render = (max) => {
    const s = Math.min(1, max / Math.max(bmp.width, bmp.height));
    const c = h('canvas', { width: Math.round(bmp.width * s), height: Math.round(bmp.height * s) });
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    return new Promise((r) => c.toBlob(r, 'image/webp', 0.82));
  };
  const base = `/uploads/${slug(file.name.replace(/\.[^.]+$/, ''))}-${Date.now().toString(36)}`;
  state.uploads.set(`${base}.webp`, await render(1600));
  state.uploads.set(`${base}-800.webp`, await render(800));
  return `${base}.webp`;
}

// ---------- Form builder ----------
let changedTimer;
function changed() {
  clearTimeout(changedTimer);
  changedTimer = setTimeout(updateBar, 150);
}

function blank(fields) {
  const o = {};
  for (const [k, s] of Object.entries(fields)) o[k] = s.type === 'bool' ? false : ['list', 'strings', 'imagelist'].includes(s.type) ? [] : s.type === 'object' ? blank(s.fields) : '';
  return o;
}

function fieldsEditor(obj, fields) {
  return h('div', { class: 'fields' }, Object.entries(fields).map(([k, s]) => {
    const id = `f${Math.random().toString(36).slice(2, 9)}`;
    const control = input(s, obj, k, id);
    return h('div', { class: `field field-${s.type}` },
      h('label', { for: id }, s.label), s.help && h('small', {}, s.help), control);
  }));
}

function input(s, obj, k, id) {
  const set = (v) => { obj[k] = v; changed(); };
  const v = obj[k];
  switch (s.type) {
    case 'text': case 'url': case 'date':
      return h('input', { id, type: s.type, value: v ?? '', oninput: (e) => set(e.target.value) });
    case 'textarea': {
      const ta = h('textarea', { id, rows: 3, value: v ?? '', oninput: (e) => { set(e.target.value); grow(ta); } });
      requestAnimationFrame(() => grow(ta));
      return ta;
    }
    case 'bool':
      return h('input', { id, type: 'checkbox', checked: !!v, onchange: (e) => set(e.target.checked) });
    case 'image':
      return imageInput(v, set, id);
    case 'object':
      if (!obj[k] || typeof obj[k] !== 'object') obj[k] = blank(s.fields);
      return fieldsEditor(obj[k], s.fields);
    default:
      if (!Array.isArray(obj[k])) obj[k] = [];
      return listEditor(s, obj[k]);
  }
}
const grow = (ta) => { ta.style.height = 'auto'; ta.style.height = ta.scrollHeight + 2 + 'px'; };

function imageInput(value, set, id) {
  const img = h('img', { alt: '', src: imgSrc(value), onerror: () => { if (value && !img.dataset.raw) { img.dataset.raw = 1; img.src = rawUrl(value); } } });
  const path = h('input', { id, type: 'text', value: value || '', list: 'image-list', placeholder: '/images/…', oninput: (e) => { value = e.target.value; set(value); img.dataset.raw = ''; img.src = imgSrc(value); } });
  const file = h('input', { type: 'file', accept: 'image/*', hidden: true, onchange: async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    status('Preparing image…');
    value = await processImage(f);
    path.value = value; set(value); img.src = imgSrc(value);
    status('Image ready — it will be uploaded when you publish.');
  } });
  return h('div', { class: 'image-input' }, h('div', { class: 'thumb' }, img),
    h('div', {}, path, h('button', { type: 'button', class: 'btn-small', onclick: () => file.click() }, 'Upload new photo'), file));
}

function listEditor(s, arr) {
  const box = h('div', { class: 'list' });
  const itemSchema = s.type === 'imagelist' ? { type: 'image' } : s.type === 'strings' ? { type: s.long ? 'textarea' : 'text' } : null;
  const move = (i, d) => { [arr[i], arr[i + d]] = [arr[i + d], arr[i]]; changed(); draw(); };
  const draw = (openIndex = -1) => {
    box.replaceChildren(
      ...arr.map((item, i) => {
        const tools = h('span', { class: 'tools' },
          h('button', { type: 'button', title: 'Move up', disabled: i === 0, onclick: () => move(i, -1) }, '↑'),
          h('button', { type: 'button', title: 'Move down', disabled: i === arr.length - 1, onclick: () => move(i, 1) }, '↓'),
          h('button', { type: 'button', title: 'Remove', class: 'danger', onclick: () => { if (confirm('Remove this item?')) { arr.splice(i, 1); changed(); draw(); } } }, '✕'));
        if (itemSchema) return h('div', { class: 'list-row' }, input(itemSchema, arr, i), tools);
        const sum = h('span', { class: 'sum' }, s.summary?.(item) || `${s.item} ${i + 1}`);
        const det = h('details', { class: 'item', open: i === openIndex, oninput: () => (sum.textContent = s.summary?.(item) || sum.textContent) },
          h('summary', {}, sum, tools));
        det.addEventListener('toggle', () => det.open && !det.querySelector('.fields') && det.append(fieldsEditor(item, s.fields)), { once: false });
        if (i === openIndex) det.append(fieldsEditor(item, s.fields));
        return det;
      }),
      h('button', { type: 'button', class: 'btn-add', onclick: () => { arr.push(itemSchema ? '' : blank(s.fields)); changed(); draw(arr.length - 1); } }, `+ Add ${s.item || 'line'}`),
    );
  };
  draw();
  return box;
}

// ---------- Translations ----------
function collectStrings() {
  const ui = state.files['src/i18n/strings.json']?.data || { ui: [], content: [] };
  const out = new Set(ui.ui);
  const visit = (v, key) => {
    if (SKIP.has(key)) return;
    if (typeof v === 'string') { if (/[A-Za-zÀ-ÿ]{2}/.test(v) && !/^(\/|https?:)/.test(v)) out.add(v); }
    else if (Array.isArray(v)) v.forEach((x) => visit(x, key));
    else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) visit(x, k);
  };
  SECTIONS.filter((s) => s.file).forEach((s) => visit(state.files[s.file].data));
  return [...out];
}

function translationsView() {
  const wrap = h('div', { class: 'tr' });
  const pick = h('select', { onchange: (e) => { state.lang = e.target.value; draw(); } },
    h('option', { value: '' }, 'Choose a language…'), state.langs.map((l) => h('option', { value: l, selected: l === state.lang }, langName(l))));
  const code = h('input', { type: 'text', placeholder: 'e.g. pt', maxlength: 2, size: 4 });
  const add = h('button', { type: 'button', class: 'btn-small', onclick: () => {
    const l = code.value.trim().toLowerCase();
    if (!/^[a-z]{2}$/.test(l) || l === 'en') return alert('Use a two-letter language code, e.g. pt, pl, ru.');
    if (!state.langs.includes(l)) { state.langs.push(l); state.files[`src/i18n/${l}.json`] = { data: {}, sha: null, snap: '' }; }
    state.lang = l; render();
  } }, 'Add language');
  const missingOnly = h('input', { type: 'checkbox', id: 'missing', onchange: () => draw() });
  const search = h('input', { type: 'search', placeholder: 'Search…', oninput: () => draw() });
  const list = h('div', { class: 'tr-list' });
  const counter = h('span', { class: 'muted' });

  async function draw() {
    if (!state.lang) { list.replaceChildren(h('p', { class: 'muted' }, 'Pick a language to start translating. English is the original text; anything left empty shows in English on the website.')); counter.textContent = ''; return; }
    const path = `src/i18n/${state.lang}.json`;
    if (!state.files[path]) { list.replaceChildren(h('p', {}, 'Loading…')); await loadFile(path, {}); }
    const dict = state.files[path].data;
    const all = collectStrings();
    const q = search.value.toLowerCase();
    const rows = all.filter((s) => (!missingOnly.checked || !dict[s]) && (!q || s.toLowerCase().includes(q) || (dict[s] || '').toLowerCase().includes(q)));
    counter.textContent = `${all.filter((s) => dict[s]).length} of ${all.length} translated`;
    list.replaceChildren(...rows.slice(0, 400).map((s) => {
      const ta = h('textarea', { rows: 1, value: dict[s] || '', class: dict[s] ? '' : 'missing', oninput: (e) => {
        const v = e.target.value;
        if (v.trim()) dict[s] = v; else delete dict[s];
        ta.className = v.trim() ? '' : 'missing'; grow(ta); changed();
      } });
      requestAnimationFrame(() => grow(ta));
      return h('div', { class: 'tr-row' }, h('p', {}, s), ta);
    }));
  }
  wrap.append(h('div', { class: 'tr-tools' }, pick, h('span', { class: 'add-lang' }, code, add), search, h('label', { class: 'check' }, missingOnly, ' Only missing'), counter), list);
  draw();
  return wrap;
}
const langName = (l) => { try { return new Intl.DisplayNames(['en'], { type: 'language' }).of(l) + ` (${l})`; } catch { return l; } };

// ---------- Publish ----------
async function publish() {
  const files = dirtyFiles();
  if (!files.length && !state.uploads.size) return status('Nothing to publish.');
  const btn = document.querySelector('.publish');
  btn.disabled = true;
  try {
    status('Checking for changes made by others…');
    for (const [p, f] of files) {
      if (!f.sha) continue;
      const cur = await gh(repo(`/contents/${p}?ref=${BRANCH}`));
      if (cur.sha !== f.sha) throw new Error(`"${p}" was changed by someone else since you opened the admin. Copy your edits somewhere, reload the page and apply them again.`);
    }
    status('Uploading…');
    const ref = await gh(repo(`/git/ref/heads/${BRANCH}`));
    const base = await gh(repo(`/git/commits/${ref.object.sha}`));
    const tree = files.map(([p, f]) => ({ path: p, mode: '100644', type: 'blob', content: json(f.data) }));
    for (const [p, blob] of state.uploads) {
      const b = await post('/git/blobs', { content: toB64(new Uint8Array(await blob.arrayBuffer())), encoding: 'base64' });
      tree.push({ path: `public${p}`, mode: '100644', type: 'blob', sha: b.sha });
    }
    const t = await post('/git/trees', { base_tree: base.tree.sha, tree });
    const names = files.map(([p]) => p.split('/').pop().replace('.json', ''));
    const msg = `Update ${[...names, state.uploads.size ? `${state.uploads.size / 2} photo(s)` : ''].filter(Boolean).join(', ')} via admin`;
    const c = await post('/git/commits', { message: msg, tree: t.sha, parents: [ref.object.sha] });
    await post(`/git/refs/heads/${BRANCH}`, { sha: c.sha }, 'PATCH');
    for (const [p, f] of files) {
      const cur = await gh(repo(`/contents/${p}?ref=${BRANCH}`));
      f.sha = cur.sha; f.snap = json(f.data);
    }
    state.uploads.clear();
    updateBar();
    watchDeploy(c.sha);
  } catch (e) {
    status(`⚠ ${e.message}`, true);
  } finally {
    btn.disabled = false;
  }
}

async function watchDeploy(sha) {
  status('Saved ✓ The website is being rebuilt (about 1–2 minutes)…');
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 6000));
    try {
      const { workflow_runs: runs } = await gh(repo(`/actions/runs?head_sha=${sha}`));
      const run = runs?.[0];
      if (run?.status === 'completed') return status(run.conclusion === 'success' ? 'Live ✓ Your changes are on the website.' : `⚠ The website build failed (${run.conclusion}). Check the Actions tab on GitHub.`, run.conclusion !== 'success');
    } catch { return status('Saved ✓ The website updates in about 2 minutes.'); }
  }
}

// ---------- Layout ----------
let statusEl, publishBtn;
function status(text, error) { if (statusEl) { statusEl.textContent = text; statusEl.classList.toggle('error', !!error); } }
function updateBar() {
  if (!publishBtn) return;
  const n = dirtyFiles().length + (state.uploads.size ? 1 : 0);
  publishBtn.textContent = n ? `Publish changes (${n})` : 'Published';
  publishBtn.classList.toggle('ready', n > 0);
}

function render() {
  const sec = SECTIONS.find((s) => s.id === state.section);
  statusEl = h('span', { class: 'status', role: 'status' });
  publishBtn = h('button', { class: 'publish', type: 'button', onclick: publish });
  const nav = h('nav', {}, SECTIONS.map((s) => h('button', { type: 'button', class: s.id === state.section ? 'active' : '', onclick: () => { state.section = s.id; render(); scrollTo(0, 0); } }, s.title)));
  const body = sec.id === 'translations' ? translationsView() : fieldsEditor(state.files[sec.file].data, sec.schema);
  app.replaceChildren(
    h('header', { class: 'bar' },
      h('a', { class: 'brand', href: SITE + '/', target: '_blank', rel: 'noopener' }, h('img', { src: SITE + '/images/logo.svg', alt: '' }), h('span', {}, 'ICCD admin')),
      statusEl, publishBtn,
      h('button', { type: 'button', class: 'link', onclick: logout }, 'Sign out')),
    h('div', { class: 'layout' }, nav,
      h('main', {}, h('h1', {}, sec.title), sec.help && h('p', { class: 'muted' }, sec.help), body)),
    h('datalist', { id: 'image-list' }, state.images.map((p) => h('option', { value: p }))),
  );
  updateBar();
}

function logout() {
  if (isDirty() && !confirm('You have unpublished changes. Sign out anyway?')) return;
  sessionStorage.removeItem('iccd-token');
  localStorage.removeItem('iccd-token');
  state.token = '';
  state.files = {};
  state.uploads.clear();
  loginView();
}

function loginView(error) {
  const token = h('input', { type: 'password', id: 'token', autocomplete: 'off', placeholder: 'github_pat_…', required: true });
  const repoIn = h('input', { type: 'text', id: 'repo', value: state.repo, placeholder: 'owner/repository', required: true });
  const remember = h('input', { type: 'checkbox', id: 'remember' });
  const form = h('form', { class: 'login', onsubmit: async (e) => {
    e.preventDefault();
    state.token = token.value.trim();
    state.repo = repoIn.value.trim();
    try {
      const r = await gh(repo(''));
      if (!r.permissions?.push) throw new Error('This token cannot edit the repository. Give it "Contents: Read and write" access.');
      store(remember.checked).setItem('iccd-token', state.token);
      localStorage.setItem('iccd-repo', state.repo);
      await start();
    } catch (err) {
      state.token = '';
      loginView(err.message);
    }
  } },
    h('img', { src: SITE + '/images/logo.svg', alt: '', width: 96, height: 96 }),
    h('h1', {}, 'ICCD admin'),
    error && h('p', { class: 'error' }, error),
    h('label', { for: 'token' }, 'GitHub access token'), token,
    h('label', { for: 'repo' }, 'Repository'), repoIn,
    h('label', { class: 'check' }, remember, ' Remember me on this device'),
    h('button', { type: 'submit', class: 'publish ready' }, 'Sign in'),
    h('details', {}, h('summary', {}, 'How do I get a token?'),
      h('ol', {},
        h('li', {}, 'Sign in to GitHub and open ', h('a', { href: 'https://github.com/settings/personal-access-tokens/new', target: '_blank', rel: 'noopener' }, 'Settings → Fine-grained tokens → Generate new token'), '.'),
        h('li', {}, 'Repository access: "Only select repositories" → choose this website\'s repository.'),
        h('li', {}, 'Permissions: Contents → "Read and write". Optional: Actions → "Read-only" (shows when the site is live).'),
        h('li', {}, 'Set an expiration date (e.g. 90 days), generate, and paste the token here.'),
        h('li', {}, 'Only use "Remember me" on your own device. Never share the token.'))),
  );
  app.replaceChildren(form);
}

async function start() {
  app.replaceChildren(h('p', { class: 'boot' }, 'Loading content…'));
  await Promise.all([...SECTIONS.filter((s) => s.file).map((s) => loadFile(s.file)), loadFile('src/i18n/strings.json', { ui: [], content: [] })]);
  try {
    const { tree } = await gh(repo(`/git/trees/${BRANCH}?recursive=1`));
    state.images = tree.map((t) => t.path).filter((p) => /^public\/(images|uploads)\/.+\.(webp|jpe?g|png)$/.test(p) && !/-(800|2400)\.\w+$/.test(p)).map((p) => p.slice(6));
    state.langs = tree.map((t) => t.path.match(/^src\/i18n\/([a-z]{2})\.json$/)?.[1]).filter(Boolean);
  } catch { /* the image picker is optional */ }
  render();
}

addEventListener('beforeunload', (e) => { if (isDirty()) e.preventDefault(); });
addEventListener('keydown', (e) => { if ((e.ctrlKey || e.metaKey) && e.key === 's' && state.token) { e.preventDefault(); publish(); } });

if (state.token && state.repo) start().catch((e) => loginView(e.message));
else loginView();
