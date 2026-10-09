// Mailing list: website sign-up with email confirmation (double opt-in), one-click
// unsubscribe, and emails from the team panel to an audience (newsletter subscribers or
// members-area dancers). Sent through Resend in batches of 100.
// KV: news:<sha(email)> = { email, lang, status: pending|active|unsubscribed, created, confirmed?, source }
//     (status, language and email also as key metadata, so the list needs no extra reads)
//     campaign:<time> = what was sent, to whom (counts only)

const LANGS = ['en', 'es', 'fr', 'it', 'de', 'nl'];
const EMAIL = /^[^\s@<>()",;]+@[^\s@<>()",;]+\.[^\s@<>()",;]{2,}$/;
const API = 'https://iccd-team-editor.iccd-cubandance.workers.dev';
const enc = new TextEncoder();
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
const sha = async (s) => hex(await crypto.subtle.digest('SHA-256', enc.encode(s)));
const b64url = (s) => btoa(String.fromCharCode(...enc.encode(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64url = (s) => new TextDecoder().decode(Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0)));
const norm = (e) => String(e || '').trim().toLowerCase();
const text = (v, max) => String(v ?? '').trim().slice(0, max);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const lang = (l) => (LANGS.includes(l) ? l : 'en');
const page = (l) => `https://cubandance.co${l === 'en' ? '' : '/' + l}/newsletter/`;

async function hmac(value, secret) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', key, enc.encode(value)));
}
// Links in emails: <email in base64url>.<signature>; "c" confirms, "u" unsubscribes
const token = async (kind, email, env) => `${b64url(email)}.${(await hmac(`news-${kind}:${email}`, env.SESSION_SECRET)).slice(0, 32)}`;
async function readToken(kind, t, env) {
  const [a, sig] = String(t || '').split('.');
  if (!a || !sig) return null;
  let email; try { email = unb64url(a); } catch { return null; }
  const want = (await hmac(`news-${kind}:${email}`, env.SESSION_SECRET)).slice(0, 32);
  return want.length === sig.length && [...want].every((c, i) => c === sig[i]) && EMAIL.test(email) ? email : null;
}

async function limited(kv, key, max, seconds) {
  const n = Number(await kv.get(key)) || 0;
  if (n >= max) return true;
  await kv.put(key, String(n + 1), { expirationTtl: seconds });
  return false;
}
const key = async (email) => `news:${await sha(email)}`;
async function save(kv, rec) {
  await kv.put(await key(rec.email), JSON.stringify(rec), { metadata: { e: rec.email, s: rec.status, l: rec.lang, t: rec.confirmed || rec.created, src: rec.source || '' } });
}

// ---------- emails ----------
const WORDS = {
  en: { subject: 'Please confirm your subscription', hi: 'Hello', intro: 'Thank you for signing up for news from the International Company of Cuban Dances: training dates, shows and stories, about once a month.', button: 'Confirm my subscription', ignore: 'If you did not sign up, ignore this email and you will not hear from us.', foot: 'You receive this email because you subscribed on cubandance.co.', unsub: 'Unsubscribe' },
  es: { subject: 'Confirma tu suscripción', hi: 'Hola', intro: 'Gracias por apuntarte a las noticias de la International Company of Cuban Dances: fechas de entrenamientos, espectáculos e historias, más o menos una vez al mes.', button: 'Confirmar mi suscripción', ignore: 'Si no te has apuntado, ignora este correo y no volverás a saber de nosotros.', foot: 'Recibes este correo porque te suscribiste en cubandance.co.', unsub: 'Darse de baja' },
  fr: { subject: 'Merci de confirmer votre inscription', hi: 'Bonjour', intro: 'Merci de vous être inscrit aux nouvelles de l’International Company of Cuban Dances : dates des stages, spectacles et histoires, environ une fois par mois.', button: 'Confirmer mon inscription', ignore: 'Si vous ne vous êtes pas inscrit, ignorez cet e-mail : vous ne recevrez rien de notre part.', foot: 'Vous recevez cet e-mail car vous vous êtes inscrit sur cubandance.co.', unsub: 'Se désinscrire' },
  it: { subject: 'Conferma la tua iscrizione', hi: 'Ciao', intro: 'Grazie per esserti iscritto alle novità della International Company of Cuban Dances: date degli stage, spettacoli e storie, circa una volta al mese.', button: 'Conferma la mia iscrizione', ignore: 'Se non ti sei iscritto, ignora questa email e non riceverai altro da noi.', foot: 'Ricevi questa email perché ti sei iscritto su cubandance.co.', unsub: 'Annulla l’iscrizione' },
  de: { subject: 'Bitte bestätige dein Abonnement', hi: 'Hallo', intro: 'Danke für deine Anmeldung zu den Neuigkeiten der International Company of Cuban Dances: Trainingstermine, Shows und Geschichten, etwa einmal im Monat.', button: 'Abonnement bestätigen', ignore: 'Wenn du dich nicht angemeldet hast, ignoriere diese E-Mail. Du hörst dann nichts mehr von uns.', foot: 'Du bekommst diese E-Mail, weil du dich auf cubandance.co angemeldet hast.', unsub: 'Abmelden' },
  nl: { subject: 'Bevestig je inschrijving', hi: 'Hoi', intro: 'Bedankt voor je inschrijving voor het nieuws van de International Company of Cuban Dances: trainingsdata, shows en verhalen, ongeveer één keer per maand.', button: 'Inschrijving bevestigen', ignore: 'Heb je je niet ingeschreven? Negeer deze e-mail, dan hoor je niets meer van ons.', foot: 'Je krijgt deze e-mail omdat je je hebt ingeschreven op cubandance.co.', unsub: 'Uitschrijven' },
};
const MEMBERS_FOOT = 'You receive this email because you are on the ICCD members list.';

// Branded email: tables and inline styles, so it looks right in Gmail, Outlook and Apple Mail
const shell = ({ preview, body, foot }) => `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light only"><title>ICCD</title></head>
<body style="margin:0;padding:0;background:#f3ecdf;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${preview}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3ecdf;">
<tr><td align="center" style="padding:32px 14px;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:18px;overflow:hidden;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;color:#14110d;">
    <tr><td align="center" style="background:#14110d;padding:28px 14px 24px;">
      <img src="https://cubandance.co/images/logo-512.png" width="64" height="64" alt="ICCD" style="display:block;border:0;width:64px;height:64px;">
      <p style="margin:14px 0 0;font-size:10px;letter-spacing:1.6px;text-transform:uppercase;color:#e8c95f;font-weight:700;">International Company of Cuban Dances</p>
    </td></tr>
    <tr><td style="padding:32px 34px 26px;font-size:16px;line-height:1.6;color:#2a251e;">${body}</td></tr>
    <tr><td style="padding:18px 34px 26px;border-top:1px solid #efe6d3;font-size:12px;line-height:1.6;color:#8a8070;" align="center">${foot}</td></tr>
  </table>
</td></tr></table>
</body></html>`;
const button = (href, label) => `<p style="margin:26px 0 6px;"><a href="${href}" style="display:inline-block;background:#e8c95f;color:#14110d;text-decoration:none;font-weight:700;font-size:14px;letter-spacing:1px;text-transform:uppercase;padding:14px 28px;border-radius:999px;">${esc(label)} &rarr;</a></p>`;

// The team writes plain text: blank line = new paragraph, **bold**, [text](https://link), bare links.
// Everything is escaped first, so nothing typed can become HTML.
function format(body) {
  const inline = (s) => esc(s)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" style="color:#2b5b3c;font-weight:700;">$1</a>')
    .replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g, '$1<a href="$2" style="color:#2b5b3c;">$2</a>');
  return body.split(/\n{2,}/).map((p) => `<p style="margin:0 0 16px;">${inline(p.trim()).replace(/\n/g, '<br>')}</p>`).join('');
}
const plain = (body) => body.replace(/\*\*([^*]+)\*\*/g, '$1').replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '$1 ($2)');

