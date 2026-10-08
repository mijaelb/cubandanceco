// Prepares the ICCD recordings for YouTube: trims camera set-up moments, converts to 1080p
// and drops the results into batch folders of 15 (what YouTube Studio takes per upload).
// Two converters work at the same time: the NVIDIA card (NVENC) and the Intel chip (Quick Sync).
// The original files are only read, never changed. Progress page: http://localhost:7777
//
// Usage:  node tools/youtube-prep/prepare.mjs [source folder] [output folder]
// Stop with Ctrl+C at any time; running it again continues where it stopped.
import { readdirSync, statSync, existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, rmSync } from 'node:fs';
import { join, relative, basename, dirname } from 'node:path';
import { execFile, spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const SRC = process.argv[2] || 'G:/ICCD Media';
const OUT = process.argv[3] || 'F:/ICCD YouTube';
const HERE = dirname(fileURLToPath(import.meta.url));
const MIN_SECONDS = 60; // shorter clips are skipped (false starts, tests)
const BATCH = 15; // files per YouTube Studio upload
const PORT = 7777;
const STATE = join(OUT, '_state', 'state.json');
const TMP = join(OUT, '_converting');
for (const d of [OUT, TMP, dirname(STATE)]) mkdirSync(d, { recursive: true });

const run = (cmd, args) => new Promise((ok, no) => execFile(cmd, args, { maxBuffer: 16 << 20, windowsHide: true }, (e, out, err) => (e ? no(new Error((err || e.message).split('\n').filter(Boolean).slice(-2).join(' '))) : ok(out))));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- state (saved after every change, so a restart continues) ----------
let state = existsSync(STATE) ? JSON.parse(readFileSync(STATE, 'utf8')) : { clips: {}, batches: {} };
let saving = false;
function save() {
  if (saving) return; saving = true;
  writeFileSync(STATE + '.tmp', JSON.stringify(state, null, 1));
  renameSync(STATE + '.tmp', STATE);
  saving = false;
}

// ---------- names ----------
const pad = (n) => String(n).padStart(2, '0');
function nameFor(c) {
  const folder = c.rel.split('/')[0];
  const place = folder.replace(/^\d{4}-\d{2}\s+\S+\s+-\s+/, '').replace(/[()]/g, '').trim();
  const stamp = c.created ? c.created.slice(0, 10) + ' ' + c.created.slice(11, 16).replace(':', 'h') : folder.slice(0, 7);
  const clip = basename(c.rel).replace(/\.[^.]+$/, '');
  return `${place} ${stamp} (${clip})`.replace(/[<>:"/\\|?*]/g, '').replace(/\s+/g, ' ');
}

// Sony cameras write C1234M01.XML next to C1234.MP4 with the local recording time (the MP4 has UTC)
function localTime(path) {
  const xml = path.replace(/\.[^.]+$/, 'M01.XML');
  try { return readFileSync(xml, 'utf8').match(/CreationDate value="([^"]+)"/)?.[1] || ''; } catch { return ''; }
}

// ---------- 1. find and measure the recordings ----------
async function scan() {
  const files = [];
  const walk = (d) => { for (const n of readdirSync(d)) { if (n.startsWith('.')) continue; const p = join(d, n); const s = statSync(p); if (s.isDirectory()) walk(p); else if (/\.(mp4|mov|m4v|mts)$/i.test(n)) files.push({ path: p, size: s.size }); } };
  walk(SRC);
  let i = 0;
  const todo = files.filter((f) => !state.clips[relative(SRC, f.path).split('\\').join('/')]);
  console.log(`${files.length} recordings found, ${todo.length} new to measure`);
  await Promise.all(Array.from({ length: 6 }, async () => {
    while (i < todo.length) {
      const f = todo[i++];
      const rel = relative(SRC, f.path).split('\\').join('/');
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
  // the same name twice (two cameras, same minute): add a number
  const seen = new Map();
  for (const c of Object.values(state.clips).filter((c) => c.name)) {
    const n = seen.get(c.name) || 0; seen.set(c.name, n + 1);
    if (n) c.name += ` ${n + 1}`;
  }
  for (const c of Object.values(state.clips)) if (['trimming', 'converting'].includes(c.status)) c.status = c.trimEnd ? 'trimmed' : 'waiting'; // interrupted last time
  save();
}

// newest training weekends first: most useful for the members
const queue = () => Object.values(state.clips).sort((a, b) => b.rel.split('/')[0].localeCompare(a.rel.split('/')[0]) || a.rel.localeCompare(b.rel));

// ---------- 2. find camera set-up moments (processor) ----------
async function trimmer() {
  for (;;) {
    if (stopping) return;
    const c = queue().find((x) => x.status === 'waiting');
    if (!c) { if (!queue().some((x) => ['trimming'].includes(x.status))) return; await sleep(2000); continue; }
    c.status = 'trimming';
    try {
      const r = JSON.parse(await run('python', ['-I', join(HERE, 'detect_trim.py'), c.path, String(c.duration)]));
      c.trimStart = r.start; c.trimEnd = r.end;
    } catch (e) { c.trimStart = 0; c.trimEnd = c.duration; c.trimNote = 'not checked: ' + e.message.slice(0, 120); }
    c.status = 'trimmed';
    save();
  }
}

// ---------- 3. convert (two engines at once) ----------
function fit(w, h) { // inside 1920×1080, even numbers
  const k = Math.min(1, 1920 / w, 1080 / h);
  return [Math.round((w * k) / 2) * 2, Math.round((h * k) / 2) * 2];
}
function ffArgs(engine, c, out) {
  const [w, h] = fit(c.w, c.h);
  const cut = ['-ss', String(c.trimStart), '-t', String((c.trimEnd - c.trimStart).toFixed(2))];
  const audio = ['-c:a', 'aac', '-b:a', '160k', '-ac', '2', '-movflags', '+faststart', '-y', out];
  if (engine === 'nvenc') return ['-hide_banner', '-loglevel', 'error', '-hwaccel', 'cuda', '-hwaccel_output_format', 'cuda', ...cut, '-i', c.path,
    '-vf', `scale_cuda=${w}:${h}`, '-c:v', 'h264_nvenc', '-preset', 'p5', '-tune', 'hq', '-rc', 'vbr', '-cq', '23', '-b:v', '8M', '-maxrate', '12M', '-bufsize', '16M', '-profile:v', 'high', ...audio];
  if (engine === 'qsv') return ['-hide_banner', '-loglevel', 'error', '-hwaccel', 'qsv', '-hwaccel_output_format', 'qsv', ...cut, '-i', c.path,
    '-vf', `scale_qsv=w=${w}:h=${h}`, '-c:v', 'h264_qsv', '-preset', 'slow', '-global_quality', '20', '-look_ahead', '1', ...audio];
  return ['-hide_banner', '-loglevel', 'error', ...cut, '-i', c.path, '-vf', `scale=${w}:${h}`, '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', ...audio]; // processor fallback
}
const active = new Map(); // engine -> clip
async function converter(engine) {
  for (;;) {
    if (stopping) return;
    const c = queue().find((x) => x.status === 'trimmed');
    if (!c) { if (!queue().some((x) => ['waiting', 'trimming', 'trimmed'].includes(x.status))) return; await sleep(2000); continue; }
    c.status = 'converting'; c.engine = engine; c.started = Date.now(); active.set(engine, c); save();
    const tmp = join(TMP, c.name + '.mp4');
    const t0 = Date.now();
    let used = engine;
    try {
      try { await run('ffmpeg', ffArgs(engine, c, tmp)); } catch (e) { used = 'cpu'; await run('ffmpeg', ffArgs('cpu', c, tmp)); } // engine problem: slower but sure
      // into the current batch folder (15 per folder)
      const open = Object.keys(state.batches).map(Number).sort((a, b) => a - b).find((n) => !state.batches[n].uploaded && state.batches[n].files.length < BATCH);
      const n = open ?? Math.max(0, ...Object.keys(state.batches).map(Number)) + 1;
      state.batches[n] ??= { files: [], uploaded: false };
      const dir = join(OUT, `Batch ${pad(n)}`); mkdirSync(dir, { recursive: true });
      renameSync(tmp, join(dir, c.name + '.mp4'));
      state.batches[n].files.push(c.rel);
      Object.assign(c, { status: 'done', batch: n, engine: used, outSize: statSync(join(dir, c.name + '.mp4')).size, seconds: Math.round((Date.now() - t0) / 1000) });
    } catch (e) {
      rmSync(tmp, { force: true });
      Object.assign(c, { status: 'error', error: e.message.slice(0, 200) });
    }
    active.delete(engine);
    save();
    writeManifest();
  }
}

// What the YouTube inbox needs to recognise each uploaded file
function writeManifest() {
  const m = {};
  for (const c of Object.values(state.clips)) if (c.status === 'done') {
    m[c.name + '.mp4'] = { training: c.rel.split('/')[0], clip: c.rel, recorded: c.created, duration: Math.round(c.trimEnd - c.trimStart), cutStart: c.trimStart, cutEnd: Math.round((c.duration - c.trimEnd) * 10) / 10 };
  }
  writeFileSync(join(OUT, '_state', 'manifest.json'), JSON.stringify(m, null, 1));
}

// ---------- 4. progress page ----------
const KEY = randomBytes(16).toString('hex'); // only this page may press the buttons
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const hms = (s) => (s >= 3600 ? `${Math.floor(s / 3600)}h ${pad(Math.floor((s % 3600) / 60))}m` : `${Math.floor(s / 60)}m ${pad(Math.round(s % 60))}s`);
function page() {
  const all = Object.values(state.clips).filter((c) => c.status !== 'skipped');
  const done = all.filter((c) => c.status === 'done');
  const secs = (l) => l.reduce((a, c) => a + (c.duration || 0), 0);
  const doneWork = done.filter((c) => c.seconds);
  const speed = doneWork.length ? secs(doneWork) / doneWork.reduce((a, c) => a + c.seconds, 0) * Math.max(1, active.size) : 0;
  const left = secs(all.filter((c) => c.status !== 'done' && c.status !== 'error'));
  const pct = Math.round((secs(done) / Math.max(1, secs(all))) * 100);
  const batches = Object.entries(state.batches).sort((a, b) => a[0] - b[0]);
  const rows = batches.map(([n, b]) => {
    const full = b.files.length >= BATCH || (!queue().some((c) => ['waiting', 'trimming', 'trimmed', 'converting'].includes(c.status)));
    const size = b.files.reduce((a, r) => a + (state.clips[r].outSize || 0), 0);
    const st = b.uploaded ? '<span class="tag done">Uploaded · space freed</span>' : full ? '<span class="tag ready">Ready to upload</span>' : `<span class="tag">Filling · ${b.files.length}/${BATCH}</span>`;
    const actions = b.uploaded ? '' : `<form method="post" action="/open"><input type="hidden" name="b" value="${n}"><button>Open folder</button></form>` +
      (full ? `<form method="post" action="/uploaded" onsubmit="return confirm('Are all ${b.files.length} videos of Batch ${pad(n)} on YouTube (upload complete)? The 1080p copies in this folder will be deleted. Your originals stay on the ICCD drive.')"><input type="hidden" name="b" value="${n}"><button class="warn">Uploaded → free the space</button></form>` : '');
    return `<tr><td><b>Batch ${pad(n)}</b><br><small>${esc(join(OUT, 'Batch ' + pad(n)))}</small></td><td>${b.files.length} videos · ${(size / 1e9).toFixed(1)} GB</td><td>${st}</td><td class="act">${actions}</td></tr>`;
  }).join('');
  const now = [...active.entries()].map(([e, c]) => `<li><b>${e === 'nvenc' ? 'Graphics card' : e === 'qsv' ? 'Quick Sync' : 'Processor'}</b> ${esc(c.name)} · ${hms(c.trimEnd - c.trimStart)} of video</li>`).join('') || '<li>Nothing right now</li>';
  const cuts = done.filter((c) => c.trimStart > 0 || c.duration - c.trimEnd > 0.5).slice(-40).reverse()
    .map((c) => `<tr><td>${esc(c.name)}</td><td>${c.trimStart ? c.trimStart + ' s' : '–'}</td><td>${c.duration - c.trimEnd > 0.5 ? (c.duration - c.trimEnd).toFixed(1) + ' s' : '–'}</td></tr>`).join('');
  const errors = all.filter((c) => c.status === 'error').map((c) => `<li>${esc(c.rel)}: ${esc(c.error)}</li>`).join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="refresh" content="15"><title>ICCD · YouTube preparation</title>
<style>body{margin:0;font:15px/1.5 system-ui,sans-serif;background:#fcfaf6;color:#14110d}header{background:#14110d;color:#e8c95f;padding:18px 28px}h1{margin:0;font-size:20px}main{padding:24px 28px;max-width:1100px}
.bar{height:14px;background:#efe6d3;border-radius:99px;overflow:hidden;margin:8px 0 4px}.bar i{display:block;height:100%;background:#e8c95f;width:${pct}%}
.stats{display:flex;gap:28px;flex-wrap:wrap;margin:14px 0 24px}.stats b{display:block;font-size:24px}table{width:100%;border-collapse:collapse;background:#fff;border-radius:12px;overflow:hidden;margin-bottom:24px}
td,th{padding:10px 12px;border-bottom:1px solid #efe6d3;text-align:left;vertical-align:middle}small{color:#746a5a}.tag{display:inline-block;padding:4px 10px;border-radius:99px;background:#efe6d3;font-size:13px;font-weight:700}
.tag.ready{background:#e8c95f}.tag.done{background:#e7f3ea;color:#1f5a2e}.act form{display:inline}button{border:1px solid #d8cfbd;background:#fff;border-radius:99px;padding:7px 14px;font-weight:700;cursor:pointer;margin:2px}button.warn{background:#14110d;color:#e8c95f;border-color:#14110d}
h2{font-size:16px;margin:26px 0 8px}ol,ul{background:#fff;border-radius:12px;padding:12px 30px}.help{background:#fff4d6;border-radius:12px;padding:12px 16px}</style></head><body>
<header><h1>ICCD · Preparing the videos for YouTube</h1></header><main>
<div class="bar"><i></i></div><small>${pct}% · updates every 15 seconds</small>
<div class="stats"><div><b>${done.length} / ${all.length}</b>videos ready</div><div><b>${hms(secs(done))}</b>of video converted</div><div><b>${speed ? '≈ ' + hms(left / speed) : '…'}</b>left (≈ ${speed ? speed.toFixed(1) : '…'}× real time)</div></div>
<p class="help"><b>How to upload:</b> open <a href="https://studio.youtube.com" target="_blank">YouTube Studio</a> → Create → Upload videos → drag in all files of a <b>Ready</b> batch (15 at a time). Visibility is Unlisted if you set it under Settings → Upload defaults. When YouTube shows the uploads as complete, click <b>Uploaded → free the space</b>.</p>
<h2>Batches</h2><table>${rows || '<tr><td>The first batch appears after the first video is converted.</td></tr>'}</table>
<h2>Converting now</h2><ul>${now}</ul>
${errors ? `<h2>Problems</h2><ul>${errors}</ul>` : ''}
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
      if (req.url === '/uploaded') { // delete only the 1080p copies of this batch
        for (const r of b.files) rmSync(join(dir, state.clips[r].name + '.mp4'), { force: true });
        try { rmSync(dir, { recursive: false }); } catch { /* folder not empty: leave it */ }
        b.uploaded = true; save();
      }
    }
    res.writeHead(303, { Location: '/' }); res.end();
  });
});

// ---------- go ----------
let stopping = false;
process.on('SIGINT', () => { if (stopping) process.exit(1); stopping = true; console.log('\nStopping after the videos being converted now (Ctrl+C again to stop at once)…'); });
await scan();
server.listen(PORT, '127.0.0.1', () => console.log(`Progress page: http://localhost:${PORT}`));
const total = Object.values(state.clips).filter((c) => c.status !== 'skipped');
console.log(`${total.length} videos to prepare (${(total.reduce((a, c) => a + (c.duration || 0), 0) / 3600).toFixed(1)} h), ${total.filter((c) => c.status === 'done').length} already done`);
await Promise.all([trimmer(), trimmer(), converter('nvenc'), converter('qsv')]);
writeManifest();
console.log(stopping ? 'Stopped. Run again to continue.' : 'All videos are prepared.');
server.close();
