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
  cache = { members: d.members, items: d.items, rev: d.rev, membersRev: d.membersRev, snapM: snap(d.members), snapI: snap(d.items) };
  return cache;
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
    const drawList = () => {
      levels.replaceChildren(...Object.entries(LEVEL).map(([l, text]) => h('span', {}, h('b', {}, cache.members.filter((p) => p.level === l).length), ' ', text)));
      const shown = cache.members.map((p, i) => [p, i]).filter(([p]) => !q || `${p.name} ${p.email}`.toLowerCase().includes(q));
      listEl.replaceChildren(...(shown.length ? shown.map(([p, i]) => h('div', { class: 'pv-person' },
        h('input', { value: p.name, placeholder: 'Name', 'aria-label': 'Name', list: 'pv-names', oninput: (e) => { p.name = e.target.value; changed(); } }),
        h('input', { type: 'email', value: p.email, placeholder: 'name@example.com', 'aria-label': 'Email', oninput: (e) => { p.email = e.target.value.trim(); changed(); } }),
        h('select', { 'aria-label': 'Level', onchange: (e) => { p.level = e.target.value; changed(); drawList(); } },
          Object.keys(LEVEL).map((l) => h('option', { value: l, selected: p.level === l }, l === 'company' ? 'Company' : 'Academy'))),
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
  let tab = 'choreography', q = '', openId = null;
  const trainings = [...ctx.trainings.events, ...ctx.trainings.history].sort((a, b) => b.start.localeCompare(a.start))
    .map((e) => ({ label: `${e.city} · ${ctx.range(e.start, e.end)}`, date: e.start }));

  function editor(it, redraw, changed) {
    const field = (label, input, hint) => h('label', { class: 'pv-field' }, h('span', {}, label), input, hint && h('small', {}, hint));
    const vids = h('div', { class: 'pv-vids' });
    const drawVids = () => vids.replaceChildren(...it.videos.map((v, i) => {
      const prev = h('img', { class: 'pv-thumb', alt: '', src: v.id ? `https://i.ytimg.com/vi/${v.id}/default.jpg` : '' , hidden: !v.id });
      const bad = h('small', { class: 'error', hidden: !!v.id || !v.url }, 'Not a YouTube link');
      return h('div', { class: 'pv-vid' }, prev,
        h('div', { class: 'pv-vid-fields' },
          h('input', { value: v.title, placeholder: `Video ${i + 1} title, e.g. "Full run" or "Part 2 · arms"`, 'aria-label': 'Video title', oninput: (e) => { v.title = e.target.value; changed(); } }),
          h('input', { value: v.url || (v.id ? `https://youtu.be/${v.id}` : ''), placeholder: 'Paste the YouTube link (unlisted)', 'aria-label': 'YouTube link', oninput: (e) => {
            v.url = e.target.value; v.id = ytId(v.url); prev.hidden = !v.id; if (v.id) prev.src = `https://i.ytimg.com/vi/${v.id}/default.jpg`; bad.hidden = !!v.id || !v.url; changed();
          } }), bad),
        h('div', { class: 'pv-vid-tools' },
          iconBtn('up', 'Move up', () => { [it.videos[i - 1], it.videos[i]] = [it.videos[i], it.videos[i - 1]]; changed(); drawVids(); }, { disabled: i === 0 }),
          iconBtn('down', 'Move down', () => { [it.videos[i + 1], it.videos[i]] = [it.videos[i], it.videos[i + 1]]; changed(); drawVids(); }, { disabled: i === it.videos.length - 1 }),
          iconBtn('trash', 'Remove this video', () => { it.videos.splice(i, 1); changed(); drawVids(); }, { class: 'danger' })));
    }), h('button', { type: 'button', class: 'btn-small', onclick: () => { it.videos.push({ title: '', id: '' }); changed(); drawVids(); vids.querySelector('.pv-vid:last-of-type input')?.focus(); } }, icon('plus'), 'Video'));
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
      const it = { id: uid(), type: tab, title: '', dance: '', teacher: '', training: tab === 'class' && last ? last.label : '', date: tab === 'class' && last ? last.date : '', academy: tab === 'class', notes: '', videos: [{ title: '', id: '' }] };
      cache.items.push(it); openId = it.id; changed(); drawList();
      list.querySelector('details[open] input')?.focus();
    };
    const n = (t) => cache.items.filter((it) => it.type === t).length;
    const tabs = h('div', { class: 'pv-tabs' }, [['choreography', 'Choreographies'], ['class', 'Class recordings']].map(([t, label]) =>
      h('button', { type: 'button', class: tab === t ? 'active' : '', onclick: () => { tab = t; openId = null; draw(); } }, label, h('small', {}, n(t)))));
    drawList();
    wrap.replaceChildren(
      h('p', { class: 'muted' }, 'Upload videos to YouTube as "Unlisted", then paste the links here. A choreography can have several videos (full run, parts, details). Class recordings are grouped by training weekend.'),
      tabs,
      h('div', { class: 'pv-tools' },
        h('input', { type: 'search', class: 'pv-search', placeholder: 'Search', value: q, oninput: (e) => { q = e.target.value.toLowerCase(); drawList(); } }),
        h('button', { type: 'button', class: 'btn-small', onclick: addItem }, icon('plus'), tab === 'class' ? 'Class recording' : 'Choreography')),
      list, bar.el);
  }
  return wrap;
}