async function resend(env, messages) {
  // one call per 100 emails (Resend's batch limit)
  let sent = 0, failed = 0;
  for (let i = 0; i < messages.length; i += 100) {
    const part = messages.slice(i, i + 100);
    const r = await fetch('https://api.resend.com/emails/batch', { method: 'POST', headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify(part) });
    if (r.ok) sent += part.length; else failed += part.length;
  }
  return { sent, failed };
}
const from = (env) => env.NEWS_FROM || 'International Company of Cuban Dances <news@cubandance.co>';

async function sendConfirm(env, email, l) {
  const w = WORDS[l], link = `${page(l)}?c=${await token('c', email, env)}`;
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST', headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: from(env), to: [email], reply_to: 'info@cubandance.co', subject: w.subject,
      text: `${w.hi},\n\n${w.intro}\n\n${w.button}: ${link}\n\n${w.ignore}\n\n--\nInternational Company of Cuban Dances · cubandance.co`,
      html: shell({ preview: esc(w.intro), body: `<p style="margin:0 0 12px;font-size:18px;font-weight:700;">${w.hi},</p><p style="margin:0;">${esc(w.intro)}</p>${button(link, w.button)}<p style="margin:18px 0 0;font-size:13px;color:#746a5a;">${esc(w.ignore)}</p>`, foot: `${esc(w.foot)}<br><a href="https://cubandance.co" style="color:#8a8070;">cubandance.co</a>` }),
    }),
  });
  if (!r.ok) throw new Error(`mail ${r.status}`);
}

