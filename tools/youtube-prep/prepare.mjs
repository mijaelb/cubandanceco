// Prepares the ICCD recordings for the members area and uploads them to Bunny Stream.
//   1. copy:    each original is copied to the SSD, one at a time and in large blocks: a hard disk
//      is fast that way, and very slow when two programs read it at once
//   2. convert: from the SSD copy into 1080p H.264, on the NVIDIA card and Intel Quick Sync at the
//      same time (keyframe every 2 s, at most ~7 Mbit/s: Bunny re-encodes every upload into its own
//      streaming versions, so more would only slow the upload); the SSD copy is deleted right after
//   3. trim:    camera set-up moments are found on the small 1080p copy (detect_trim.py) and cut
//      without converting again
//   4. upload:  to Bunny Stream (resumable), one folder per training weekend, with the recording
//      details; the local copy is then deleted. Without Bunny (no _state/bunny.json) the videos
//      go into "Batch NN" folders of 15 for a manual YouTube upload instead.
// The original files are only read, never changed. Progress page: http://localhost:7777
//
// Usage:  node tools/youtube-prep/prepare.mjs [source folder] [output folder] [training name]
//   training name: when the source folder is a single weekend, e.g. "2026-05 May - Sicily"
//   (otherwise each first-level folder of the source is one weekend)
// Closing it is safe; running it again continues where it stopped.
import { readdirSync, statSync, existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, rmSync, openSync, readSync, closeSync } from 'node:fs';
import { copyFile } from 'node:fs/promises';
import { join, relative, basename, dirname } from 'node:path';
import { execFile, spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { randomBytes, createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const SRC = process.argv[2] || 'G:/ICCD Media';
const OUT = process.argv[3] || 'F:/ICCD YouTube';
const TRAINING = process.argv[4] || '';
const relOf = (p) => (TRAINING ? TRAINING + '/' : '') + relative(SRC, p).split('\\').join('/');
const HERE = dirname(fileURLToPath(import.meta.url));
const MIN_SECONDS = 60; // shorter clips are skipped (false starts, tests)
const BATCH = 15; // files per YouTube Studio upload (only without Bunny)
const PORT = 7777;
const STATE = join(OUT, '_state', 'state.json');
const TMP = join(OUT, '_converting');
const READY = join(OUT, '_ready');
const STAGE = join(OUT, '_copies');
const AHEAD = 2; // originals copied ahead of the converters
for (const d of [OUT, TMP, READY, STAGE, dirname(STATE)]) mkdirSync(d, { recursive: true });
const BUNNY = existsSync(join(OUT, '_state', 'bunny.json')) ? JSON.parse(readFileSync(join(OUT, '_state', 'bunny.json'), 'utf8')) : null;

const run = (cmd, args) => new Promise((ok, no) => execFile(cmd, args, { maxBuffer: 16 << 20, windowsHide: true }, (e, out, err) => (e ? no(new Error((err || e.message).split('\n').filter(Boolean).slice(-2).join(' '))) : ok(out))));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pad = (n) => String(n).padStart(2, '0');

// ---------- state (saved after every change, so a restart continues) ----------
const state = existsSync(STATE) ? JSON.parse(readFileSync(STATE, 'utf8')) : { clips: {}, batches: {} };
state.collections ??= {};
function save() {
  writeFileSync(STATE + '.tmp', JSON.stringify(state, null, 1));
  renameSync(STATE + '.tmp', STATE);
}

// ---------- names ----------
// Sony cameras write C1234M01.XML next to C1234.MP4 with the local recording time (the MP4 has UTC)
// DJI cameras put the local time in the file name: DJI_20260511151112_0001_D.MP4
function localTime(path) {
  const dji = basename(path).match(/^DJI_(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})_/);
  if (dji) return `${dji[1]}-${dji[2]}-${dji[3]}T${dji[4]}:${dji[5]}:${dji[6]}`;
  try { return readFileSync(path.replace(/\.[^.]+$/, 'M01.XML'), 'utf8').match(/CreationDate value="([^"]+)"/)?.[1] || ''; } catch { return ''; }
}
function nameFor(c) {
  const folder = c.rel.split('/')[0];
  const place = folder.replace(/^\d{4}-\d{2}\s+\S+\s+-\s+/, '').replace(/[()]/g, '').trim();
  const stamp = c.created ? c.created.slice(0, 10) + ' ' + c.created.slice(11, 16).replace(':', 'h') : folder.slice(0, 7);
  const clip = basename(c.rel).replace(/\.[^.]+$/, '');
  return `${place} ${stamp} (${clip})`.replace(/[<>:"/\\|?*]/g, '').replace(/\s+/g, ' ');
}

// ---------- 1. find and measure the recordings ----------
async function scan() {
  const files = [];
  const walk = (d) => { for (const n of readdirSync(d)) { if (n.startsWith('.')) continue; const p = join(d, n); const s = statSync(p); if (s.isDirectory()) walk(p); else if (/\.(mp4|mov|m4v|mts)$/i.test(n)) files.push({ path: p, size: s.size }); } };
  walk(SRC);
  let i = 0;
  const todo = files.filter((f) => !state.clips[relOf(f.path)]);
  console.log(`${files.length} recordings found, ${todo.length} new to measure`);
  await Promise.all(Array.from({ length: 4 }, async () => {
    while (i < todo.length) {
      const f = todo[i++];
      const rel = relOf(f.path);
      try {
        const j = JSON.parse(await run('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_entries', 'format=duration:format_tags=creation_time:stream=codec_type,codec_name,width,height', f.path]));
        const v = j.streams.find((s) => s.codec_type === 'video') || {};
        const c = { rel, path: f.path, size: f.size, duration: +j.format.duration || 0, w: v.width, h: v.height, codec: v.codec_name, created: localTime(f.path) || j.format.tags?.creation_time || '' };
        c.status = c.duration < MIN_SECONDS ? 'skipped' : 'waiting';
        c.name = nameFor(c);
        state.clips[rel] = c;
      } catch (e) { state.clips[rel] = { rel, path: f.path, status: 'error', error: 'Cannot read: ' + e.message }; }
    }
  }));
  const seen = new Map(); // the same name twice (two cameras, same minute): add a number
  for (const c of Object.values(state.clips).filter((c) => c.name)) {
    const n = seen.get(c.name) || 0; seen.set(c.name, n + 1);
    if (n && !c.name.endsWith(` ${n + 1}`)) c.name += ` ${n + 1}`;
  }
  // interrupted last time: half-written files are useless, and that step starts again
  for (const f of readdirSync(TMP)) rmSync(join(TMP, f), { force: true });
  const keep = new Set(Object.values(state.clips).filter((c) => c.status === 'staged' || ['trimming', 'converting', 'trimmed'].includes(c.status)).map((c) => c.staged));
  for (const f of readdirSync(STAGE)) if (!keep.has(join(STAGE, f))) rmSync(join(STAGE, f), { force: true });
  for (const c of Object.values(state.clips)) {
    if (['trimming', 'converting', 'trimmed', 'staged'].includes(c.status)) c.status = c.staged && existsSync(c.staged) ? 'staged' : 'waiting';
    if (c.status === 'staging') { if (c.staged) rmSync(c.staged, { force: true }); c.status = 'waiting'; }
    if (c.status === 'cutting') c.status = 'converted';
    if (c.status === 'uploading') c.status = 'ready';
  }
  save();
}
// newest training weekends first: most useful for the members
const queue = () => Object.values(state.clips).sort((a, b) => b.rel.split('/')[0].localeCompare(a.rel.split('/')[0]) || a.rel.localeCompare(b.rel));
const pending = (...st) => queue().some((x) => st.includes(x.status));

// ---------- 2. copy to the SSD (one at a time: the hard disk is fast only that way) ----------
async function copier() {
  for (;;) {
    if (stopping) return;
    if (queue().filter((x) => ['staged', 'converting'].includes(x.status)).length >= AHEAD + 2) { await sleep(2000); continue; }
    const c = queue().find((x) => x.status === 'waiting');
    if (!c) return;
    c.status = 'staging'; c.staged = join(STAGE, c.name + '.src' + (c.path.match(/\.[^.]+$/)?.[0] || '.mp4')); active.set('copy', c); save();
    const t0 = Date.now();
    try {
      await copyFile(c.path, c.staged);
      Object.assign(c, { status: 'staged', copySeconds: Math.round((Date.now() - t0) / 1000) });
    } catch (e) { rmSync(c.staged, { force: true }); Object.assign(c, { status: 'error', error: 'copy: ' + e.message.slice(0, 160) }); }
    active.delete('copy'); save();
  }
}

// ---------- 3. convert (two engines, from the SSD copy) ----------
function fit(w, h) { const k = Math.min(1, 1920 / w, 1080 / h); return [Math.round((w * k) / 2) * 2, Math.round((h * k) / 2) * 2]; }
function ffArgs(engine, c, out) {
  const [w, h] = fit(c.w, c.h);
  const keys = ['-force_key_frames', 'expr:gte(t,n_forced*2)']; // a keyframe every 2 s, so the trim can cut without converting again
  const tail = ['-c:a', 'aac', '-b:a', '160k', '-ac', '2', '-movflags', '+faststart', '-y', out];
  const src = c.staged || c.path;
  if (engine === 'nvenc') return ['-hide_banner', '-loglevel', 'error', '-hwaccel', 'cuda', '-hwaccel_output_format', 'cuda', '-i', src,
    '-vf', `scale_cuda=${w}:${h}`, '-c:v', 'h264_nvenc', '-preset', 'p5', '-tune', 'hq', '-rc', 'vbr', '-cq', '24', '-b:v', '6M', '-maxrate', '7M', '-bufsize', '14M', '-profile:v', 'high', ...keys, ...tail];
  if (engine === 'qsv') return ['-hide_banner', '-loglevel', 'error', '-hwaccel', 'qsv', '-hwaccel_output_format', 'qsv', '-i', src,
    '-vf', `scale_qsv=w=${w}:h=${h}`, '-c:v', 'h264_qsv', '-preset', 'slow', '-b:v', '6M', '-maxrate', '7M', '-bufsize', '14M', '-look_ahead', '1', ...keys, ...tail];
  return ['-hide_banner', '-loglevel', 'error', '-i', src, '-vf', `scale=${w}:${h}`, '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', ...keys, ...tail]; // processor fallback
}
const active = new Map(); // what each worker does now
async function converter(engine) {
  for (;;) {
    if (stopping) return;
    // do not run far ahead of the uploads: at most 6 converted videos waiting on the SSD
    if (BUNNY && queue().filter((x) => ['converted', 'cutting', 'ready', 'uploading'].includes(x.status)).length >= 6) { await sleep(5000); continue; }
    const c = queue().find((x) => x.status === 'staged');
    if (!c) { if (!pending('waiting', 'staging')) return; await sleep(2000); continue; }
    c.status = 'converting'; c.engine = engine; c.started = Date.now(); active.set(engine, c); save();
    const full = join(TMP, c.name + '.full.mp4');
    const t0 = Date.now();
    let used = engine;
    try {
      try { await run('ffmpeg', ffArgs(engine, c, full)); } catch { used = 'cpu'; await run('ffmpeg', ffArgs('cpu', c, full)); } // engine problem: slower but sure
      Object.assign(c, { status: 'converted', engine: used, seconds: Math.round((Date.now() - t0) / 1000), full });
      rmSync(c.staged, { force: true }); delete c.staged; // the SSD copy is not needed any more
    } catch (e) {
      rmSync(full, { force: true }); if (c.staged) { rmSync(c.staged, { force: true }); delete c.staged; }
      Object.assign(c, { status: 'error', error: e.message.slice(0, 200) });
    }
    active.delete(engine); save();
  }
}

// ---------- 4. find and cut the camera set-up (on the 1080p copy) ----------
async function trimmer() {
  for (;;) {
    if (stopping) return;
    const c = queue().find((x) => x.status === 'converted');
    if (!c) { if (!pending('waiting', 'staging', 'staged', 'converting')) return; await sleep(3000); continue; }
    c.status = 'cutting'; active.set('trim', c); save();
    const out = join(READY, c.name + '.mp4');
    try {
      const len = Number(await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', c.full])) || c.duration;
      let r = { start: 0, end: len };
      try { r = JSON.parse(await run('python', ['-I', join(HERE, 'detect_trim.py'), c.full, String(len)])); } catch (e) { c.trimNote = 'not checked: ' + e.message.slice(0, 100); }
      c.trimStart = r.start; c.trimEnd = r.end; c.outLength = len;
      if (r.start > 0 || r.end < len - 0.5) {
        await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-ss', String(r.start), '-to', String(r.end), '-i', c.full, '-c', 'copy', '-avoid_negative_ts', 'make_zero', '-movflags', '+faststart', '-y', out]);
        rmSync(c.full, { force: true });
      } else renameSync(c.full, out);
      Object.assign(c, { status: 'ready', file: out, outSize: statSync(out).size });
      delete c.full;
      if (!BUNNY) toBatch(c);
    } catch (e) { Object.assign(c, { status: 'error', error: 'cut: ' + e.message.slice(0, 200) }); }
    active.delete('trim'); save();
  }
}

// Without Bunny: batch folders of 15 for YouTube Studio
function toBatch(c) {
  const open = Object.keys(state.batches).map(Number).sort((a, b) => a - b).find((n) => !state.batches[n].uploaded && state.batches[n].files.length < BATCH);
  const n = open ?? Math.max(0, ...Object.keys(state.batches).map(Number)) + 1;
  state.batches[n] ??= { files: [], uploaded: false };
  const dir = join(OUT, `Batch ${pad(n)}`); mkdirSync(dir, { recursive: true });
  renameSync(c.file, join(dir, c.name + '.mp4'));
  Object.assign(c, { status: 'done', batch: n, file: join(dir, c.name + '.mp4') });
  state.batches[n].files.push(c.rel);
}

// ---------- 5. upload to Bunny Stream ----------
const api = async (path, opts = {}) => {
  const r = await fetch(`https://video.bunnycdn.com/library/${BUNNY.libraryId}${path}`, { ...opts, headers: { AccessKey: BUNNY.apiKey, Accept: 'application/json', ...(opts.body ? { 'Content-Type': 'application/json' } : {}) } });
  if (!r.ok) throw new Error(`Bunny ${r.status} ${(await r.text()).slice(0, 120)}`);
  return r.status === 204 ? null : r.json();
};
async function collectionFor(folder) {
  if (state.collections[folder]) return state.collections[folder];
  const found = (await api(`/collections?page=1&itemsPerPage=100&search=${encodeURIComponent(folder)}`)).items?.find((x) => x.name === folder);
  state.collections[folder] = found?.guid || (await api('/collections', { method: 'POST', body: JSON.stringify({ name: folder }) })).guid;
  save();
  return state.collections[folder];
}
// TUS: resumable upload in pieces, so a dropped connection only repeats one piece
const CHUNK = 64 << 20;
async function tusUpload(c, onProgress) {
  const size = statSync(c.file).size;
  const expire = Math.floor(Date.now() / 1000) + 24 * 3600;
  const sig = createHash('sha256').update(`${BUNNY.libraryId}${BUNNY.apiKey}${expire}${c.bunny.guid}`).digest('hex');
  const auth = { AuthorizationSignature: sig, AuthorizationExpire: String(expire), VideoId: c.bunny.guid, LibraryId: String(BUNNY.libraryId), 'Tus-Resumable': '1.0.0' };
  let offset = 0;
  if (c.bunny.tus) { // continue an upload that was interrupted
    const h = await fetch(c.bunny.tus, { method: 'HEAD', headers: auth });
    if (h.ok) offset = Number(h.headers.get('Upload-Offset')) || 0; else delete c.bunny.tus;
  }
  if (!c.bunny.tus) {
    const b64 = (s) => Buffer.from(s).toString('base64');
    const r = await fetch('https://video.bunnycdn.com/tusupload', { method: 'POST', headers: { ...auth, 'Upload-Length': String(size), 'Upload-Metadata': `filetype ${b64('video/mp4')},title ${b64(c.name)}` } });
    if (r.status !== 201) throw new Error(`upload start ${r.status}`);
    c.bunny.tus = new URL(r.headers.get('Location'), 'https://video.bunnycdn.com').href; save();
  }
  const fd = openSync(c.file, 'r');
  try {
    while (offset < size) {
      if (stopping) throw new Error('stopped');
      const buf = Buffer.alloc(Math.min(CHUNK, size - offset));
      readSync(fd, buf, 0, buf.length, offset);
      let tries = 0;
      for (;;) {
        try {
          const r = await fetch(c.bunny.tus, { method: 'PATCH', headers: { ...auth, 'Upload-Offset': String(offset), 'Content-Type': 'application/offset+octet-stream' }, body: buf });
          if (r.status !== 204) throw new Error(`upload ${r.status}`);
          offset = Number(r.headers.get('Upload-Offset')); break;
        } catch (e) { if (++tries > 6) throw e; await sleep(5000 * tries); }
      }
      onProgress(offset / size);
    }
  } finally { closeSync(fd); }
}
async function uploader(n) {
  for (;;) {
    if (stopping) return;
    const c = queue().find((x) => x.status === 'ready');
    if (!c) { if (!pending('waiting', 'staging', 'staged', 'converting', 'converted', 'cutting')) return; await sleep(3000); continue; }
    c.status = 'uploading'; c.progress = 0; active.set('up' + n, c); save();
    const t0 = Date.now();
    try {
      const folder = c.rel.split('/')[0];
      if (!c.bunny?.guid) {
        const v = await api('/videos', { method: 'POST', body: JSON.stringify({ title: c.name, collectionId: await collectionFor(folder) }) });
        c.bunny = { guid: v.guid }; save();
      }
      await tusUpload(c, (p) => { c.progress = p; });
      // the details the team area shows next to each video
      const cut = [c.trimStart > 0 && `${c.trimStart}s at the start`, c.outLength - c.trimEnd > 0.5 && `${(c.outLength - c.trimEnd).toFixed(1)}s at the end`].filter(Boolean).join(', ');
      await api(`/videos/${c.bunny.guid}`, { method: 'POST', body: JSON.stringify({ metaTags: [
        { property: 'training', value: folder }, { property: 'recorded', value: c.created || '' },
        { property: 'clip', value: c.rel }, { property: 'cut', value: cut || 'nothing' },
      ] }) });
      rmSync(c.file, { force: true }); // on Bunny now: free the space
      Object.assign(c, { status: 'done', uploadSeconds: Math.round((Date.now() - t0) / 1000) });
      delete c.file;
    } catch (e) {
      if (stopping) c.status = 'ready';
      else Object.assign(c, { status: 'ready', uploadError: e.message.slice(0, 160), retryAt: Date.now() + 60000 });
      if (!stopping) await sleep(60000); // network trouble: wait a minute, then try again
    }
    active.delete('up' + n); save();
  }
}

// ---------- 6. progress page ----------
const KEY = randomBytes(16).toString('hex'); // only this page may press the buttons
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const hms = (s) => (s >= 3600 ? `${Math.floor(s / 3600)}h ${pad(Math.floor((s % 3600) / 60))}m` : `${Math.floor(s / 60)}m ${pad(Math.round(s % 60))}s`);
const started = Date.now(); let doneAtStart = null;
function page() {
  const all = Object.values(state.clips).filter((c) => c.status !== 'skipped');
  const done = all.filter((c) => c.status === 'done');
  const len = (c) => (c.trimEnd ?? c.duration) - (c.trimStart || 0);
  const secs = (l) => l.reduce((a, c) => a + (c.duration || 0), 0);
  doneAtStart ??= secs(done);
  const rate = (secs(done) - doneAtStart) / ((Date.now() - started) / 1000); // seconds of video finished per second, this session
  const left = secs(all.filter((c) => c.status !== 'done' && c.status !== 'error'));
  const pct = Math.round((secs(done) / Math.max(1, secs(all))) * 100);
  const label = { copy: 'Copying to the SSD', nvenc: 'Converting · graphics card', qsv: 'Converting · Quick Sync', cpu: 'Converting · processor', trim: 'Removing camera set-up', up1: 'Uploading', up2: 'Uploading' };
  const now = [...active.entries()].map(([k, c]) => `<li><b>${label[k] || k}</b> ${esc(c.name)} · ${hms(len(c))}${k.startsWith('up') ? ` · ${Math.round((c.progress || 0) * 100)}%` : ''}</li>`).join('') || '<li>Nothing right now</li>';
  const count = (st) => all.filter((c) => st.includes(c.status)).length;
  const cuts = all.filter((c) => c.trimStart > 0 || (c.outLength && c.outLength - c.trimEnd > 0.5)).slice(-40).reverse()
    .map((c) => `<tr><td>${esc(c.name)}</td><td>${c.trimStart ? c.trimStart + ' s' : '–'}</td><td>${c.outLength - c.trimEnd > 0.5 ? (c.outLength - c.trimEnd).toFixed(1) + ' s' : '–'}</td></tr>`).join('');
  const errors = all.filter((c) => c.status === 'error' || c.uploadError).map((c) => `<li>${esc(c.rel)}: ${esc(c.error || c.uploadError)}</li>`).join('');
  const batches = BUNNY ? '' : `<h2>Batches for YouTube</h2><table>${Object.entries(state.batches).map(([n, b]) => `<tr><td><b>Batch ${pad(n)}</b></td><td>${b.files.length} videos</td><td>${b.uploaded ? 'Uploaded' : b.files.length >= BATCH ? 'Ready' : 'Filling'}</td><td>${b.uploaded ? '' : `<form method="post" action="/open"><input type="hidden" name="b" value="${n}"><button>Open folder</button></form> <form method="post" action="/uploaded" onsubmit="return confirm('Uploaded? The copies in this folder will be deleted.')"><input type="hidden" name="b" value="${n}"><button class="warn">Uploaded → free the space</button></form>`}</td></tr>`).join('')}</table>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="refresh" content="15"><title>ICCD · video preparation</title>
<style>body{margin:0;font:15px/1.5 system-ui,sans-serif;background:#fcfaf6;color:#14110d}header{background:#14110d;color:#e8c95f;padding:18px 28px}h1{margin:0;font-size:20px}main{padding:24px 28px;max-width:1100px}
.bar{height:14px;background:#efe6d3;border-radius:99px;overflow:hidden;margin:8px 0 4px}.bar i{display:block;height:100%;background:#e8c95f;width:${pct}%}
.stats{display:flex;gap:28px;flex-wrap:wrap;margin:14px 0 24px}.stats b{display:block;font-size:24px}table{width:100%;border-collapse:collapse;background:#fff;border-radius:12px;overflow:hidden;margin-bottom:24px}
td,th{padding:9px 12px;border-bottom:1px solid #efe6d3;text-align:left}small{color:#746a5a}h2{font-size:16px;margin:26px 0 8px}ul{background:#fff;border-radius:12px;padding:12px 30px}
form{display:inline}button{border:1px solid #d8cfbd;background:#fff;border-radius:99px;padding:6px 12px;font-weight:700;cursor:pointer}button.warn{background:#14110d;color:#e8c95f}</style></head><body>
<header><h1>ICCD · Preparing the videos ${BUNNY ? 'and uploading them to Bunny Stream' : 'for YouTube'}</h1></header><main>
<div class="bar"><i></i></div><small>${pct}% of the video time finished · updates every 15 seconds</small>
<div class="stats"><div><b>${done.length} / ${all.length}</b>${BUNNY ? 'uploaded and in the team area' : 'ready'}</div>
<div><b>${count(['waiting'])}</b>waiting</div><div><b>${count(['staging', 'staged', 'converting', 'converted', 'cutting', 'ready', 'uploading'])}</b>in progress</div>
<div><b>${rate > 0 ? '≈ ' + hms(left / rate) : 'measuring…'}</b>left${rate > 0 ? ` (${rate.toFixed(1)}× real time)` : ''}</div></div>
<h2>Working on now</h2><ul>${now}</ul>
${errors ? `<h2>Problems (retried automatically)</h2><ul>${errors}</ul>` : ''}
${batches}
<h2>Camera set-up removed (latest)</h2><table><tr><th>Video</th><th>Start cut</th><th>End cut</th></tr>${cuts || '<tr><td colspan="3">None yet.</td></tr>'}</table>
<small>${Object.values(state.clips).filter((c) => c.status === 'skipped').length} clips shorter than a minute were skipped. Originals on ${esc(SRC)} are never changed.</small>
<script>document.querySelectorAll('form').forEach(f=>{const k=document.createElement('input');k.type='hidden';k.name='k';k.value='${KEY}';f.append(k)})</script>
</main></body></html>`;
}
const server = createServer((req, res) => {
  if (!/^(localhost|127\.0\.0\.1):\d+$/.test(req.headers.host || '')) { res.writeHead(403); return res.end(); } // only from this PC
  if (req.method === 'GET') { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; form-action 'self'" }); return res.end(page()); }
  let body = '';
  req.on('data', (d) => (body += d)).on('end', () => {
    const f = new URLSearchParams(body);
    const b = state.batches[f.get('b')];
    if (f.get('k') === KEY && b) {
      const dir = join(OUT, `Batch ${pad(Number(f.get('b')))}`);
      if (req.url === '/open') spawn('explorer', [dir.replace(/\//g, '\\')], { detached: true });
      if (req.url === '/uploaded') { for (const r of b.files) rmSync(state.clips[r].file || '', { force: true }); b.uploaded = true; save(); }
    }
    res.writeHead(303, { Location: '/' }); res.end();
  });
});

// ---------- go ----------
let stopping = false;
process.on('SIGINT', () => { if (stopping) process.exit(1); stopping = true; console.log('\nStopping… (Ctrl+C again to stop at once)'); });
await scan();
server.listen(PORT, '127.0.0.1', () => console.log(`Progress page: http://localhost:${PORT}`));
const total = Object.values(state.clips).filter((c) => c.status !== 'skipped');
console.log(`${total.length} videos (${(total.reduce((a, c) => a + (c.duration || 0), 0) / 3600).toFixed(1)} h), ${total.filter((c) => c.status === 'done').length} finished. ${BUNNY ? 'Uploading to Bunny Stream.' : 'No Bunny connection: batch folders for YouTube.'}`);
await Promise.all([copier(), converter('nvenc'), converter('qsv'), trimmer(), ...(BUNNY ? [uploader(1), uploader(2)] : [])]);
console.log(stopping ? 'Stopped. Run again to continue.' : 'All videos are finished.');
server.close();
