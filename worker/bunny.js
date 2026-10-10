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
  const token = hex(await crypto.subtle.digest('SHA-256', enc.encode(`${String(env.BUNNY_TOKEN_KEY).trim()}${guid}${expires}`))); // trim: a pasted key often carries a space or line break
  return `https://player.mediadelivery.net/embed/${env.BUNNY_LIBRARY_ID}/${guid}?token=${token}&expires=${expires}`;
}
export const thumbUrl = (env, guid, file = 'thumbnail.jpg') => `https://${env.BUNNY_CDN}/${guid}/${file}`;

// Team marks, one KV entry per video (so two people clicking at once never overwrite each other);
// the details travel as metadata, so one list call returns them all
async function marks(kv, prefix) {
  const out = {};
  let cursor;
  do {
    const page = await kv.list({ prefix, cursor });
    for (const k of page.keys) out[k.name.slice(prefix.length)] = k.metadata || {};
    cursor = page.list_complete ? null : page.cursor;
  } while (cursor);
  return out;
}

// Team routes (the caller has already checked the team session)
export async function inbox(req, env, url, reply, who = 'team') {
  if (!env.BUNNY_API_KEY) return reply({ message: 'Bunny Stream is not connected yet.' }, 503);
  const kv = env.PRIVATE;
  const body = req.method === 'POST' ? await req.json().catch(() => ({})) : {};
  const guid = body.guid || url.searchParams.get('guid') || '';
  if (url.pathname !== '/bunny/videos' && !GUID.test(guid)) return reply({ message: 'Unknown video' }, 400);

  if (url.pathname === '/bunny/videos' && req.method === 'GET') {
    const [cols, kept, flags] = await Promise.all([bunny(env, '/collections?page=1&itemsPerPage=1000'), marks(kv, 'kept:'), marks(kv, 'flag:')]);
    const names = Object.fromEntries((cols?.items || []).map((c) => [c.guid, c.name]));
    const videos = [];
    for (let page = 1; page < 50; page++) {
      const d = await bunny(env, `/videos?page=${page}&itemsPerPage=100&orderBy=date`);
      for (const v of d.items || []) {
        const meta = Object.fromEntries((v.metaTags || []).map((m) => [m.property, m.value]));
        videos.push({
          guid: v.guid, title: v.title, length: v.length, status: v.status, progress: v.encodeProgress,
          uploaded: v.dateUploaded, training: names[v.collectionId] || meta.training || '', recorded: meta.recorded || '', cut: meta.cut || '',
          thumb: thumbUrl(env, v.guid, v.thumbnailFileName || 'thumbnail.jpg'), kept: !!kept[v.guid], flag: flags[v.guid] || null,
        });
      }
      if (page * 100 >= (d.totalItems || 0)) break;
    }
    return reply({ videos, cdn: env.BUNNY_CDN });
  }
  if (url.pathname === '/bunny/play' && req.method === 'GET') {
    const link = await playUrl(env, guid, 2);
    // check the link with Bunny first, so a wrong key gives a clear message instead of a bare 403
    const test = await fetch(link, { headers: { Referer: 'https://cubandance.co/' } });
    if (test.status === 403) return reply({ message: 'Bunny refuses the player link: the token authentication key stored in the team-area service does not match the one in the Bunny library (Security tab).' }, 502);
    return reply({ url: link });
  }
  if (url.pathname === '/bunny/rename' && req.method === 'POST') {
    const title = String(body.title || '').trim().slice(0, 200);
    if (!title) return reply({ message: 'The name cannot be empty' }, 400);
    await bunny(env, `/videos/${guid}`, { method: 'POST', body: JSON.stringify({ title }) });
    return reply({ ok: true, title });
  }
  if (url.pathname === '/bunny/keep' && req.method === 'POST') {
    body.kept ? await kv.put(`kept:${guid}`, '1', { metadata: { at: new Date().toISOString() } }) : await kv.delete(`kept:${guid}`);
    return reply({ ok: true });
  }
  // Flag for deletion: the team reviews before anything is deleted (saved at once, shared by all)
  if (url.pathname === '/bunny/flag' && req.method === 'POST') {
    if (!body.flagged) { await kv.delete(`flag:${guid}`); return reply({ ok: true, flag: null }); }
    const flag = { reason: String(body.reason || '').trim().slice(0, 120), at: new Date().toISOString(), by: String(who).slice(0, 80) };
    await kv.put(`flag:${guid}`, '1', { metadata: flag });
    return reply({ ok: true, flag });
  }
  if (url.pathname === '/bunny/delete' && req.method === 'POST') {
    await bunny(env, `/videos/${guid}`, { method: 'DELETE' }).catch((e) => { if (!String(e.message).includes('404')) throw e; }); // already gone is fine
    await Promise.all([kv.delete(`flag:${guid}`), kv.delete(`kept:${guid}`)]);
    return reply({ ok: true });
  }
  return null;
}
