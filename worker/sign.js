// Online signatures for association documents (for example a board authorisation).
// The team creates a request (the text and who should sign); the signer opens
// cubandance.co/sign/#<id>, reads it, types their name, draws a signature and signs.
// Kept in KV: the text, its SHA-256, the signature image, time, IP country and browser,
// so the signed record can be turned into a PDF with an audit trail.
// A request can be signed once; nobody can change the text after it was created.

const enc = new TextEncoder();
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
const sha256 = async (s) => hex(await crypto.subtle.digest('SHA-256', enc.encode(s)));
const ID = /^[A-Za-z0-9_-]{24}$/;
const newId = () => btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(18)))).replace(/\+/g, '-').replace(/\//g, '_');
const clean = (s, max) => String(s ?? '').replace(/\r\n/g, '\n').slice(0, max);

// Team only: create a request. Returns the link to send to the signer.
export async function createRequest(env, body) {
  const title = clean(body.title, 200).trim(), text = clean(body.text, 20000).trim(), signer = clean(body.signer, 200).trim(), role = clean(body.role, 200).trim();
  if (!title || !text || !signer) throw new Error('Title, text and signer are needed');
  const id = newId();
  const req = { id, title, text, signer, role, hash: await sha256(`${title}\n\n${text}`), created: Date.now() };
  await env.PRIVATE.put(`sign:${id}`, JSON.stringify(req));
  return { id, url: `https://cubandance.co/sign/#${id}`, hash: req.hash };
}

// Public: what the signer sees (no IP or browser details).
export async function readRequest(env, id) {
  if (!ID.test(id)) return null;
  const r = await env.PRIVATE.get(`sign:${id}`, 'json');
  if (!r) return null;
  return { title: r.title, text: r.text, signer: r.signer, role: r.role, hash: r.hash, signed: r.signed ? { name: r.signed.name, at: r.signed.at } : null };
}

// Public: sign once. The signature is a PNG drawn on the page.
export async function signRequest(env, id, body, req) {
  if (!ID.test(id)) return { status: 404, body: { message: 'This link is not valid.' } };
  const kv = env.PRIVATE, key = `sign:${id}`;
  const r = await kv.get(key, 'json');
  if (!r) return { status: 404, body: { message: 'This link is not valid.' } };
  if (r.signed) return { status: 409, body: { message: 'This document has already been signed.' } };
  const name = clean(body.name, 200).trim(), image = String(body.signature || '');
  if (name.length < 3) return { status: 400, body: { message: 'Please type your full name.' } };
  if (!body.agree) return { status: 400, body: { message: 'Please tick the box to confirm.' } };
  if (!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(image) || image.length < 2000 || image.length > 400000) return { status: 400, body: { message: 'Please draw your signature.' } };
  if (body.hash !== r.hash) return { status: 409, body: { message: 'The document changed. Please reload the page.' } };
  r.signed = {
    name, image, at: Date.now(),
    country: req.headers.get('CF-IPCountry') || '', ip: req.headers.get('CF-Connecting-IP') || '',
    browser: clean(req.headers.get('User-Agent'), 300),
  };
  await kv.put(key, JSON.stringify(r));
  return { status: 200, body: { signed: { name, at: r.signed.at } } };
}

// Team only: the full record, to make the signed PDF.
export async function fullRecord(env, id) {
  if (!ID.test(id)) return null;
  return env.PRIVATE.get(`sign:${id}`, 'json');
}
