// Members area: a private video library for company and academy dancers.
// Members sign in with their email and a 6-digit code sent by email (valid 10 minutes,
// one use, 5 tries). The member list and the library live only in Cloudflare KV, never
// in the public repository. The organising team edits both from the admin.
//
// Needs: KV binding PRIVATE, secret RESEND_API_KEY, var MAIL_FROM, secret SESSION_SECRET.

import { GUID, playUrl, thumbUrl } from './bunny.js';
import { subscribe, portal, getSub, canWatchClasses, priceInfo, allSubs, paywallFor } from './stripe.js';

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
export { hmac, same, limited, sha, b64url, unb64url, getJSON }; // also used by helpers.js

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
    // looked up again every time, so removing or blocking someone locks them out at once
    return (await getJSON(env.PRIVATE, 'members', [])).find((p) => p.email === e && !p.blocked) || null;
  } catch { return null; }
}

// The code email, in the language the member used on the site
const MAIL = {
  en: { subject: 'is your ICCD members code', hi: 'Hi', intro: 'Your code for the ICCD members area is:', valid: `It works once, for ${CODE_MINUTES} minutes. If you did not ask for it, you can ignore this email.`, open: 'Members area', foot: 'You receive this email because you are on the ICCD members list.' },
  es: { subject: 'es tu código de miembro de ICCD', hi: 'Hola', intro: 'Tu código para el área de miembros de ICCD es:', valid: `Sirve una sola vez, durante ${CODE_MINUTES} minutos. Si no lo has pedido, puedes ignorar este correo.`, open: 'Área de miembros', foot: 'Recibes este correo porque estás en la lista de miembros de ICCD.' },
  fr: { subject: 'est votre code membre ICCD', hi: 'Bonjour', intro: 'Votre code pour l’espace membres de l’ICCD :', valid: `Il fonctionne une seule fois, pendant ${CODE_MINUTES} minutes. Si vous ne l’avez pas demandé, ignorez cet e-mail.`, open: 'Espace membres', foot: 'Vous recevez cet e-mail car vous êtes sur la liste des membres de l’ICCD.' },
  it: { subject: 'è il tuo codice membro ICCD', hi: 'Ciao', intro: 'Il tuo codice per l’area membri dell’ICCD è:', valid: `Vale una sola volta, per ${CODE_MINUTES} minuti. Se non l’hai richiesto, puoi ignorare questa email.`, open: 'Area membri', foot: 'Ricevi questa email perché sei nella lista dei membri dell’ICCD.' },
  de: { subject: 'ist dein ICCD-Mitgliedercode', hi: 'Hallo', intro: 'Dein Code für den ICCD-Mitgliederbereich lautet:', valid: `Er ist nur einmal und ${CODE_MINUTES} Minuten lang gültig. Wenn du ihn nicht angefordert hast, kannst du diese E-Mail ignorieren.`, open: 'Mitgliederbereich', foot: 'Du bekommst diese E-Mail, weil du auf der ICCD-Mitgliederliste stehst.' },
  nl: { subject: 'is je ICCD-ledencode', hi: 'Hoi', intro: 'Je code voor de ICCD-ledenomgeving is:', valid: `Hij werkt één keer, ${CODE_MINUTES} minuten lang. Heb je hem niet aangevraagd? Dan kun je deze e-mail negeren.`, open: 'Ledenomgeving', foot: 'Je krijgt deze e-mail omdat je op de ICCD-ledenlijst staat.' },
};

