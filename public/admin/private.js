// Admin sections for the private members area: who can sign in, and the video library.
// Nothing here goes to GitHub: it is saved in the members service (worker/members.js).
// Loaded by admin.js, which passes its helpers in `ctx`.

const LEVEL = { company: 'Company · sees all videos', academy: 'Academy · sees videos marked for the Academy' };
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
  let q = '';
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
      levels.replaceChildren(...Object.entries(LEVEL).map(([l, text]) => h('span', {}, h('b', {}, cache.members.filter((p) => p.level === l).length), ' ', text)), h('span', {}, h('b', {}, paying), ' subscribed to class recordings'), h('span', {}, h('b', {}, cache.members.filter((p) => p.free).length), ' with free access'));
      const shown = cache.members.map((p, i) => [p, i]).filter(([p]) => !q || `${p.name} ${p.email}`.toLowerCase().includes(q));
      listEl.replaceChildren(...(shown.length ? shown.map(([p, i]) => h('div', { class: 'pv-person' },
        h('input', { value: p.name, placeholder: 'Name', 'aria-label': 'Name', list: 'pv-names', oninput: (e) => { p.name = e.target.value; changed(); } }),
        h('input', { type: 'email', value: p.email, placeholder: 'name@example.com', 'aria-label': 'Email', oninput: (e) => { p.email = e.target.value.trim(); changed(); } }),
        h('select', { 'aria-label': 'Level', onchange: (e) => { p.level = e.target.value; changed(); drawList(); } },
          Object.keys(LEVEL).map((l) => h('option', { value: l, selected: p.level === l }, l === 'company' ? 'Company' : 'Academy'))),
        h('label', { class: 'pv-free', title: 'Class recordings without paying (teachers, organisers, special cases)' }, h('input', { type: 'checkbox', checked: !!p.free, onchange: (e) => { if (e.target.checked) p.free = true; else delete p.free; changed(); drawList(); } }), ' Free'),
        subStatus(p),
        iconBtn('trash', `Remove ${p.name || 'this person'}`, () => { if (confirm(`Remove ${p.name || p.email}? They can no longer sign in.`)) { cache.members.splice(i, 1); changed(); drawList(); } }, { class: 'danger' })))
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
      h('p', { class: 'muted' }, 'People on this list can open ', h('a', { href: SITE + '/members/', target: '_blank', rel: 'noopener' }, 'cubandance.co/members'), ' and sign in with a code sent to their email. Removing someone locks them out straight away.'),
      levels,
      h('form', { class: 'pv-add', onsubmit: add }, name, email, level, h('button', { type: 'submit', class: 'btn-small' }, icon('plus'), 'Add')),
      err,
      h('input', { type: 'search', class: 'pv-search', placeholder: 'Search by name or email', oninput: (e) => { q = e.target.value.toLowerCase(); drawList(); } }),
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