// ---------- who receives a campaign ----------
async function allSubscribers(kv) {
  const out = [];
  let cursor;
  do {
    const p = await kv.list({ prefix: 'news:', cursor });
    for (const k of p.keys) if (k.metadata?.e) out.push({ email: k.metadata.e, status: k.metadata.s, lang: k.metadata.l, at: k.metadata.t, source: k.metadata.src || '' });
    cursor = p.list_complete ? null : p.cursor;
  } while (cursor);
  return out;
}
async function audience(env, name, l) {
  const kv = env.PRIVATE;
  const subs = await allSubscribers(kv);
  const off = new Set(subs.filter((s) => s.status === 'unsubscribed').map((s) => s.email));
  let list;
  if (name === 'newsletter') list = subs.filter((s) => s.status === 'active').map((s) => ({ email: s.email, lang: s.lang, kind: 'news' }));
  else if (name.startsWith('members')) {
    const level = name.split(':')[1];
    const members = JSON.parse((await kv.get('members')) || '[]');
    list = members.filter((m) => !level || m.level === level).map((m) => ({ email: m.email, name: m.name, kind: 'members' }));
  } else throw new Error('Unknown audience');
  const seen = new Set();
  return list.filter((p) => !off.has(p.email) && (!l || l === 'all' || p.lang === l) && !seen.has(p.email) && seen.add(p.email));
}

// ---------- routes ----------
// Public: sign up, confirm, unsubscribe (website and email links)
export async function newsPublic(req, env, url, reply) {
  const kv = env.PRIVATE;
  const body = await req.json().catch(() => ({}));
  if (url.pathname === '/news/subscribe' && req.method === 'POST') {
    if (body.website) return reply({ ok: true }); // a field people never see: only robots fill it in
    const email = norm(body.email), l = lang(text(body.lang, 2));
    if (!EMAIL.test(email) || email.length > 200) return reply({ message: 'Please check your email address.' }, 400);
    const ip = req.headers.get('CF-Connecting-IP') || 'unknown';
    if (await limited(kv, `rl:news:ip:${ip}`, 8, 3600) || await limited(kv, `rl:news:mail:${await sha(email)}`, 3, 86400)) return reply({ message: 'Too many attempts. Please try again later.' }, 429);
    const old = JSON.parse((await kv.get(await key(email))) || 'null');
    if (old?.status !== 'active') {
      await save(kv, { email, lang: l, status: 'pending', created: Date.now(), source: text(body.source, 40) || 'website' });
      try { await sendConfirm(env, email, l); } catch { return reply({ message: 'We could not send the confirmation email right now. Please try again later.' }, 502); }
    }
    return reply({ ok: true }); // the same answer whether or not the address was already on the list
  }
  if (url.pathname === '/news/confirm' && req.method === 'POST') {
    const email = await readToken('c', body.token, env);
    const rec = email && JSON.parse((await kv.get(await key(email))) || 'null');
    if (!rec) return reply({ message: 'This link is not valid any more. Please sign up again.' }, 400);
    if (rec.status !== 'active') await save(kv, { ...rec, status: 'active', confirmed: Date.now() });
    return reply({ ok: true, lang: rec.lang });
  }
  if (url.pathname === '/news/unsubscribe' && req.method === 'POST') {
    const email = await readToken('u', body.token, env);
    if (!email) return reply({ message: 'This link is not valid.' }, 400);
    const rec = JSON.parse((await kv.get(await key(email))) || 'null') || { email, lang: 'en', created: Date.now(), source: 'email' };
    await save(kv, { ...rec, status: 'unsubscribed', unsubscribed: Date.now() });
    return reply({ ok: true });
  }
  return null;
}

