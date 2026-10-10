// Video helpers: people the team trusts to sort the recordings, and nothing else.
// The team adds them (name + email) in the panel; they sign in with a 6-digit code sent by email,
// like members. Their session opens only the video tools: the inbox (watch, rename, keep out, flag)
// and the video library of the members area. They cannot delete recordings, nor see members,
// emails, participants or the website files.

import { hmac, same, limited, sha, b64url, unb64url, getJSON } from './members.js';

const HOURS = 12; // how long a helper stays signed in
const CODE_MINUTES = 10;
const EMAIL = /^[^\s@<>()",;]+@[^\s@<>()",;]+\.[^\s@<>()",;]{2,}$/;
const norm = (e) => String(e || '').trim().toLowerCase();
const text = (v, max) => String(v ?? '').trim().slice(0, max);

// What a helper's session may open (everything else answers "not allowed")
export function helperMay(method, path) {
  if (method === 'GET' && ['/bunny/videos', '/bunny/play', '/file', '/m/admin'].includes(path)) return true;
  if (method === 'POST' && ['/bunny/rename', '/bunny/keep', '/bunny/flag'].includes(path)) return true;
  return method === 'PUT' && path === '/m/admin'; // the library only (checked in members.js)
}

// "h.<payload>.<signature>": who and until when; the list is checked again on every request,
// so removing a helper locks them out at once
export async function readHelper(req, env) {
  const [h, payload = '', sig = ''] = (req.headers.get('Authorization') || '').replace(/^Bearer /, '').split('.');
  if (h !== 'h' || !(await same(sig, await hmac('helper:' + payload, env.SESSION_SECRET)))) return null;
  try {
    const { e, x } = JSON.parse(unb64url(payload));
    if (x < Date.now()) return null;
    return (await getJSON(env.PRIVATE, 'helpers', [])).find((p) => p.email === e) || null;
  } catch { return null; }
}

async function sendCode(env, to, name, code) {
  const first = text(name, 80).split(' ')[0];
  const safe = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const page = 'https://cubandance.co/admin/';
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: env.MAIL_FROM, to: [to], reply_to: env.REPLY_TO || 'info@cubandance.co',
      subject: `${code} is your ICCD video helper code`,
      text: `Hi${first ? ' ' + first : ''},\n\nYour code to sort the ICCD videos is ${code}\n\nIt works once, for ${CODE_MINUTES} minutes. If you did not ask for it, you can ignore this email.\n\n${page}\n\n--\nInternational Company of Cuban Dances`,
      html: `<div style="font-family:Helvetica,Arial,sans-serif;font-size:16px;line-height:1.6;color:#14110d;max-width:520px;margin:0 auto;padding:24px;">
        <p>Hi${first ? ' ' + safe(first) : ''},</p><p>Your code to sort the ICCD videos is:</p>
        <p style="font-family:Menlo,Consolas,monospace;font-size:34px;font-weight:700;letter-spacing:8px;margin:12px 0;">${code}</p>
        <p>It works once, for ${CODE_MINUTES} minutes. If you did not ask for it, you can ignore this email.</p>
        <p><a href="${page}" style="color:#2b5b3c;font-weight:700;">Open the video tools</a></p>
        <p style="color:#8a8070;font-size:13px;">International Company of Cuban Dances</p></div>`,
    }),
  });
  if (!r.ok) throw new Error(`mail ${r.status}`);
}

// Public: ask for a code, check it. Team: the list of helpers.
export async function helpers(req, env, url, reply, teamOk) {
  const kv = env.PRIVATE;
  const body = req.method === 'POST' || req.method === 'PUT' ? await req.json().catch(() => ({})) : {};
  const ip = req.headers.get('CF-Connecting-IP') || 'x';

  if (url.pathname === '/h/code' && req.method === 'POST') {
    const email = norm(body.email);
    if (!EMAIL.test(email)) return reply({ message: 'Please check your email address.' }, 400);
    if (await limited(kv, `rl:hip:${ip}`, 10, 3600) || await limited(kv, `rl:hmail:${await sha(email)}`, 3, 900)) {
      return reply({ message: 'Too many codes requested. Please wait a few minutes and try again.' }, 429);
    }
    const person = (await getJSON(kv, 'helpers', [])).find((p) => p.email === email);
    if (person) {
      const code = String(crypto.getRandomValues(new Uint32Array(1))[0] % 1e6).padStart(6, '0');
      await kv.put(`hcode:${await sha(email)}`, JSON.stringify({ h: await hmac('hcode:' + code, env.SESSION_SECRET), tries: 0 }), { expirationTtl: CODE_MINUTES * 60 });
      try { await sendCode(env, email, person.name, code); } catch { return reply({ message: 'We could not send the email right now. Please try again later.' }, 502); }
    }
    return reply({ ok: true }); // the same answer for everyone, so the list stays private
  }

  if (url.pathname === '/h/verify' && req.method === 'POST') {
    const email = norm(body.email), code = String(body.code || '').replace(/\D/g, '');
    const key = `hcode:${await sha(email)}`;
    const saved = await getJSON(kv, key, null);
    if (saved && saved.tries < 5 && code.length === 6 && (await same(saved.h, await hmac('hcode:' + code, env.SESSION_SECRET)))) {
      await kv.delete(key);
      const person = (await getJSON(kv, 'helpers', [])).find((p) => p.email === email);
      if (person) {
        const payload = b64url(JSON.stringify({ e: email, x: Date.now() + HOURS * 3600e3 }));
        return reply({ token: `h.${payload}.${await hmac('helper:' + payload, env.SESSION_SECRET)}`, name: person.name, role: 'helper' });
      }
    }
    if (saved) {
      if (saved.tries + 1 >= 5) await kv.delete(key);
      else await kv.put(key, JSON.stringify({ ...saved, tries: saved.tries + 1 }), { expirationTtl: CODE_MINUTES * 60 });
    }
    await new Promise((r) => setTimeout(r, 1000));
    return reply({ message: 'This code is not right or has expired. Ask for a new one.' }, 401);
  }

  if (url.pathname === '/helpers') {
    if (!(await teamOk())) return reply({ message: 'Please sign in again' }, 401);
    if (req.method === 'GET') return reply({ helpers: await getJSON(kv, 'helpers', []) });
    if (req.method === 'PUT') {
      const list = Array.isArray(body.helpers) ? body.helpers.slice(0, 100) : null;
      if (!list) return reply({ message: 'Invalid list' }, 400);
      const seen = new Set(), out = [];
      for (const p of list) {
        const email = norm(p.email);
        if (!EMAIL.test(email)) return reply({ message: `Check the email of ${text(p.name, 60) || 'a helper'}` }, 400);
        if (seen.has(email)) continue;
        seen.add(email);
        out.push({ name: text(p.name, 80), email, added: text(p.added, 10) || new Date().toISOString().slice(0, 10) });
      }
      await kv.put('helpers', JSON.stringify(out));
      return reply({ helpers: out });
    }
  }
  return null;
}
