// Admin sections for the private members area: who can sign in, and the video library.
// Nothing here goes to GitHub: it is saved in the members service (worker/members.js).
// Loaded by admin.js, which passes its helpers in `ctx`.

const LEVEL = { company: 'Company · sees all videos', academy: 'Academy · sees videos marked for the Academy' };

// ---------- members and the website: photos of company members ----------
const plainName = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim();
// everyone with a photo on the Company page (company members, the team, the musicians)
const sitePeople = (ctx) => [...(ctx.people.members || []), ...(ctx.people.team || []), ...(ctx.people.musicians || [])].filter((x) => x.name);
// the website person of a company member: chosen by the team, or the same name
function sitePerson(ctx, m) {
  if (!m || m.level !== 'company') return null;
  const all = sitePeople(ctx);
  if (m.site) return all.find((x) => x.name === m.site) || null;
  const n = plainName(m.name);
  if (!n) return null;
  const words = n.split(' ');
  return all.find((x) => plainName(x.name) === n) || all.find((x) => { const w = plainName(x.name).split(' '); return w[0] === words[0] && w.at(-1) === words.at(-1); }) || null;
}
const avatar = (ctx, m) => {
  const p = sitePerson(ctx, m);
  if (p?.photo) return ctx.h('img', { class: 'pv-avatar', src: ctx.SITE + p.photo, alt: '', loading: 'lazy', title: p.name });
  const initials = plainName(m?.name).split(' ').filter(Boolean).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
  return ctx.h('span', { class: 'pv-avatar none', 'aria-hidden': 'true' }, initials || '?');
};

// Active members: how many of the last 3 training weekends they came to (Weezevent tickets, by email)
const ACTIVE_NEEDS = { company: 2, academy: 1 }; // company: at most one missed in three; academy: at least one in three
function recentWeekends(s, ctx) {
  const today = new Date().toLocaleDateString('sv-SE'), thisMonth = today.slice(0, 7); // local date: a weekend counts from its first day
  const upcoming = new Set((ctx.trainings.events || []).filter((e) => e.start > today).map((e) => e.start.slice(0, 7)));
  const months = new Set();
  for (const x of peopleIndex(s)) for (const t of x.trainings) months.add(t.split(':')[1]);
  return [...months].filter((m) => m < thisMonth || (m === thisMonth && !upcoming.has(m))).sort().slice(-3);
}
function activity(s, ctx) {
  const last = recentWeekends(s, ctx), by = new Map();
  for (const x of peopleIndex(s)) by.set(x.email, new Set([...x.trainings].map((t) => t.split(':')[1])));
  return { last, of: (m) => { const mine = by.get((m.email || '').toLowerCase()); return mine ? last.filter((ym) => mine.has(ym)).length : null; } };
}
const YT = /(?:youtu\.be\/|youtube(?:-nocookie)?\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|live\/))([\w-]{11})|^([\w-]{11})$/;
const ytId = (s) => { const m = String(s || '').trim().match(YT); return m ? m[1] || m[2] : ''; };
const uid = () => crypto.randomUUID().slice(0, 8);
const snap = (v) => JSON.stringify(v);

// one copy of the private data per admin session
let cache = null;
async function load(ctx, force) {
  if (cache && !force) return cache;
  const d = await ctx.api('/m/admin');
  cache = { members: d.members, items: d.items, rev: d.rev, membersRev: d.membersRev, snapM: snap(d.members), snapI: snap(d.items), cdn: d.cdn, subs: d.subs || {} };
  return cache;
}
// Saves the library straight away (used by the inbox, where every click is one decision)
async function saveItems(ctx) {
  const r = await ctx.api('/m/admin', { method: 'PUT', body: JSON.stringify({ items: cache.items, rev: cache.rev }) });
  cache.rev = r.rev; cache.snapI = snap(cache.items);
}
const thumbOf = (v) => (v.src === 'bunny' ? `https://${cache.cdn}/${v.id}/thumbnail.jpg` : v.id ? `https://i.ytimg.com/vi/${v.id}/default.jpg` : '');
let focus = null; // { tab, id }: the inbox opens an item in the videos section

// Plays an archive recording in a window (signed link from the members service)
function previewBunny(ctx, v) {
  const { h, iconBtn } = ctx;
  const box = h('div', { class: 'pv-modal', onclick: (e) => e.target === box && box.remove() },
    h('div', { class: 'pv-modal-in' },
      h('div', { class: 'pv-modal-head' }, h('b', {}, v.title), iconBtn('close', 'Close', () => box.remove())),
      h('div', { class: 'pv-player' }, h('p', { class: 'muted' }, 'Loading…'))));
  document.body.append(box);
  ctx.api(`/bunny/play?guid=${v.guid}`).then(({ url }) => box.querySelector('.pv-player').replaceChildren(
    h('iframe', { src: `${url}&autoplay=true&preload=true`, allow: 'autoplay; fullscreen; picture-in-picture', allowfullscreen: true })))
    .catch((e) => box.querySelector('.pv-player').replaceChildren(h('p', { class: 'error' }, e.message)));
  addEventListener('keydown', function esc(e) { if (e.key === 'Escape') { box.remove(); removeEventListener('keydown', esc); } });
}

// The archive recordings on Bunny, loaded once per visit (Refresh in the picker loads them again)
let archive = null;
const loadArchive = async (ctx, force) => (archive && !force ? archive : (archive = (await ctx.api('/bunny/videos')).videos));
const mins = (s) => { const m = Math.round((s || 0) / 60); return m >= 60 ? `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m` : `${m} min`; };

// Search the archive and add recordings to a class or choreography
function libraryPicker(ctx, it, onAdd) {
  const { h, icon } = ctx;
  let q = '', only = true;
  const list = h('div', { class: 'pv-pick-list' }, h('p', { class: 'muted' }, 'Loading the library…'));
  const place = (it.training || '').split(' · ')[0].toLowerCase();
  const draw = () => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    const rows = archive
      .filter((v) => v.status === 4 && !v.flag)
      .filter((v) => !only || !place || v.training.toLowerCase().includes(place))
      .filter((v) => words.every((w) => `${v.title} ${v.training}`.toLowerCase().includes(w)))
      .sort((a, b) => (b.recorded || '').localeCompare(a.recorded || ''))
      .slice(0, 60);
    list.replaceChildren(...(rows.length ? rows.map((v) => {
      const added = it.videos.some((x) => x.src === 'bunny' && x.id === v.guid);
      const elsewhere = (cache.items || []).filter((x) => x !== it && x.videos.some((y) => y.src === 'bunny' && y.id === v.guid));
      return h('div', { class: `pv-pick${added ? ' added' : ''}` },
        h('button', { type: 'button', class: 'pv-pick-thumb', onclick: () => previewBunny(ctx, v), 'aria-label': `Watch ${v.title}` }, h('img', { src: v.thumb, alt: '', loading: 'lazy' }), h('span', { class: 'pv-len' }, mins(v.length))),
        h('div', { class: 'pv-pick-body' },
          h('b', {}, v.title),
          h('small', {}, [v.training, v.recorded && v.recorded.slice(0, 16).replace('T', ' '), elsewhere.length && `also in: ${elsewhere.map((x) => x.title || '(no title)').join(', ')}`].filter(Boolean).join(' · '))),
        added ? h('span', { class: 'pv-pick-done' }, 'Added ✓')
          : h('button', { type: 'button', class: 'btn-small', onclick: () => { it.videos.push({ id: v.guid, title: '', src: 'bunny' }); onAdd(); draw(); } }, icon('plus'), 'Add'));
    }) : [h('p', { class: 'muted' }, only && place ? `Nothing from ${it.training.split(' · ')[0]} found. Untick "Only this training weekend" to search everything.` : 'Nothing found.')]));
  };
  const box = h('div', { class: 'pv-picker' },
    h('div', { class: 'pv-pick-tools' },
      h('input', { type: 'search', placeholder: 'Search our library: teacher, dance, place…', oninput: (e) => { q = e.target.value; archive && draw(); } }),
      place && h('label', { class: 'pv-check' }, h('input', { type: 'checkbox', checked: true, onchange: (e) => { only = e.target.checked; archive && draw(); } }), ` Only ${it.training.split(' · ')[0]}`),
      h('button', { type: 'button', class: 'btn-small', onclick: async () => { list.replaceChildren(h('p', { class: 'muted' }, 'Loading…')); await loadArchive(ctx, true); draw(); } }, 'Refresh')),
    list);
  loadArchive(ctx).then(draw).catch((e) => list.replaceChildren(h('p', { class: 'error' }, e.message)));
  setTimeout(() => box.querySelector('input')?.focus(), 0);
  return box;
}
export const privateDirty = () => !!cache && (snap(cache.members) !== cache.snapM || snap(cache.items) !== cache.snapI);

// Save bar shared by both sections
function saveBar(ctx, what, redraw) {
  const { h, icon } = ctx;
  const note = h('span', { class: 'pv-note', role: 'status' });
  const btn = h('button', { type: 'button', class: 'btn-pdf', onclick: async () => {
    btn.disabled = true; note.textContent = 'Saving…'; note.classList.remove('error');
    try {
      const body = what === 'members' ? { members: cache.members, membersRev: cache.membersRev } : { items: cache.items, rev: cache.rev };
      const r = await ctx.api('/m/admin', { method: 'PUT', body: JSON.stringify(body) });
      if (what === 'members') { cache.membersRev = r.membersRev; cache.snapM = snap(cache.members); } else { cache.rev = r.rev; cache.snapI = snap(cache.items); }
      note.textContent = 'Saved ✓ Members see it straight away.';
      refresh();
    } catch (e) { note.textContent = `⚠ ${e.message}`; note.classList.add('error'); }
    btn.disabled = false;
  } }, icon('download'), 'Save');
  const refresh = () => {
    const dirty = what === 'members' ? snap(cache.members) !== cache.snapM : snap(cache.items) !== cache.snapI;
    btn.classList.toggle('pv-ready', dirty);
    btn.lastChild.textContent = dirty ? 'Save changes' : 'Saved';
  };
  refresh();
  return { el: h('div', { class: 'pv-save' }, note, btn), refresh, redraw };
}