// Mail apps' one-click unsubscribe (RFC 8058): a POST from the mail provider, without Origin
export async function oneClick(req, env, url) {
  const email = await readToken('u', url.searchParams.get('t'), env);
  if (!email) return new Response('Not valid', { status: 400 });
  const kv = env.PRIVATE;
  const rec = JSON.parse((await kv.get(await key(email))) || 'null') || { email, lang: 'en', created: Date.now(), source: 'email' };
  await save(kv, { ...rec, status: 'unsubscribed', unsubscribed: Date.now() });
  return new Response('Unsubscribed');
}

// Team: the list, removing someone, sending
export async function newsAdmin(req, env, url, reply) {
  const kv = env.PRIVATE;
  if (url.pathname === '/news/admin' && req.method === 'GET') {
    const subscribers = (await allSubscribers(kv)).sort((a, b) => (b.at || 0) - (a.at || 0));
    const camp = await kv.list({ prefix: 'campaign:' });
    const campaigns = camp.keys.map((k) => k.metadata).filter(Boolean).sort((a, b) => b.at - a.at).slice(0, 30);
    const members = JSON.parse((await kv.get('members')) || '[]');
    return reply({ subscribers, campaigns, members: { all: members.length, company: members.filter((m) => m.level === 'company').length, academy: members.filter((m) => m.level === 'academy').length } });
  }
  if (url.pathname === '/news/admin' && req.method === 'DELETE') {
    const email = norm((await req.json().catch(() => ({}))).email);
    await kv.delete(await key(email)); // erased completely (right to be forgotten)
    return reply({ ok: true });
  }
  if (url.pathname === '/news/send' && req.method === 'POST') {
    const b = await req.json().catch(() => ({}));
    const subject = text(b.subject, 150), body = String(b.body || '').replace(/\r\n/g, '\n').trim().slice(0, 20000);
    if (!subject || !body) return reply({ message: 'Write a subject and a message.' }, 400);
    let people;
    if (b.test) {
      const to = norm(b.test);
      if (!EMAIL.test(to)) return reply({ message: 'Check the test email address.' }, 400);
      people = [{ email: to, lang: 'en', kind: 'news' }];
    } else {
      try { people = await audience(env, text(b.audience, 40), text(b.lang, 3)); } catch (e) { return reply({ message: e.message }, 400); }
      if (!people.length) return reply({ message: 'Nobody to send to in this audience.' }, 400);
      if (people.length > 2000) return reply({ message: 'More than 2,000 people: ask for a bigger sending plan first.' }, 400);
      if (Number(b.expect) !== people.length) return reply({ message: `The audience changed: it now has ${people.length} people. Check and send again.`, count: people.length }, 409);
    }
    const html = format(body);
    const messages = await Promise.all(people.map(async (p) => {
      const l = lang(p.lang), w = WORDS[l];
      const unsub = p.kind === 'news' ? `${page(l)}?u=${await token('u', p.email, env)}` : '';
      const foot = p.kind === 'news'
        ? `${esc(w.foot)}<br><a href="${unsub}" style="color:#8a8070;">${esc(w.unsub)}</a> · <a href="https://cubandance.co" style="color:#8a8070;">cubandance.co</a>`
        : `${MEMBERS_FOOT}<br><a href="https://cubandance.co" style="color:#8a8070;">cubandance.co</a>`;
      return {
        from: from(env), to: [p.email], reply_to: 'info@cubandance.co', subject: (b.test ? '[Test] ' : '') + subject,
        html: shell({ preview: esc(plain(body).slice(0, 140)), body: html, foot }),
        text: `${plain(body)}\n\n--\nInternational Company of Cuban Dances · cubandance.co${unsub ? `\n${w.unsub}: ${unsub}` : ''}`,
        ...(unsub ? { headers: { 'List-Unsubscribe': `<${API}/news/one-click?t=${await token('u', p.email, env)}>, <mailto:info@cubandance.co?subject=unsubscribe>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' } } : {}),
      };
    }));
    const result = await resend(env, messages);
    if (!b.test) {
      const at = Date.now();
      const record = { at, subject, audience: text(b.audience, 40), lang: text(b.lang, 3) || 'all', ...result };
      await kv.put(`campaign:${at}`, JSON.stringify({ ...record, body }), { metadata: record });
    }
    return reply(result.failed && !result.sent ? { message: 'Resend refused the emails. Check the sending plan and the domain.' } : result, result.failed && !result.sent ? 502 : 200);
  }
  return null;
}
