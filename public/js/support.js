// Support page: live progress of the fundraising campaign. The members service adds up the
// donations made through the Stripe donation links since the campaign started (kept 10 minutes).
const box = document.querySelector('[data-campaign]');
if (box) {
  const { api, lang, from, to, goal, extra, gift, gifts, days, last } = box.dataset;
  const euro = (n) => new Intl.NumberFormat(lang, { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(n);
  const bar = box.querySelector('.campaign-bar');
  const meta = [];
  if (to) {
    const left = Math.ceil((Date.parse(`${to}T23:59:59`) - Date.now()) / 864e5);
    if (left > 1) meta.push(`${left} ${days}`); else if (left === 1) meta.push(last);
  }
  const show = (raised, count) => {
    const total = raised + Number(extra || 0);
    box.querySelector('[data-raised]').textContent = euro(total);
    bar.firstElementChild.style.width = `${Math.min(100, (total / Number(goal)) * 100)}%`;
    bar.setAttribute('aria-valuenow', String(Math.round(total)));
    box.querySelector('[data-meta]').textContent = [count ? `${count} ${count === 1 ? gift : gifts}` : '', ...meta].filter(Boolean).join(' · ');
  };
  show(0, 0);
  fetch(`${api}/donate/progress?from=${encodeURIComponent(from)}${to ? `&to=${encodeURIComponent(to)}` : ''}`)
    .then((r) => (r.ok ? r.json() : null))
    .then((d) => d && show(d.raised, d.gifts))
    .catch(() => {});
}
