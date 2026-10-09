// Weezevent (ticketing): read events and participants with WEEZEVENT_API_KEY.
// probe() is a first look at what the account's API returns: event names and dates,
// and for participants only the FIELD NAMES, never anyone's details.

const BASE = 'https://api.weezevent.com';
const keysOf = (o, depth = 0) => (o && typeof o === 'object' && !Array.isArray(o) && depth < 3
  ? Object.fromEntries(Object.entries(o).map(([k, v]) => [k, Array.isArray(v) ? (v[0] && typeof v[0] === 'object' ? [keysOf(v[0], depth + 1)] : 'list') : v && typeof v === 'object' ? keysOf(v, depth + 1) : typeof v]))
  : typeof o);

// Weezevent needs an access token, given for a login (a separate Weezevent user for the website:
// WEEZEVENT_USERNAME / WEEZEVENT_PASSWORD). Kept in KV for a few hours, renewed when refused.
async function accessToken(env, fresh) {
  const kv = env.PRIVATE;
  if (!fresh) { const t = await kv.get('weezevent:token'); if (t) return t; }
  if (!env.WEEZEVENT_USERNAME || !env.WEEZEVENT_PASSWORD) return '';
  const body = new URLSearchParams({ username: String(env.WEEZEVENT_USERNAME).trim(), password: String(env.WEEZEVENT_PASSWORD), api_key: String(env.WEEZEVENT_API_KEY).trim() });
  const r = await fetch(`${BASE}/auth/access_token`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' }, body });
  const d = await r.json().catch(() => ({}));
  const t = d.accessToken || d.access_token || '';
  if (!t) throw new Error(`Weezevent login refused (${r.status}): ${d.error?.message || d.message || 'check the username and password'}`);
  await kv.put('weezevent:token', t, { expirationTtl: 3 * 3600 });
  return t;
}

async function get(path, env, extra = '', retry = true) {
  const token = await accessToken(env);
  const r = await fetch(`${BASE}${path}${path.includes('?') ? '&' : '?'}api_key=${encodeURIComponent(String(env.WEEZEVENT_API_KEY).trim())}${token ? `&access_token=${encodeURIComponent(token)}` : ''}${extra}`, { headers: { Accept: 'application/json' } });
  if ((r.status === 401 || r.status === 403) && token && retry) { await accessToken(env, true); return get(path, env, extra, false); }
  const t = await r.text();
  let d = null; try { d = JSON.parse(t); } catch { /* not JSON */ }
  return { status: r.status, d, snippet: d ? null : t.slice(0, 200) };
}

export async function probe(env) {
  if (!env.WEEZEVENT_API_KEY) return { message: 'WEEZEVENT_API_KEY is not set' };
  const out = { login: env.WEEZEVENT_USERNAME && env.WEEZEVENT_PASSWORD ? 'set' : 'missing: add WEEZEVENT_USERNAME and WEEZEVENT_PASSWORD' };
  const ev = await get('/events', env, '&include_closed=true&include_without_sales=true&include_not_published=true');
  out.events = { status: ev.status, shape: ev.d ? keysOf(ev.d) : ev.snippet, error: ev.d?.error || ev.d?.message || null };
  const list = ev.d?.events || ev.d?.data || [];
  out.eventList = Array.isArray(list) ? list.slice(0, 40).map((e) => ({ id: e.id, name: e.name || e.title, date: e.date?.start || e.date || e.start_date || null, participants: e.participants ?? null })) : null;
  const first = Array.isArray(list) && list.find((e) => e.id);
  if (first) {
    const pa = await get('/participant/list', env, `&id_event[]=${first.id}&full=1&max=1`);
    out.participants = { status: pa.status, shape: pa.d ? keysOf(pa.d) : pa.snippet, error: pa.d?.error || pa.d?.message || null };
  }
  if (first) {
    const tk = await get('/tickets', env, `&id_event[]=${first.id}`);
    out.tickets = { status: tk.status, shape: tk.d ? keysOf(tk.d) : tk.snippet, error: tk.d?.error || null };
    const names = [];
    const walk = (o) => { if (Array.isArray(o)) o.forEach(walk); else if (o && typeof o === 'object') { if (o.id && o.name && (o.price !== undefined || o.quotas || o.participants !== undefined)) names.push({ id: o.id, name: o.name, price: o.price ?? null, participants: o.participants ?? null }); Object.values(o).forEach(walk); } };
    walk(tk.d);
    out.ticketNames = names.slice(0, 60);
  }
  return out;
}

// ---------- all events: tickets and participants (team panel, analytics, mailing audiences) ----------
// Every event and its ticket types; refunded and deleted tickets are left out. Events more than
// four months old no longer change: they are kept 30 days. Recent ones are asked again after 10 minutes.
const SHOW = /ra[ií]ces|sabor|show|spectacle/i;
const kindOfEvent = (name) => (SHOW.test(name) ? 'show' : 'training');
async function eventData(env, e) {
  const tickets = [], people = [];
  const tk = await get('/tickets', env, `&id_event[]=${e.id}`);
  for (const te of tk.d?.events || []) for (const cat of te.categories || []) for (const t of cat.tickets || []) tickets.push({ id: String(t.id), name: String(t.name || '').trim(), price: Number(t.price) || 0, event: e.id });
  for (let page = 1; page <= 20; page++) {
    const pa = await get('/participant/list', env, `&id_event[]=${e.id}&full=1&max=500&page=${page}`);
    const list = pa.d?.participants || [];
    for (const p of list) {
      if (p.deleted === '1' || p.refund === '1' || p.deleted === true || p.refund === true) continue;
      const o = p.owner || {}, b = p.buyer || {};
      people.push({
        id: String(p.id_participant), ticket: String(p.id_ticket), event: e.id,
        first: String(o.first_name || b.acheteur_first_name || '').trim(), last: String(o.last_name || b.acheteur_last_name || '').trim(),
        email: String(o.email || b.email_acheteur || '').trim().toLowerCase(),
        promo: String(p.promo_code || '').trim().toUpperCase(),
        booked: p.create_date || p.transaction_date || '', scanned: p.control_status?.status === '1' || !!p.control_status?.scan_date,
      });
    }
    if (list.length < 500) break;
  }
  return { tickets, people };
}
export async function history(env, fresh) {
  const kv = env.PRIVATE;
  if (!env.WEEZEVENT_API_KEY || !env.WEEZEVENT_USERNAME) return { connected: false, at: Date.now(), events: [], tickets: [], people: [] };
  if (!fresh) { const c = await kv.get('weezevent:history2', 'json'); if (c) return c; }
  const ev = await get('/events', env, '&include_closed=true&include_without_sales=true&include_not_published=true');
  if (ev.status !== 200) throw new Error(ev.d?.error?.message || `Weezevent answered ${ev.status}`);
  const events = (ev.d?.events || []).map((e) => ({ id: e.id, name: String(e.name || '').trim(), start: e.date?.start || '', end: e.date?.end || '', kind: kindOfEvent(e.name) }))
    .sort((a, b) => a.start.localeCompare(b.start));
  const tickets = [], people = [];
  const old = Date.now() - 120 * 864e5;
  for (const e of events) {
    const key = `weezevent:event2:${e.id}`;
    const last = Date.parse((e.end || e.start || '').replace(' ', 'T')) || Date.now();
    let d = last < old && !fresh ? await kv.get(key, 'json') : null;
    if (!d) { d = await eventData(env, e); if (last < old) await kv.put(key, JSON.stringify(d), { expirationTtl: 30 * 86400 }); }
    tickets.push(...d.tickets); people.push(...d.people);
  }
  const out = { connected: true, at: Date.now(), events, tickets, people };
  await kv.put('weezevent:history2', JSON.stringify(out), { expirationTtl: 600 });
  return out;
}
// the current season: the most recent training event (what the Participants tabs open on)
export async function season(env, fresh) {
  const h = await history(env, fresh);
  if (!h.connected) return h;
  const current = [...h.events].reverse().find((e) => e.kind === 'training');
  return { ...h, current: current?.id || null };
}

// Groups used for analytics and mailing audiences, the same in the panel and the service
// the training a ticket is for: its month, and the year written in the name or the season's
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
function ticketMonth(name, ev) {
  const words = String(name).toLowerCase().split(/[\s,:-]+/);
  const m = MONTHS.indexOf(words[0]);
  if (m < 0 || !ev?.start) return null;
  const y0 = Number(ev.start.slice(0, 4)), m0 = Number(ev.start.slice(5, 7));
  const written = words.find((w) => /^20\d\d$/.test(w));
  return `${written ? Number(written) : m + 1 >= m0 ? y0 : y0 + 1}-${String(m + 1).padStart(2, '0')}`;
}
export function segments(h, ym) {
  const kind = new Map(h.events.map((e) => [e.id, e.kind]));
  const evs = new Map(h.events.map((e) => [e.id, e]));
  const tname = new Map(h.tickets.map((t) => [t.id, t.name]));
  const current = [...h.events].reverse().find((e) => e.kind === 'training')?.id;
  const by = new Map();
  for (const p of h.people) {
    if (!p.email) continue;
    const x = by.get(p.email) || { trainings: new Set(), shows: new Set(), now: false, months: new Set() };
    const month = kind.get(p.event) === 'show' ? null : ticketMonth(tname.get(p.ticket) || '', evs.get(p.event));
    if (kind.get(p.event) === 'show') x.shows.add(p.event); else if (month) { x.trainings.add(`${p.event}:${month}`); if (p.event === current) { x.now = true; x.months.add(month); } } // T-shirts and passes are not trainings; 'now' = trains this season
    by.set(p.email, x);
  }
  const pick = (f) => [...by.entries()].filter(([, x]) => f(x)).map(([e]) => e);
  return {
    all: pick(() => true),
    trained: pick((x) => x.trainings.size > 0),
    lapsed: pick((x) => x.trainings.size > 0 && !x.now),
    shows: pick((x) => x.shows.size > 0 && x.trainings.size === 0),
    regulars: pick((x) => x.trainings.size >= 5),
    // trained this season, but no ticket yet for the training of month ym
    unbooked: ym ? pick((x) => x.now && !x.months.has(ym)) : [],
  };
}

// Who of these people booked after a given moment: trainings per month, and shows
// (Weezevent writes local time in Luxembourg / Paris)
const parisTime = (s) => {
  const t = Date.parse(String(s).replace(' ', 'T') + 'Z');
  if (!t) return 0;
  const local = Date.parse(new Date(t).toLocaleString('en-US', { timeZone: 'Europe/Paris' }) + ' UTC');
  return t - (local - t);
};
export function bookingsSince(h, emails, at) {
  const kind = new Map(h.events.map((e) => [e.id, e.kind]));
  const evs = new Map(h.events.map((e) => [e.id, e]));
  const tname = new Map(h.tickets.map((t) => [t.id, t.name]));
  const who = new Set(), months = {}, shows = new Set();
  for (const p of h.people) {
    if (!emails.has(p.email) || parisTime(p.booked) < at) continue;
    if (kind.get(p.event) === 'show') { who.add(p.email); shows.add(p.email); continue; }
    const m = ticketMonth(tname.get(p.ticket) || '', evs.get(p.event));
    if (!m) continue; // T-shirts and passes
    who.add(p.email);
    (months[m] ||= new Set()).add(p.email);
  }
  return { booked: who.size, months: Object.fromEntries(Object.entries(months).map(([m, x]) => [m, x.size])), shows: shows.size };
}

// Add a ticket holder to the members area (the team chooses Company or Academy)
export async function addMember(env, body) {
  const kv = env.PRIVATE;
  const email = String(body.email || '').trim().toLowerCase(), name = String(body.name || '').trim().slice(0, 80);
  const level = body.level === 'academy' ? 'academy' : 'company';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) throw new Error('This participant has no valid email.');
  const members = JSON.parse((await kv.get('members')) || '[]');
  if (members.some((m) => m.email === email)) return { already: true };
  members.unshift({ name, email, level });
  await kv.put('members', JSON.stringify(members));
  await kv.put('members-rev', String((Number(await kv.get('members-rev')) || 0) + 1));
  return { added: true };
}
