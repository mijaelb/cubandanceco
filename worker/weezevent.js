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
  const ev = await get('/events', env);
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

// ---------- this season's participants (team panel, mailing audiences) ----------
// Every ticket type sits under the season's event(s); refunded and deleted tickets are left out.
// Kept 10 minutes in KV so the panel and a send use the same list without asking Weezevent twice.
export async function season(env, fresh) {
  const kv = env.PRIVATE;
  if (!fresh) { const c = await kv.get('weezevent:season', 'json'); if (c) return c; }
  if (!env.WEEZEVENT_API_KEY || !env.WEEZEVENT_USERNAME) return { connected: false, at: Date.now(), events: [], tickets: [], people: [] };
  const ev = await get('/events', env);
  if (ev.status !== 200) throw new Error(ev.d?.error?.message || `Weezevent answered ${ev.status}`);
  const events = (ev.d?.events || []).map((e) => ({ id: e.id, name: e.name, start: e.date?.start || '' }));
  const tickets = [];
  const people = [];
  for (const e of events) {
    const tk = await get('/tickets', env, `&id_event[]=${e.id}`);
    for (const te of tk.d?.events || []) for (const cat of te.categories || []) for (const t of cat.tickets || []) tickets.push({ id: String(t.id), name: String(t.name || '').trim(), price: t.price ?? null, event: e.id });
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
          booked: p.create_date || p.transaction_date || '', paid: !!p.paid, scanned: p.control_status?.status === '1' || !!p.control_status?.scan_date,
        });
      }
      if (list.length < 500) break;
    }
  }
  const out = { connected: true, at: Date.now(), events, tickets, people };
  await kv.put('weezevent:season', JSON.stringify(out), { expirationTtl: 600 });
  return out;
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
