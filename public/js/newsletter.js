// Newsletter page: confirm (?c=…) or unsubscribe (?u=…) from the links in the emails.
// The sign-up form itself is handled by site.js, like the one in the footer.
const root = document.querySelector('.newsletter-page');
const q = new URLSearchParams(location.search);
const [action, token] = q.get('c') ? ['confirm', q.get('c')] : q.get('j') ? ['join', q.get('j')] : q.get('u') ? ['unsubscribe', q.get('u')] : [];

function state(title, text) {
  const box = root.querySelector('[data-state]');
  box.querySelector('[data-state-title]').textContent = title;
  box.querySelector('[data-state-text]').textContent = text;
  box.hidden = false;
}

if (action) {
  // the link only works once it has done its job: take it out of the address bar
  history.replaceState(null, '', location.pathname);
  fetch(`${root.dataset.api}/news/${action}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token, lang: document.documentElement.lang }) })
    .then(async (r) => {
      if (r.status === 400) return state(root.dataset.badLink, '');
      if (!r.ok) return state(root.dataset.error, '');
      if (action === 'confirm' || action === 'join') { state(root.dataset.confirmed, root.dataset.confirmedText); root.querySelector('[data-news]').hidden = true; }
      else state(root.dataset.left, root.dataset.leftText);
    })
    .catch(() => state(root.dataset.error, ''));
}
