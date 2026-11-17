// Isolated fault checks on the production build. The build is served unchanged from a temporary
// directory beside a few QA files that exist only there; nothing here enters dist or the shipped page.
//
//   node scripts/browser-qa.mjs [port=5200]      serve, then open one of the pages below
//   node scripts/browser-qa.mjs --check          write the QA files, check them against the build, and exit
//
// Open http://localhost:5200/rewire/?scenario=<name>. Several names can be joined with commas.
//
//   reset        Adds "Simulate GPU reset" (Alt+Shift+G): the real engine client is told its device was lost.
//   worker-fail  Adds "Fail engine worker" (Alt+Shift+W): the engine worker is terminated and reports an
//                error, as a crashed worker does. Use it with the tiny model on screen, or on the Grow bench
//                before "Open this model in the full lab".
//   worker-dead  The engine worker throws while starting, so it never answers. `&dead=N` fails the first N
//                engine workers (default 1); the ones after that are the real worker.
//   no-gpu       The page has no navigator.gpu.
//   storage      The engine worker's cache storage refuses to open.
//   corrupt      The first weight chunk in the cache is replaced with zeros before the model loads; the page
//                must download it again. It needs the model: the pinned remote one (about 385 MB on a first
//                visit to this origin), or local weights in artifacts/weights with a build made with
//                VITE_WEIGHTS_URL=/weights/.
//
// The buttons sit in a small fixed panel; the key chords do the same when a dialog covers the page.
// Every event is logged to the console as QA_<EVENT>.
import { existsSync, mkdtempSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";

const args = process.argv.slice(2), check = args.includes("--check"), port = args.find((a) => /^\d+$/.test(a)) ?? "5200";
const dist = resolve(import.meta.dirname, "..", "dist");
if (!existsSync(join(dist, "index.html"))) throw new Error("Build the page first: pnpm build");
const html = readFileSync(join(dist, "index.html"), "utf8");
// The entry is under the deployed subpath (/rewire/assets/…) in a production build, and at the root in others.
const entry = /<script[^>]*\ssrc="((?:\/[^"/]+)*\/assets\/index-[^"]+\.js)"/.exec(html)?.[1];
const engine = readdirSync(join(dist, "assets")).find((n) => /^worker-.*\.js$/.test(n));
if (!entry || !engine) throw new Error("The build has no entry script or no engine worker. Build the page again: pnpm build");
const base = entry.slice(0, entry.indexOf("/assets/"));
const CACHE = "rewire-weights-v1";
if (!readFileSync(join(dist, "assets", engine), "utf8").includes(CACHE)) throw new Error(`The engine worker no longer uses the cache "${CACHE}". Update the corrupt scenario.`);

const qa = mkdtempSync(join(tmpdir(), "rewire-browser-qa-"));
for (const name of readdirSync(dist)) if (name !== "index.html") symlinkSync(join(dist, name), join(qa, name));
const files = {
  "index.html": html.replace(entry, `${base}/qa.js`),
  // Cache storage is refused before the real worker is evaluated: imports run in this order.
  "qa-no-cache.js": `Object.defineProperty(globalThis, 'caches', { value: { open: async () => { throw new Error('QA storage refused'); } } });\n`,
  "qa-worker.js": `import '${base}/qa-no-cache.js';\nimport '${base}/assets/${engine}';\n`,
  "qa-dead-worker.js": `throw new Error('QA: the engine worker failed to start');\n`,
  "qa.js": `
const params = new URLSearchParams(location.search);
const scenarios = new Set((params.get('scenario') ?? '').split(',').map((s) => s.trim()).filter(Boolean));
const on = (name) => scenarios.has(name);
const known = ['reset', 'worker-fail', 'worker-dead', 'no-gpu', 'storage', 'corrupt'];
const unknown = [...scenarios].filter((s) => !known.includes(s));
const log = (event, ...rest) => { console.log('QA_' + event, ...rest); said(event.toLowerCase().replaceAll('_', ' ') + (rest.length ? ' ' + rest.join(' ') : '')); };

// ---- the panel: fixed, small, and outside the page's own markup
const panel = document.createElement('div');
panel.setAttribute('role', 'group');
panel.setAttribute('aria-label', 'QA controls');
panel.style.cssText = 'position:fixed;left:8px;bottom:8px;z-index:2147483647;display:flex;flex-wrap:wrap;gap:6px;align-items:center;max-width:min(420px,calc(100vw - 16px));padding:6px 8px;font:12px/1.3 system-ui,sans-serif;color:#fff;background:#7a1f1f;border-radius:6px;box-shadow:0 2px 10px rgba(0,0,0,.4)';
const title = document.createElement('strong');
title.textContent = 'QA: ' + ([...scenarios].join(', ') || 'no scenario');
const status = document.createElement('span');
status.style.cssText = 'flex-basis:100%;opacity:.85';
panel.append(title);
function said(text) { status.textContent = text; }
function control(label, chord, run) {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = label + ' (Alt+Shift+' + chord + ')';
  b.style.cssText = 'font:inherit;color:#111;background:#fff;border:0;border-radius:4px;padding:6px 8px;min-height:32px;cursor:pointer';
  b.onclick = run;
  panel.append(b);
  // The same action from the keyboard, for when a modal dialog makes the rest of the page inert.
  addEventListener('keydown', (e) => { if (e.altKey && e.shiftKey && e.code === 'Key' + chord) { e.preventDefault(); run(); } }, true);
}
if (unknown.length) said('unknown scenario: ' + unknown.join(', ') + '. Known: ' + known.join(', '));

// ---- faults that are in place before the page starts
if (on('no-gpu')) { delete Object.getPrototypeOf(navigator).gpu; log('NO_GPU'); }
let dead = on('worker-dead') ? Math.max(1, Number(params.get('dead') ?? 1) || 1) : 0;

// ---- the engine worker, as the page creates it
const ActualWorker = Worker;
let engineWorker = null, engineWorkers = 0, poisoned = null;
window.Worker = class extends ActualWorker {
  constructor(url, options) {
    const isEngine = String(url).includes('/assets/worker-');
    const fails = isEngine && dead > 0;
    if (fails) dead--;
    super(fails ? '${base}/qa-dead-worker.js' : isEngine && on('storage') ? '${base}/qa-worker.js' : url, options);
    if (!isEngine) return;
    engineWorker = this;
    engineWorkers++;
    this.qaGate = Promise.resolve();
    this.addEventListener('message', onMessage);
    this.addEventListener('error', (e) => log('ENGINE_WORKER_ERROR', e.message || 'worker error'));
    log('ENGINE_WORKER', engineWorkers, fails ? 'fails to start' : on('storage') ? 'without cache storage' : 'real');
  }
  postMessage(message, ...rest) {
    // Only the corrupt scenario delays anything: the load waits until the cache has been poisoned, and
    // every message after it keeps its place in line.
    if (this !== engineWorker || !on('corrupt')) return super.postMessage(message, ...rest);
    this.qaGate = this.qaGate.then(async () => {
      if (message?.t === 'load' && !poisoned) await poison(message.base).catch((e) => log('CACHE_POISON_FAILED', String(e?.message ?? e)));
      super.postMessage(message, ...rest);
    });
  }
};
async function poison(weights) {
  const root = new URL(weights, location.href).href;
  const manifest = await (await fetch(root + 'manifest.json')).json();
  const first = manifest.files[0];
  const cache = await caches.open('${CACHE}');
  await cache.put(root + first.name, new Response(new Uint8Array(first.bytes)));
  poisoned = { url: root + first.name, sha256: first.sha256 };
  log('CACHE_POISONED', first.name);
}
async function onMessage(e) {
  if (e.data?.t !== 'done' || !e.data.result?.manifestHash) return;
  log('LOADED', JSON.stringify(e.data.result));
  if (!poisoned) return;
  const cache = await caches.open('${CACHE}');
  const response = await cache.match(poisoned.url);
  if (!response) return log('CACHE_REPAIRED', false, 'the chunk is not in the cache');
  const hash = await crypto.subtle.digest('SHA-256', await response.arrayBuffer());
  const actual = Array.from(new Uint8Array(hash), (n) => n.toString(16).padStart(2, '0')).join('');
  log('CACHE_REPAIRED', actual === poisoned.sha256);
}

// ---- faults the tester triggers
if (on('reset')) control('Simulate GPU reset', 'G', () => {
  if (!engineWorker) return said('no engine worker yet');
  engineWorker.dispatchEvent(new MessageEvent('message', { data: { t: 'lost' } }));
  log('GPU_RESET', 'sent to engine worker', engineWorkers);
});
if (on('worker-fail')) control('Fail engine worker', 'W', () => {
  if (!engineWorker) return said('no engine worker yet');
  // A crashed worker never answers again and reports an error on its Worker object. Both happen here.
  engineWorker.terminate();
  engineWorker.dispatchEvent(new ErrorEvent('error', { message: 'QA: the engine worker stopped' }));
  log('WORKER_FAILED', 'engine worker', engineWorkers);
});
panel.append(status);
document.body.append(panel);

await import('${entry}');
`,
};
for (const [name, text] of Object.entries(files)) writeFileSync(join(qa, name), text);

if (check) {
  // The page that is served starts the QA script, and the build that ships knows nothing of it.
  const served = readFileSync(join(qa, "index.html"), "utf8");
  if (!served.includes(`src="${base}/qa.js"`) || served.includes(entry)) throw new Error("The QA page does not start from qa.js");
  const shipped = [join(dist, "index.html"), ...readdirSync(join(dist, "assets")).filter((n) => /\.(js|css)$/.test(n)).map((n) => join(dist, "assets", n))];
  for (const file of shipped) {
    if (/qa-worker|qa-dead-worker|qa-no-cache|\/qa\.js|QA_[A-Z]/.test(readFileSync(file, "utf8"))) throw new Error(`QA code found in the build: ${file}`);
  }
  if (readdirSync(dist).some((n) => n.startsWith("qa"))) throw new Error("QA files found in the build");
  console.log(JSON.stringify({ status: "passed", directory: qa, base: base || "/", entry, engine: `${base}/assets/${engine}`, files: Object.keys(files) }));
} else {
  console.log(`QA page: http://localhost:${port}${base}/?scenario=reset,worker-fail  (see the top of this script for every scenario)`);
  const child = spawn(process.execPath, [join(import.meta.dirname, "throttled-serve.mjs"), port, "0", "0"],
    { env: { ...process.env, REWIRE_DIST: qa }, stdio: "inherit" });
  for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
  child.on("exit", (code) => { process.exitCode = code ?? 0; });
}
