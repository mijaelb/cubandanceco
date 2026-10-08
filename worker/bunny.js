// Bunny Stream: the team inbox of uploaded recordings, and signed player links.
// Secrets: BUNNY_LIBRARY_ID, BUNNY_API_KEY, BUNNY_TOKEN_KEY (embed token authentication), BUNNY_CDN.

export const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const enc = new TextEncoder();
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

async function bunny(env, path, opts = {}) {
  const r = await fetch(`https://video.bunnycdn.com/library/${env.BUNNY_LIBRARY_ID}${path}`, {
    ...opts, headers: { AccessKey: env.BUNNY_API_KEY, Accept: 'application/json', ...(opts.body ? { 'Content-Type': 'application/json' } : {}) },
  });
  if (!r.ok) throw new Error(`Bunny ${r.status}`);
  return r.status === 204 ? null : r.json().catch(() => null);
}

// Player link that stops working after a few hours (embed view token authentication)
export async function playUrl(env, guid, hours = 6) {
  const expires = Math.floor(Date.now() / 1000) + hours * 3600;
  const token = hex(await crypto.subtle.digest('SHA-256', enc.encode(`${env.BUNNY_TOKEN_KEY}${guid}${expires}`)));
  return `https://player.mediadelivery.net/embed/${env.BUNNY_LIBRARY_ID}/${guid}?token=${token}&expires=${expires}`;
}
export const thumbUrl = (env, guid, file = 'thumbnail.jpg') => `https://${env.BUNNY_CDN}/${guid}/${file}`;

// Team routes (the caller has already checked the team session)
export async function inbox(req, env, url, reply) {
  if (!env.BUNNY_API_KEY) return reply({ message: 'Bunny Stream is not connected yet.' }, 503);
  const kv = env.PRIVATE;
  const body = req.method === 'POST' ? await req.json().catch(() => ({})) : {};
  const guid = body.guid || url.searchParams.get('guid') || '';
  if (url.pathname !== '/bunny/videos' && !GUID.test(guid)) return reply({ message: 'Unknown video' }, 400);

  if (url.pathname === '/bunny/videos' && req.method === 'GET') {
    const [cols, kept] = await Promise.all([
      bunny(env, '/collections?page=1&itemsPerPage=1000'),
      kv.get('bunny-kept').then((v) => new Set(JSON.parse(v || '[]'))),
    ]);
    const names = Object.fromEntries((cols?.items || []).map((c) => [c.guid, c.name]));
    const videos = [];
    for (let page = 1; page < 50; page++) {
      const d = await bunny(env, `/videos?page=${page}&itemsPerPage=100&orderBy=date`);
      for (const v of d.items || []) {
        const meta = Object.fromEntries((v.metaTags || []).map((m) => [m.property, m.value]));
        videos.push({
          guid: v.guid, title: v.title, length: v.length, status: v.status, progress: v.encodeProgress,
          uploaded: v.dateUploaded, training: names[v.collectionId] || meta.training || '', recorded: meta.recorded || '', cut: meta.cut || '',
          thumb: thumbUrl(env, v.guid, v.thumbnailFileName || 'thumbnail.jpg'), kept: kept.has(v.guid),
        });
      }
      if (page * 100 >= (d.totalItems || 0)) break;
    }
    return reply({ videos, cdn: env.BUNNY_CDN });
  }
  if (url.pathname === '/bunny/play' && req.method === 'GET') return reply({ url: await playUrl(env, guid, 2) });
  if (url.pathname === '/bunny/rename' && req.method === 'POST') {
    const title = String(body.title || '').trim().slice(0, 200);
    if (!title) return reply({ message: 'The name cannot be empty' }, 400);
    await bunny(env, `/videos/${guid}`, { method: 'POST', body: JSON.stringify({ title }) });
    return reply({ ok: true, title });
  }
  if (url.pathname === '/bunny/keep' && req.method === 'POST') {
    const kept = new Set(JSON.parse((await kv.get('bunny-kept')) || '[]'));
    body.kept ? kept.add(guid) : kept.delete(guid);
    await kv.put('bunny-kept', JSON.stringify([...kept]));
    return reply({ ok: true });
  }
  if (url.pathname === '/bunny/delete' && req.method === 'POST') {
    await bunny(env, `/videos/${guid}`, { method: 'DELETE' });
    return reply({ ok: true });
  }
  return null;
}
