// Signature page: loads the document named in the link (#id), lets the signer type their
// name and draw a signature, and sends both to the members service, which keeps the record.
// All text is inserted with textContent (never as HTML).
const root = document.querySelector('.sign');
const API = root.dataset.api;
const id = location.hash.slice(1);
const $ = (s) => root.querySelector(s);
const show = (el, on = true) => { el.hidden = !on; };
const when = (t) => new Date(t).toLocaleString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZoneName: 'short' });

function fail(msg) {
  $('[data-title]').textContent = 'This link cannot be opened';
  $('[data-error]').textContent = msg;
  show($('[data-error]'));
}

function done(signed) {
  show($('[data-form]'), false);
  $('[data-done-text]').textContent = `Signed by ${signed.name} on ${when(signed.at)}.`;
  show($('[data-done]'));
}

// ---------- signature pad ----------
const pad = $('[data-pad]');
const ctx = pad.getContext('2d');
let ink = 0, drawing = false, last = null;
function size() {
  const r = pad.getBoundingClientRect(), k = devicePixelRatio || 1;
  const keep = ink ? pad.toDataURL() : null;
  pad.width = Math.round(r.width * k); pad.height = Math.round(r.height * k);
  ctx.setTransform(k, 0, 0, k, 0, 0);
  ctx.lineWidth = 2.4; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#14110d';
  if (keep) { const img = new Image(); img.onload = () => ctx.drawImage(img, 0, 0, r.width, r.height); img.src = keep; }
}
const at = (e) => { const r = pad.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
pad.addEventListener('pointerdown', (e) => { drawing = true; last = at(e); pad.setPointerCapture(e.pointerId); e.preventDefault(); });
pad.addEventListener('pointermove', (e) => {
  if (!drawing) return;
  const p = at(e);
  ctx.beginPath(); ctx.moveTo(...last); ctx.lineTo(...p); ctx.stroke();
  ink += Math.hypot(p[0] - last[0], p[1] - last[1]); last = p;
});
for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) pad.addEventListener(ev, () => { drawing = false; });
$('[data-clear]').addEventListener('click', () => { ctx.clearRect(0, 0, pad.width, pad.height); ink = 0; });
addEventListener('resize', size);

// ---------- load the document ----------
let doc = null;
async function load() {
  if (!/^[A-Za-z0-9_-]{24}$/.test(id)) return fail('The link is incomplete. Please open the full link you received.');
  try {
    const r = await fetch(`${API}/sign/${id}`);
    const d = await r.json();
    if (!r.ok) return fail(d.message || 'This link is not valid.');
    doc = d;
  } catch { return fail('The document could not be loaded. Please check your connection and reload the page.'); }
  document.title = `${doc.title} · Signature`;
  $('[data-title]').textContent = doc.title;
  const article = $('[data-doc]');
  for (const para of doc.text.split(/\n{2,}/)) {
    const p = document.createElement('p');
    p.textContent = para.trim();
    article.append(p);
  }
  show(article);
  $('[data-for]').textContent = `To be signed by ${doc.signer}${doc.role ? `, ${doc.role}` : ''}.`;
  show($('[data-for]'));
  $('[data-hash]').textContent = `Document fingerprint (SHA-256): ${doc.hash}`;
  show($('[data-hash]'));
  if (doc.signed) return done(doc.signed);
  show($('[data-form]'));
  $('#sign-name').value = doc.signer;
  size();
}

// ---------- sign ----------
// an old message goes away as soon as the signer changes something
const hideError = () => show($('[data-form-error]'), false);
$('[data-form]').addEventListener('input', hideError);
pad.addEventListener('pointerdown', hideError);
$('[data-form]').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target, err = $('[data-form-error]'), btn = form.querySelector('.sign-btn');
  const name = form.name.value.trim();
  const problem = name.length < 3 ? 'Please type your full name.' : ink < 60 ? 'Please draw your signature in the box.' : !form.agree.checked ? 'Please tick the box to confirm.' : '';
  err.textContent = problem; show(err, !!problem);
  if (problem) return;
  btn.disabled = true; btn.textContent = 'Signing…';
  try {
    const r = await fetch(`${API}/sign/${id}`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, agree: true, hash: doc.hash, signature: pad.toDataURL('image/png') }) });
    const d = await r.json();
    if (!r.ok) throw new Error(d.message || 'The signature could not be saved.');
    done(d.signed);
  } catch (ex) {
    err.textContent = ex.message; show(err);
    btn.disabled = false; btn.textContent = 'Sign';
  }
});

load();
