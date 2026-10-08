// Members area: a private video library for company and academy dancers.
// Members sign in with their email and a 6-digit code sent by email (valid 10 minutes,
// one use, 5 tries). The member list and the library live only in Cloudflare KV, never
// in the public repository. The organising team edits both from the admin.
//
// Needs: KV binding PRIVATE, secret RESEND_API_KEY, var MAIL_FROM, secret SESSION_SECRET.

const DAYS = 7; // how long a member stays signed in on a device
const CODE_MINUTES = 10;
const LEVELS = ['company', 'academy'];
const YT = /^[\w-]{11}$/;
const EMAIL = /^[^\s@<>()",;]+@[^\s@<>()",;]+\.[^\s@<>()",;]{2,}$/;

const enc = new TextEncoder();
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
const sha = async (s) => hex(await crypto.subtle.digest('SHA-256', enc.encode(s)));
const b64url = (s) => btoa(String.fromCharCode(...enc.encode(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64url = (s) => new TextDecoder().decode(Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0)));
const norm = (e) => String(e || '').trim().toLowerCase();
const text = (v, max) => String(v ?? '').trim().slice(0, max);

async function hmac(value, secret) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', key, enc.encode(value)));
}
async function same(a, b) {
  const [x, y] = await Promise.all([a, b].map((s) => crypto.subtle.digest('SHA-256', enc.encode(String(s)))));
  return crypto.subtle.timingSafeEqual(x, y);
}
const getJSON = async (kv, key, fallback) => JSON.parse((await kv.get(key)) || 'null') ?? fallback;

// Counts requests per key in a time window (KV is eventually consistent: good enough to slow down abuse)
async function limited(kv, key, max, seconds) {
  const n = Number(await kv.get(key)) || 0;
  if (n >= max) return true;
  await kv.put(key, String(n + 1), { expirationTtl: seconds });
  return false;
}

// Member sessions: "m.<payload>.<signature>"; the payload only says who and until when
async function memberToken(email, secret) {
  const payload = b64url(JSON.stringify({ e: email, x: Date.now() + DAYS * 864e5 }));
  return `m.${payload}.${await hmac('member:' + payload, secret)}`;
}
async function readMember(req, env) {
  const [m, payload = '', sig = ''] = (req.headers.get('Authorization') || '').replace(/^Bearer /, '').split('.');
  if (m !== 'm' || !(await same(sig, await hmac('member:' + payload, env.SESSION_SECRET)))) return null;
  try {
    const { e, x } = JSON.parse(unb64url(payload));
    if (x < Date.now()) return null;
    // looked up again every time, so removing someone from the list locks them out at once
    return (await getJSON(env.PRIVATE, 'members', [])).find((p) => p.email === e) || null;
  } catch { return null; }
}

async function sendCode(env, to, name, code) {
  const first = text(name, 80).split(' ')[0] || 'there';
  const safe = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: env.MAIL_FROM, to: [to],
      subject: `${code} is your ICCD members code`,
      text: `Hi ${first},\n\nYour code for the ICCD members area is: ${code}\n\nIt works once, for ${CODE_MINUTES} minutes. If you did not ask for it, you can ignore this email.\n\nInternational Company of Cuban Dances\nhttps://cubandance.co`,
      html: `<div style="font-family:Arial,sans-serif;color:#14110d;max-width:480px">
        <p>Hi ${safe(first)},</p><p>Your code for the ICCD members area is:</p>
        <p style="font-size:34px;font-weight:700;letter-spacing:8px;margin:18px 0">${code}</p>
        <p>It works once, for ${CODE_MINUTES} minutes. If you did not ask for it, you can ignore this email.</p>
        <p style="color:#6f6656">International Company of Cuban Dances · <a href="https://cubandance.co" style="color:#6f6656">cubandance.co</a></p></div>`,
    }),
  });
  if (!r.ok) throw new Error(`mail ${r.status}`);
}

// What the team saves from the admin is checked and trimmed here
function cleanMembers(list) {
  if (!Array.isArray(list) || list.length > 1000) throw new Error('Invalid member list');
  const seen = new Set();
  return list.map((p) => {
    const email = norm(p.email);
    if (!EMAIL.test(email)) throw new Error(`Check the email of ${text(p.name, 60) || 'a member'}`);
    if (seen.has(email)) throw new Error(`${email} is on the list twice`);
    seen.add(email);
    return { name: text(p.name, 80), email, level: LEVELS.includes(p.level) ? p.level : 'company' };
  });
}
function cleanLibrary(items) {
  if (!Array.isArray(items) || items.length > 3000) throw new Error('Invalid library');
  return items.map((it) => ({
    id: text(it.id, 24) || crypto.randomUUID().slice(0, 8),
    type: it.type === 'class' ? 'class' : 'choreography',
    title: text(it.title, 120), dance: text(it.dance, 80), teacher: text(it.teacher, 120),
    training: text(it.training, 80), date: /^\d{4}-\d{2}-\d{2}$/.test(it.date) ? it.date : '',
    academy: !!it.academy, notes: text(it.notes, 2000),
    videos: (Array.isArray(it.videos) ? it.videos : []).slice(0, 50).filter((v) => YT.test(v.id)).map((v) => ({ id: v.id, title: text(v.title, 120) })),
  }));
}