// ---------- Members' access ----------
export function accessView(ctx) {
  const { h, icon, iconBtn, SITE } = ctx;
  const wrap = h('div', { class: 'pv' }, h('p', { class: 'muted' }, 'Loading…'));
  load(ctx).then(draw).catch((e) => wrap.replaceChildren(h('p', { class: 'error' }, e.message)));
  let q = '', show = 'all', act = null;
  loadSeason(ctx).then((s) => { if (s?.connected) { act = activity(s, ctx); if (cache) draw(); } }).catch(() => { /* no Weezevent: no activity shown */ });
  function draw() {
    const bar = saveBar(ctx, 'members');
    const changed = () => bar.refresh();
    const names = [...new Set([...(ctx.people.members || []), ...(ctx.people.team || [])].map((p) => p.name))].sort();
    const listEl = h('div', { class: 'pv-people' });
    const levels = h('div', { class: 'pv-levels' });
    const day = (ms) => new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
    const subStatus = (p) => {
      const s = cache.subs[p.email];
      if (p.free) return h('span', { class: 'pv-sub free' }, 'Free access');
      if (!s) return h('span', { class: 'pv-sub' }, 'Not subscribed');
      if (s.status === 'active' || s.status === 'trialing') return h('span', { class: 'pv-sub on' }, s.cancelAtEnd ? `Ends ${day(s.until)}` : `Subscribed · renews ${day(s.until)}`);
      if (s.status === 'past_due') return h('span', { class: 'pv-sub warn' }, 'Payment problem (retrying)');
      return h('span', { class: 'pv-sub' }, 'Subscription ended');
    };
    const drawList = () => {
      const paying = cache.members.filter((p) => !p.free && ['active', 'trialing', 'past_due'].includes(cache.subs[p.email]?.status)).length;
      levels.replaceChildren(...Object.entries(LEVEL).map(([l, text]) => h('span', {}, h('b', {}, cache.members.filter((p) => p.level === l && !p.blocked).length), ' ', text)), h('span', {}, h('b', {}, cache.members.filter((p) => p.blocked).length), ' blocked'), h('span', {}, h('b', {}, paying), ' subscribed to class recordings'), h('span', {}, h('b', {}, cache.members.filter((p) => p.free).length), ' with free access'));
      const came = (p) => (act ? act.of(p) : null);
      // fewer than 3 weekends so far (start of the records): the need shrinks with them
      const needs = (p) => Math.min(ACTIVE_NEEDS[p.level], act ? act.last.length : 0);
      const quiet = (p) => came(p) !== null && came(p) < needs(p);
      const shown = cache.members.map((p, i) => [p, i]).filter(([p]) => (!q || `${p.name} ${p.email}`.toLowerCase().includes(q))
        && (show === 'all' || (show === 'blocked' ? p.blocked : show === 'quiet' ? quiet(p) || came(p) === null : show === 'nosite' ? p.level === 'company' && !sitePerson(ctx, p) : p.level === show)));
      const monthsText = act ? act.last.map((m) => cap(MONTH_NAMES[Number(m.slice(5)) - 1])).join(', ') : '';
      // a second line per person: website photo (company), and how often they came lately
      const meta = (p) => {
        const site = sitePerson(ctx, p);
        const pick = p.level === 'company' && h('select', { 'aria-label': `Website profile of ${p.name || p.email}`, class: 'pv-site', onchange: (e) => { if (e.target.value) p.site = e.target.value; else delete p.site; changed(); drawList(); } },
          h('option', { value: '' }, site && !p.site ? `Website: ${site.name} (same name)` : 'Website: not linked'),
          sitePeople(ctx).map((x) => h('option', { value: x.name, selected: p.site === x.name }, `Website: ${x.name}`)));
        const n = came(p);
        const badge = !act || !act.last.length ? null : n === null ? h('span', { class: 'pv-sub' }, 'No Weezevent bookings with this email')
          : h('span', { class: `pv-sub ${n >= needs(p) ? 'on' : 'warn'}`, title: `Training weekends: ${monthsText}` }, `${n >= needs(p) ? 'Active' : 'Not active lately'} · came ${n} of the last ${act.last.length} (${monthsText})`);
        const sub = cache.subs[p.email];
        const block = h('button', { type: 'button', class: `btn-small${p.blocked ? ' pv-send' : ''}`, onclick: () => {
          if (p.blocked) { delete p.blocked; changed(); drawList(); return; }
          const paying = sub && ['active', 'trialing', 'past_due'].includes(sub.status);
          if (!confirm(`Block ${p.name || p.email}? They stay on the list but cannot sign in or watch videos until you unblock them.${paying ? '\n\nThey still have a paid subscription for the class recordings: cancel it in Stripe if they should not pay while blocked.' : ''}`)) return;
          p.blocked = true; changed(); drawList();
        } }, p.blocked ? 'Unblock' : 'Block access');
        return h('div', { class: 'pv-person-meta' }, avatar(ctx, p), p.blocked && h('span', { class: 'pv-sub warn' }, 'Blocked · cannot sign in'), pick || h('span', { class: 'pv-sub' }, 'Academy · not on the website'), badge, block);
      };
      listEl.replaceChildren(...(shown.length ? shown.map(([p, i]) => h('div', { class: `pv-person${p.blocked ? ' blocked' : ''}` },
        h('input', { value: p.name, placeholder: 'Name', 'aria-label': 'Name', list: 'pv-names', oninput: (e) => { p.name = e.target.value; changed(); } }),
        h('input', { type: 'email', value: p.email, placeholder: 'name@example.com', 'aria-label': 'Email', oninput: (e) => { p.email = e.target.value.trim(); changed(); } }),
        h('select', { 'aria-label': 'Level', onchange: (e) => { p.level = e.target.value; changed(); drawList(); } },
          Object.keys(LEVEL).map((l) => h('option', { value: l, selected: p.level === l }, l === 'company' ? 'Company' : 'Academy'))),
        h('label', { class: 'pv-free', title: 'Class recordings without paying (teachers, organisers, special cases)' }, h('input', { type: 'checkbox', checked: !!p.free, onchange: (e) => { if (e.target.checked) p.free = true; else delete p.free; changed(); drawList(); } }), ' Free'),
        subStatus(p),
        iconBtn('trash', `Remove ${p.name || 'this person'}`, () => { if (confirm(`Remove ${p.name || p.email}? They can no longer sign in.`)) { cache.members.splice(i, 1); changed(); drawList(); } }, { class: 'danger' }),
        meta(p)))
        : [h('p', { class: 'muted' }, q ? 'Nobody found.' : 'Nobody yet. Add the first person above.')]));
    };
    const name = h('input', { placeholder: 'Name', list: 'pv-names', 'aria-label': 'Name' });
    const email = h('input', { type: 'email', placeholder: 'name@example.com', 'aria-label': 'Email' });
    const level = h('select', { 'aria-label': 'Level' }, h('option', { value: 'company' }, 'Company'), h('option', { value: 'academy' }, 'Academy'));
    const err = h('p', { class: 'error', hidden: true });
    const add = (e) => {
      e.preventDefault();
      const mail = email.value.trim().toLowerCase();
      err.hidden = true;
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(mail)) { err.textContent = 'Check the email address.'; err.hidden = false; return; }
      if (cache.members.some((p) => p.email.toLowerCase() === mail)) { err.textContent = `${mail} is already on the list.`; err.hidden = false; return; }
      cache.members.unshift({ name: name.value.trim(), email: mail, level: level.value });
      name.value = email.value = ''; name.focus(); changed(); drawList();
    };
    drawList();
    wrap.replaceChildren(
      h('p', { class: 'muted' }, 'People on this list can open ', h('a', { href: SITE + '/members/', target: '_blank', rel: 'noopener' }, 'cubandance.co/members'), ' and sign in with a code sent to their email. Block access locks someone out straight away but keeps them on the list, so you can unblock them later; the bin removes them completely.'),
      levels,
      h('form', { class: 'pv-add', onsubmit: add }, name, email, level, h('button', { type: 'submit', class: 'btn-small' }, icon('plus'), 'Add')),
      err,
      h('p', { class: 'pv-hint' }, `Active members: company dancers come every month (at least ${ACTIVE_NEEDS.company} of the last 3 training weekends); academy dancers at least ${ACTIVE_NEEDS.academy} of the last 3. Counted from Weezevent tickets booked with the same email. Company members are linked to their photo on the website by name; choose another name if it does not match.`),
      h('div', { class: 'pv-compose-row' },
        h('input', { type: 'search', class: 'pv-search', placeholder: 'Search by name or email', value: q, oninput: (e) => { q = e.target.value.toLowerCase(); drawList(); } }),
        h('select', { 'aria-label': 'Show', onchange: (e) => { show = e.target.value; drawList(); } },
          [['all', 'Everyone'], ['company', 'Company members'], ['academy', 'Academy members'], ['quiet', 'Not active lately'], ['blocked', 'Blocked'], ['nosite', 'Company, no website photo']].map(([v, t]) => h('option', { value: v, selected: show === v }, t)))),
      listEl,
      h('datalist', { id: 'pv-names' }, names.map((n) => h('option', { value: n }))),
      bar.el);
  }
  return wrap;
}

// ---------- Video library ----------
export function videosView(ctx) {
  const { h, icon, iconBtn } = ctx;
  const wrap = h('div', { class: 'pv' }, h('p', { class: 'muted' }, 'Loading…'));
  load(ctx).then(() => draw()).catch((e) => wrap.replaceChildren(h('p', { class: 'error' }, e.message)));
  loadArchive(ctx).then(() => cache && draw()).catch(() => { /* names stay generic */ });
  let tab = focus?.tab || 'choreography', q = '', openId = focus?.id || null;
  focus = null;
  const trainings = [...ctx.trainings.events, ...ctx.trainings.history].sort((a, b) => b.start.localeCompare(a.start))
    .map((e) => ({ label: `${e.city} · ${ctx.range(e.start, e.end)}`, date: e.start }));

  function editor(it, redraw, changed) {
    const field = (label, input, hint) => h('label', { class: 'pv-field' }, h('span', {}, label), input, hint && h('small', {}, hint));
    const vids = h('div', { class: 'pv-vids' });
    const drawVids = () => vids.replaceChildren(...it.videos.map((v, i) => {
      const prev = h('img', { class: 'pv-thumb', alt: '', src: thumbOf(v), hidden: !v.id });
      const bad = h('small', { class: 'error', hidden: !!v.id || !v.url }, 'Not a YouTube link');
      return h('div', { class: 'pv-vid' }, prev,
        h('div', { class: 'pv-vid-fields' },
          h('input', { value: v.title, placeholder: `Video ${i + 1} title, e.g. "Full run" or "Part 2 · arms"`, 'aria-label': 'Video title', oninput: (e) => { v.title = e.target.value; changed(); } }),
          v.src === 'bunny' ? h('small', { class: 'pv-src' }, 'From our library', archive?.find((x) => x.guid === v.id) ? ` · ${archive.find((x) => x.guid === v.id).title}` : '') :
          h('input', { value: v.url || (v.id ? `https://youtu.be/${v.id}` : ''), placeholder: 'Paste a YouTube link, or add recordings from the inbox', 'aria-label': 'YouTube link', oninput: (e) => {
            v.url = e.target.value; v.id = ytId(v.url); prev.hidden = !v.id; if (v.id) prev.src = thumbOf(v); bad.hidden = !!v.id || !v.url; changed();
          } }), bad),
        h('div', { class: 'pv-vid-tools' },
          iconBtn('up', 'Move up', () => { [it.videos[i - 1], it.videos[i]] = [it.videos[i], it.videos[i - 1]]; changed(); drawVids(); }, { disabled: i === 0 }),
          iconBtn('down', 'Move down', () => { [it.videos[i + 1], it.videos[i]] = [it.videos[i], it.videos[i + 1]]; changed(); drawVids(); }, { disabled: i === it.videos.length - 1 }),
          iconBtn('trash', 'Remove this video', () => { it.videos.splice(i, 1); changed(); drawVids(); }, { class: 'danger' })));
    }), h('div', { class: 'pv-add-video' },
      h('button', { type: 'button', class: 'btn-small', onclick: (e) => {
        const open = vids.querySelector('.pv-picker');
        if (open) { open.remove(); e.currentTarget.classList.remove('on'); return; }
        e.currentTarget.classList.add('on');
        vids.append(libraryPicker(ctx, it, () => { changed(); const p = vids.querySelector('.pv-picker'); drawVids(); vids.append(p); vids.querySelector('.pv-add-video .btn-small')?.classList.add('on'); }));
      } }, icon('plus'), 'From our library'),
      h('button', { type: 'button', class: 'btn-small', onclick: () => { it.videos.push({ title: '', id: '' }); changed(); drawVids(); vids.querySelector('.pv-vid:last-of-type input')?.focus(); } }, icon('plus'), 'YouTube link')));
    drawVids();
    const dances = ctx.lists.titles;
    return h('div', { class: 'pv-edit' },
      h('div', { class: 'pv-grid' },
        field('Title', h('input', { value: it.title, placeholder: it.type === 'class' ? 'e.g. Técnica, Yemayá' : 'e.g. Yemayá · Raíces Cubanas', oninput: (e) => { it.title = e.target.value; changed(); } })),
        field('Dance', h('input', { value: it.dance, list: 'pv-dances', placeholder: 'e.g. Yemayá', oninput: (e) => { it.dance = e.target.value; changed(); } })),
        field('Teacher', h('input', { value: it.teacher, list: 'pv-teachers', placeholder: 'e.g. Sergio & Mireisi', oninput: (e) => { it.teacher = e.target.value; changed(); } })),
        field('Training', h('select', { onchange: (e) => { const t = trainings.find((x) => x.label === e.target.value); it.training = e.target.value; if (t && !it.date) it.date = t.date; changed(); redraw(); } },
          h('option', { value: '' }, '—'), trainings.map((t) => h('option', { value: t.label, selected: it.training === t.label }, t.label)),
          it.training && !trainings.some((t) => t.label === it.training) && h('option', { value: it.training, selected: true }, it.training))),
        field('Date', h('input', { type: 'date', value: it.date, onchange: (e) => { it.date = e.target.value; changed(); } }))),
      h('label', { class: 'pv-check' }, h('input', { type: 'checkbox', checked: it.academy, onchange: (e) => { it.academy = e.target.checked; changed(); redraw(); } }),
        ' Also for Academy dancers', h('small', {}, ' (company members always see everything)')),
      it.type === 'class' && h('label', { class: 'pv-check' }, h('input', { type: 'checkbox', checked: !!it.free, onchange: (e) => { if (e.target.checked) it.free = true; else delete it.free; changed(); redraw(); } }),
        ' Free (no subscription needed)', h('small', {}, ' (open to the members it is for, without paying)')),
      field('Notes (optional)', h('textarea', { rows: 3, value: it.notes, placeholder: 'Counts, music, what to practise…', oninput: (e) => { it.notes = e.target.value; changed(); } })),
      h('p', { class: 'pv-label' }, 'Videos', h('small', {}, ' in the order members see them')),
      vids,
      h('datalist', { id: 'pv-dances' }, dances.map((d) => h('option', { value: d }))),
      h('datalist', { id: 'pv-teachers' }, ctx.lists.teachers.map((d) => h('option', { value: d }))));
  }

  function draw() {
    const bar = saveBar(ctx, 'items');
    const changed = () => bar.refresh();
    const list = h('div', { class: 'pv-list' });
    const drawList = () => {
      const items = cache.items.filter((it) => it.type === tab && (!q || [it.title, it.dance, it.teacher, it.training].join(' ').toLowerCase().includes(q)))
        .sort((a, b) => (tab === 'class' ? (b.date || '').localeCompare(a.date || '') : 0) || a.title.localeCompare(b.title));
      list.replaceChildren(...(items.length ? items.map((it) => {
        const i = cache.items.indexOf(it);
        const meta = () => [it.teacher, it.training, `${it.videos.filter((v) => v.id).length} video(s)`].filter(Boolean).join(' · ');
        const sum = h('span', { class: 'sum' }, h('b', {}, it.title || '(no title)'), h('small', {}, meta()));
        const edited = () => { changed(); sum.firstChild.textContent = it.title || '(no title)'; sum.lastChild.textContent = meta(); };
        const det = h('details', { class: 'item', open: it.id === openId, ontoggle: (e) => { if (e.target.open) { openId = it.id; if (!det.querySelector('.pv-edit')) det.append(editor(it, () => { drawList(); }, edited)); } } },
          h('summary', {}, sum,
            it.free && h('span', { class: 'pv-badge free' }, 'Free'),
            h('span', { class: `pv-badge ${it.academy ? 'on' : ''}` }, it.academy ? 'Company + Academy' : 'Company'),
            iconBtn('copy', 'Duplicate', (e) => { e.preventDefault(); const c = structuredClone(it); c.id = uid(); c.title += ' (copy)'; cache.items.splice(i + 1, 0, c); openId = c.id; changed(); drawList(); }),
            iconBtn('trash', 'Remove', (e) => { e.preventDefault(); if (confirm(`Remove "${it.title || 'this item'}" and its videos from the members area?`)) { cache.items.splice(i, 1); changed(); drawList(); } }, { class: 'danger' })));
        if (it.id === openId) det.append(editor(it, () => drawList(), edited));
        return det;
      }) : [h('p', { class: 'tt-empty' }, q ? 'Nothing found.' : tab === 'class' ? 'No class recordings yet.' : 'No choreographies yet.')]));
    };
    const addItem = () => {
      // classes are recorded at the most recent weekend that has started
      const today = new Date().toISOString().slice(0, 10);
      const last = trainings.find((t) => t.date <= today) || trainings[0];
      const it = { id: uid(), type: tab, title: '', dance: '', teacher: '', training: tab === 'class' && last ? last.label : '', date: tab === 'class' && last ? last.date : '', academy: false, notes: '', videos: [{ title: '', id: '' }] };
      cache.items.push(it); openId = it.id; changed(); drawList();
      list.querySelector('details[open] input')?.focus();
    };
    const n = (t) => cache.items.filter((it) => it.type === t).length;
    const tabs = h('div', { class: 'pv-tabs' }, [['choreography', 'Choreographies'], ['class', 'Class recordings']].map(([t, label]) =>
      h('button', { type: 'button', class: tab === t ? 'active' : '', onclick: () => { tab = t; openId = null; draw(); } }, label, h('small', {}, n(t)))));
    drawList();
    wrap.replaceChildren(
      h('p', { class: 'muted' }, 'Add recordings from our library (the ICCD archive), or paste a YouTube link. A choreography can have several videos (full run, parts, details). Class recordings are grouped by training weekend.'),
      tabs,
      h('div', { class: 'pv-tools' },
        h('input', { type: 'search', class: 'pv-search', placeholder: 'Search', value: q, oninput: (e) => { q = e.target.value.toLowerCase(); drawList(); } }),
        h('button', { type: 'button', class: 'btn-small', onclick: addItem }, icon('plus'), tab === 'class' ? 'Class recording' : 'Choreography')),
      list, bar.el);
  }
  return wrap;
}