// Branded HTML email: tables and inline styles, so it looks right in Gmail, Outlook and Apple Mail
const mailHtml = ({ hi, code, m, page }) => `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light only"><title>ICCD</title></head>
<body style="margin:0;padding:0;background:#f3ecdf;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${code} · ${m.valid}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3ecdf;">
<tr><td align="center" style="padding:32px 14px;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:18px;overflow:hidden;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;color:#14110d;">
    <tr><td align="center" style="background:#14110d;padding:28px 14px 24px;">
      <img src="https://cubandance.co/images/logo-512.png" width="64" height="64" alt="ICCD" style="display:block;border:0;width:64px;height:64px;">
      <p style="margin:14px 0 0;font-size:10px;letter-spacing:1.6px;text-transform:uppercase;color:#e8c95f;font-weight:700;">International Company of Cuban Dances</p>
    </td></tr>
    <tr><td style="padding:34px 34px 8px;">
      <p style="margin:0 0 10px;font-size:18px;font-weight:700;">${hi},</p>
      <p style="margin:0;font-size:16px;line-height:1.55;color:#3b352c;">${m.intro}</p>
    </td></tr>
    <tr><td align="center" style="padding:22px 34px;">
      <table role="presentation" cellpadding="0" cellspacing="0" style="background:#fbf1d4;border-radius:14px;">
        <tr><td style="padding:18px 30px;font-family:'SFMono-Regular',Menlo,Consolas,monospace;font-size:38px;font-weight:700;letter-spacing:10px;color:#14110d;">${code}</td></tr>
      </table>
      <p style="margin:14px 0 0;font-size:13px;line-height:1.5;color:#746a5a;">${m.valid}</p>
    </td></tr>
    <tr><td align="center" style="padding:6px 34px 34px;">
      <a href="${page}" style="display:inline-block;background:#e8c95f;color:#14110d;text-decoration:none;font-weight:700;font-size:14px;letter-spacing:1px;text-transform:uppercase;padding:14px 28px;border-radius:999px;">${m.open} &rarr;</a>
    </td></tr>
    <tr><td style="padding:18px 34px 26px;border-top:1px solid #efe6d3;font-size:12px;line-height:1.5;color:#8a8070;" align="center">
      ${m.foot}<br><a href="https://cubandance.co" style="color:#8a8070;">cubandance.co</a>
    </td></tr>
  </table>
</td></tr></table>
</body></html>`;

async function sendCode(env, to, name, code, lang) {
  const L = MAIL[lang] ? lang : 'en', m = MAIL[L];
  const page = `https://cubandance.co${L === 'en' ? '' : '/' + L}/members/`;
  const first = text(name, 80).split(' ')[0];
  const hi = `${m.hi}${first ? ' ' + first : ''}`;
  const safe = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: env.MAIL_FROM, to: [to], reply_to: env.REPLY_TO || 'info@cubandance.co', // replies reach the team
      subject: `${code} ${m.subject}`,
      text: `${hi},\n\n${m.intro} ${code}\n\n${m.valid}\n\n${m.open}: ${page}\n\n--\nInternational Company of Cuban Dances\n${m.foot}`,
      html: mailHtml({ hi: safe(hi), code, m, page }),
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
    const level = LEVELS.includes(p.level) ? p.level : 'company';
    // site: the name under which a company member appears on the website (people.json), for the photo
    return { name: text(p.name, 80), email, level, ...(p.free ? { free: true } : {}), ...(p.blocked ? { blocked: true } : {}), ...(level === 'company' && text(p.site, 80) ? { site: text(p.site, 80) } : {}) };
  });
}
function cleanLibrary(items) {
  if (!Array.isArray(items) || items.length > 3000) throw new Error('Invalid library');
  return items.map((it) => ({
    id: text(it.id, 24) || crypto.randomUUID().slice(0, 8),
    type: it.type === 'class' ? 'class' : 'choreography',
    title: text(it.title, 120), dance: text(it.dance, 80), teacher: text(it.teacher, 120),
    training: text(it.training, 80), date: /^\d{4}-\d{2}-\d{2}$/.test(it.date) ? it.date : '',
    academy: !!it.academy, notes: text(it.notes, 2000), ...(it.type === 'class' && it.free ? { free: true } : {}),
    ...(/^\d{4}-\d{2}-\d{2}$/.test(it.added) ? { added: it.added } : {}),
    // YouTube ids, or Bunny Stream videos (src: 'bunny', id = the video's guid)
    videos: (Array.isArray(it.videos) ? it.videos : []).slice(0, 50)
      .filter((v) => (v.src === 'bunny' ? GUID.test(v.id) : YT.test(v.id)))
      .map((v) => ({ id: v.id, title: text(v.title, 120), ...(v.src === 'bunny' ? { src: 'bunny' } : {}) })),
  }));
}

