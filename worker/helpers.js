// Personal sign-in with an email code, for two lists the team keeps in the panel (Members area → Team access):
//  - team members: the same as the team password (everything in the team panel), but personal,
//    so removing someone locks them out at once
//  - video helpers: only the video tools: the inbox (watch, rename, keep out, flag) and the video
//    library of the members area; no deleting, no members, emails, participants or website files
// The team password keeps working as before.

import { hmac, same, limited, sha, b64url, unb64url, getJSON } from './members.js';

const HOURS = 12; // how long a sign-in lasts (like the team password)
const CODE_MINUTES = 10;
const EMAIL = /^[^\s@<>()",;]+@[^\s@<>()",;]+\.[^\s@<>()",;]{2,}$/;
const norm = (e) => String(e || '').trim().toLowerCase();
const text = (v, max) => String(v ?? '').trim().slice(0, max);
const LISTS = { team: 'team-people', helper: 'helpers' }; // KV keys

// What a video helper's session may open (everything else answers "not allowed")
export function helperMay(method, path) {
  if (method === 'GET' && ['/bunny/videos', '/bunny/play', '/file', '/m/admin'].includes(path)) return true;
  if (method === 'POST' && ['/bunny/rename', '/bunny/keep', '/bunny/flag'].includes(path)) return true;
  return method === 'PUT' && path === '/m/admin'; // the library only (checked in members.js)
}

// "<t|h>.<payload>.<signature>": who and until when; the list is checked again on every request
async function readPerson(req, env, role) {
  const mark = role === 'team' ? 't' : 'h';
  const [m, payload = '', sig = ''] = (req.headers.get('Authorization') || '').replace(/^Bearer /, '').split('.');
  if (m !== mark || !(await same(sig, await hmac(`${role}:` + payload, env.SESSION_SECRET)))) return null;
  try {
    const { e, x } = JSON.parse(unb64url(payload));
    if (x < Date.now()) return null;
    return (await getJSON(env.PRIVATE, LISTS[role], [])).find((p) => p.email === e) || null;
  } catch { return null; }
}
export const readHelper = (req, env) => readPerson(req, env, 'helper');
export const readTeamPerson = (req, env) => readPerson(req, env, 'team');

async function sendCode(env, to, name, code, role) {
  const first = text(name, 80).split(' ')[0];
  const safe = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const page = 'https://cubandance.co/admin/';
  const what = role === 'team' ? 'to sign in to the ICCD team area' : 'to sort the ICCD videos';
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: env.MAIL_FROM, to: [to], reply_to: env.REPLY_TO || 'info@cubandance.co',
      subject: `${code} is your ICCD ${role === 'team' ? 'team' : 'video helper'} code`,
      text: `Hi${first ? ' ' + first : ''},\n\nYour code ${what} is ${code}\n\nIt works once, for ${CODE_MINUTES} minutes. If you did not ask for it, you can ignore this email.\n\n${page}\n\n--\nInternational Company of Cuban Dances`,
      html: `<div style="font-family:Helvetica,Arial,sans-serif;font-size:16px;line-height:1.6;color:#14110d;max-width:520px;margin:0 auto;padding:24px;">
        <p>Hi${first ? ' ' + safe(first) : ''},</p><p>Your code ${what} is:</p>
        <p style="font-family:Menlo,Consolas,monospace;font-size:34px;font-weight:700;letter-spacing:8px;margin:12px 0;">${code}</p>
        <p>It works once, for ${CODE_MINUTES} minutes. If you did not ask for it, you can ignore this email.</p>
        <p><a href="${page}" style="color:#2b5b3c;font-weight:700;">Open the team area</a></p>
        <p style="color:#8a8070;font-size:13px;">International Company of Cuban Dances</p></div>`,
    }),
  });
  if (!r.ok) throw new Error(`mail ${r.status}`);
}

// the list an email is on: the team first (someone on both lists gets the team area)
async function find(kv, email) {
  for (const role of ['team', 'helper']) {
    const person = (await getJSON(kv, LISTS[role], [])).find((p) => p.email === email);
    if (person) return { role, person };
  }
  return null;
}
function cleanList(list) {
  if (!Array.isArray(list)) throw new Error('Invalid list');
  const seen = new Set(), out = [];
  for (const p of list.slice(0, 100)) {
    const email = norm(p.email);
    if (!EMAIL.test(email)) throw new Error(`Check the email of ${text(p.name, 60) || 'someone on the list'}`);
    if (seen.has(email)) continue;
    seen.add(email);
    out.push({ name: text(p.name, 80), email, added: text(p.added, 10) || new Date().toISOString().slice(0, 10) });
  }
  return out;
}

// Public: ask for a code, check it. Team: the two lists.
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
    const found = await find(kv, email);
    if (found) {
      const code = String(crypto.getRandomValues(new Uint32Array(1))[0] % 1e6).padStart(6, '0');
      await kv.put(`hcode:${await sha(email)}`, JSON.stringify({ h: await hmac('hcode:' + code, env.SESSION_SECRET), tries: 0 }), { expirationTtl: CODE_MINUTES * 60 });
      try { await sendCode(env, email, found.person.name, code, found.role); } catch { return reply({ message: 'We could not send the email right now. Please try again later.' }, 502); }
    }
    return reply({ ok: true }); // the same answer for everyone, so the lists stay private
  }

  if (url.pathname === '/h/verify' && req.method === 'POST') {
    const email = norm(body.email), code = String(body.code || '').replace(/\D/g, '');
    const key = `hcode:${await sha(email)}`;
    const saved = await getJSON(kv, key, null);
    if (saved && saved.tries < 5 && code.length === 6 && (await same(saved.h, await hmac('hcode:' + code, env.SESSION_SECRET)))) {
      await kv.delete(key);
      const found = await find(kv, email); // checked again: still on a list, and which one
      if (found) {
        const payload = b64url(JSON.stringify({ e: email, x: Date.now() + HOURS * 3600e3 }));
        const mark = found.role === 'team' ? 't' : 'h';
        return reply({ token: `${mark}.${payload}.${await hmac(`${found.role}:` + payload, env.SESSION_SECRET)}`, name: found.person.name, role: found.role });
      }
    }
    if (saved) {
      if (saved.tries + 1 >= 5) await kv.delete(key);
      else await kv.put(key, JSON.stringify({ ...saved, tries: saved.tries + 1 }), { expirationTtl: CODE_MINUTES * 60 });
    }
    await new Promise((r) => setTimeout(r, 1000));
    return reply({ message: 'This code is not right or has expired. Ask for a new one.' }, 401);
  }

  // the team's lists (team members and video helpers), saved at once
  if (url.pathname === '/helpers') {
    if (!(await teamOk())) return reply({ message: 'Please sign in again' }, 401);
    const both = async () => ({ helpers: await getJSON(kv, LISTS.helper, []), team: await getJSON(kv, LISTS.team, []) });
    if (req.method === 'GET') return reply(await both());
    if (req.method === 'PUT') {
      try {
        if (body.helpers) await kv.put(LISTS.helper, JSON.stringify(cleanList(body.helpers)));
        if (body.team) await kv.put(LISTS.team, JSON.stringify(cleanList(body.team)));
      } catch (e) { return reply({ message: e.message }, 400); }
      return reply(await both());
    }
  }
  return null;
}