// ---------- Inbox: the recordings uploaded from the ICCD drive ----------
const KIND = { todo: 'To sort', members: 'In the members area', kept: 'Kept out', flagged: 'Flagged to delete', all: 'All' };
const REASONS = ['Bad sound', 'Bad picture', 'Duplicate', 'Not useful', 'Too short'];
export function inboxView(ctx) {
  const { h, icon, iconBtn } = ctx;
  const wrap = h('div', { class: 'pv' }, h('p', { class: 'muted' }, 'Loading the recordings…'));
  let videos = [], view = 'todo', q = '', training = '';
  const flash = h('p', { class: 'pv-flash', role: 'status' }); // the last action, stays visible when the list changes
  const trainings = [...ctx.trainings.events, ...ctx.trainings.history];
  // "2025-09 September - Milan" -> the training weekend it belongs to, as the videos section names it
  const weekendOf = (folder, recorded) => {
    const month = (recorded || folder).slice(0, 7);
    const place = folder.replace(/^\d{4}-\d{2}\s+\S+\s+-\s+/, '').replace(/\(.*\)/, '').trim().toLowerCase();
    const t = trainings.find((e) => e.start.slice(0, 7) === month && (place.includes(e.city.toLowerCase()) || e.city.toLowerCase().includes(place)))
      || trainings.find((e) => e.start.slice(0, 7) === month);
    return t ? { label: `${t.city} · ${ctx.range(t.start, t.end)}`, date: t.start } : { label: folder.replace(/^\d{4}-\d{2}\s+\S+\s+-\s+/, ''), date: (recorded || '').slice(0, 10) };
  };
  const usedIn = (guid) => cache.items.filter((it) => it.videos.some((v) => v.src === 'bunny' && v.id === guid));
  const kindOf = (v) => (v.flag ? 'flagged' : usedIn(v.guid).length ? 'members' : v.kept ? 'kept' : 'todo');
  const fmt = (s) => { const m = Math.round(s / 60); return m >= 60 ? `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m` : `${m} min`; };
  const when = (iso) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)} ${iso.slice(11, 16)}` : '');

  async function refresh() {
    try {
      await load(ctx, true);
      videos = (await ctx.api('/bunny/videos')).videos;
      draw();
    } catch (e) { wrap.replaceChildren(h('p', { class: 'error' }, e.message)); }
  }

  const preview = (v) => previewBunny(ctx, v);

  function card(v) {
    const note = h('small', { class: 'pv-saved' });
    const act = async (fn, okText, redraw = true) => {
      note.textContent = '…'; note.classList.remove('error');
      try { await fn(); note.textContent = okText; flash.textContent = `${okText.replace(/ ✓$/, '')}: ${v.title} ✓`; flash.classList.remove('error'); if (redraw) draw(); }
      catch (e) { note.textContent = '⚠ ' + e.message; note.classList.add('error'); flash.textContent = `⚠ ${v.title}: ${e.message}`; flash.classList.add('error'); }
    };
    const title = h('input', { value: v.title, 'aria-label': 'Name', onkeydown: (e) => e.key === 'Enter' && e.target.blur(), onchange: (e) => act(async () => {
      const r = await ctx.api('/bunny/rename', { method: 'POST', body: JSON.stringify({ guid: v.guid, title: e.target.value }) });
      v.title = r.title;
    }, 'Name saved ✓', false) });
    const ready = v.status === 4;
    const add = (it) => { it.videos.push({ id: v.guid, title: '', src: 'bunny' }); };
    const asClass = () => act(async () => {
      const w = weekendOf(v.training, v.recorded);
      cache.items.push({ id: crypto.randomUUID().slice(0, 8), type: 'class', title: v.title, dance: '', teacher: '', training: w.label, date: (v.recorded || w.date || '').slice(0, 10), academy: false, notes: '', videos: [] });
      add(cache.items.at(-1)); await saveItems(ctx);
    }, 'Added as a class recording ✓');
    const choreos = cache.items.filter((it) => it.type === 'choreography').sort((a, b) => a.title.localeCompare(b.title));
    const toChoreo = h('select', { 'aria-label': 'Add to a choreography', onchange: (e) => {
      const val = e.target.value; e.target.value = '';
      if (!val) return;
      act(async () => {
        if (val === 'new') cache.items.push({ id: crypto.randomUUID().slice(0, 8), type: 'choreography', title: v.title, dance: '', teacher: '', training: weekendOf(v.training, v.recorded).label, date: '', academy: false, notes: '', videos: [] });
        add(val === 'new' ? cache.items.at(-1) : cache.items.find((it) => it.id === val)); await saveItems(ctx);
      }, 'Added to the choreography ✓');
    } }, h('option', { value: '' }, 'Add to a choreography…'), h('option', { value: 'new' }, '+ New choreography'), choreos.map((c) => h('option', { value: c.id }, c.title || '(no title)')));
    const used = usedIn(v.guid);
    return h('article', { class: `pv-rec ${kindOf(v)}` },
      h('button', { type: 'button', class: 'pv-rec-thumb', disabled: !ready, onclick: () => preview(v), 'aria-label': `Watch ${v.title}` },
        ready ? h('img', { src: v.thumb, alt: '', loading: 'lazy' }) : h('span', { class: 'pv-proc' }, v.status === 5 || v.status === 6 ? 'Upload failed' : `Processing ${v.progress || 0}%`),
        h('span', { class: 'pv-len' }, fmt(v.length || 0)), ready && h('span', { class: 'pv-playicon', 'aria-hidden': 'true' }, '▶')),
      h('div', { class: 'pv-rec-body' },
        title,
        h('p', { class: 'pv-rec-meta' }, [when(v.recorded), v.cut && v.cut !== 'nothing' && `set-up cut: ${v.cut}`].filter(Boolean).join(' · ')),
        used.length ? h('p', { class: 'pv-rec-used' }, 'In the members area: ', used.map((it, i) => [i ? ', ' : '', h('button', { type: 'button', class: 'm-linkish', onclick: () => { focus = { tab: it.type, id: it.id }; ctx.go('videos'); } }, `${it.type === 'class' ? 'Class' : 'Choreography'} · ${it.title || '(no title)'}`)])) : null,
        h('div', { class: 'pv-rec-actions' },
          h('button', { type: 'button', class: 'btn-small', onclick: asClass }, icon('plus'), 'Class recording'),
          toChoreo,
          v.kept ? h('button', { type: 'button', class: 'btn-small', onclick: () => act(async () => { await ctx.api('/bunny/keep', { method: 'POST', body: JSON.stringify({ guid: v.guid, kept: false }) }); v.kept = false; }, 'Back in “To sort” ✓') }, 'Put back')
            : !used.length && h('button', { type: 'button', class: 'btn-small', title: 'Keep the video in the archive, not for members', onclick: () => act(async () => { await ctx.api('/bunny/keep', { method: 'POST', body: JSON.stringify({ guid: v.guid, kept: true }) }); v.kept = true; }, 'Kept out ✓') }, 'Keep out'),
          v.flag ? [
            h('button', { type: 'button', class: 'btn-small', onclick: () => act(() => setFlag(v, false), 'Unflagged') }, 'Unflag'),
            h('button', { type: 'button', class: 'btn-small pv-danger', onclick: () => { if (confirm(`Delete "${v.title}" from Bunny Stream? This cannot be undone. (The original stays on the ICCD drive.)`)) act(() => remove(v), 'Deleted'); } }, icon('trash'), 'Delete now'),
          ] : h('select', { class: 'pv-flag', 'aria-label': 'Flag to delete', onchange: (e) => { const r = e.target.value; if (r !== '-') act(() => setFlag(v, true, r), 'Flagged to delete'); } },
            h('option', { value: '-' }, 'Flag to delete…'), h('option', { value: '' }, 'Flag (no reason)'), REASONS.map((r) => h('option', { value: r }, r))),
          note),
        v.flag && h('p', { class: 'pv-flagged' }, icon('trash'), ` Flagged to delete${v.flag.reason ? ' · ' + v.flag.reason : ''}${v.flag.at ? ' · ' + new Date(v.flag.at).toLocaleString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).replace(',', '') : ''}`, used.length ? ' · also in the members area, deleting removes it there' : '')));
  }

  // flags are saved at once in the members service, so the whole team sees them
  async function setFlag(v, flagged, reason = '') {
    const r = await ctx.api('/bunny/flag', { method: 'POST', body: JSON.stringify({ guid: v.guid, flagged, reason }) });
    v.flag = r.flag;
  }
  async function remove(v) {
    await ctx.api('/bunny/delete', { method: 'POST', body: JSON.stringify({ guid: v.guid }) });
    const before = snap(cache.items);
    cache.items.forEach((it) => { it.videos = it.videos.filter((x) => x.id !== v.guid); });
    if (snap(cache.items) !== before) await saveItems(ctx);
    videos = videos.filter((x) => x.guid !== v.guid);
  }
  async function removeAllFlagged() {
    const list = videos.filter((v) => v.flag);
    if (!list.length || !confirm(`Delete all ${list.length} flagged recordings from Bunny Stream? This cannot be undone. (The originals stay on the ICCD drive.)`)) return;
    let n = 0;
    for (const v of list) {
      flash.textContent = `Deleting ${++n} of ${list.length}…`;
      try { await remove(v); } catch (e) { flash.textContent = `⚠ ${v.title}: ${e.message}`; flash.classList.add('error'); return draw(); }
    }
    flash.textContent = `Deleted ${list.length} flagged recordings ✓`; flash.classList.remove('error');
    draw();
  }

  const listBox = h('div', {});
  function drawList() {
    const shown = videos.filter((v) => (view === 'all' || kindOf(v) === view) && (!training || v.training === training) && (!q || `${v.title} ${v.training}`.toLowerCase().includes(q)));
    const groups = new Map();
    shown.sort((a, b) => b.training.localeCompare(a.training) || (a.recorded || '').localeCompare(b.recorded || '')).forEach((v) => groups.set(v.training, [...(groups.get(v.training) || []), v]));
    listBox.replaceChildren(shown.length
      ? h('div', { class: 'pv-inbox' }, [...groups].map(([g, list]) => h('section', {}, h('h3', {}, g || 'Other', h('small', {}, ` ${list.length}`)), list.map(card))))
      : h('p', { class: 'tt-empty' }, videos.length ? 'Nothing here.' : 'No recordings uploaded yet. They appear here as soon as the upload from the ICCD drive has finished.'));
  }
  function draw() {
    const counts = Object.fromEntries(Object.keys(KIND).map((k) => [k, videos.filter((v) => k === 'all' || kindOf(v) === k).length]));
    const folders = [...new Set(videos.map((v) => v.training))].sort().reverse();
    drawList();
    wrap.replaceChildren(
      h('p', { class: 'muted' }, 'Watch each recording, give it a clear name, then add it to the members area, keep it out, or flag it to delete. Flags are saved at once and seen by the whole team. The originals always stay on the ICCD drive.'),
      flash,
      h('div', { class: 'pv-tabs' }, Object.entries(KIND).map(([k, label]) => h('button', { type: 'button', class: view === k ? 'active' : '', onclick: () => { view = k; draw(); } }, label, h('small', {}, counts[k])))),
      h('div', { class: 'pv-tools' },
        h('select', { 'aria-label': 'Training weekend', onchange: (e) => { training = e.target.value; drawList(); } }, h('option', { value: '' }, 'All training weekends'), folders.map((f) => h('option', { value: f, selected: f === training }, f))),
        h('input', { type: 'search', class: 'pv-search', placeholder: 'Search', value: q, oninput: (e) => { q = e.target.value.toLowerCase(); drawList(); } }),
        h('button', { type: 'button', class: 'btn-small', onclick: refresh }, 'Refresh'),
        view === 'flagged' && counts.flagged > 0 && h('button', { type: 'button', class: 'btn-small pv-danger', onclick: removeAllFlagged }, icon('trash'), `Delete all ${counts.flagged} flagged`)),
      view === 'flagged' && h('p', { class: 'muted' }, 'Recordings the team flagged. Check them once more: unflag what should stay, delete the rest.'),
      listBox);
  }
  refresh();
  return wrap;
}

// ---------- Mailing list ----------
// Newsletter subscribers from the website (they confirmed by email) and emails to an audience:
// the newsletter, or the members-area dancers. Sent by the members service (worker/news.js).
const LANG_NAMES = { en: 'English', es: 'Spanish', fr: 'French', it: 'Italian', de: 'German', nl: 'Dutch' };
const STATUS = { active: 'Subscribed', pending: 'Waiting for confirmation', unsubscribed: 'Unsubscribed' };
const AUDIENCE = { newsletter: 'Newsletter subscribers', members: 'Members area: everyone', 'members:company': 'Members area: Company', 'members:academy': 'Members area: Academy' };

// Ready-made emails: which ones are offered depends on who the email is for.
// {name} stays in the text (each person gets their own first name); city and dates are filled in now.
const TICKETS = 'https://my.weezevent.com/iccd-training-2026-2027';
const TEMPLATES = {
  participants: [
    { id: 'next', label: 'Next training (announce, with booking)', card: 'upcoming',
      subject: (t) => `Next training: ${t.city}, ${t.dates}`,
      body: (t) => `Hi {name},\n\nOur next training weekend is in ${t.city} on ${t.dates}, with live drums and our maestros. Places are limited, so book early.\n\n{card}\n\nWe would love to see you there!\n**The ICCD team**` },
    { id: 'invite', label: 'Invite to our newsletter', button: 'join',
      subject: () => 'Shall we keep you posted?',
      body: () => `Hi {name},\n\nYou have danced with us or come to one of our shows, and we would love to keep in touch. Our newsletter brings our training dates, shows and news, about once a month.\n\nIf you would like it, just click the button below. If not, you don't need to do anything: we will not add you without your yes.\n\nWarm regards,\n**The ICCD team**` },
    { id: 'reminder', label: 'Training reminder (a few days before)', card: 'this', reminders: true,
      subject: (t) => `See you in ${t.city} this weekend!`,
      body: (t) => `Hi {name},\n\nWe're looking forward to dancing with you in ${t.city} on ${t.dates}! Here is everything you need for the weekend.\n\nThe full timetable is on our website. Please arrive 10 minutes early so we can start on time with the musicians.\n\n{card}\n\nSee you on the dance floor,\n**The ICCD team**` },
    { id: 'timetable', label: 'The timetable is out', card: 'this',
      subject: (t) => `${t.city}: the timetable is out`,
      body: (t) => `Hi {name},\n\nThe timetable for ${t.city} (${t.dates}) is now online. Have a look so you know which classes are for you, and when the breaks are.\n\nIf you have any questions, just reply to this email.\n\n{card}\n\nSee you soon,\n**The ICCD team**` },
    { id: 'thanks', label: 'Thank you, after the training', card: 'next',
      subject: (t) => `Thank you for dancing with us in ${t.city}!`,
      body: (t) => `Hi {name},\n\nThank you for joining us in ${t.city}. It was a joy to share the weekend with you, the maestros and the musicians.\n\nPhotos and videos will follow on our Instagram. We would love to see you again at our next training.\n\n{card}\n\nWith love,\n**The ICCD team**` },
  ],
  members: [
    { id: 'next', label: 'Next training (announce, with booking)', card: 'upcoming',
      subject: (t) => `Next training: ${t.city}, ${t.dates}`,
      body: (t) => `Hi {name},\n\nOur next training weekend is in ${t.city} on ${t.dates}, with live drums and our maestros. Places are limited, so book early.\n\n{card}\n\nWe would love to see you there!\n**The ICCD team**` },
    { id: 'invite', label: 'Invite to our newsletter', button: 'join',
      subject: () => 'Shall we keep you posted?',
      body: () => `Hi {name},\n\nAs a member of the company you already hear from us about the members area. Would you also like our newsletter? It brings our training dates, shows and news, about once a month.\n\nIf you would like it, just click the button below. If not, you don't need to do anything: we will not add you without your yes.\n\nWarm regards,\n**The ICCD team**` },
    { id: 'videos', label: 'New videos in the members area', button: 'members',
      subject: () => 'New videos in the members area',
      body: () => `Hi {name},\n\nNew class recordings and choreographies are waiting for you in the members area.\n\nSign in with your email address and you'll receive a code to open the videos.\n\nEnjoy practising!\n**The ICCD team**` },
    { id: 'news', label: 'News for the company',
      subject: () => 'News for the company',
      body: () => `Hi {name},\n\n[Write your news here.]\n\nSee you soon,\n**The ICCD team**` },
  ],
  news: [
    { id: 'next', label: 'Next training (announce, with booking)', card: 'upcoming',
      subject: (t) => `Next training: ${t.city}, ${t.dates}`,
      body: (t) => `Hello,\n\nOur next training weekend is in ${t.city} on ${t.dates}, with live drums and our maestros. Places are limited, so book early.\n\n{card}\n\nWe would love to see you there!\n**The ICCD team**` },
    { id: 'news', label: 'News from ICCD',
      subject: () => 'News from the International Company of Cuban Dances',
      body: () => `Hello,\n\n[Write your news here.]\n\nWarm regards,\n**The ICCD team**` },
  ],
};
const PHOTO_GROUPS = {
  'Trainings': { joy: 'The joy of a training', weekend: 'The whole group at a weekend', together: 'Celebrating together', havana: 'Training in Havana', hall: 'A full hall dancing', maestro: 'A maestro teaching' },
  'Costumes': { company: 'The company in costume', hats: 'Red costumes and straw hats', red: 'Changó in red', green: 'Oggún in green', yemaya: 'Yemayá in blue' },
  'On stage': { stage: 'On stage with live drums', drums: 'The drummers', timba: 'Timba on stage', rumba: 'Dancers in red, Rome', oshun: 'Oshún on stage', ship: 'The ship scene' },
};
const PHOTOS = Object.assign({}, ...Object.values(PHOTO_GROUPS));
// the photo and headline each template starts with (the team can change both)
const LOOK = {
  reminder: { photo: 'joy', eyebrow: 'See you this weekend', headline: (t) => `${t.city} · ${t.dates}` },
  timetable: { photo: 'maestro', eyebrow: 'The timetable is out', headline: (t) => `${t.city} · ${t.dates}` },
  thanks: { photo: 'weekend', eyebrow: 'Thank you', headline: (t) => `Thank you, ${t.city}!` },
  next: { photo: 'company', eyebrow: 'Next training', headline: (t) => `${t.city} · ${t.dates}` },
  videos: { photo: 'stage', eyebrow: 'Members area', headline: () => 'New videos for you' },
  news: { photo: 'drums', eyebrow: 'News', headline: () => 'News from ICCD' },
  invite: { photo: 'together', eyebrow: 'Stay in touch', headline: () => 'Shall we keep you posted?' },
};
const BUTTONS = { join: { label: 'Yes, keep me posted', join: true }, members: { label: 'Open the members area', url: 'https://cubandance.co/members/' }, tickets: { label: 'Book your training', url: TICKETS }, support: { label: 'Support us', url: 'https://cubandance.co/support/' } };
const kindOf = (aud) => (aud.startsWith('tickets:') || aud.startsWith('segment:') ? 'participants' : aud.startsWith('members') ? 'members' : 'news');
const remember = { get: (k, d) => { try { return localStorage.getItem(k) || d; } catch { return d; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } } };

export function mailingView(ctx) {
  const { h } = ctx;
  const wrap = h('div', { class: 'pv' }, h('p', { class: 'muted' }, 'Loading…'));
  let data = null, q = '', pendingLabel = '', lastNote = ['', false]; // the last message stays after the list is drawn again
  let groups = [];
  const reload = () => Promise.all([ctx.api('/news/admin'), loadSeason(ctx).catch(() => null), load(ctx).catch(() => null)])
    .then(([d, s]) => { data = d; groups = s?.connected ? groupsFor(s, ctx.trainings, s.current).filter((g) => g.people.length) : []; draw(); })
    .catch((e) => wrap.replaceChildren(h('p', { class: 'error' }, e.message)));
  reload();
  const day = (ms) => (ms ? new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '');
  // who an audience reaches, as far as the panel can tell (the service counts again before sending)
  const off = () => new Set(data.subscribers.filter((s) => s.status === 'unsubscribed').map((s) => s.email));
  // members' emails per audience (the panel's copy of the member list)
  const membersEmails = (aud) => (cache?.members || []).filter((m) => !m.blocked && (aud === 'members' || m.level === aud.split(':')[1])).map((m) => m.email.toLowerCase());
  const count = (aud, lang, invite) => {
    if (aud === 'newsletter') return data.subscribers.filter((s) => s.status === 'active' && (lang === 'all' || s.lang === lang)).length;
    const skip = invite ? new Set([...off(), ...data.subscribers.filter((s) => s.status === 'active').map((s) => s.email)]) : off();
    if (aud.startsWith('tickets:')) {
      const ids = new Set(aud.slice(8).split(','));
      return uniqueEmails(season.people.filter((p) => (ids.has('all') ? p.event === season.current : ids.has(p.ticket)))).filter((e) => !skip.has(e)).length;
    }
    if (aud.startsWith('segment:unbooked:')) {
      const ym = aud.slice(17), cur = season.events.find((e) => e.id === season.current), tname = new Map(season.tickets.map((t) => [t.id, t.name]));
      const booked = new Set(season.people.filter((p) => p.event === season.current && ticketMonth({ name: tname.get(p.ticket) || '' }, cur) === ym).map((p) => p.email));
      return peopleIndex(season).filter((x) => x.now && !booked.has(x.email)).map((x) => x.email).filter((e) => !skip.has(e)).length;
    }
    if (aud.startsWith('segment:')) return peopleIndex(season).filter((x) => SEGMENTS[aud.slice(8)].test(x)).map((x) => x.email).filter((e) => !skip.has(e)).length;
    if (invite) return membersEmails(aud).filter((e) => !skip.has(e)).length;
    return { members: data.members.all, 'members:company': data.members.company, 'members:academy': data.members.academy }[aud];
  };
  const audiencePeople = (aud) => {
    const first = (p) => String(p.first || p.name || '').trim().split(/\s+/)[0] || '';
    const full = (p) => (p.first !== undefined ? `${p.first} ${p.last || ''}` : p.name || '').trim();
    let list = [];
    if (aud === 'newsletter') list = data.subscribers.filter((s) => s.status === 'active').map((s) => ({ email: s.email, name: '', first: '' }));
    else if (aud.startsWith('members')) list = (cache?.members || []).filter((m) => !m.blocked && (aud === 'members' || m.level === aud.split(':')[1])).map((m) => ({ email: m.email.toLowerCase(), name: m.name, first: first(m) }));
    else if (season?.connected) {
      const by = new Map(peopleIndex(season).map((x) => [x.email, x]));
      let emails = [];
      if (aud.startsWith('tickets:')) { const ids = new Set(aud.slice(8).split(',')); emails = uniqueEmails(season.people.filter((p) => (ids.has('all') ? p.event === season.current : ids.has(p.ticket)))); }
      else if (aud.startsWith('segment:') && !aud.startsWith('segment:unbooked:')) emails = peopleIndex(season).filter((x) => SEGMENTS[aud.slice(8)].test(x)).map((x) => x.email);
      else if (aud.startsWith('segment:unbooked:')) emails = peopleIndex(season).filter((x) => x.now).map((x) => x.email);
      list = emails.map((e) => by.get(e)).filter(Boolean).map((x) => ({ email: x.email, name: full(x), first: first(x) }));
    }
    const skip = off();
    return list.filter((p) => p.email && !skip.has(p.email)).sort((a, b) => (a.name || a.email).localeCompare(b.name || b.email));
  };
  const label = (value) => AUDIENCE[value] || (value === 'tickets:all' ? 'Participants · this whole season' : value.startsWith('segment:unbooked:') ? `Trained this season, not booked for ${(ctx.trainings.events || []).find((e) => e.start.startsWith(value.slice(17)))?.city || 'the next training'} yet` : value.startsWith('segment:') ? SEGMENTS[value.slice(8)].label : `Participants · ${groups.find((g) => `tickets:${g.tickets.join(',')}` === value)?.label || pendingLabel || 'a training'}`);

  // a field with its name and a line on what it does
  const field = (label, hint, ...controls) => h('div', { class: 'pv-field' }, h('span', { class: 'pv-label' }, label), hint && h('small', { class: 'pv-hint' }, hint), ...controls);
  // tabs inside the Mailing page: the sections stay in place, only shown or hidden (nothing typed is lost)
  const MAIL_TABS = [['write', 'Write an email'], ['templates', 'Templates'], ['sent', 'Sent and scheduled'], ['subscribers', 'Subscribers']];
  const mailTabs = h('div', { class: 'pv-views' }, MAIL_TABS.map(([k, t]) => h('button', { type: 'button', 'data-k': k, onclick: () => { mailTab = k; showMailTab(); } }, t)));
  function showMailTab() {
    mailTabs.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b.dataset.k === mailTab));
    wrap.querySelectorAll('[data-mtab]').forEach((s) => { s.hidden = s.dataset.mtab !== mailTab; });
  }
  let openTemplate = null, templatesChanged = null; // set by draw(): open a template in the Write tab; redraw the Templates tab
  // ----- Templates tab: the team's own and the ready-made ones -----
  function templatesTab() {
    const own = data.templates || [];
    const KIND_NAMES = { participants: 'For participants', members: 'For the members area', news: 'For newsletter subscribers' };
    const row = (img, name, sub, ...buttons) => h('div', { class: 'pv-tpl-row' }, img ? h('img', { src: `${ctx.SITE}/images/email/${img}.jpg`, alt: '', loading: 'lazy' }) : h('span', { class: 'pv-tpl-noimg' }), h('span', {}, h('b', {}, name), h('br'), h('small', { class: 'muted' }, sub)), h('span', { class: 'pv-compose-row' }, ...buttons));
    const tell = (t, bad) => { lastNote = [t, !!bad]; templatesChanged(); };
    const rename = (t) => async (e) => {
      const box = e.target.closest('.pv-tpl-row');
      const input = h('input', { value: t.name, maxlength: 60, 'aria-label': 'New name' });
      const save = h('button', { type: 'button', class: 'btn-small pv-send', onclick: async () => {
        if (!input.value.trim()) return;
        try { const r = await ctx.api('/news/templates', { method: 'POST', body: JSON.stringify({ ...t, name: input.value }) }); data.templates = r.templates; tell('Renamed ✓'); } catch (err) { tell(err.message, true); }
      } }, 'Save the name');
      box.querySelector('.pv-compose-row').replaceChildren(input, save, h('button', { type: 'button', class: 'btn-small', onclick: () => templatesChanged() }, 'Cancel'));
      input.focus();
    };
    const remove = (t) => async () => {
      if (!confirm(`Delete the template "${t.name}"? Emails already sent are not affected.`)) return;
      try { const r = await ctx.api('/news/templates', { method: 'DELETE', body: JSON.stringify({ id: t.id }) }); data.templates = r.templates; tell('Template deleted ✓'); } catch (err) { tell(err.message, true); }
    };
    return h('section', { 'data-mtab': 'templates', class: 'pv-templates' },
      lastNote[0] && h('p', { class: `pv-note${lastNote[1] ? ' bad' : ''}`, role: 'status' }, lastNote[0]),
      h('h3', {}, 'Your team\'s templates'),
      h('p', { class: 'pv-hint' }, 'A template keeps the photo, headline, subject, message, training box and button. {city} and {dates} are filled in with the training you choose. To make one: write an email in "Write an email", then click "Save as template". To change one: open it, change it, then "Save as template" and "Update".'),
      own.length ? h('div', { class: 'pv-subs' }, own.map((t) => row(t.photo, t.name, t.subject,
        h('button', { type: 'button', class: 'btn-small pv-send', onclick: () => openTemplate(`saved:${t.id}`) }, 'Open in the editor'),
        h('button', { type: 'button', class: 'btn-small', onclick: rename(t) }, 'Rename'),
        h('button', { type: 'button', class: 'btn-small', onclick: remove(t) }, 'Delete'))))
        : h('p', { class: 'muted' }, 'No templates saved yet.'),
      h('h3', {}, 'Ready-made templates'),
      h('p', { class: 'pv-hint' }, 'These come with the panel and always fill in the next training. Open one, change what you like and save it as your own.'),
      Object.entries(TEMPLATES).map(([kind, list]) => h('div', { class: 'pv-tpl-kind' }, h('span', { class: 'pv-label' }, KIND_NAMES[kind]),
        h('div', { class: 'pv-subs' }, list.map((t) => row(LOOK[t.id]?.photo, t.label, t.subject({ city: '{city}', dates: '{dates}' }),
          h('button', { type: 'button', class: 'btn-small', onclick: () => openTemplate(t.id, kind) }, 'Open in the editor')))))));
  }
  function draw() {
    const subs = data.subscribers;
    const n = (s) => subs.filter((x) => x.status === s).length;
    const byLang = Object.entries(subs.filter((s) => s.status === 'active').reduce((m, s) => ({ ...m, [s.lang]: (m[s.lang] || 0) + 1 }), {}));

    // ----- write and send -----
    const upcomingEv = [...(ctx.trainings.events || [])].sort((a, b) => a.start.localeCompare(b.start)).find((e) => e.start >= new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10));
    const audience = h('select', { 'aria-label': 'Audience' },
      h('optgroup', { label: 'Website and members area' }, Object.entries(AUDIENCE).map(([v, t]) => h('option', { value: v }, t))),
      groups.length > 0 && h('optgroup', { label: 'This season (Weezevent)' },
        groups.map((g) => h('option', { value: `tickets:${g.tickets.join(',')}` }, `Participants · ${g.label}`)),
        h('option', { value: 'tickets:all' }, 'Participants · this whole season')),
      season?.connected && upcomingEv && h('optgroup', { label: `${upcomingEv.city} (Weezevent)` }, h('option', { value: `segment:unbooked:${upcomingEv.start.slice(0, 7)}` }, `Trained this season, not booked for ${upcomingEv.city} yet`)),
      season?.connected && h('optgroup', { label: 'Since 2023 (Weezevent)' }, SEGMENT_AUDIENCES.map((k) => h('option', { value: `segment:${k}` }, SEGMENTS[k].label))));
    if (pendingAudience) {
      // a training of an older event (from All events) is not in the list yet: add it
      if (![...audience.options].some((o) => o.value === pendingAudience.value)) audience.append(h('option', { value: pendingAudience.value }, pendingAudience.label));
      audience.value = pendingAudience.value; pendingLabel = pendingAudience.label; pendingAudience = null;
    }
    const lang = h('select', { 'aria-label': 'Language' }, h('option', { value: 'all' }, 'All languages'), Object.entries(LANG_NAMES).map(([v, t]) => h('option', { value: v }, `${t} readers only`)));
    const subject = h('input', { placeholder: 'For example: Brussels training: the timetable is out', 'aria-label': 'Subject', maxlength: 150 });
    const body = h('textarea', { rows: 10, 'aria-label': 'Message', placeholder: 'Write your message.\n\nA blank line starts a new paragraph. **Two stars** make words bold. Links: [the timetable](https://cubandance.co/trainings/) or just paste the address.' });
    const testTo = h('input', { type: 'email', value: remember.get('iccd-test-to', 'info@cubandance.co'), 'aria-label': 'Send the test to', list: 'pv-test-people', autocomplete: 'off' });
    // a test can also go to one person of the audience (pick them by name): it then greets them by their first name
    const testPeople = h('datalist', { id: 'pv-test-people' });
    const testWho = h('small', { class: 'pv-hint' });
    const fillTestPeople = () => {
      const list = audiencePeople(audience.value);
      testPeople.replaceChildren(...list.slice(0, 500).map((p) => h('option', { value: p.email }, p.name || p.email)));
      showTestWho();
    };
    const testPerson = () => audiencePeople(audience.value).find((p) => p.email === testTo.value.trim().toLowerCase());
    const showTestWho = () => {
      const p = testPerson();
      testWho.textContent = p ? `The test goes to ${p.name || p.email}, from this audience${p.first ? `, and greets them as "${p.first}"` : ''}. The subject starts with [Test].` : 'Your own address, or start typing a name or email to send the test to one person of this audience.';
    };
    testTo.addEventListener('input', showTestWho);
    // ----- template, training card, reminders, button -----
    const today = new Date().toISOString().slice(0, 10);
    const events = [...(ctx.trainings.events || [])].sort((a, b) => a.start.localeCompare(b.start));
    const evLabel = (e) => `${e.city} · ${ctx.range(e.start, e.end)}`;
    const template = h('select', { 'aria-label': 'Template' });
    const saveTplBtn = h('button', { type: 'button', class: 'btn-small' }, 'Save as template');
    const delTplBtn = h('button', { type: 'button', class: 'btn-small', hidden: true }, 'Delete this template');
    const saveTplBox = h('div', { class: 'pv-confirm pv-tpl', hidden: true });
    const cardSel = h('select', { 'aria-label': 'Training details in the email' }, h('option', { value: '' }, 'None'), events.map((e, i) => h('option', { value: String(i) }, evLabel(e))));
    const remindersBox = h('input', { type: 'checkbox' });
    const buttonSel = h('select', { 'aria-label': 'Button' }, h('option', { value: '' }, 'None'), Object.entries(BUTTONS).map(([k, b]) => h('option', { value: k }, `"${b.label}"`)));
    const previewBox = h('div', { class: 'pv-preview', hidden: true });
    // the photo at the top: the chosen one, and a grid to choose another
    const photoThumb = h('img', { class: 'pv-photo-thumb', alt: '', src: `${ctx.SITE}/images/email/company.jpg` });
    const photoName = h('b', {}, PHOTOS.company);
    const photoGrid = h('div', { class: 'pv-photo-grid', hidden: true }, Object.entries(PHOTO_GROUPS).map(([g, list]) => h('div', { class: 'pv-photo-group' }, h('small', { class: 'pv-hint' }, g),
      h('div', { class: 'pv-photo-opts' }, Object.entries(list).map(([k, t]) => h('button', { type: 'button', class: 'pv-photo-opt', 'data-photo': k, title: t, onclick: () => { photoSel.value = k; photoSel.onchange(); photoGrid.hidden = true; } },
        h('img', { src: `${ctx.SITE}/images/email/${k}.jpg`, alt: '', loading: 'lazy' }), h('span', {}, t)))))));
    const photoSel = { value: 'company', onchange: () => {
      photoThumb.src = `${ctx.SITE}/images/email/${photoSel.value}.jpg`; photoName.textContent = PHOTOS[photoSel.value] || '';
      photoGrid.querySelectorAll('.pv-photo-opt').forEach((b) => b.classList.toggle('on', b.dataset.photo === photoSel.value));
    } };
    const photoBtn = h('button', { type: 'button', class: 'btn-small', onclick: () => { photoGrid.hidden = !photoGrid.hidden; } }, 'Choose another photo');
    const eyebrow = h('input', { placeholder: 'For example: Next training', 'aria-label': 'Small line above the headline', maxlength: 40 });
    const headline = h('input', { placeholder: 'For example: Brussels · 14–15 Nov 2026', 'aria-label': 'Headline', maxlength: 70 });
    // the training an audience is about: its month, matched to the calendar
    const trainingFor = (aud) => {
      const g = groups.find((x) => `tickets:${x.tickets.join(',')}` === aud);
      return g && g.ym ? events.findIndex((e) => e.start.slice(0, 7) === g.ym) : -1;
    };
    const weekAhead = new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10);
    const upcoming = () => events.findIndex((e) => e.start >= weekAhead);
    const nextAfter = (i) => events.findIndex((e, j) => j > i && e.start >= today) >= 0 ? events.findIndex((e, j) => j > i && e.start >= today) : events.findIndex((e) => e.start >= today);
    const fillTemplates = () => {
      const kind = kindOf(audience.value);
      const keep = template.value;
      template.replaceChildren(h('option', { value: '' }, 'Start from a template…'),
        h('optgroup', { label: 'Ready-made' }, TEMPLATES[kind].map((t) => h('option', { value: t.id }, t.label))),
        (data.templates || []).length > 0 && h('optgroup', { label: 'Saved by the team' }, data.templates.map((t) => h('option', { value: `saved:${t.id}` }, t.name))));
      if ([...template.options].some((o) => o.value === keep)) template.value = keep;
      delTplBtn.hidden = !template.value.startsWith('saved:');
      const own = trainingFor(audience.value);
      if (own >= 0) cardSel.value = String(own);
    };
    // a saved template keeps {city} and {dates} where the training was named, filled in again when used
    const savedTpl = (v) => v.startsWith('saved:') && (data.templates || []).find((x) => `saved:${x.id}` === v);
    const fromSaved = (x) => {
      const fill = (s) => (info) => s.replace(/\{city\}/g, info.city).replace(/\{dates\}/g, info.dates);
      return { id: x.id, card: x.card, reminders: x.reminders, button: x.button, subject: fill(x.subject), body: fill(x.body), look: x.photo && { photo: x.photo, eyebrow: x.eyebrow, headline: fill(x.headline) } };
    };
    template.onchange = () => {
      delTplBtn.hidden = !template.value.startsWith('saved:'); saveTplBox.hidden = true;
      const saved = savedTpl(template.value);
      const t = saved ? fromSaved(saved) : TEMPLATES[kindOf(audience.value)].find((x) => x.id === template.value);
      if (!t) return;
      if ((subject.value.trim() || body.value.trim()) && !confirm('Replace the subject and message with this template?')) { template.value = ''; return; }
      const own = trainingFor(audience.value);
      const idx = t.card === 'this' ? (own >= 0 ? own : nextAfter(-1)) : t.card === 'next' ? nextAfter(own) : t.card === 'upcoming' ? upcoming() : -1;
      const ev = events[idx] || events[nextAfter(-1)] || {};
      const info = { city: ev.city || '[city]', dates: ev.start ? ctx.range(ev.start, ev.end) : '[dates]' };
      subject.value = t.subject(info); body.value = t.body(info);
      const look = t.look || LOOK[t.id];
      if (look) { photoSel.value = look.photo; photoSel.onchange(); eyebrow.value = look.eyebrow; headline.value = look.headline(info); }
      cardSel.value = t.card && idx >= 0 ? String(idx) : '';
      remindersBox.checked = !!t.reminders;
      buttonSel.value = t.button || '';
      updateReach();
      grow(body);
    };
    saveTplBtn.onclick = () => {
      if (!subject.value.trim() || !body.value.trim()) { say('Write a subject and a message first, then save them as a template.', true); return; }
      const saved = savedTpl(template.value);
      const name = h('input', { value: saved ? saved.name : '', placeholder: 'Name, for example: Brussels reminder', maxlength: 60, 'aria-label': 'Template name' });
      const store = async (e, id) => {
        if (!name.value.trim()) { name.focus(); return; }
        e.target.disabled = true;
        // the training named in the email becomes {city} and {dates}, so the template works for the next one too
        const ev = events[Number(cardSel.value)];
        const general = (s) => (ev ? s.split(ctx.range(ev.start, ev.end)).join('{dates}').split(ev.city).join('{city}') : s);
        const idx = Number(cardSel.value);
        try {
          const r = await ctx.api('/news/templates', { method: 'POST', body: JSON.stringify({ id, name: name.value, subject: general(subject.value), body: general(body.value), photo: photoSel.value, eyebrow: eyebrow.value, headline: general(headline.value),
            card: cardSel.value === '' ? '' : idx === trainingFor(audience.value) ? 'this' : 'upcoming', reminders: remindersBox.checked, button: buttonSel.value }) });
          data.templates = r.templates;
          templatesChanged(); template.value = `saved:${r.id}`; delTplBtn.hidden = false;
          saveTplBox.hidden = true;
          say(`Template "${name.value.trim()}" saved for the whole team ✓`);
        } catch (err) { say(err.message, true); e.target.disabled = false; }
      };
      saveTplBox.replaceChildren(
        h('p', {}, h('b', {}, 'Save this email as a template'), ' (subject, message, photo, headline, training details and button). The training city and dates are kept as {city} and {dates}, so the template fills them in for the next training.'),
        h('div', { class: 'pv-confirm-buttons' }, name,
          saved && h('button', { type: 'button', class: 'btn-small pv-send', onclick: (e) => store(e, saved.id) }, `Update "${saved.name}"`),
          h('button', { type: 'button', class: saved ? 'btn-small' : 'btn-small pv-send', onclick: (e) => store(e) }, saved ? 'Save as a new one' : 'Save'),
          h('button', { type: 'button', class: 'btn-small', onclick: () => { saveTplBox.hidden = true; } }, 'Cancel')));
      saveTplBox.hidden = false;
      name.focus();
    };
    delTplBtn.onclick = async () => {
      const saved = savedTpl(template.value);
      if (!saved || !confirm(`Delete the template "${saved.name}"? Emails already sent are not affected.`)) return;
      try {
        const r = await ctx.api('/news/templates', { method: 'DELETE', body: JSON.stringify({ id: saved.id }) });
        data.templates = r.templates; template.value = ''; templatesChanged();
        say('Template deleted ✓');
      } catch (err) { say(err.message, true); }
    };
    templatesChanged = () => {
      fillTemplates();
      wrap.querySelector('.pv-templates')?.replaceWith(templatesTab());
      showMailTab();
    };
    openTemplate = (value, kind) => {
      if (kind && kindOf(audience.value) !== kind) {
        const fit = [...audience.options].find((o) => kindOf(o.value) === kind && !o.value.startsWith('segment:unbooked:'));
        if (fit) { audience.value = fit.value; audience.onchange(); }
      }
      template.value = value; template.onchange();
      mailTab = 'write'; showMailTab(); scrollTo(0, 0);
    };
    const grow = (ta) => { ta.style.height = 'auto'; ta.style.height = ta.scrollHeight + 4 + 'px'; };
    body.addEventListener('input', () => grow(body));
    // everything the service needs to build the email
    const extras = () => {
      const e = events[Number(cardSel.value)];
      const card = cardSel.value !== '' && e ? { start: e.start, end: e.end, label: 'Training weekend', title: `${e.city} · ${ctx.range(e.start, e.end)}`, when: e.time || '', venue: e.venue || '', address: e.address || '', note: e.note || '', mapUrl: e.mapUrl || '', timetableUrl: `${ctx.SITE}/trainings/`, ticketUrl: kindOf(audience.value) === 'participants' && Number(cardSel.value) === trainingFor(audience.value) ? '' : e.ticketUrl || TICKETS } : null;
      return { card, reminders: remindersBox.checked ? ctx.trainings.reminders || [] : [], button: buttonSel.value ? BUTTONS[buttonSel.value] : null, photo: photoSel.value, eyebrow: eyebrow.value, headline: headline.value };
    };
    // Send and Schedule unlock only after this exact version was previewed or sent as a test
    let checked = '';
    const fp = () => JSON.stringify([subject.value.trim(), body.value.trim(), audience.value, lang.value, extras()]);
    const checkedFirst = () => {
      if (fp() === checked) return true;
      say('First check this exact version: click Preview or Send me a test. Any change after that needs a new check.', true);
      return false;
    };
    const previewBtn = h('button', { type: 'button', class: 'btn-small' }, 'Preview');
    previewBtn.onclick = async () => {
      if (!ready()) return;
      previewBtn.disabled = true;
      try {
        const r = await ctx.api('/news/preview', { method: 'POST', body: JSON.stringify({ subject: subject.value, body: body.value, audience: audience.value, sampleName: kindOf(audience.value) === 'news' ? '' : 'Carla', ...extras() }) });
        previewBox.replaceChildren(
          h('div', { class: 'pv-preview-head' }, h('span', {}, h('b', {}, r.subject), kindOf(audience.value) === 'news' ? '' : ' · shown with "Carla" as an example name'), h('button', { type: 'button', class: 'btn-small', onclick: () => { previewBox.hidden = true; } }, 'Close preview')),
          h('iframe', { src: r.url, title: 'Email preview', class: 'pv-preview-frame' }));
        previewBox.hidden = false;
        checked = fp();
        previewBox.scrollIntoView({ behavior: 'smooth', block: 'start' });
      } catch (e) { say(e.message, true); }
      previewBtn.disabled = false;
    };
    const reach = h('p', { class: 'pv-reach' });
    const oldNote = h('div', { class: 'pv-old', hidden: true });
    // a segment from the Weezevent history: how many last booked more than a year ago
    const longAgo = (aud) => {
      if (!season?.connected || !aud.startsWith('segment:') || aud.startsWith('segment:unbooked:')) return 0;
      const year = new Date(Date.now() - 365 * 864e5).toISOString().slice(0, 10), skip = off();
      return peopleIndex(season).filter((x) => SEGMENTS[aud.slice(8)].test(x) && !skip.has(x.email) && x.last_at < year).length;
    };
    const note = h('p', { class: `pv-note${lastNote[1] ? ' bad' : ''}`, role: 'status' }, lastNote[0]);
    const confirmBox = h('div', { class: 'pv-confirm', hidden: true });
    const sendBtn = h('button', { type: 'button', class: 'btn-small pv-send' }, 'Send…');
    const testBtn = h('button', { type: 'button', class: 'btn-small' }, 'Send me a test');
    const scheduleBtn = h('button', { type: 'button', class: 'btn-small' }, 'Schedule…');
    const scheduleBox = h('div', { class: 'pv-confirm', hidden: true });
    const pad = (n) => String(n).padStart(2, '0');
    const localInput = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
    const updateReach = () => {
      lang.disabled = audience.value !== 'newsletter';
      if (lang.disabled) lang.value = 'all';
      const c = count(audience.value, lang.value, buttonSel.value === 'join');
      reach.textContent = `Goes to ${c} ${c === 1 ? 'person' : 'people'}. People who unsubscribed are always left out.`;
      const old = buttonSel.value === 'join' ? 0 : longAgo(audience.value);
      oldNote.hidden = !old;
      if (old) oldNote.replaceChildren(
        h('p', {}, h('b', {}, `${old} of these people last booked with us more than a year ago.`), ' The privacy rules (GDPR) allow emails to recent customers, but people we have not seen for a long time may not expect them. Write to them first with the invitation to the newsletter: only those who say yes get the announcements after that.'),
        h('button', { type: 'button', class: 'btn-small', onclick: () => { template.value = 'invite'; template.onchange(); } }, 'Use the invitation instead'));
      return c;
    };
    audience.onchange = () => { confirmBox.hidden = true; previewBox.hidden = true; updateReach(); fillTemplates(); fillTestPeople(); };
    buttonSel.onchange = () => { confirmBox.hidden = true; updateReach(); };
    lang.onchange = () => { confirmBox.hidden = true; updateReach(); };
    const say = (t, bad) => { lastNote = [t, !!bad]; note.textContent = t; note.classList.toggle('bad', !!bad); };
    const ready = () => { if (!subject.value.trim() || !body.value.trim()) { say('Write a subject and a message first.', true); return false; } return true; };
    testBtn.onclick = async () => {
      if (!ready()) return;
      testBtn.disabled = true; say('Sending the test…');
      const who = testPerson();
      if (!who) remember.set('iccd-test-to', testTo.value.trim()); // remember your own address, not a participant's
      try { await ctx.api('/news/send', { method: 'POST', body: JSON.stringify({ subject: subject.value, body: body.value, test: testTo.value, testName: who?.first || '', audience: audience.value, ...extras() }) }); checked = fp(); say(`Test sent to ${who?.name ? `${who.name} (${testTo.value.trim()})` : testTo.value}. Check how it looks before sending to everyone.`); }
      catch (e) { say(e.message, true); }
      testBtn.disabled = false;
    };
    let expect = 0;
    let again = false;
    // a last chance: the email leaves after 10 seconds unless Stop is clicked
    function send() {
      let left = 10;
      const stop = h('button', { type: 'button', class: 'btn-small pv-send' }, 'Stop, don\'t send');
      const line = h('b', {});
      const tick = () => { line.textContent = `Sending in ${left} second${left === 1 ? '' : 's'}…`; };
      tick();
      const timer = setInterval(() => { left -= 1; if (left > 0) return tick(); clearInterval(timer); confirmBox.hidden = true; sendNow(); }, 1000);
      stop.onclick = () => { clearInterval(timer); confirmBox.hidden = true; sendBtn.disabled = false; say('Stopped. Nothing was sent.'); };
      confirmBox.replaceChildren(h('p', {}, line, ' Nothing has gone out yet.'), h('div', { class: 'pv-confirm-buttons' }, stop));
      sendBtn.disabled = true;
    }
    async function sendNow() {
      sendBtn.disabled = true; say('Sending…');
      try {
        const r = await ctx.api('/news/send', { method: 'POST', body: JSON.stringify({ subject: subject.value, body: body.value, audience: audience.value, label: label(audience.value), lang: lang.value, expect, again, ...extras() }) });
        say(`Sent to ${r.sent} ${r.sent === 1 ? 'person' : 'people'}${r.failed ? `, ${r.failed} could not be sent` : ''} ✓`);
        subject.value = body.value = '';
        sendBtn.disabled = false;
        await reload();
      } catch (e) { say(e.message, true); sendBtn.disabled = false; }
    }
    scheduleBtn.onclick = () => {
      if (!ready() || !checkedFirst()) return;
      const c = updateReach();
      if (!c) { say('Nobody to send to in this audience.', true); return; }
      const t = new Date(); t.setDate(t.getDate() + 1); t.setHours(10, 0, 0, 0);
      const when = h('input', { type: 'datetime-local', value: localInput(t), min: localInput(new Date(Date.now() + 10 * 60e3)), 'aria-label': 'Date and time' });
      scheduleBox.replaceChildren(
        h('p', {}, h('b', {}, `Schedule "${subject.value.trim()}" for ${label(audience.value)}`), ` (about ${c} ${c === 1 ? 'person' : 'people'} today; the list is checked again when it goes out). It is sent within 10 minutes of the time you choose.`, c > (data.daily?.limit || 100) - 5 ? ` The email service allows ${data.daily?.limit || 100} emails a day, so this one goes out in daily portions over about ${Math.ceil(c / ((data.daily?.limit || 100) - 5))} days, each morning at 10:00.` : ''),
        h('div', { class: 'pv-confirm-buttons' }, when,
          h('button', { type: 'button', class: 'btn-small pv-send', onclick: async (e) => {
            e.target.disabled = true;
            try {
              await ctx.api('/news/schedule', { method: 'POST', body: JSON.stringify({ subject: subject.value, body: body.value, audience: audience.value, label: label(audience.value), lang: lang.value, at: new Date(when.value).toISOString(), ...extras() }) });
              say(`Scheduled for ${new Date(when.value).toLocaleString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })} ✓`);
              subject.value = body.value = '';
              await reload();
            } catch (err) { say(err.message, true); e.target.disabled = false; }
          } }, 'Schedule it'),
          h('button', { type: 'button', class: 'btn-small', onclick: () => { scheduleBox.hidden = true; } }, 'Cancel')));
      scheduleBox.hidden = false; confirmBox.hidden = true;
    };
    sendBtn.onclick = () => {
      if (!ready() || !checkedFirst()) return;
      expect = updateReach();
      if (!expect) { say('Nobody to send to in this audience.', true); return; }
      scheduleBox.hidden = true;
      const who = `${label(audience.value)}${lang.value !== 'all' ? `, ${LANG_NAMES[lang.value]} readers` : ''}`;
      const twin = data.campaigns.find((c) => c.sent && c.subject === subject.value.trim() && c.audience === audience.value.slice(0, 60) && c.at > Date.now() - 7 * 864e5);
      again = false;
      const yes = h('button', { type: 'button', class: 'btn-small pv-send', onclick: () => { again = !!twin; send(); } }, twin ? 'Yes, send it again' : 'Yes, send now');
      // more than 10 people: type the number to confirm (a slip of the mouse cannot send it)
      const typed = expect > 10 && h('input', { inputmode: 'numeric', class: 'pv-type-count', placeholder: `Type ${expect}`, 'aria-label': `Type ${expect} to confirm`, oninput: (e) => { yes.disabled = e.target.value.trim() !== String(expect); } });
      if (typed) yes.disabled = true;
      confirmBox.replaceChildren(
        h('p', {}, h('b', {}, `Send "${subject.value.trim()}" to ${expect} ${expect === 1 ? 'person' : 'people'} (${who}) now?`), ' This cannot be undone.', typed ? ` To confirm, type the number of people: ${expect}.` : ''),
        !oldNote.hidden && h('p', { class: 'pv-note bad' }, `Reminder: ${longAgo(audience.value)} of them last booked more than a year ago (see the note above).`),
        twin && h('p', { class: 'pv-note bad' }, `This email was already sent to these people on ${new Date(twin.at).toLocaleString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })}.`),
        h('div', { class: 'pv-confirm-buttons' }, typed, yes,
          h('button', { type: 'button', class: 'btn-small', onclick: () => { confirmBox.hidden = true; } }, 'Cancel')));
      confirmBox.hidden = false;
      typed ? typed.focus() : null;
    };

    // ----- subscribers -----
    const listEl = h('div', { class: 'pv-subs' });
    const drawList = () => {
      const shown = subs.filter((s) => !q || s.email.includes(q));
      listEl.replaceChildren(...(shown.length ? shown.map((s) => h('div', { class: 'pv-sub-row' },
        h('span', { class: 'pv-sub-mail' }, s.email),
        h('span', {}, LANG_NAMES[s.lang] || s.lang),
        h('span', { class: `pv-sub ${s.status === 'active' ? 'on' : s.status === 'pending' ? 'warn' : ''}` }, STATUS[s.status] || s.status),
        h('span', { class: 'muted' }, day(s.at)),
        ctx.iconBtn('trash', `Erase ${s.email}`, async () => {
          if (!confirm(`Erase ${s.email} completely? They will no longer be on the list, and no record of them is kept.`)) return;
          try { await ctx.api('/news/admin', { method: 'DELETE', body: JSON.stringify({ email: s.email }) }); await reload(); } catch (e) { alert(e.message); }
        }, { class: 'danger' })))
        : [h('p', { class: 'muted' }, q ? 'Nobody found.' : 'Nobody has signed up yet. The form is in the footer of every page and on cubandance.co/newsletter.')]));
    };
    const exportCsv = () => {
      const rows = [['email', 'language', 'date'], ...subs.filter((s) => s.status === 'active').map((s) => [s.email, s.lang, new Date(s.at || 0).toISOString().slice(0, 10)])];
      saveCsv('iccd-newsletter', rows);
    };
    drawList();

    wrap.replaceChildren(
      h('div', { class: 'pv-levels' },
        h('span', {}, h('b', {}, n('active')), ' subscribed'), h('span', {}, h('b', {}, n('pending')), ' waiting for confirmation'), h('span', {}, h('b', {}, n('unsubscribed')), ' unsubscribed'),
        h('span', {}, h('b', {}, data.members.all), ' in the members area'),
        byLang.length > 0 && h('span', {}, byLang.map(([l, c]) => `${LANG_NAMES[l] || l} ${c}`).join(' · '))),
      mailTabs,
      h('section', { class: 'pv-compose', 'data-mtab': 'write' },
        h('div', { class: 'pv-step' }, h('h3', {}, h('span', { class: 'pv-num' }, '1'), 'Who gets it'),
          field('Audience', 'The group of people this email goes to.', audience),
          field('Language', 'Only for newsletter subscribers, who chose a language when signing up.', lang),
          reach, oldNote),
        h('div', { class: 'pv-step' }, h('h3', {}, h('span', { class: 'pv-num' }, '2'), 'Template ', h('small', { class: 'muted' }, '(optional)')),
          field('Start from a template', 'Fills in everything below. You can then change any of it. Templates are managed in the Templates tab.', h('div', { class: 'pv-compose-row' }, template, saveTplBtn, delTplBtn)),
          saveTplBox),
        h('div', { class: 'pv-step' }, h('h3', {}, h('span', { class: 'pv-num' }, '3'), 'Top of the email'),
          field('Photo', 'The big picture people see first.', h('div', { class: 'pv-photo-row' }, photoThumb, h('div', { class: 'pv-photo-fields' }, photoName, photoBtn))),
          photoGrid,
          field('Small line above the headline', 'A few words in small capitals on the gold band, like a label. Optional.', eyebrow),
          field('Headline', 'The big words on the gold band, under the photo. Leave it empty for no gold band.', headline)),
        h('div', { class: 'pv-step' }, h('h3', {}, h('span', { class: 'pv-num' }, '4'), 'Subject and message'),
          field('Subject', 'What people see in their inbox before opening the email.', subject),
          field('Message', null, body),
          h('small', { class: 'pv-hint' }, '{name} becomes each person\'s first name. {card} marks where the training box goes (otherwise it comes after your message). A blank line starts a new paragraph; **two stars** make words bold; links: [the timetable](https://cubandance.co/trainings/) or just paste the address. To organise a longer email: a paragraph starting with ## is a section title, ### a box with a title, > a highlighted quote, and a line -> [Book now](https://…) is a button.')),
        h('div', { class: 'pv-step' }, h('h3', {}, h('span', { class: 'pv-num' }, '5'), 'Extras ', h('small', { class: 'muted' }, '(optional)')),
          field('Training box', 'A box with the dates, place, map and booking button of one training.', cardSel),
          field('Button', 'One big button at the end of the email.', buttonSel),
          h('label', { class: 'pv-check-inline' }, remindersBox, ' Add the kind reminders (what to bring, be on time…) from the Trainings page')),
        h('div', { class: 'pv-step' }, h('h3', {}, h('span', { class: 'pv-num' }, '6'), 'Check and send'),
          h('small', { class: 'pv-hint' }, 'Preview it or send a test first: Send and Schedule only work after that.'),
          h('div', { class: 'pv-compose-row' }, h('label', { class: 'pv-test' }, 'Test to ', testTo), previewBtn, testBtn, scheduleBtn, sendBtn),
          testWho, testPeople,
          confirmBox, scheduleBox, note, previewBox)),
      templatesTab(),
      (data.scheduled || []).length === 0 ? '' : h('section', { 'data-mtab': 'sent' },
        h('h3', {}, 'Scheduled'),
        h('div', { class: 'pv-sent' }, data.scheduled.map((c) => h('div', { class: 'pv-sent-row' },
          h('span', {}, h('b', {}, new Date(c.at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }))), h('b', {}, c.subject), h('span', {}, c.label),
          h('button', { type: 'button', class: 'btn-small', onclick: async () => { if (!confirm(`Cancel "${c.subject}"? It will not be sent.`)) return; try { await ctx.api('/news/schedule', { method: 'DELETE', body: JSON.stringify({ id: c.id }) }); say('Cancelled ✓'); await reload(); } catch (e) { say(e.message, true); } } }, 'Cancel'))))),
      h('section', { 'data-mtab': 'sent' },
        h('h3', {}, 'Sent'),
        data.campaigns.length ? h('div', { class: 'pv-sent' }, data.campaigns.map((c) => h('div', { class: 'pv-sent-row' },
          h('span', { class: 'muted' }, day(c.at)), h('b', {}, c.subject, c.tracked && c.sent ? h('small', { class: 'pv-result', 'data-at': String(c.at) }) : '', c.left ? h('small', { class: 'muted' }, ` · ${c.left} more in the next days`) : '', c.scheduled ? h('small', { class: 'muted' }, ' · scheduled') : '', c.error ? h('small', { class: 'pv-note bad' }, ` · not sent: ${c.error}`) : ''), h('span', {}, `${c.label || AUDIENCE[c.audience] || 'Participants'}${c.lang && c.lang !== 'all' ? ` · ${LANG_NAMES[c.lang]}` : ''}`), h('span', {}, `${c.sent} sent${c.failed ? `, ${c.failed} failed` : ''}`))))
          : h('p', { class: 'muted' }, 'Nothing sent yet.')),
      h('section', { 'data-mtab': 'subscribers' },
        h('div', { class: 'pv-subs-head' }, h('h3', {}, 'Subscribers'), h('button', { type: 'button', class: 'btn-small', onclick: exportCsv }, 'Export the subscribed list (CSV)')),
        h('input', { type: 'search', class: 'pv-search', placeholder: 'Search by email', oninput: (e) => { q = e.target.value.toLowerCase(); drawList(); } }),
        listEl));
    updateReach();
    fillTemplates();
    fillTestPeople();
    showMailTab();
    showResults();
  }
  // "9 of 50 booked since · 7 for November": what each email achieved
  let results = null;
  async function showResults() {
    if (!wrap.querySelector('.pv-result')) return;
    try { results = (await ctx.api('/news/results')).results || {}; } catch { return; }
    for (const el of wrap.querySelectorAll('.pv-result')) {
      const r = results[el.dataset.at];
      if (!r) continue;
      const months = Object.entries(r.months).sort().map(([m, n]) => `${n} for ${MONTH_NAMES[Number(m.slice(5)) - 1].replace(/^./, (x) => x.toUpperCase())}`);
      el.textContent = r.booked ? ` · ${r.booked} of ${r.to} booked since${months.length ? ` (${[...months, r.shows ? `${r.shows} for a show` : ''].filter(Boolean).join(', ')})` : ''}` : ` · no bookings yet from the ${r.to} people`;
      el.classList.toggle('good', r.booked > 0);
    }
  }
  return wrap;
}

