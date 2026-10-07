// Fetches the latest Instagram posts at build time (daily in CI) from the feed URL
// in src/data/site.json (links.instagramFeed — a Behold.so JSON feed), saves the
// images into public/instagram/ and writes src/lib/instagram.json for the home page.
// No Instagram scripts run in visitors' browsers. If anything fails, the section hides.
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';

const OUT = 'src/lib/instagram.json';
const feed = JSON.parse(readFileSync('src/data/site.json', 'utf8')).links?.instagramFeed;
if (!feed) {
  console.log('instagram: no feed URL set, skipping');
  process.exit(0);
}

try {
  const res = await fetch(feed);
  if (!res.ok) throw new Error(`feed responded ${res.status}`);
  const data = await res.json();
  const list = (Array.isArray(data) ? data : data.posts || []).slice(0, 8);
  rmSync('public/instagram', { recursive: true, force: true });
  mkdirSync('public/instagram', { recursive: true });
  const posts = [];
  for (const p of list) {
    const src = p.sizes?.medium?.mediaUrl || p.thumbnailUrl || p.mediaUrl;
    if (!src || !/^https:\/\/www\.instagram\.com\//.test(p.permalink || '')) continue;
    const img = await fetch(src);
    if (!img.ok) continue;
    const file = `/instagram/${String(p.id).replace(/\W/g, '')}.jpg`;
    writeFileSync(`public${file}`, Buffer.from(await img.arrayBuffer()));
    const caption = (p.prunedCaption || p.caption || '').split('\n')[0].slice(0, 140);
    posts.push({ image: file, url: p.permalink, caption, video: p.mediaType === 'VIDEO' });
  }
  writeFileSync(OUT, JSON.stringify(posts, null, 1) + '\n');
  console.log(`instagram: ${posts.length} posts`);
} catch (e) {
  console.warn(`instagram: skipped (${e.message})`);
}