export async function members(req, env, url, reply, teamOk) {
  const kv = env.PRIVATE;
  const ip = req.headers.get('CF-Connecting-IP') || 'unknown';
  const body = req.method === 'GET' ? {} : await req.json().catch(() => ({}));

  // 1. Ask for a code. The answer is the same whether or not the email is on the list.
  if (url.pathname === '/m/code' && req.method === 'POST') {
    const email = norm(body.email);
    if (!EMAIL.test(email)) return reply({ message: 'Please check your email address.' }, 400);
    if (await limited(kv, `rl:ip:${ip}`, 10, 3600) || await limited(kv, `rl:mail:${await sha(email)}`, 3, 900)) {
      return reply({ message: 'Too many codes requested. Please wait a few minutes and try again.' }, 429);
    }
    const person = (await getJSON(kv, 'members', [])).find((p) => p.email === email);
    if (person) {
      const code = String(crypto.getRandomValues(new Uint32Array(1))[0] % 1e6).padStart(6, '0');
      await kv.put(`code:${await sha(email)}`, JSON.stringify({ h: await hmac('code:' + code, env.SESSION_SECRET), tries: 0 }), { expirationTtl: CODE_MINUTES * 60 });
      try { await sendCode(env, email, person.name, code); } catch { return reply({ message: 'We could not send the email right now. Please try again later.' }, 502); }
    }
    return reply({ ok: true });
  }

  // 2. Check the code -> member session for a few days
  if (url.pathname === '/m/verify' && req.method === 'POST') {
    const email = norm(body.email), code = String(body.code || '').replace(/\D/g, '');
    const key = `code:${await sha(email)}`;
    const saved = await getJSON(kv, key, null);
    if (saved && saved.tries < 5 && code.length === 6 && (await same(saved.h, await hmac('code:' + code, env.SESSION_SECRET)))) {
      await kv.delete(key);
      const person = (await getJSON(kv, 'members', [])).find((p) => p.email === email);
      if (person) return reply({ token: await memberToken(email, env.SESSION_SECRET), name: person.name, level: person.level });
    }
    if (saved) {
      if (saved.tries + 1 >= 5) await kv.delete(key);
      else await kv.put(key, JSON.stringify({ ...saved, tries: saved.tries + 1 }), { expirationTtl: CODE_MINUTES * 60 });
    }
    await new Promise((r) => setTimeout(r, 1000));
    return reply({ message: 'This code is not right or has expired. Ask for a new one.' }, 401);
  }

  // 3. The library, as much as this member may see
  if (url.pathname === '/m/library' && req.method === 'GET') {
    const person = await readMember(req, env);
    if (!person) return reply({ message: 'Please sign in again.' }, 401);
    const { items = [] } = await getJSON(kv, 'library', {});
    return reply({ name: person.name, level: person.level, items: person.level === 'company' ? items : items.filter((it) => it.academy) });
  }

  // 4. Team: read and save the member list and the library
  if (url.pathname === '/m/admin') {
    if (!(await teamOk())) return reply({ message: 'Please sign in again' }, 401);
    if (req.method === 'GET') {
      const lib = await getJSON(kv, 'library', { items: [], rev: 0 });
      return reply({ members: await getJSON(kv, 'members', []), items: lib.items || [], rev: lib.rev || 0, membersRev: Number(await kv.get('members-rev')) || 0 });
    }
    if (req.method === 'PUT') {
      try {
        const out = {};
        if (body.members) {
          if ((Number(await kv.get('members-rev')) || 0) !== body.membersRev) return reply({ message: 'Someone else changed the member list in the meantime. Reload the page and try again.' }, 409);
          await kv.put('members', JSON.stringify(cleanMembers(body.members)));
          await kv.put('members-rev', String((out.membersRev = body.membersRev + 1)));
        }
        if (body.items) {
          const lib = await getJSON(kv, 'library', { items: [], rev: 0 });
          if ((lib.rev || 0) !== body.rev) return reply({ message: 'Someone else changed the videos in the meantime. Reload the page and try again.' }, 409);
          const json = JSON.stringify({ items: cleanLibrary(body.items), rev: (out.rev = body.rev + 1) });
          if (json.length > 2_000_000) return reply({ message: 'Too large' }, 413);
          await kv.put('library', json);
        }
        return reply({ ok: true, ...out });
      } catch (e) { return reply({ message: e.message }, 400); }
    }
  }
  return null;
}
