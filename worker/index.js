// ICCD team editor gateway (Cloudflare Worker).
// Lets organisers without a GitHub account edit the trainings / timetables with a
// shared team password. The GitHub key lives only here, as an encrypted secret.
// Also serves the private members area (members.js).
//
// Secrets (set with `npx wrangler secret put NAME`, never committed):
//   TEAM_PASSWORD   the shared password
//   GITHUB_TOKEN    fine-grained token: this repository only, Contents read & write (+ Actions read)
//   SESSION_SECRET  random string used to sign 12-hour sessions
//   RESEND_API_KEY  sends the sign-in codes of the members area

import { members } from './members.js';

const ORIGINS = ['https://cubandance.co', 'https://www.cubandance.co', 'http://localhost:4321'];
const READ = /^src\/(data|i18n)\/[a-z-]+\.json$/;
const WRITE = new Set(['src/data/trainings.json']); // the only file the team password can change
const SESSION_HOURS = 12;

const enc = new TextEncoder();
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function sign(value, secret) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', key, enc.encode(value)));
}
// constant-time comparison of two strings of any length
async function same(a, b) {
  const [x, y] = await Promise.all([a, b].map((s) => crypto.subtle.digest('SHA-256', enc.encode(String(s)))));
  return crypto.subtle.timingSafeEqual(x, y);
}
function toB64(text) {
  const bytes = enc.encode(text);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const origin = req.headers.get('Origin') || '';
    const cors = {
      'Access-Control-Allow-Origin': ORIGINS.includes(origin) ? origin : ORIGINS[0],
      'Access-Control-Allow-Headers': 'Authorization, Content-Type',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
      Vary: 'Origin',
    };
    const reply = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (!ORIGINS.includes(origin)) return reply({ message: 'Forbidden' }, 403);

    const session = async () => `${String(Date.now() + SESSION_HOURS * 3600e3)}`;
    const teamOk = async () => {
      const [exp = '', sig = ''] = (req.headers.get('Authorization') || '').replace(/^Bearer /, '').split('.');
      return !!exp && Number(exp) >= Date.now() && (await same(sig, await sign(exp, env.SESSION_SECRET)));
    };

    // Members area (its own sign-in with email codes)
    if (url.pathname.startsWith('/m/')) return (await members(req, env, url, reply, teamOk)) || reply({ message: 'Not found' }, 404);

    const github = (path, init = {}) => fetch(`https://api.github.com/repos/${env.REPO}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${env.GITHUB_TOKEN}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'iccd-team-editor', ...(init.body ? { 'Content-Type': 'application/json' } : {}) },
    });

    // Sign in with the team password -> signed session valid for a few hours
    if (url.pathname === '/login' && req.method === 'POST') {
      const { password = '' } = await req.json().catch(() => ({}));
      if (!env.TEAM_PASSWORD || !(await same(password, env.TEAM_PASSWORD))) {
        await sleep(1500); // slows down guessing
        return reply({ message: 'Wrong password' }, 401);
      }
      const exp = await session();
      return reply({ token: `${exp}.${await sign(exp, env.SESSION_SECRET)}` });
    }

    // The site owner, signed in to the admin with a GitHub key that can edit this repository,
    // gets the same session (to manage the members area)
    if (url.pathname === '/login-github' && req.method === 'POST') {
      const { token = '' } = await req.json().catch(() => ({}));
      const r = await fetch(`https://api.github.com/repos/${env.REPO}`, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'iccd-team-editor' } });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d.permissions?.push) return reply({ message: 'Not allowed' }, 401);
      const exp = await session();
      return reply({ token: `${exp}.${await sign(exp, env.SESSION_SECRET)}` });
    }

    // Everything else needs a valid session
    if (!(await teamOk())) return reply({ message: 'Please sign in again' }, 401);

    if (url.pathname === '/file' && req.method === 'GET') {
      const path = url.searchParams.get('path') || '';
      if (!READ.test(path)) return reply({ message: 'Not allowed' }, 403);
      const r = await github(`/contents/${path}?ref=main`);
      const d = await r.json();
      return r.ok ? reply({ content: d.content, sha: d.sha }) : reply({ message: d.message }, r.status);
    }

    if (url.pathname === '/file' && req.method === 'PUT') {
      const { path = '', content = '', sha = '', message = '' } = await req.json().catch(() => ({}));
      if (!WRITE.has(path)) return reply({ message: 'Not allowed' }, 403);
      if (content.length > 500_000) return reply({ message: 'Too large' }, 413);
      try { JSON.parse(content); } catch { return reply({ message: 'Invalid content' }, 400); }
      const r = await github(`/contents/${path}`, {
        method: 'PUT',
        body: JSON.stringify({ message: `${String(message).slice(0, 80) || 'Update trainings'} (team editor)`, content: toB64(content), sha, branch: 'main' }),
      });
      const d = await r.json();
      if (r.status === 409) return reply({ message: 'Someone else saved changes in the meantime. Reload the page and apply your edits again.' }, 409);
      return r.ok ? reply({ sha: d.content.sha, commit: d.commit.sha }) : reply({ message: d.message }, r.status);
    }

    if (url.pathname === '/status' && req.method === 'GET') {
      const r = await github(`/actions/runs?head_sha=${encodeURIComponent(url.searchParams.get('sha') || '')}`);
      const d = await r.json().catch(() => ({}));
      const run = d.workflow_runs?.[0];
      return reply({ status: run?.status || 'queued', conclusion: run?.conclusion || null });
    }

    return reply({ message: 'Not found' }, 404);
  },
};