export async function members(req, env, url, reply, teamOk, helperOk) {
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
    const person = (await getJSON(kv, 'members', [])).find((p) => p.email === email && !p.blocked);
    if (person) {
      const code = String(crypto.getRandomValues(new Uint32Array(1))[0] % 1e6).padStart(6, '0');
      await kv.put(`code:${await sha(email)}`, JSON.stringify({ h: await hmac('code:' + code, env.SESSION_SECRET), tries: 0 }), { expirationTtl: CODE_MINUTES * 60 });
      try { await sendCode(env, email, person.name, code, text(body.lang, 2)); } catch { return reply({ message: 'We could not send the email right now. Please try again later.' }, 502); }
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
      const person = (await getJSON(kv, 'members', [])).find((p) => p.email === email && !p.blocked);
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
    const mine = person.level === 'company' ? items : items.filter((it) => it.academy);
    const sub = await getSub(kv, person.email);
    const paid = !(await paywallFor(env, person.email)) || canWatchClasses(person, sub); // no paywall until Stripe is live (test key: testers only)
    const out = [];
    for (const it of mine) {
      if (it.type === 'class' && !paid && !it.free) { // locked: what it is, but nothing to play (free classes stay open)
        out.push({ ...it, locked: true, videos: it.videos.map((v) => ({ title: v.title, ...(v.src === 'bunny' ? { thumb: thumbUrl(env, v.id) } : {}) })) });
        continue;
      }
      // Bunny videos get a player link that expires after a few hours
      for (const v of it.videos) if (v.src === 'bunny') Object.assign(v, { url: await playUrl(env, v.id), thumb: thumbUrl(env, v.id) });
      out.push(it);
    }
    const price = paid ? null : await priceInfo(env, person.level).catch(() => null);
    return reply({ name: person.name, level: person.level, items: out, classes: { open: paid, free: !!person.free, status: sub?.status || null, until: sub?.until || null, cancelAtEnd: !!sub?.cancelAtEnd, canManage: !!sub?.customer, price } });
  }

  // 3b. Subscription for the class recordings (Stripe): start, or manage (cancel, change card)
  if ((url.pathname === '/m/subscribe' || url.pathname === '/m/manage') && req.method === 'POST') {
    const person = await readMember(req, env);
    if (!person) return reply({ message: 'Please sign in again.' }, 401);
    if (!env.STRIPE_SECRET_KEY) return reply({ message: 'Payments are not set up yet.' }, 503);
    try {
      return reply({ url: url.pathname === '/m/subscribe' ? await subscribe(env, person, text(body.lang, 2)) : await portal(env, person, text(body.lang, 2)) });
    } catch (e) { return reply({ message: e.message }, 502); }
  }

  // 4. Team: read and save the member list and the library
  if (url.pathname === '/m/admin') {
    const team = await teamOk(), helper = team ? null : await helperOk?.();
    if (!team && !helper) return reply({ message: 'Please sign in again' }, 401);
    if (req.method === 'GET' && helper) { // video helpers: the library, no members
      const lib = await getJSON(kv, 'library', { items: [], rev: 0 });
      return reply({ members: [], items: lib.items || [], rev: lib.rev || 0, membersRev: 0, cdn: env.BUNNY_CDN || '', subs: {}, role: 'helper' });
    }
    if (req.method === 'PUT' && helper && body.members) return reply({ message: 'Video helpers can change the videos only.' }, 403);
    if (req.method === 'GET') {
      const lib = await getJSON(kv, 'library', { items: [], rev: 0 });
      return reply({ members: await getJSON(kv, 'members', []), items: lib.items || [], rev: lib.rev || 0, membersRev: Number(await kv.get('members-rev')) || 0, cdn: env.BUNNY_CDN || '', subs: await allSubs(kv) });
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
