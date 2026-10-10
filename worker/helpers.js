// Personal sign-in for two lists the team keeps in the panel (Members area → Team access):
//  - team members: the same as the team password (everything in the team panel), but personal
//  - video helpers: only the video tools: the inbox (watch, rename, keep out, flag) and the video
//    library of the members area; no deleting, no members, emails, participants or website files
// Each person signs in with their email and an access code the team chose for them beforehand;
// team members also type the team password (both are needed).
// Only a salted, slow hash of the code is kept; removing someone or giving a new code locks the old
// one out at once. The team password alone stops opening the panel as soon as one team member
// has an access code (see teamCodesSet).

import { hmac, same, limited, sha, b64url, unb64url, getJSON } from './members.js';

const HOURS = 12; // how long a sign-in lasts (like the team password)
const EMAIL = /^[^\s@<>()",;]+@[^\s@<>()",;]+\.[^\s@<>()",;]{2,}$/;
const norm = (e) => String(e || '').trim().toLowerCase();
const text = (v, max) => String(v ?? '').trim().slice(0, max);
const LISTS = { team: 'team-people', helper: 'helpers' }; // KV keys
const enc = new TextEncoder();
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

// PBKDF2 with a random salt per person (and the service secret), so a stolen list reveals no codes
async function hashCode(code, salt, env) {
  const key = await crypto.subtle.importKey('raw', enc.encode(`${code}\u0000${env.SESSION_SECRET}`), 'PBKDF2', false, ['deriveBits']);
  return hex(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: enc.encode(salt), iterations: 100000 }, key, 256));
}

// What a video helper's session may open (everything else answers "not allowed")
export function helperMay(method, path) {
  if (method === 'GET' && ['/bunny/videos', '/bunny/play', '/file', '/m/admin'].includes(path)) return true;
  if (method === 'POST' && ['/bunny/rename', '/bunny/keep', '/bunny/flag'].includes(path)) return true;
  return method === 'PUT' && path === '/m/admin'; // the library only (checked in members.js)
}

// "<t|h>.<payload>.<signature>": who, which code and until when. Checked on every request against the
// list: removed, or given a new code since, means signed out.
async function readPerson(req, env, role) {
  const mark = role === 'team' ? 't' : 'h';
  const [m, payload = '', sig = ''] = (req.headers.get('Authorization') || '').replace(/^Bearer /, '').split('.');
  if (m !== mark || !(await same(sig, await hmac(`${role}:` + payload, env.SESSION_SECRET)))) return null;
  try {
    const { e, x, c } = JSON.parse(unb64url(payload));
    if (x < Date.now()) return null;
    const p = (await getJSON(env.PRIVATE, LISTS[role], [])).find((q) => q.email === e);
    return p && p.salt === c ? p : null;
  } catch { return null; }
}
export const readHelper = (req, env) => readPerson(req, env, 'helper');
export const readTeamPerson = (req, env) => readPerson(req, env, 'team');

// once a team member has an access code, the team password alone no longer signs in
export const teamCodesSet = async (env) => (await getJSON(env.PRIVATE, LISTS.team, [])).some((p) => p.hash);

// what the panel may see of a list: never the hashes
const shown = (list) => list.map(({ name, email, added, codeSet }) => ({ name, email, added, hasCode: !!codeSet, codeSet: codeSet || '' }));

