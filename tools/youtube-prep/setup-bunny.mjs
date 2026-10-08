// One-time connection to Bunny Stream. Run it in your own terminal:
//   node tools/youtube-prep/setup-bunny.mjs
// It asks for the library details (keys are typed hidden), checks them with Bunny, saves them
// for the uploader next to the converted videos (never in the repository), and gives them to
// the team-area service on Cloudflare.
import { createInterface } from 'node:readline';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const OUT = process.argv[2] || 'F:/ICCD YouTube';
const WORKER = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'worker');

function ask(question, hidden = false) {
  return new Promise((ok) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    if (hidden) rl._writeToOutput = (s) => rl.output.write(s.startsWith(question) ? s : '*'.repeat(Math.min(s.length, 1)));
    rl.question(question, (a) => { rl.close(); if (hidden) process.stdout.write('\n'); ok(a.trim()); });
  });
}

console.log('\nICCD · connect Bunny Stream\nFind these in bunny.net → Stream → your library:\n' +
  '  • Library ID and API key:   "API" tab\n  • Token authentication key: "Security" tab (Embed view token authentication)\n' +
  '  • CDN hostname:             "API" tab, e.g. vz-1234abcd-567.b-cdn.net\n');
const id = await ask('Library ID: ');
const key = await ask('API key (hidden): ', true);
const token = await ask('Token authentication key (hidden): ', true);
const cdn = (await ask('CDN hostname: ')).replace(/^https?:\/\//, '').replace(/\/.*$/, '');

const r = await fetch(`https://video.bunnycdn.com/library/${encodeURIComponent(id)}/videos?page=1&itemsPerPage=1`, { headers: { AccessKey: key, Accept: 'application/json' } });
if (!r.ok) { console.log(`\n✗ Bunny refused these details (${r.status}). Check the Library ID and API key and run this again.`); process.exit(1); }
const d = await r.json();
console.log(`✓ Connected to the library (${d.totalItems ?? 0} videos in it now).`);

mkdirSync(join(OUT, '_state'), { recursive: true });
writeFileSync(join(OUT, '_state', 'bunny.json'), JSON.stringify({ libraryId: id, apiKey: key, cdn }, null, 1));
console.log(`✓ Saved for the uploader in ${join(OUT, '_state', 'bunny.json')} (this PC only).`);

// the team area needs the same details to list, rename and play the videos
const secrets = { BUNNY_LIBRARY_ID: id, BUNNY_API_KEY: key, BUNNY_TOKEN_KEY: token, BUNNY_CDN: cdn };
for (const [name, value] of Object.entries(secrets)) {
  const s = spawnSync('npx', ['wrangler', 'secret', 'put', name], { cwd: WORKER, input: value, shell: true, encoding: 'utf8' });
  console.log(s.status === 0 ? `✓ ${name} stored in the team-area service` : `✗ Could not store ${name}: ${(s.stderr || s.stdout).trim().split('\n').pop()}`);
}
console.log('\nDone. You can close this window.');
