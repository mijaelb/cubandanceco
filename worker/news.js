// Mailing list: website sign-up with email confirmation (double opt-in), one-click
// unsubscribe, and emails from the team panel to an audience (newsletter subscribers or
// members-area dancers). Sent through Resend in batches of 100.
// KV: news:<sha(email)> = { email, lang, status: pending|active|unsubscribed, created, confirmed?, source }
//     (status, language and email also as key metadata, so the list needs no extra reads)
//     campaign:<time> = what was sent, to whom (counts only)

import { history, segments, bookingsSince } from './weezevent.js';

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
const PARTICIPANTS_FOOT = 'You receive this email because you booked a ticket for an ICCD training.';

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
// A paragraph starting with "## " is a section title, "### " a box with a title, "> " a highlighted quote;
// a line "-> [Label](https://…)" is a button (several in a row sit side by side).
// Everything is escaped first, so nothing typed can become HTML.
const HEAD_FONT = "Impact,'Arial Narrow Bold','Arial Narrow','Helvetica Neue',Arial,sans-serif";
function format(body) {
  const inline = (s) => esc(s)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" style="color:#2b5b3c;font-weight:700;">$1</a>')
    .replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g, '$1<a href="$2" style="color:#2b5b3c;">$2</a>');
  const PILL = /^->\s*\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)\s*$/;
  // lines of one paragraph: text lines joined with <br>, button lines grouped into one row
  const lines = (list, size = '') => {
    const out = [];
    let text = [], pills = [];
    const flush = () => {
      if (text.length) out.push(`<p style="margin:0 0 ${pills.length ? 10 : 16}px;${size}">${text.map(inline).join('<br>')}</p>`);
      if (pills.length) out.push(`<p style="margin:4px 0 16px;">${pills.map(([l, u]) => pill(u, l)).join('')}</p>`);
      text = []; pills = [];
    };
    for (const l of list) {
      const m = l.trim().match(PILL);
      if (m) { pills.push([m[1], m[2]]); continue; }
      if (pills.length) flush();
      text.push(l.trim());
    }
    flush();
    return out.join('');
  };
  return String(body).replace(/\r\n?/g, '\n').split(/\n{2,}/).map((p) => {
    const ls = p.trim().split('\n');
    const first = ls[0];
    if (first.startsWith('## ')) return `<p style="margin:34px 0 14px;padding-top:20px;border-top:2px solid #e8c95f;font-family:${HEAD_FONT};font-size:24px;line-height:1.1;text-transform:uppercase;letter-spacing:0.5px;color:#14110d;">${inline(first.slice(3))}</p>${lines(ls.slice(1))}`;
    if (first.startsWith('### ')) return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 14px;background:#fbf6e9;border:1px solid #eadfc6;border-radius:14px;"><tr><td style="padding:18px 20px 4px;">
      <p style="margin:0 0 8px;font-size:17px;font-weight:700;color:#14110d;"><span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:#e8c95f;margin-right:8px;"></span>${inline(first.slice(4))}</p>${lines(ls.slice(1), 'font-size:15px;line-height:1.6;')}</td></tr></table>`;
    if (first.startsWith('> ')) return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:6px 0 22px;"><tr><td style="border-left:4px solid #e8c95f;background:#fbf1d4;border-radius:0 12px 12px 0;padding:16px 22px;font-size:19px;line-height:1.5;font-weight:700;color:#14110d;">${ls.map((l) => inline(l.replace(/^>\s?/, ''))).join('<br>')}</td></tr></table>`;
    if (ls.length === 1 && !PILL.test(first.trim())) return `<p style="margin:0 0 16px;">${inline(first.trim())}</p>`; // a plain paragraph (and the {card} marker) stays as before
    return lines(ls);
  }).join('');
}
// ---------- campaign emails: logo bar, photo, headline band, message, training card, reminders, button ----------
export const PHOTOS = {
  company: 'The company in full costume',
  stage: 'Dancers in costume with live drummers on stage',
  joy: 'Dancers laughing at a training weekend',
  yemaya: 'A dancer in a blue Yemayá costume',
  drums: 'Drummers and singers playing live',
  maestro: 'Leonardo Moya teaching a class',
  havana: 'The company at a training in Havana',
  together: 'Dancers celebrating together after a training',
  weekend: 'The whole group at a training weekend',
  hall: 'A full hall dancing at a training',
  hats: 'Dancers in red costumes and straw hats',
  red: 'Dancers in red Changó costumes',
  green: 'Dancers in green Oggún costumes',
  timba: 'Dancers performing timba on stage',
  rumba: 'Dancers in red on stage in Rome',
  oshun: 'Oshún dancing on stage',
  ship: 'Dancers in white on stage, a ship on the screen behind',
};
const MONTHS3 = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const HEAD = "Impact,'Arial Narrow Bold','Arial Narrow','Helvetica Neue',Arial,sans-serif"; // like the website's Anton
const url = (u) => (/^https:\/\/[^\s"'<>]+$/.test(String(u || '')) ? String(u) : '');
const pill = (href, label, dark) => `<a href="${href}" style="display:inline-block;margin:6px 8px 0 0;background:${dark ? '#14110d' : '#e8c95f'};color:${dark ? '#fbf1d4' : '#14110d'};text-decoration:none;font-weight:700;font-size:13px;letter-spacing:1px;text-transform:uppercase;padding:13px 24px;border-radius:999px;">${esc(label)} &rarr;</a>`;
function cardHtml(c) {
  if (!c || !c.title) return '';
  const row = (label, value) => (value ? `<tr><td style="padding:5px 14px 5px 0;vertical-align:top;font-size:11px;letter-spacing:1.2px;text-transform:uppercase;color:#8a7a52;font-weight:700;white-space:nowrap;">${esc(label)}</td><td style="padding:5px 0;font-size:15px;line-height:1.5;color:#2a251e;">${value}</td></tr>` : '');
  const where = [c.venue && `<strong>${esc(c.venue)}</strong>`, c.address && esc(c.address), c.note && `<span style="color:#746a5a;">${esc(c.note)}</span>`].filter(Boolean).join('<br>');
  const buttons = [url(c.ticketUrl) && pill(url(c.ticketUrl), 'Book your place'), url(c.mapUrl) && pill(url(c.mapUrl), 'Open in Maps', true), url(c.timetableUrl) && pill(url(c.timetableUrl), 'See the timetable', true)].filter(Boolean).join('');
  // calendar tile: "14–15" over "NOV"
  const d1 = /^\d{4}-\d\d-\d\d$/.test(c.start || '') ? c.start : '', d2 = /^\d{4}-\d\d-\d\d$/.test(c.end || '') ? c.end : d1;
  const days = d1 ? (d1 === d2 ? `${+d1.slice(8)}` : d1.slice(5, 7) === d2.slice(5, 7) ? `${+d1.slice(8)}–${+d2.slice(8)}` : `${+d1.slice(8)}/${+d2.slice(8)}`) : '';
  const mon = d1 ? (d1.slice(5, 7) === d2.slice(5, 7) ? MONTHS3[+d1.slice(5, 7) - 1] : `${MONTHS3[+d1.slice(5, 7) - 1]}/${MONTHS3[+d2.slice(5, 7) - 1]}`) : '';
  const tile = days ? `<td class="tile" width="92" style="width:92px;padding:0 18px 0 0;vertical-align:top;">
      <table role="presentation" width="92" cellpadding="0" cellspacing="0" style="width:92px;border-radius:12px;overflow:hidden;">
        <tr><td align="center" style="background:#14110d;color:#e8c95f;font-size:12px;letter-spacing:2px;font-weight:700;padding:7px 0;">${mon}</td></tr>
        <tr><td align="center" style="background:#ffffff;color:#14110d;font-family:${HEAD};font-size:30px;line-height:1;padding:12px 0 6px;">${days}</td></tr>
        <tr><td align="center" style="background:#ffffff;color:#8a7a52;font-size:11px;letter-spacing:1px;padding:0 0 10px;">${d1.slice(0, 4)}</td></tr>
      </table></td>` : '';
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:26px 0 8px;background:#fbf1d4;border-radius:16px;">
    <tr><td class="card-pad" style="padding:22px 22px 24px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>${tile}
        <td class="tile-text" style="vertical-align:top;">
          <p style="margin:0 0 4px;font-size:11px;letter-spacing:1.6px;text-transform:uppercase;color:#2b5b3c;font-weight:700;">${esc(c.label || 'Training weekend')}</p>
          <p style="margin:0 0 10px;font-family:${HEAD};font-size:26px;line-height:1.1;text-transform:uppercase;letter-spacing:0.5px;color:#14110d;">${esc(c.title)}</p>
          <table role="presentation" cellpadding="0" cellspacing="0">${row('When', esc(c.when || ''))}${row('Where', where)}</table>
        </td></tr></table>
      ${buttons ? `<p style="margin:16px 0 0;">${buttons}</p>` : ''}
    </td></tr></table>`;
}
function remindersHtml(list) {
  if (!list?.length) return '';
  return `<p style="margin:26px 0 10px;font-size:11px;letter-spacing:1.6px;text-transform:uppercase;color:#2b5b3c;font-weight:700;">Kind reminders</p>
    <table role="presentation" cellpadding="0" cellspacing="0">${list.map((r) => `<tr><td style="padding:3px 10px 3px 0;vertical-align:top;color:#e8c95f;font-size:18px;line-height:1.2;">&bull;</td><td style="padding:3px 0;font-size:15px;line-height:1.5;color:#2a251e;">${esc(r)}</td></tr>`).join('')}</table>`;
}
const campaignShell = ({ preview, body, foot, photo, eyebrow, headline }) => {
  const pic = PHOTOS[photo] ? photo : 'drums';
  const band = headline ? `<tr><td class="px" style="background:#e8c95f;padding:22px 40px 24px;">
      ${eyebrow ? `<p style="margin:0 0 6px;font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#2b5b3c;font-weight:700;">${esc(eyebrow)}</p>` : ''}
      <p class="big" style="margin:0;font-family:${HEAD};font-size:34px;line-height:1.05;text-transform:uppercase;letter-spacing:0.5px;color:#14110d;">${esc(headline)}</p>
    </td></tr>` : '';
  return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light only"><title>ICCD</title>
<style>@media (max-width:480px){.outer{padding:12px 6px 24px!important}.px{padding-left:22px!important;padding-right:22px!important}.hide-sm{display:none!important}.card-pad{padding:18px!important}.tile,.tile-text{display:block!important;width:auto!important}.tile{padding:0 0 14px!important}.big{font-size:28px!important}}</style></head>
<body style="margin:0;padding:0;background:#efe6d3;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${preview}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#efe6d3;">
<tr><td class="outer" align="center" style="padding:28px 12px 36px;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:20px;overflow:hidden;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;color:#14110d;box-shadow:0 14px 40px rgba(20,17,13,0.12);">
    <tr><td class="px" style="background:#14110d;padding:14px 24px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
        <td style="line-height:0;width:44px;"><img src="https://cubandance.co/images/logo-512.png" width="36" height="36" alt="ICCD" style="display:block;border:0;width:36px;height:36px;"></td>
        <td style="font-size:10px;letter-spacing:2px;text-transform:uppercase;color:#e8c95f;font-weight:700;">International Company of Cuban Dances</td>
        <td class="hide-sm" align="right" style="font-size:11px;"><a href="https://cubandance.co" style="color:#c2b7a2;text-decoration:none;">cubandance.co</a></td>
      </tr></table>
    </td></tr>
    <tr><td style="padding:0;line-height:0;"><img src="https://cubandance.co/images/email/${pic}.jpg" width="600" alt="${esc(PHOTOS[pic])}" style="display:block;width:100%;max-width:600px;height:auto;border:0;"></td></tr>
    ${band}
    <tr><td class="px" style="padding:34px 40px 30px;font-size:16px;line-height:1.65;color:#2a251e;">${body}</td></tr>
    <tr><td class="px" align="center" style="padding:26px 40px 30px;background:#14110d;font-size:12px;line-height:1.7;color:#a99f8c;">
      <img src="https://cubandance.co/images/logo-512.png" width="44" height="44" alt="" style="display:block;border:0;width:44px;height:44px;margin:0 auto 10px;">
      <p style="margin:0 0 4px;font-family:${HEAD};font-size:16px;letter-spacing:1px;text-transform:uppercase;color:#ffffff;">Sharing our love for Cuban music, dance and culture</p>
      <p style="margin:0 0 14px;"><a href="https://www.instagram.com/cuban_dance_international_co/" style="color:#e8c95f;font-weight:700;text-decoration:none;">Instagram</a> &nbsp;&middot;&nbsp; <a href="https://cubandance.co" style="color:#e8c95f;font-weight:700;text-decoration:none;">cubandance.co</a> &nbsp;&middot;&nbsp; <a href="mailto:info@cubandance.co" style="color:#e8c95f;font-weight:700;text-decoration:none;">info@cubandance.co</a></p>
      ${foot.replace(/color:#8a8070/g, 'color:#a99f8c')}
    </td></tr>
  </table>
</td></tr></table>
</body></html>`;
};

// One person's email: {name} becomes their first name ("Hi {name}," becomes "Hi," when there is none)
async function buildMessage(env, p, o) {
  const l = lang(p.lang), w = WORDS[l];
  const first = String(p.name || '').trim().split(/\s+/)[0] || '';
  const personal = (s) => (first ? s.replace(/\{name\}/g, first) : s.replace(/\s*\{name\}/g, ''));
  const body = personal(o.body);
  const unsub = p.kind === 'news' || p.kind === 'participants' ? `${page(l)}?u=${await token('u', p.email, env)}` : '';
  const reason = p.kind === 'news' ? esc(w.foot) : p.kind === 'participants' ? PARTICIPANTS_FOOT : MEMBERS_FOOT;
  const foot = `<p style="margin:0;">${reason}${unsub ? `<br><a href="${unsub}" style="color:#8a8070;">${esc(w.unsub)}</a>` : ''}</p>`;
  // the invitation button is personal: one click subscribes this person (their yes, by email)
  const btnUrl = o.button?.join ? `${page(l)}?j=${await token('j', p.email, env)}` : url(o.button?.url);
  const btn = o.button && btnUrl ? `<p style="margin:28px 0 4px;">${pill(btnUrl, o.button.label || 'Open')}</p>` : '';
  const extra = cardHtml(o.card) + remindersHtml(o.reminders);
  const text1 = format(body), marker = '<p style="margin:0 0 16px;">{card}</p>';
  const main = text1.includes(marker) ? text1.replace(marker, extra ? `<div style="margin:0 0 28px;">${extra}</div>` : '') : text1.replace(/\{card\}/g, '') + extra;
  const html = campaignShell({ preview: esc(plain(body.replace(/\{card\}/g, '')).slice(0, 140)), body: main + btn, foot, photo: o.photo, eyebrow: personal(o.eyebrow || ''), headline: personal(o.headline || '') });
  const card = o.card?.title ? `\n\n${o.card.title}\n${[o.card.when, o.card.venue, o.card.address, o.card.note].filter(Boolean).join('\n')}${url(o.card.mapUrl) ? `\nMap: ${o.card.mapUrl}` : ''}${url(o.card.timetableUrl) ? `\nTimetable: ${o.card.timetableUrl}` : ''}${url(o.card.ticketUrl) ? `\nBook: ${o.card.ticketUrl}` : ''}` : '';
  const rem = o.reminders?.length ? `\n\nKind reminders:\n${o.reminders.map((r) => `- ${r}`).join('\n')}` : '';
  const btnText = o.button && btnUrl ? `\n\n${o.button.label || 'Open'}: ${btnUrl}` : '';
  return {
    from: from(env), to: [p.email], reply_to: 'info@cubandance.co', subject: (o.test ? '[Test] ' : '') + personal(o.subject),
    html, text: `${body.includes('{card}') ? plain(body).replace('{card}', `${card}${rem}`.trim()) : `${plain(body)}${card}${rem}`}${btnText}\n\n--\nInternational Company of Cuban Dances · cubandance.co${unsub ? `\n${w.unsub}: ${unsub}` : ''}`,
    ...(unsub ? { headers: { 'List-Unsubscribe': `<${API}/news/one-click?t=${await token('u', p.email, env)}>, <mailto:info@cubandance.co?subject=unsubscribe>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' } } : {}),
  };
}
// what the team may add to an email, checked and trimmed
function extras(b) {
  const c = b.card && typeof b.card === 'object' ? b.card : null;
  const card = c && text(c.title, 120) ? { start: text(c.start, 10), end: text(c.end, 10), label: text(c.label, 40), title: text(c.title, 120), when: text(c.when, 160), venue: text(c.venue, 160), address: text(c.address, 200), note: text(c.note, 200), mapUrl: url(c.mapUrl), timetableUrl: url(c.timetableUrl), ticketUrl: url(c.ticketUrl) } : null;
  const reminders = Array.isArray(b.reminders) ? b.reminders.map((r) => text(r, 140)).filter(Boolean).slice(0, 12) : [];
  const button = b.button?.join ? { join: true, label: text(b.button.label, 40) || 'Yes, keep me posted' } : b.button && url(b.button.url) ? { label: text(b.button.label, 40) || 'Open', url: url(b.button.url) } : null;
  return { card, reminders, button, photo: PHOTOS[b.photo] ? b.photo : '', eyebrow: text(b.eyebrow, 40), headline: text(b.headline, 70) };
}
const kindOf = (aud) => (String(aud).startsWith('tickets:') || String(aud).startsWith('segment:') ? 'participants' : String(aud).startsWith('members') ? 'members' : 'news');

const plain = (body) => body.replace(/^#{2,3} /gm, '').replace(/^> ?/gm, '').replace(/^-> ?/gm, '').replace(/\*\*([^*]+)\*\*/g, '$1').replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '$1 ($2)');

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
async function audience(env, name, l, invite) {
  const kv = env.PRIVATE;
  const subs = await allSubscribers(kv);
  const off = new Set(subs.filter((s) => s.status === 'unsubscribed').map((s) => s.email));
  let list;
  if (name === 'newsletter') list = subs.filter((s) => s.status === 'active').map((s) => ({ email: s.email, lang: s.lang, kind: 'news' }));
  else if (name.startsWith('members')) {
    const level = name.split(':')[1];
    const members = JSON.parse((await kv.get('members')) || '[]');
    list = members.filter((m) => !m.blocked && (!level || m.level === level)).map((m) => ({ email: m.email, name: m.name, kind: 'members' }));
  } else if (name.startsWith('tickets:')) {
    // participants with one of these Weezevent ticket types (a training, or the whole season)
    const ids = new Set(name.slice(8).split(',').filter(Boolean));
    const h = await history(env);
    const current = [...h.events].reverse().find((e) => e.kind === 'training')?.id;
    list = h.people.filter((p) => p.email && (ids.has('all') ? p.event === current : ids.has(p.ticket))).map((p) => ({ email: p.email, name: `${p.first} ${p.last}`.trim(), kind: 'participants' }));
  } else if (name.startsWith('segment:')) {
    // groups of past and present participants: everyone, lapsed dancers, show audiences, regulars
    const h = await history(env);
    const [segName, ym] = name.slice(8).split(':');
    const wanted = new Set(segments(h, ym)[segName] || []);
    const names = new Map(h.people.map((p) => [p.email, `${p.first} ${p.last}`.trim()]));
    list = [...wanted].map((email) => ({ email, name: names.get(email) || '', kind: 'participants' }));
  } else throw new Error('Unknown audience');
  const seen = new Set();
  const on = invite ? new Set(subs.filter((s) => s.status === 'active').map((s) => s.email)) : new Set();
  return list.filter((p) => !off.has(p.email) && !on.has(p.email) && (!l || l === 'all' || p.lang === l) && !seen.has(p.email) && seen.add(p.email));
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
      try { await sendConfirm(env, email, l); await countSent(kv, 1); } catch { return reply({ message: 'We could not send the confirmation email right now. Please try again later.' }, 502); }
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
  if (url.pathname === '/news/join' && req.method === 'POST') {
    // the "Yes, keep me posted" button of an invitation: the click is the person's consent
    const email = await readToken('j', body.token, env);
    if (!email) return reply({ message: 'This link is not valid.' }, 400);
    const rec = JSON.parse((await kv.get(await key(email))) || 'null');
    if (rec?.status !== 'active') await save(kv, { email, lang: lang(text(body.lang, 2)), status: 'active', created: rec?.created || Date.now(), confirmed: Date.now(), source: 'invitation' });
    return reply({ ok: true });
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

// One campaign: checks, audience, personal emails, Resend, the record in "Sent".
// `scheduled` skips the count check (the audience may have grown since it was planned).
const DAILY = (env) => Number(env.MAIL_DAILY_LIMIT) || 100;
const today = () => new Date().toISOString().slice(0, 10);
const usedToday = async (kv) => Number(await kv.get(`mailcount:${today()}`)) || 0;
async function countSent(kv, n) { if (n) await kv.put(`mailcount:${today()}`, String((await usedToday(kv)) + n), { expirationTtl: 3 * 86400 }); }

async function sendCampaign(env, b, scheduled) {
  const kv = env.PRIVATE;
  const subject = text(b.subject, 150), body = String(b.body || '').replace(/\r\n/g, '\n').trim().slice(0, 20000);
  if (!subject || !body) return { status: 400, body: { message: 'Write a subject and a message.' } };
  let people;
  if (b.test) {
    const to = norm(b.test);
    if (!EMAIL.test(to)) return { status: 400, body: { message: 'Check the test email address.' } };
    people = [{ email: to, lang: 'en', kind: kindOf(b.audience), name: text(b.testName, 40) }];
  } else {
    try { people = await audience(env, text(b.audience, 2000), text(b.lang, 3), !!b.button?.join); } catch (e) { return { status: 400, body: { message: e.message } }; }
    if (!people.length) return { status: 400, body: { message: 'Nobody to send to in this audience.' } };
    if (people.length > 2000) return { status: 400, body: { message: 'More than 2,000 people: ask for a bigger sending plan first.' } };
    if (Array.isArray(b.only)) { const only = new Set(b.only); people = people.filter((p) => only.has(p.email)); } // the rest of a split email
    if (!scheduled && Number(b.expect) !== people.length) return { status: 409, body: { message: `The audience changed: it now has ${people.length} people. Check and send again.`, count: people.length } };
    if (!scheduled && !b.again) {
      const week = Date.now() - 7 * 864e5;
      const twin = (await kv.list({ prefix: 'campaign:' })).keys.map((k) => k.metadata).find((m) => m && m.at > week && m.sent && m.subject === subject && m.audience === text(b.audience, 60));
      if (twin) return { status: 409, body: { message: `"${subject}" was already sent to these people on ${new Date(twin.at).toUTCString().slice(0, 16)}. Not sent again.`, duplicate: true } };
    }
  }
  // a few emails a day stay free for sign-up confirmations and member codes
  const room = Math.max(0, DAILY(env) - (await usedToday(kv)) - 5);
  let rest = [];
  if (!b.test && people.length > room) {
    if (!scheduled) return { status: 400, body: { message: `Today ${room} more emails can be sent (the email service allows ${DAILY(env)} a day). Use Schedule… instead: a big list is then sent in daily portions automatically.`, room } };
    rest = people.slice(room).map((p) => p.email);
    people = people.slice(0, room);
    if (!people.length) return { status: 200, body: { sent: 0, failed: 0, rest } };
  }
  const opts = { subject, body, test: !!b.test, ...extras(b) };
  const messages = await Promise.all(people.map((p) => buildMessage(env, p, opts)));
  const result = await resend(env, messages);
  await countSent(kv, result.sent);
  if (!b.test) {
    const at = Date.now();
    const record = { at, subject, audience: text(b.audience, 60), label: text(b.label, 80), lang: text(b.lang, 3) || 'all', ...(scheduled ? { scheduled: true } : {}), ...(rest.length ? { left: rest.length } : {}), ...result, tracked: true };
    // who got it, to see later who booked afterwards
    await kv.put(`campaign:${at}-${crypto.randomUUID().slice(0, 6)}`, JSON.stringify({ ...record, body, to: people.map((p) => p.email) }), { metadata: record });
  }
  return result.failed && !result.sent ? { status: 502, body: { message: 'Resend refused the emails. Check the sending plan and the domain.' } } : { status: 200, body: { ...result, rest } };
}

// The timer (every 10 minutes): send the scheduled emails that are due
export async function runScheduled(env) {
  const kv = env.PRIVATE;
  const due = (await kv.list({ prefix: 'scheduled:' })).keys.filter((k) => (k.metadata?.at || 0) <= Date.now());
  for (const k of due) {
    const item = await kv.get(k.name, 'json');
    await kv.delete(k.name); // first, so a slow send is never sent twice
    if (item?.payload) {
      const r = await sendCampaign(env, item.payload, true).catch((e) => ({ status: 500, body: { message: e.message } }));
      if (r.status === 200 && r.body.rest?.length) {
        const next = new Date(); next.setUTCDate(next.getUTCDate() + 1); next.setUTCHours(8, 0, 0, 0); // 10:00 in Luxembourg (summer)
        const id = `${next.getTime()}-${crypto.randomUUID().slice(0, 8)}`;
        const meta = { id, at: next.getTime(), subject: item.subject, label: `${item.label.replace(/ \(continued\)$/, '')} (continued)`, lang: item.lang, left: r.body.rest.length };
        await kv.put(`scheduled:${id}`, JSON.stringify({ ...meta, payload: { ...item.payload, only: r.body.rest } }), { metadata: meta });
      }
      if (r.status !== 200) await kv.put(`campaign:${Date.now()}-${crypto.randomUUID().slice(0, 6)}`, JSON.stringify({ subject: item.subject, error: r.body.message }), { metadata: { at: Date.now(), subject: item.subject, label: item.label, sent: 0, failed: 0, error: r.body.message, scheduled: true } });
    }
  }
}

// Team: the list, removing someone, sending
export async function newsAdmin(req, env, url, reply) {
  const kv = env.PRIVATE;
  if (url.pathname === '/news/admin' && req.method === 'GET') {
    const subscribers = (await allSubscribers(kv)).sort((a, b) => (b.at || 0) - (a.at || 0));
    const camp = await kv.list({ prefix: 'campaign:' });
    const campaigns = camp.keys.map((k) => k.metadata).filter(Boolean).sort((a, b) => b.at - a.at).slice(0, 30);
    const scheduled = (await kv.list({ prefix: 'scheduled:' })).keys.map((k) => k.metadata).filter(Boolean).sort((a, b) => a.at - b.at);
    const members = JSON.parse((await kv.get('members')) || '[]').filter((m) => !m.blocked);
    const templates = JSON.parse((await kv.get('templates')) || '[]');
    return reply({ subscribers, campaigns, scheduled, templates, daily: { limit: DAILY(env), used: await usedToday(kv) }, members: { all: members.length, company: members.filter((m) => m.level === 'company').length, academy: members.filter((m) => m.level === 'academy').length } });
  }
  if (url.pathname === '/news/admin' && req.method === 'DELETE') {
    const email = norm((await req.json().catch(() => ({}))).email);
    await kv.delete(await key(email)); // erased completely (right to be forgotten)
    return reply({ ok: true });
  }
  if (url.pathname === '/news/send' && req.method === 'POST') {
    const r = await sendCampaign(env, await req.json().catch(() => ({})));
    return reply(r.body, r.status);
  }
  // Scheduled emails: kept with everything needed, sent by the timer (see runScheduled)
  if (url.pathname === '/news/schedule' && req.method === 'POST') {
    const b = await req.json().catch(() => ({}));
    const at = Date.parse(b.at);
    if (!at || at < Date.now() + 4 * 60e3 || at > Date.now() + 366 * 864e5) return reply({ message: 'Choose a time at least 5 minutes from now, and within a year.' }, 400);
    if (!text(b.subject, 150) || !String(b.body || '').trim()) return reply({ message: 'Write a subject and a message.' }, 400);
    try { if (!(await audience(env, text(b.audience, 2000), text(b.lang, 3), !!b.button?.join)).length) return reply({ message: 'Nobody to send to in this audience.' }, 400); } catch (e) { return reply({ message: e.message }, 400); }
    const id = `${at}-${crypto.randomUUID().slice(0, 8)}`;
    const { test, expect, ...payload } = b;
    const meta = { id, at, subject: text(b.subject, 150), label: text(b.label, 80) || text(b.audience, 60), lang: text(b.lang, 3) || 'all' };
    await kv.put(`scheduled:${id}`, JSON.stringify({ ...meta, payload }), { metadata: meta });
    return reply({ ok: true, ...meta });
  }
  // What each email achieved: of the people who got it, who booked a training or show afterwards (from Weezevent)
  if (url.pathname === '/news/results' && req.method === 'GET') {
    const since = Date.now() - 180 * 864e5;
    const sent = (await kv.list({ prefix: 'campaign:' })).keys.filter((k) => k.metadata?.tracked && k.metadata.sent && k.metadata.at > since);
    if (!sent.length) return reply({ results: {} });
    let h;
    try { h = await history(env); } catch (e) { return reply({ message: e.message }, 502); }
    if (!h.connected) return reply({ results: {} });
    const results = {};
    for (const k of sent) {
      const c = await kv.get(k.name, 'json');
      if (c?.to?.length) results[c.at] = { to: c.to.length, ...bookingsSince(h, new Set(c.to), c.at) };
    }
    return reply({ results, at: h.at });
  }
  // The team's own templates (saved from the composer, shared by everyone in the team)
  if (url.pathname === '/news/templates' && (req.method === 'POST' || req.method === 'DELETE')) {
    const b = await req.json().catch(() => ({}));
    let list = JSON.parse((await kv.get('templates')) || '[]');
    const id = /^[a-z0-9-]{6,40}$/.test(b.id || '') ? b.id : crypto.randomUUID().slice(0, 13);
    list = list.filter((t) => t.id !== id);
    if (req.method === 'POST') {
      if (!text(b.name, 60) || !text(b.subject, 150) || !String(b.body || '').trim()) return reply({ message: 'Give the template a name, a subject and a message.' }, 400);
      if (list.length >= 60) return reply({ message: 'There are 60 saved templates already. Delete one first.' }, 400);
      list.push({ id, name: text(b.name, 60), subject: text(b.subject, 150), body: String(b.body).slice(0, 20000), photo: PHOTOS[b.photo] ? b.photo : '', eyebrow: text(b.eyebrow, 40), headline: text(b.headline, 70),
        card: ['upcoming', 'this'].includes(b.card) ? b.card : '', reminders: !!b.reminders, button: text(b.button, 20), at: Date.now() });
      list.sort((x, y) => x.name.localeCompare(y.name));
    }
    await kv.put('templates', JSON.stringify(list));
    return reply({ templates: list, id });
  }
  if (url.pathname === '/news/schedule' && req.method === 'DELETE') {
    const id = text((await req.json().catch(() => ({}))).id, 80);
    await kv.delete(`scheduled:${id}`);
    return reply({ ok: true });
  }
  if (url.pathname === '/news/preview' && req.method === 'POST') {
    const b = await req.json().catch(() => ({}));
    const sample = { email: 'preview@cubandance.co', lang: 'en', kind: kindOf(b.audience), name: text(b.sampleName, 40) };
    const m = await buildMessage(env, sample, { subject: text(b.subject, 150) || '(no subject)', body: String(b.body || '').slice(0, 20000) || ' ', ...extras(b) });
    const id = crypto.randomUUID();
    await kv.put(`preview:${id}`, m.html, { expirationTtl: 900 });
    return reply({ url: `${API}/news/preview/${id}`, subject: m.subject });
  }
  return null;
}

// The preview page the team panel shows in a frame (random address, gone after 15 minutes)
export async function previewPage(env, id) {
  const html = /^[0-9a-f-]{36}$/.test(id) ? await env.PRIVATE.get(`preview:${id}`) : null;
  return new Response(html || 'This preview has expired.', { status: html ? 200 : 404, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': "default-src 'none'; img-src https://cubandance.co; style-src 'unsafe-inline'; frame-ancestors https://cubandance.co http://localhost:4321", 'Cache-Control': 'no-store' } });
}
