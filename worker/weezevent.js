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
  return out;
}
