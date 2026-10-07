// Small progressive enhancements for the public site. Everything works without it.
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];

// Mobile menu
const btn = $('[data-menu-btn]'), menu = $('[data-menu]');
btn?.addEventListener('click', () => {
  const open = btn.getAttribute('aria-expanded') !== 'true';
  btn.setAttribute('aria-expanded', String(open));
  menu.hidden = !open;
  document.body.classList.toggle('no-scroll', open);
});

// Solid header after scrolling
const header = $('[data-header]');
const onScroll = () => header?.classList.toggle('scrolled', scrollY > 40);
addEventListener('scroll', onScroll, { passive: true });
onScroll();

// Close the language menu when clicking elsewhere
document.addEventListener('click', (e) => $$('details.lang[open]').forEach((d) => !d.contains(e.target) && d.removeAttribute('open')));

// Reveal sections as they scroll into view
const io = new IntersectionObserver((es) => es.forEach((e) => e.isIntersecting && (e.target.classList.add('in'), io.unobserve(e.target))), { rootMargin: '0px 0px -8% 0px' });
$$('.reveal').forEach((el) => io.observe(el));

// Hide events that already finished (the site is also rebuilt daily)
const today = new Date().toISOString().slice(0, 10);
$$('[data-end]').forEach((el) => el.dataset.end < today && el.remove());

// Click-to-play videos (nothing is downloaded until play)
$$('[data-play]').forEach((b) => b.addEventListener('click', () => {
  const v = $('video', b.parentElement);
  v.controls = true;
  v.play();
  b.remove();
}));

// Gallery: category filters + lightbox
const items = $$('[data-lightbox]');
const dlg = $('[data-lb]');
if (dlg && items.length) {
  const img = $('img', dlg), cap = $('p', dlg);
  let i = 0;
  const visible = () => items.filter((a) => !a.hidden);
  const show = (n) => {
    const v = visible();
    i = (n + v.length) % v.length;
    img.src = v[i].href;
    cap.textContent = img.alt = $('img', v[i]).alt;
  };
  items.forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); dlg.showModal(); show(visible().indexOf(a)); }));
  $$('[data-lb-step]', dlg).forEach((b) => b.addEventListener('click', () => show(i + Number(b.dataset.lbStep))));
  $('[data-lb-close]', dlg).addEventListener('click', () => dlg.close());
  dlg.addEventListener('click', (e) => e.target === dlg && dlg.close());
  addEventListener('keydown', (e) => dlg.open && (e.key === 'ArrowRight' ? show(i + 1) : e.key === 'ArrowLeft' && show(i - 1)));
  $$('[data-filter]').forEach((b) => b.addEventListener('click', () => {
    $$('[data-filter]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    items.forEach((a) => (a.hidden = !!b.dataset.filter && a.dataset.cat !== b.dataset.filter));
  }));
}
