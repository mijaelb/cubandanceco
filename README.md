# International Company of Cuban Dances — website

The website of the International Company of Cuban Dances (ICCD): **cubandance.co**.
Static site built with [Astro](https://astro.build), hosted for free on GitHub Pages,
with a small admin panel at `/admin/` for editing content and translations.

## How it works

```
src/data/*.json      ← all content (trainings, show, teachers, people, FAQ, gallery, about, home)
src/i18n/<lang>.json ← translations: "English text" → "translated text" (missing = English)
src/views/*.astro    ← one file per page (Home, Trainings, Show, About, Company, Gallery, FAQ)
src/components/      ← small building blocks (image, training card, schedule, video, page hero)
src/layouts/Layout.astro ← header, menu, language switcher, footer, SEO + security headers
src/styles/global.css    ← the only stylesheet (brand colours: gold, cream, ink)
src/pages/[...path].astro← generates every page in every language (/, /es/, /fr/ …)
public/js/site.js        ← menu, scroll effects, gallery lightbox (the site works without it)
public/admin/            ← the admin panel (admin.js + admin.css), talks to the GitHub API
public/images, public/video, public/uploads ← media (uploads = photos added via the admin)
scripts/strings.mjs      ← lists every translatable string for the admin (runs on build)
```

Every change pushed to `main` (including saves from the admin) rebuilds the site automatically
(`.github/workflows/deploy.yml`, ~1–2 minutes). The site is also rebuilt every night so trainings
and shows disappear on their own once they are over.

## Editing content (admin panel)

1. Open `https://cubandance.co/admin/` (link "Admin" in the footer).
2. Sign in with a GitHub **fine-grained token** (one-time setup):
   GitHub → Settings → Developer settings → **Fine-grained tokens** → *Generate new token*
   - Repository access: **Only select repositories** → this repository
   - Permissions: **Contents: Read and write** (optional: **Actions: Read-only** to see when the site is live)
   - Expiration: e.g. 90 days. Paste the token into the admin. Never share it.
3. Edit, then press **Publish changes**. Photos you upload are resized automatically.
4. **Translations** tab: pick a language, fill in or improve texts. Empty = shown in English.
   You can add a new language with its two-letter code (e.g. `pt`).

Anyone who should edit the site needs write access to the repository and their own token.

## Team editor (no GitHub account needed)

Organisers can edit **trainings and timetables** with a shared team password.
The admin page talks to a small Cloudflare Worker (`worker/`) that checks the password
and saves the change to GitHub with its own key. Secrets live only in Cloudflare:

```bash
cd worker
npx wrangler secret put TEAM_PASSWORD   # change the team password
npx wrangler secret put GITHUB_TOKEN    # fine-grained token: this repo only, Contents read & write, Actions read
npx wrangler deploy                     # after changing worker/index.js
```

## Security

- No server, no database, no passwords on the site: only static files.
- The admin can only change content with a valid GitHub token that has write access to this repository.
  Turn on **two-factor authentication** on every GitHub account with access.
- Strict Content-Security-Policy on every page (no third-party scripts, fonts are self-hosted, no trackers).
- The admin never inserts content as HTML, keeps the token for the browser session only
  (unless "Remember me" is ticked) and is hidden from search engines.

## Custom domain (cubandance.co)

1. Repository → Settings → Pages → *Custom domain*: `cubandance.co` → Save, then tick **Enforce HTTPS**.
2. At your domain registrar, set DNS:
   - `A` records for `cubandance.co` → `185.199.108.153`, `185.199.109.153`, `185.199.110.153`, `185.199.111.153`
   - `CNAME` record for `www` → `<your-github-username>.github.io`
3. Wait for DNS (minutes to a few hours). The site adapts its links automatically.

## Local development

```bash
npm install
npm run dev      # http://localhost:4321
npm run build    # outputs to dist/
```
