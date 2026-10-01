// Serves the production build and the local weights through one shared, throttled connection, to check what a
// visitor on a slow network sees first (section 5.1). Not used in production.
//
//   node scripts/throttled-serve.mjs [port=5199] [kbps=1100] [latency_ms=170]
import { createReadStream, existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, resolve, sep } from "node:path";
import { Transform } from "node:stream";

const [port = 5199, kbps = 1100, latency = 170] = process.argv.slice(2).map(Number);
const dist = process.env.REWIRE_DIST ? resolve(process.env.REWIRE_DIST) : resolve(import.meta.dirname, "..", "dist");
const weightsRoot = resolve(import.meta.dirname, "..", "..", "artifacts", "weights");
const weights = join(weightsRoot, process.env.REWIRE_WEIGHTS ?? readdirSync(weightsRoot).sort()[0]);
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml",
  ".txt": "text/plain", ".wasm": "application/wasm" };

// Exercise the same response policies as the deployment, including workers and training under CSP.
const policies = [];
let policy;
for (const line of readFileSync(join(dist, "_headers"), "utf8").split("\n")) {
  if (!line.trim() || line.trimStart().startsWith("#")) continue;
  if (!line.startsWith(" ")) { policy = { path: line.trim(), headers: [] }; policies.push(policy); }
  else {
    const split = line.indexOf(":");
    if (policy && split >= 0) policy.headers.push([line.slice(0, split).trim(), line.slice(split + 1).trim()]);
  }
}

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
    let url;
    try { url = decodeURIComponent((req.url ?? "/").split("?")[0]); }
    catch { res.statusCode = 400; return res.end(); }
    if (url.includes("\0")) { res.statusCode = 400; return res.end(); }
    for (const policy of policies) {
      if (policy.path.endsWith("*") ? url.startsWith(policy.path.slice(0, -1)) : url === policy.path) {
        for (const [name, value] of policy.headers) res.setHeader(name, value);
      }
    }
    const inWeights = url.startsWith("/weights/");
    const base = inWeights ? weights : dist;
    let file = join(base, inWeights ? url.slice("/weights/".length) : url);
    if (file !== base && !file.startsWith(base + sep)) { res.statusCode = 403; return res.end(); }
    if (!inWeights && (!existsSync(file) || statSync(file).isDirectory()) && !extname(url)) file = join(dist, "index.html");
    if (!existsSync(file)) { res.statusCode = 404; return res.end(); }
    const size = statSync(file).size;
    res.setHeader("Content-Type", types[extname(file)] ?? "application/octet-stream");
    res.setHeader("Accept-Ranges", "bytes");
    const range = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range ?? "");
    const a = range ? Number(range[1]) : 0, b = range && range[2] ? Number(range[2]) : size - 1;
    if ((req.headers.range && !range) || a > b || a >= size || b >= size) {
      res.statusCode = 416; res.setHeader("Content-Range", `bytes */${size}`); return res.end();
    }
    res.statusCode = range ? 206 : 200;
    if (range) res.setHeader("Content-Range", `bytes ${a}-${b}/${size}`);
    res.setHeader("Content-Length", String(b - a + 1));
    if (req.method === "HEAD") return res.end();
    const stream = createReadStream(file, { start: a, end: b });
    const output = kbps > 0 ? stream.pipe(slow()) : stream;
    res.on("close", () => { stream.destroy(); output.destroy(); });
    output.on("error", () => res.destroy()).pipe(res);
  }, latency);
}).listen(port, "127.0.0.1", () => console.log(`${kbps > 0 ? `throttled at ${kbps} KB/s` : "unthrottled"}, ${latency} ms: http://localhost:${port}/`));