// ---------- Participants (Weezevent) ----------
// Every Weezevent event since 2023. Training tickets start with the month ("October - Early Bird…",
// "June 2024…"), matched to the training of that month in the calendar; shows are one group each.
// A spreadsheet file of what is on screen: semicolons and a UTF-8 mark, so Excel opens it
// in columns with the accents right (Google Sheets and Numbers read it too)
function saveCsv(name, rows) {
  const cell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const blob = new Blob(['\ufeff' + rows.map((r) => r.map(cell).join(';')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}.csv`;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
const MONTH_NAMES = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
let season = null, pendingAudience = null, subsCache = null, mailTab = 'write';
const loadSeason = async (ctx, fresh) => (season && !fresh ? season : (season = await ctx.api('/weezevent/participants' + (fresh ? '?fresh=1' : ''))));
const uniqueEmails = (people) => [...new Set(people.map((p) => p.email).filter(Boolean))];
const cap = (w) => w[0].toUpperCase() + w.slice(1);

// The training a ticket is for: its month (and year: written in the name, or the season's)
function ticketMonth(t, ev) {
  const words = String(t.name).toLowerCase().split(/[\s,:-]+/);
  const m = MONTH_NAMES.indexOf(words[0]);
  if (m < 0 || !ev?.start) return null;
  const y0 = Number(ev.start.slice(0, 4)), m0 = Number(ev.start.slice(5, 7));
  const written = words.find((w) => /^20\d\d$/.test(w));
  const year = written ? Number(written) : m + 1 >= m0 ? y0 : y0 + 1;
  return `${year}-${String(m + 1).padStart(2, '0')}`;
}
// groups for one event: a training month each (in date order), or the whole show
function groupsFor(s, trainings, eventId) {
  const ev = s.events.find((e) => e.id === eventId);
  if (!ev) return [];
  const cal = [...(trainings?.events || []), ...(trainings?.history || [])];
  const byId = new Map(s.tickets.filter((t) => t.event === eventId).map((t) => [t.id, t]));
  const groups = new Map();
  const add = (key, make) => groups.get(key) || groups.set(key, make()).get(key);
  for (const p of s.people.filter((x) => x.event === eventId)) {
    const t = byId.get(p.ticket);
    const ym = ev.kind === 'training' && t ? ticketMonth(t, ev) : null;
    const key = ev.kind === 'show' ? 'show' : ym || 'other';
    const g = add(key, () => {
      if (key === 'show') return { key, ym: ev.start.slice(0, 7), label: ev.name, tickets: new Set(), people: [] };
      if (key === 'other') return { key, ym: '9999', label: 'Passes, T-shirts and other', tickets: new Set(), people: [] };
      const c = cal.find((e) => String(e.start).slice(0, 7) === ym);
      const name = `${cap(MONTH_NAMES[Number(ym.slice(5)) - 1])} ${ym.slice(0, 4)}`;
      return { key, ym, label: c ? `${name} · ${c.city}` : name, tickets: new Set(), people: [] };
    });
    g.tickets.add(p.ticket);
    g.people.push({ ...p, ticketName: t?.name || 'Ticket' });
  }
  return [...groups.values()].map((g) => ({ ...g, tickets: [...g.tickets] })).sort((a, b) => a.ym.localeCompare(b.ym));
}
// one row per person across every event: the analytics
function peopleIndex(s) {
  const ev = new Map(s.events.map((e) => [e.id, e]));
  const price = new Map(s.tickets.map((t) => [t.id, t.price || 0]));
  const tname = new Map(s.tickets.map((t) => [t.id, t.name]));
  const by = new Map();
  for (const p of s.people) {
    if (!p.email) continue;
    const e = ev.get(p.event);
    const x = by.get(p.email) || { email: p.email, first: p.first, last: p.last, trainings: new Set(), shows: new Set(), seasons: new Set(), spent: 0, checkins: 0, first_at: '9999', last_at: '', now: false, bookings: [] };
    const when = (p.booked || e?.start || '').slice(0, 10);
    const month = e?.kind === 'show' ? null : ticketMonth({ name: tname.get(p.ticket) || '' }, e);
    if (e?.kind === 'show') x.shows.add(p.event); else if (month) { x.trainings.add(`${p.event}:${month}`); x.seasons.add(p.event); if (p.event === s.current) x.now = true; } // T-shirts and passes are not trainings; 'now' = trains this season
    x.spent += price.get(p.ticket) || 0;
    if (p.scanned) x.checkins++;
    if (when && when < x.first_at) x.first_at = when;
    if (when > x.last_at) { x.last_at = when; x.first = p.first || x.first; x.last = p.last || x.last; }
    x.bookings.push({ when, event: e?.name || '', ticket: tname.get(p.ticket) || 'Ticket', promo: p.promo || '' });
    if (p.promo) (x.promos ||= new Set()).add(p.promo);
    by.set(p.email, x);
  }
  return [...by.values()];
}
const SEGMENTS = {
  all: { label: 'Everyone who ever booked', test: () => true },
  regulars: { label: 'Regulars (5+ trainings)', test: (x) => x.trainings.size >= 5 },
  lapsed: { label: 'Trained before, not this season', test: (x) => x.trainings.size > 0 && !x.now },
  shows: { label: 'Show audiences who never trained', test: (x) => x.shows.size > 0 && x.trainings.size === 0 },
  newcomers: { label: 'New this season', test: (x) => x.now && x.seasons.size === 1 && x.shows.size === 0 },
};
const SEGMENT_AUDIENCES = ['all', 'lapsed', 'shows', 'regulars'];

export function participantsView(ctx) {
  const { h } = ctx;
  const wrap = h('div', { class: 'pv' }, h('p', { class: 'muted' }, 'Loading the participants from Weezevent…'));
  let view = 'season', eventId = null, tab = null, q = '', seg = 'all', sort = 'trainings', open = null, message = ['', false];
  const start = (fresh) => Promise.all([loadSeason(ctx, fresh), load(ctx, fresh), ctx.api('/news/admin').then((d) => { subsCache = d.subscribers; }).catch(() => {})])
    .then(draw).catch((e) => wrap.replaceChildren(h('p', { class: 'error' }, e.message)));
  start(false);
  const day = (s) => (s ? new Date(s.slice(0, 10) + 'T12:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '');
  const monthYear = (s) => (s && s !== '9999' ? new Date(s.slice(0, 10) + 'T12:00:00').toLocaleDateString('en-GB', { month: 'short', year: 'numeric' }) : '');
  const short = (name) => name.replace(/^\s*[A-Za-z]+(\s+20\d\d)?\s*-\s*/, '').trim();
  const euro = (n) => `€${Math.round(n).toLocaleString('en-GB')}`;

  function draw() {
    if (!season.connected) return wrap.replaceChildren(h('p', { class: 'muted' }, 'Weezevent is not connected yet: its API key and login are needed in the members service.'));
    const members = new Map(cache.members.map((m) => [m.email.toLowerCase(), m]));
    const subscribed = new Set((subsCache || []).filter((s) => s.status === 'active').map((s) => s.email));
    const index = peopleIndex(season);
    const note = h('p', { class: `pv-note${message[1] ? ' bad' : ''}`, role: 'status' }, message[0]);
    const say = (t, bad) => { message = [t, !!bad]; note.textContent = t; note.classList.toggle('bad', !!bad); };
    const badges = (email) => [members.has(email) && h('span', { class: 'pv-badge on' }, `${members.get(email).level === 'academy' ? 'Academy member' : 'Company member'}${members.get(email).blocked ? ' (blocked)' : ''}`), subscribed.has(email) && h('span', { class: 'pv-badge' }, 'Newsletter')];
    const memberCell = (p) => {
      if (members.has(p.email)) return h('span', { class: 'pv-badges' }, avatar(ctx, members.get(p.email)), ...badges(p.email));
      if (!p.email) return h('span', { class: 'muted' }, 'No email');
      const level = h('select', { 'aria-label': 'Level' }, h('option', { value: 'company' }, 'Company'), h('option', { value: 'academy' }, 'Academy'));
      return h('span', { class: 'pv-add-member' }, subscribed.has(p.email) && h('span', { class: 'pv-badge' }, 'Newsletter'), level, h('button', { type: 'button', class: 'btn-small', onclick: async (e) => {
        e.target.disabled = true;
        try {
          const r = await ctx.api('/weezevent/add-member', { method: 'POST', body: JSON.stringify({ name: `${p.first} ${p.last}`.trim(), email: p.email, level: level.value }) });
          await load(ctx, true);
          say(r.already ? `${p.email} was already in the members area.` : `${p.first} ${p.last} can now sign in to the members area ✓`);
          draw();
        } catch (err) { say(err.message, true); e.target.disabled = false; }
      } }, 'Add to members area'));
    };
    const emailButtons = (value, label, emails, extra) => h('div', { class: 'pv-compose-row' },
      h('button', { type: 'button', class: 'btn-small pv-send', onclick: () => { pendingAudience = { value, label }; ctx.go('mailing'); } }, `Email these ${emails.length} people`),
      h('button', { type: 'button', class: 'btn-small', onclick: async () => { try { await navigator.clipboard.writeText(emails.join(', ')); say(`${emails.length} email addresses copied ✓`); } catch { say('Copying is not allowed in this browser.', true); } } }, 'Copy the emails'),
      extra);

    // ----- one event: a tab per training month (or the show), its participants -----
    const eventPanel = (id) => {
      const groups = groupsFor(season, ctx.trainings, id);
      if (!groups.length) return h('p', { class: 'muted' }, 'No bookings in this event.');
      if (!groups.some((g) => g.key === tab)) tab = (groups.find((g) => g.key !== 'other' && g.people.length) || groups[0]).key;
      const g = groups.find((x) => x.key === tab);
      const rows = g.people.filter((p) => !q || `${p.first} ${p.last} ${p.email} ${p.promo || ''}`.toLowerCase().includes(q)).sort((a, b) => a.first.localeCompare(b.first));
      const exportRows = () => {
        saveCsv(`iccd-${g.label}${q ? `-${q}` : ''}`, [['first name', 'last name', 'email', 'training', 'ticket', 'promo code', 'booked', 'checked in', 'members area', 'newsletter'],
          ...rows.map((p) => [p.first, p.last, p.email, g.label, p.ticketName, p.promo || '', (p.booked || '').slice(0, 10), p.scanned ? 'yes' : '', members.get(p.email)?.level || '', subscribed.has(p.email) ? 'yes' : ''])]);
        say(`${rows.length} ${rows.length === 1 ? 'ticket' : 'tickets'} exported ✓`);
      };
      const codes = Object.entries(g.people.reduce((m, p) => (p.promo ? { ...m, [p.promo]: (m[p.promo] || 0) + 1 } : m), {})).sort((a, b) => b[1] - a[1]);
      return h('div', { class: 'pv' },
        groups.length > 1 && h('div', { class: 'pv-tabs' }, groups.map((x) => h('button', { type: 'button', class: tab === x.key ? 'active' : '', onclick: () => { tab = x.key; draw(); } }, x.label, h('small', {}, uniqueEmails(x.people).length)))),
        emailButtons(`tickets:${g.tickets.join(',')}`, `Participants · ${g.label}`, uniqueEmails(g.people), h('button', { type: 'button', class: 'btn-small', onclick: exportRows }, q ? `Export these ${rows.length} (Excel)` : 'Export this list (Excel)')),
        codes.length > 0 && h('p', { class: 'pv-codes' }, 'Promo codes: ', codes.map(([c, n]) => h('button', { type: 'button', class: `pv-code${q === c.toLowerCase() ? ' on' : ''}`, title: `Show the ${n} ticket${n === 1 ? '' : 's'} booked with ${c}`, onclick: () => { q = q === c.toLowerCase() ? '' : c.toLowerCase(); draw(); } }, `${c} × ${n}`)),
          h('small', { class: 'muted' }, ` · ${g.people.length - codes.reduce((s, [, n]) => s + n, 0)} without a code`)),
        h('div', { class: 'pv-subs' }, rows.length ? rows.map((p) => h('div', { class: 'pv-part-row' },
          h('span', {}, h('b', {}, `${p.first} ${p.last}`), h('br'), h('small', { class: 'muted' }, p.email || 'no email')),
          h('span', {}, short(p.ticketName), p.promo && h('span', { class: 'pv-code' }, p.promo), h('br'), h('small', { class: 'muted' }, [p.booked && `booked ${day(p.booked)}`, p.scanned && 'checked in'].filter(Boolean).join(' · '))),
          memberCell(p))) : [h('p', { class: 'muted' }, 'Nobody found.')]));
    };

    // ----- people: one row each, across every event -----
    const peoplePanel = () => {
      const S = SEGMENTS[seg];
      const chosen = index.filter((x) => S.test(x));
      const sorters = { trainings: (a, b) => b.trainings.size - a.trainings.size || b.last_at.localeCompare(a.last_at), recent: (a, b) => b.last_at.localeCompare(a.last_at), spent: (a, b) => b.spent - a.spent, name: (a, b) => `${a.first} ${a.last}`.localeCompare(`${b.first} ${b.last}`) };
      const rows = chosen.filter((x) => !q || `${x.first} ${x.last} ${x.email} ${[...(x.promos || [])].join(' ')}`.toLowerCase().includes(q)).sort(sorters[sort]);
      const exportCsv = () => {
        const lines = [['name', 'email', 'trainings', 'shows', 'first booking', 'last booking', 'spent (EUR, approx.)', 'checked in', 'member', 'newsletter', 'promo codes'],
          ...rows.map((x) => [`${x.first} ${x.last}`, x.email, x.trainings.size, x.shows.size, x.first_at, x.last_at, Math.round(x.spent), x.checkins, members.get(x.email)?.level || '', subscribed.has(x.email) ? 'yes' : '', [...(x.promos || [])].join(' ')])];
        saveCsv(`iccd-people-${SEGMENTS[seg].label}${q ? `-${q}` : ''}`, lines);
        say(`${rows.length} ${rows.length === 1 ? 'person' : 'people'} exported ✓`);
      };
      return h('div', { class: 'pv' },
        h('div', { class: 'pv-tabs' }, Object.entries(SEGMENTS).map(([k, s]) => h('button', { type: 'button', class: seg === k ? 'active' : '', onclick: () => { seg = k; open = null; draw(); } }, s.label, h('small', {}, index.filter((x) => s.test(x)).length)))),
        h('div', { class: 'pv-compose-row' },
          h('label', { class: 'pv-check-inline' }, 'Sort by ', h('select', { onchange: (e) => { sort = e.target.value; draw(); } }, [['trainings', 'most trainings'], ['recent', 'most recent booking'], ['spent', 'most spent'], ['name', 'name']].map(([v, t]) => h('option', { value: v, selected: sort === v }, t)))),
          h('button', { type: 'button', class: 'btn-small', onclick: exportCsv }, q ? `Export these ${rows.length} (Excel)` : 'Export this list (Excel)')),
        SEGMENT_AUDIENCES.includes(seg) ? emailButtons(`segment:${seg}`, S.label, chosen.map((x) => x.email)) : null,
        h('div', { class: 'pv-subs' }, rows.length ? rows.slice(0, 400).map((x) => h('div', { class: `pv-person-card${open === x.email ? ' open' : ''}` },
          h('button', { type: 'button', class: 'pv-person-sum', onclick: () => { open = open === x.email ? null : x.email; draw(); } },
            h('span', {}, h('b', {}, `${x.first} ${x.last}`), h('br'), h('small', { class: 'muted' }, x.email)),
            h('span', { class: 'pv-stats' },
              h('span', {}, h('b', {}, x.trainings.size), x.trainings.size === 1 ? ' training' : ' trainings'),
              x.shows.size > 0 && h('span', {}, h('b', {}, x.shows.size), x.shows.size === 1 ? ' show' : ' shows'),
              h('span', { class: 'muted' }, `${monthYear(x.first_at)} – ${monthYear(x.last_at)}`),
              h('span', { class: 'muted' }, `about ${euro(x.spent)}`))),
          memberCell(x),
          open === x.email && h('ul', { class: 'pv-bookings' }, x.bookings.sort((a, b) => b.when.localeCompare(a.when)).map((b) => h('li', {}, h('span', { class: 'muted' }, day(b.when)), ' ', b.event, ' · ', short(b.ticket), b.promo && h('span', { class: 'pv-code' }, b.promo))))))
          : [h('p', { class: 'muted' }, 'Nobody found.')]),
        rows.length > 400 && h('p', { class: 'muted' }, `Showing the first 400 of ${rows.length}. Search to find someone.`));
    };

    // ----- promo codes: every code, how often and by whom -----
    const codesPanel = () => {
      const ev = new Map(season.events.map((e) => [e.id, e])), tname = new Map(season.tickets.map((t) => [t.id, t.name]));
      const by = new Map();
      for (const p of season.people) {
        if (!p.promo) continue;
        const c = by.get(p.promo) || { code: p.promo, tickets: [], people: new Set(), first: '9999', last: '' };
        const when = (p.booked || '').slice(0, 10);
        c.tickets.push({ ...p, when, eventName: ev.get(p.event)?.name || '', ticketName: tname.get(p.ticket) || 'Ticket' });
        c.people.add(p.email || p.id);
        if (when && when < c.first) c.first = when;
        if (when > c.last) c.last = when;
        by.set(p.promo, c);
      }
      const all = [...by.values()].filter((c) => !q || c.code.toLowerCase().includes(q) || c.tickets.some((t) => `${t.first} ${t.last} ${t.email}`.toLowerCase().includes(q))).sort((a, b) => b.last.localeCompare(a.last));
      if (!by.size) return h('p', { class: 'muted' }, 'No promo codes used in any event yet.');
      const total = season.people.length, used = season.people.filter((p) => p.promo).length;
      const exportCodes = () => {
        const list = all.flatMap((c) => c.tickets.map((t) => [c.code, t.first, t.last, t.email, t.eventName, t.ticketName, t.when]));
        saveCsv(`iccd-promo-codes${q ? `-${q}` : ''}`, [['promo code', 'first name', 'last name', 'email', 'event', 'ticket', 'booked'], ...list]);
        say(`${list.length} ${list.length === 1 ? 'ticket' : 'tickets'} exported ✓`);
      };
      return h('div', { class: 'pv' },
        h('p', { class: 'muted' }, `${used} of ${total} tickets were booked with a promo code (${by.size} different codes). Newest first; open a code to see who used it.`),
        h('div', { class: 'pv-compose-row' }, h('button', { type: 'button', class: 'btn-small', onclick: exportCodes }, q ? `Export the ${all.length} codes found (Excel)` : 'Export all codes and who used them (Excel)')),
        h('div', { class: 'pv-subs' }, all.map((c) => h('div', { class: `pv-person-card${open === `code:${c.code}` ? ' open' : ''}` },
          h('button', { type: 'button', class: 'pv-person-sum', onclick: () => { open = open === `code:${c.code}` ? null : `code:${c.code}`; draw(); } },
            h('span', {}, h('span', { class: 'pv-code big' }, c.code)),
            h('span', { class: 'pv-stats' },
              h('span', {}, h('b', {}, c.tickets.length), c.tickets.length === 1 ? ' ticket' : ' tickets'),
              h('span', {}, h('b', {}, c.people.size), c.people.size === 1 ? ' person' : ' people'),
              h('span', { class: 'muted' }, c.first === c.last ? day(c.first) : `${day(c.first)} – ${day(c.last)}`))),
          open === `code:${c.code}` && h('ul', { class: 'pv-bookings' }, c.tickets.sort((a, b) => b.when.localeCompare(a.when)).map((t) => h('li', {},
            h('span', { class: 'muted' }, day(t.when)), ' ', h('b', {}, `${t.first} ${t.last}`), ` (${t.email || 'no email'}) · `, t.eventName, ' · ', short(t.ticketName))))))));
    };

    // ----- all events -----
    const eventsPanel = () => {
      if (eventId) return h('div', { class: 'pv' }, h('button', { type: 'button', class: 'btn-small', onclick: () => { eventId = null; tab = null; draw(); } }, '← All events'), h('h3', {}, season.events.find((e) => e.id === eventId)?.name || ''), eventPanel(eventId));
      return h('div', { class: 'pv-subs' }, [...season.events].reverse().map((e) => {
        const ps = season.people.filter((p) => p.event === e.id);
        return h('button', { type: 'button', class: 'pv-event-row', onclick: () => { eventId = e.id; tab = null; draw(); } },
          h('span', {}, h('b', {}, e.name), h('br'), h('small', { class: 'muted' }, `${e.kind === 'show' ? 'Show' : 'Training season'} · ${monthYear(e.start)}`)),
          h('span', {}, h('b', {}, ps.length), ' tickets · ', h('b', {}, uniqueEmails(ps).length), ' people'));
      }));
    };

    const now = index.filter((x) => x.now);
    const newcomers = index.filter((x) => SEGMENTS.newcomers.test(x));
    const returning = now.length - newcomers.length;
    wrap.replaceChildren(
      h('div', { class: 'pv-kpis' },
        h('div', {}, h('b', {}, index.length), h('span', {}, 'people since 2023')),
        h('div', {}, h('b', {}, now.length), h('span', {}, `training this season · ${newcomers.length} new, ${returning} returning`)),
        h('div', {}, h('b', {}, index.filter((x) => SEGMENTS.regulars.test(x)).length), h('span', {}, 'regulars (5+ trainings)')),
        h('div', {}, h('b', {}, index.filter((x) => SEGMENTS.lapsed.test(x)).length), h('span', {}, 'trained before, not this season'))),
      h('div', { class: 'pv-levels' },
        h('span', {}, `From Weezevent: ${season.events.length} events, updated ${new Date(season.at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`),
        h('button', { type: 'button', class: 'btn-small', onclick: () => { wrap.replaceChildren(h('p', { class: 'muted' }, 'Updating from Weezevent…')); start(true); } }, 'Update now')),
      h('div', { class: 'pv-views' }, [['season', 'This season'], ['people', 'People'], ['codes', 'Promo codes'], ['events', 'All events']].map(([v, t]) => h('button', { type: 'button', class: view === v ? 'active' : '', onclick: () => { view = v; tab = null; q = ''; draw(); } }, t))),
      h('input', { type: 'search', class: 'pv-search', placeholder: 'Search by name, email or promo code', value: q, oninput: (e) => { q = e.target.value.toLowerCase(); clearTimeout(wrap.t); wrap.t = setTimeout(() => { draw(); const s = wrap.querySelector('.pv-search'); s.focus(); s.setSelectionRange(s.value.length, s.value.length); }, 250); } }),
      note,
      view === 'season' ? eventPanel(season.current) : view === 'people' ? peoplePanel() : view === 'codes' ? codesPanel() : eventsPanel());
  }
  return wrap;
}
