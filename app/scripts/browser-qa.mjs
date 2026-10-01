// Isolated production-build fault checks. No test hooks enter the shipped page or worker.
// node scripts/browser-qa.mjs [port=5200], then /?scenario=reset|no-gpu|crashed|storage|corrupt
import { mkdtempSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";

const dist = resolve(import.meta.dirname, "..", "dist");
const qa = mkdtempSync(join(tmpdir(), "rewire-browser-qa-"));
for (const name of readdirSync(dist)) if (name !== "index.html") symlinkSync(join(dist, name), join(qa, name));
const html = readFileSync(join(dist, "index.html"), "utf8");
const entry = /src="(\/assets\/index-[^"]+\.js)"/.exec(html)?.[1];
const engine = readdirSync(join(dist, "assets")).find((n) => /^worker-.*\.js$/.test(n));
if (!entry || !engine) throw new Error("Build the page first");
writeFileSync(join(qa, "index.html"), html.replace(entry, "/qa.js"));
writeFileSync(join(qa, "qa-worker.js"), `import '/assets/${engine}'; Object.defineProperty(globalThis, 'caches', { value: { open: async () => { throw new Error('QA storage refused'); } } });`);
writeFileSync(join(qa, "qa.js"), `
const scenario = new URLSearchParams(location.search).get('scenario');
if (scenario === 'no-gpu') delete Object.getPrototypeOf(navigator).gpu;
if (scenario === 'crashed') localStorage.setItem('rewire-live-session', '1');
const ActualWorker = Worker;
let modelWorker;
window.Worker = class extends ActualWorker {
  constructor(url, options) {
    const isEngine = String(url).includes('/assets/worker-');
    super(scenario === 'storage' && isEngine ? '/qa-worker.js' : url, options);
    if (isEngine) { modelWorker = this; this.addEventListener('message', onMessage); }
  }
};
async function onMessage(e) {
  if (e.data.t !== 'done' || !e.data.result?.manifestHash) return;
  console.log('QA_LOADED', JSON.stringify(e.data.result));
  if (scenario === 'corrupt') {
    const cache = await caches.open('rewire-weights-v1');
    const response = await cache.match(location.origin + '/weights/' + first.name);
    const hash = await crypto.subtle.digest('SHA-256', await response.arrayBuffer());
    const actual = Array.from(new Uint8Array(hash), n => n.toString(16).padStart(2, '0')).join('');
    console.log('QA_CACHE_REPAIRED', actual === first.sha256);
  }
}
let first;
if (scenario === 'corrupt') {
  first = (await (await fetch('/weights/manifest.json')).json()).files[0];
  const cache = await caches.open('rewire-weights-v1');
  await cache.put(location.origin + '/weights/' + first.name, new Response(new Uint8Array(first.bytes)));
}
await import('${entry}');
if (scenario === 'reset') {
  const b = document.createElement('button');
  b.textContent = 'Simulate GPU reset';
  b.onclick = () => modelWorker.dispatchEvent(new MessageEvent('message', {data: {t: 'lost'}}));
  document.body.append(b);
}
`);
const child = spawn(process.execPath, [join(import.meta.dirname, "throttled-serve.mjs"), process.argv[2] ?? "5200", "0", "0"],
  { env: { ...process.env, REWIRE_DIST: qa }, stdio: "inherit" });
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
child.on("exit", (code) => { process.exitCode = code ?? 0; });