// Public: sign in with email + access code. Team: the two lists and their codes.
export async function helpers(req, env, url, reply, teamOk) {
  const kv = env.PRIVATE;
  const body = req.method === 'POST' || req.method === 'PUT' ? await req.json().catch(() => ({})) : {};
  const ip = req.headers.get('CF-Connecting-IP') || 'x';

  // the sign-in page asks whether the team password alone still opens the panel (before the switch)
  if (url.pathname === '/h/mode' && req.method === 'GET') return reply({ passwordOnly: !(await teamCodesSet(env)) });

  if (url.pathname === '/h/login' && req.method === 'POST') {
    const email = norm(body.email), code = String(body.code || '').trim(), password = String(body.password || '');
    const wrong = async () => { await new Promise((r) => setTimeout(r, 1000)); return reply({ message: 'This does not match. Check your email, your access code and (team members) the team password, or ask the team for a new code.' }, 401); };
    if (!EMAIL.test(email) || !code) return wrong();
    // a few tries per person and per place, so codes cannot be guessed
    if (await limited(kv, `rl:lip:${ip}`, 20, 3600) || await limited(kv, `rl:lmail:${await sha(email)}`, 8, 900)) {
      return reply({ message: 'Too many tries. Please wait 15 minutes and try again.' }, 429);
    }
    for (const role of ['team', 'helper']) { // someone on both lists gets the team area
      const p = (await getJSON(kv, LISTS[role], [])).find((q) => q.email === email);
      if (!p) continue;
      // team members: their own code AND the team password; helpers: their own code
      const own = !!p.hash && (await same(p.hash, await hashCode(code, p.salt, env)));
      if (!own) continue;
      if (role === 'team' && !(env.TEAM_PASSWORD && (await same(password, env.TEAM_PASSWORD)))) continue;
      const payload = b64url(JSON.stringify({ e: email, x: Date.now() + HOURS * 3600e3, c: p.salt }));
      const mark = role === 'team' ? 't' : 'h';
      return reply({ token: `${mark}.${payload}.${await hmac(`${role}:` + payload, env.SESSION_SECRET)}`, name: p.name, role });
    }
    return wrong();
  }

  if (url.pathname === '/helpers' || url.pathname === '/helpers/code') {
    if (!(await teamOk())) return reply({ message: 'Please sign in again' }, 401);
    const both = async () => ({ helpers: shown(await getJSON(kv, LISTS.helper, [])), team: shown(await getJSON(kv, LISTS.team, [])) });
    if (url.pathname === '/helpers' && req.method === 'GET') return reply(await both());
    // names and emails (codes stay as they were, matched by email)
    if (url.pathname === '/helpers' && req.method === 'PUT') {
      for (const role of ['team', 'helper']) {
        const incoming = body[role === 'team' ? 'team' : 'helpers'];
        if (!incoming) continue;
        if (!Array.isArray(incoming)) return reply({ message: 'Invalid list' }, 400);
        const old = new Map((await getJSON(kv, LISTS[role], [])).map((p) => [p.email, p]));
        const seen = new Set(), out = [];
        for (const p of incoming.slice(0, 100)) {
          const email = norm(p.email);
          if (!EMAIL.test(email)) return reply({ message: `Check the email of ${text(p.name, 60) || 'someone on the list'}` }, 400);
          if (seen.has(email)) continue;
          seen.add(email);
          const was = old.get(email) || {};
          out.push({ name: text(p.name, 80), email, added: was.added || new Date().toISOString().slice(0, 10), ...(was.hash ? { hash: was.hash, salt: was.salt, codeSet: was.codeSet } : {}) });
        }
        await kv.put(LISTS[role], JSON.stringify(out));
      }
      return reply(await both());
    }
    // give someone an access code (chosen by the team); the old one stops working
    if (url.pathname === '/helpers/code' && req.method === 'POST') {
      const role = body.list === 'team' ? 'team' : 'helper', email = norm(body.email), code = String(body.code || '').trim();
      if (code.length < 6 || code.length > 64) return reply({ message: 'Choose a code of at least 6 characters.' }, 400);
      const list = await getJSON(kv, LISTS[role], []);
      const p = list.find((q) => q.email === email);
      if (!p) return reply({ message: 'This person is not on the list.' }, 404);
      p.salt = crypto.randomUUID();
      p.hash = await hashCode(code, p.salt, env);
      p.codeSet = new Date().toISOString().slice(0, 10);
      await kv.put(LISTS[role], JSON.stringify(list));
      return reply(await both());
    }
  }
  return null;
}
