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
import { inbox } from './bunny.js';
import { webhook, setup as stripeSetup, donationProgress } from './stripe.js';
import { createRequest, readRequest, signRequest, fullRecord } from './sign.js';
import { newsPublic, newsAdmin, oneClick, previewPage, runScheduled } from './news.js';
import { probe as weezeventProbe, season as weezeventSeason, addMember as weezeventAddMember } from './weezevent.js';

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
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      Vary: 'Origin',
    };
    const reply = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    // Stripe reports subscription changes here (server to server, checked by its signature)
    if (url.pathname === '/stripe/webhook' && req.method === 'POST') return env.STRIPE_SECRET_KEY ? webhook(req, env) : new Response('Not set up', { status: 503 });
    // Mail apps' one-click unsubscribe comes from the mail provider, without an Origin
    if (url.pathname === '/news/one-click' && req.method === 'POST') return oneClick(req, env, url);
    // Email previews open in the team panel's frame (a GET without Origin; random address, 15 minutes)
    const previewPath = url.pathname.match(/^\/news\/preview\/([0-9a-f-]{36})$/);
    if (previewPath && req.method === 'GET') return previewPage(env, previewPath[1]);
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

    // Support page: progress of the fundraising campaign (public, totals only)
    if (url.pathname === '/donate/progress' && req.method === 'GET') {
      const day = /^20\d\d-\d\d-\d\d$/, from = url.searchParams.get('from') || '', to = url.searchParams.get('to') || '';
      if (!env.STRIPE_SECRET_KEY || !day.test(from) || (to && !day.test(to)) || from < '2026-01-01') return reply({ message: 'Unknown campaign' }, 400);
      try { return reply(await donationProgress(env, from, to)); } catch { return reply({ message: 'Not available right now' }, 502); }
    }

    // Newsletter: sign up, confirm, unsubscribe (from the website and the email links)
    if (url.pathname.startsWith('/news/') && ['/news/subscribe', '/news/confirm', '/news/unsubscribe', '/news/join'].includes(url.pathname)) {
      const r = await newsPublic(req, env, url, reply);
      if (r) return r;
    }

    // Online signatures: the signer reads and signs with the link (cubandance.co/sign/#<id>)
    const signPath = url.pathname.match(/^\/sign\/([A-Za-z0-9_-]{24})$/);
    if (signPath && req.method === 'GET') { const r = await readRequest(env, signPath[1]); return r ? reply(r) : reply({ message: 'This link is not valid.' }, 404); }
    if (signPath && req.method === 'POST') { const r = await signRequest(env, signPath[1], await req.json().catch(() => ({})), req); return reply(r.body, r.status); }

    // Everything else needs a valid session
    if (!(await teamOk())) return reply({ message: 'Please sign in again' }, 401);

    // Weezevent: this season's participants (team only), and adding one to the members area
    if (url.pathname === '/weezevent/participants' && req.method === 'GET') {
      try { return reply(await weezeventSeason(env, url.searchParams.has('fresh'))); } catch (e) { return reply({ message: e.message }, 502); }
    }
    if (url.pathname === '/weezevent/add-member' && req.method === 'POST') {
      try { return reply(await weezeventAddMember(env, await req.json().catch(() => ({})))); } catch (e) { return reply({ message: e.message }, 400); }
    }

    // Weezevent: first look at what the API returns (event names, field names only)
    if (url.pathname === '/weezevent/probe' && req.method === 'GET') {
      try { return reply(await weezeventProbe(env)); } catch (e) { return reply({ message: e.message }, 502); }
    }

    // Mailing list: subscribers, removing someone, sending to an audience
    if (['/news/admin', '/news/send', '/news/preview', '/news/schedule', '/news/templates', '/news/results'].includes(url.pathname)) {
      try { return (await newsAdmin(req, env, url, reply)) || reply({ message: 'Not found' }, 404); } catch (e) { return reply({ message: e.message }, 502); }
    }

    // Online signatures: create a request, read the signed record (for the PDF)
    if (url.pathname === '/sign' && req.method === 'POST') {
      try { return reply(await createRequest(env, await req.json().catch(() => ({})))); } catch (e) { return reply({ message: e.message }, 400); }
    }
    const recordPath = url.pathname.match(/^\/sign\/([A-Za-z0-9_-]{24})\/record$/);
    if (recordPath && req.method === 'GET') { const r = await fullRecord(env, recordPath[1]); return r ? reply(r) : reply({ message: 'Not found' }, 404); }

    // One-time Stripe setup (prices, webhook, customer portal, testers)
    if (url.pathname === '/stripe/setup' && req.method === 'POST') {
      if (!env.STRIPE_SECRET_KEY) return reply({ message: 'Add STRIPE_SECRET_KEY first' }, 503);
      try { return reply(await stripeSetup(env, await req.json().catch(() => ({})))); } catch (e) { return reply({ message: e.message }, 502); }
    }

    // Recordings uploaded to Bunny Stream (team inbox)
    if (url.pathname.startsWith('/bunny/')) {
      try { return (await inbox(req, env, url, reply)) || reply({ message: 'Not found' }, 404); } catch (e) { return reply({ message: e.message }, 502); }
    }

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

  // every 10 minutes: send the emails scheduled in the team panel
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runScheduled(env));
  },
};
