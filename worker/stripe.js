// Stripe: monthly subscription for the class recordings (choreographies stay free).
// Secrets: STRIPE_SECRET_KEY (restricted key), STRIPE_WEBHOOK_SECRET (signing secret of the webhook).
// Prices are created in Stripe on first use (see PRICES); a member's level decides which one.

export const PRICES = {
  company: { lookup: 'iccd-classes-company-monthly', cents: 299, name: 'ICCD class recordings · Company member' },
  academy: { lookup: 'iccd-classes-academy-monthly', cents: 999, name: 'ICCD class recordings · Academy member' },
};
const TRIAL_DAYS = 0; // e.g. 30 for a free first month
const ALLOWED = ['active', 'trialing', 'past_due']; // past_due: Stripe is still retrying the payment

const enc = new TextEncoder();
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
const form = (obj, prefix = '') => Object.entries(obj).flatMap(([k, v]) => {
  const key = prefix ? `${prefix}[${k}]` : k;
  return v && typeof v === 'object' ? form(v, key) : v === undefined ? [] : [`${encodeURIComponent(key)}=${encodeURIComponent(v)}`];
}).join('&');

async function stripe(env, path, params, method = params ? 'POST' : 'GET') {
  const r = await fetch(`https://api.stripe.com/v1${path}`, {
    method, headers: { Authorization: `Bearer ${String(env.STRIPE_SECRET_KEY).trim()}`, ...(params ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}) },
    body: params ? (typeof params === 'string' ? params : form(params)) : undefined,
  });
  const d = await r.json();
  if (!r.ok) throw new Error(`Stripe: ${d.error?.message || r.status}`);
  return d;
}

// The monthly price for a level; created in Stripe the first time it is needed
async function priceFor(env, level) {
  const p = PRICES[level] || PRICES.academy;
  const found = (await stripe(env, `/prices?active=true&lookup_keys[]=${p.lookup}&expand[]=data.product`)).data[0];
  if (found) return found;
  const product = await stripe(env, '/products', { name: p.name });
  return stripe(env, '/prices', { product: product.id, currency: 'eur', unit_amount: p.cents, recurring: { interval: 'month' }, lookup_key: p.lookup, tax_behavior: 'inclusive' });
}
export async function priceInfo(env, level) {
  if (!env.STRIPE_SECRET_KEY) return null;
  const cached = await env.PRIVATE.get(`price:${level}`, 'json');
  if (cached && cached.until > Date.now()) return cached;
  const p = await priceFor(env, level);
  const info = { amount: p.unit_amount, currency: p.currency, until: Date.now() + 3600e3 };
  await env.PRIVATE.put(`price:${level}`, JSON.stringify(info), { expirationTtl: 7200 });
  return info;
}

// Subscription state per member, kept up to date by the webhook
const subKey = (email) => `sub:${email}`;
export const getSub = (kv, email) => kv.get(subKey(email), 'json');
export const canWatchClasses = (person, sub) => !!person.free || (!!sub && ALLOWED.includes(sub.status));

async function saveSubscription(env, s, email) {
  const kv = env.PRIVATE;
  email ||= await kv.get(`cust:${s.customer}`);
  if (!email) return;
  const sub = { customer: s.customer, id: s.id, status: s.status, until: (s.current_period_end || s.items?.data?.[0]?.current_period_end || 0) * 1000, cancelAtEnd: !!s.cancel_at_period_end };
  await kv.put(subKey(email), JSON.stringify(sub), { metadata: { status: sub.status, until: sub.until, cancelAtEnd: sub.cancelAtEnd } });
}

// Member actions: start a subscription, or open Stripe's page to cancel / change the card
export async function subscribe(env, person, lang) {
  const kv = env.PRIVATE;
  const price = await priceFor(env, person.level);
  const sub = await getSub(kv, person.email);
  const page = `https://cubandance.co${lang && lang !== 'en' ? '/' + lang : ''}/members/`;
  const session = await stripe(env, '/checkout/sessions', {
    mode: 'subscription',
    line_items: { 0: { price: price.id, quantity: 1 } },
    ...(sub?.customer ? { customer: sub.customer } : { customer_email: person.email }),
    client_reference_id: person.email,
    metadata: { email: person.email, level: person.level },
    subscription_data: { metadata: { email: person.email, level: person.level }, ...(TRIAL_DAYS ? { trial_period_days: TRIAL_DAYS } : {}) },
    allow_promotion_codes: 'true',
    locale: ['es', 'fr', 'it', 'de', 'nl'].includes(lang) ? lang : 'en',
    success_url: `${page}#paid`,
    cancel_url: `${page}#classes`,
  });
  return session.url;
}
export async function portal(env, person, lang) {
  const sub = await getSub(env.PRIVATE, person.email);
  if (!sub?.customer) throw new Error('No subscription yet');
  const page = `https://cubandance.co${lang && lang !== 'en' ? '/' + lang : ''}/members/#classes`;
  return (await stripe(env, '/billing_portal/sessions', { customer: sub.customer, return_url: page, locale: ['es', 'fr', 'it', 'de', 'nl'].includes(lang) ? lang : 'en' })).url;
}

// Stripe calls this when something changes; the signature proves it comes from Stripe
export async function webhook(req, env) {
  const raw = await req.text();
  const parts = Object.fromEntries((req.headers.get('Stripe-Signature') || '').split(',').map((p) => p.split('=')).map(([k, ...v]) => [k, v.join('=')]));
  const all = (req.headers.get('Stripe-Signature') || '').split(',').filter((p) => p.startsWith('v1=')).map((p) => p.slice(3));
  const key = await crypto.subtle.importKey('raw', enc.encode(String(env.STRIPE_WEBHOOK_SECRET).trim()), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const expected = hex(await crypto.subtle.sign('HMAC', key, enc.encode(`${parts.t}.${raw}`)));
  const fresh = Math.abs(Date.now() / 1000 - Number(parts.t)) < 300;
  if (!fresh || !all.includes(expected)) return new Response('Bad signature', { status: 400 });

  const event = JSON.parse(raw);
  const o = event.data.object;
  const kv = env.PRIVATE;
  if (event.type === 'checkout.session.completed' && o.mode === 'subscription') {
    const email = o.metadata?.email || o.client_reference_id;
    await kv.put(`cust:${o.customer}`, email);
    await saveSubscription(env, await stripe(env, `/subscriptions/${o.subscription}`), email);
  }
  if (['customer.subscription.created', 'customer.subscription.updated', 'customer.subscription.deleted'].includes(event.type)) {
    if (o.metadata?.email) await kv.put(`cust:${o.customer}`, o.metadata.email);
    await saveSubscription(env, o, o.metadata?.email);
  }
  return new Response('ok');
}

// For the admin: subscription state of everyone, in one list call
export async function allSubs(kv) {
  const out = {};
  let cursor;
  do {
    const page = await kv.list({ prefix: 'sub:', cursor });
    for (const k of page.keys) out[k.name.slice(4)] = k.metadata || {};
    cursor = page.list_complete ? null : page.cursor;
  } while (cursor);
  return out;
}
