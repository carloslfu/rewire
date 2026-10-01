// Serves the production build and the local weights through one shared, throttled connection, to check what a
// visitor on a slow network sees first (section 5.1). Not used in production.
//
//   node scripts/throttled-serve.mjs [port=5199] [kbps=1100] [latency_ms=170]
import { createReadStream, existsSync, readdirSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, resolve } from "node:path";
import { Transform } from "node:stream";

const [port = 5199, kbps = 1100, latency = 170] = process.argv.slice(2).map(Number);
const dist = resolve(import.meta.dirname, "..", "dist");
const weightsRoot = resolve(import.meta.dirname, "..", "..", "artifacts", "weights");
const weights = join(weightsRoot, process.env.REWIRE_WEIGHTS ?? readdirSync(weightsRoot).sort()[0]);
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml",
  ".txt": "text/plain", ".wasm": "application/wasm" };

// one bucket for every response, like a single slow link
let next = Date.now();
const slow = () => new Transform({
  transform(chunk, _e, done) {
    next = Math.max(next, Date.now()) + (chunk.length / (kbps * 1024)) * 1000;
    setTimeout(() => done(null, chunk), next - Date.now());
  },
});

createServer((req, res) => {
  setTimeout(() => {
    const url = decodeURIComponent((req.url ?? "/").split("?")[0]);
    const inWeights = url.startsWith("/weights/");
    const base = inWeights ? weights : dist;
    let file = join(base, inWeights ? url.slice("/weights/".length) : url);
    if (!file.startsWith(base)) { res.statusCode = 403; return res.end(); }
    if (!inWeights && (!existsSync(file) || statSync(file).isDirectory())) file = join(dist, "index.html");
    if (!existsSync(file)) { res.statusCode = 404; return res.end(); }
    const size = statSync(file).size;
    res.setHeader("Content-Type", types[extname(file)] ?? "application/octet-stream");
    res.setHeader("Accept-Ranges", "bytes");
    const range = /bytes=(\d+)-(\d*)/.exec(req.headers.range ?? "");
    const a = range ? Number(range[1]) : 0, b = range && range[2] ? Number(range[2]) : size - 1;
    res.statusCode = range ? 206 : 200;
    if (range) res.setHeader("Content-Range", `bytes ${a}-${b}/${size}`);
    res.setHeader("Content-Length", String(b - a + 1));
    if (req.method === "HEAD") return res.end();
    createReadStream(file, { start: a, end: b }).pipe(slow()).pipe(res);
  }, latency);
}).listen(port, () => console.log(`throttled at ${kbps} KB/s, ${latency} ms: http://localhost:${port}/`));
