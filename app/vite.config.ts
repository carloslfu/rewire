import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { Transform } from "node:stream";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

// In development the converted weights are served from artifacts/weights/<id>/ at /weights/.
// In production they come from Hugging Face (VITE_WEIGHTS_URL); they are never part of the build.
// A slow connection can be simulated by writing a speed in KB/s to artifacts/.throttle (delete it to stop).
function localWeights(): Plugin {
  const root = resolve(import.meta.dirname, "..", "artifacts", "weights");
  const throttleFile = resolve(import.meta.dirname, "..", "artifacts", ".throttle");
  const throttle = () => {
    const kbps = existsSync(throttleFile) ? Number(readFileSync(throttleFile, "utf8").trim()) : 0;
    if (!(kbps > 0)) return null;
    let t = Date.now();
    return new Transform({
      transform(chunk: Buffer, _enc, done) {
        t = Math.max(t, Date.now()) + (chunk.length / (kbps * 1024)) * 1000;
        setTimeout(() => done(null, chunk), t - Date.now());
      },
    });
  };
  return {
    name: "rewire-local-weights",
    configureServer(server) {
      server.middlewares.use("/weights", async (req, res, next) => {
        const id = process.env.REWIRE_WEIGHTS ?? (existsSync(root) ? readdirSync(root).sort()[0] : undefined);
        if (!id) return next();
        const { createReadStream, statSync } = await import("node:fs");
        const file = join(root, id, (req.url ?? "/").split("?")[0]);
        if (!file.startsWith(join(root, id)) || !existsSync(file) || statSync(file).isDirectory()) return next();
        const size = statSync(file).size;
        const range = /bytes=(\d+)-(\d*)/.exec(req.headers.range ?? "");
        res.setHeader("Accept-Ranges", "bytes");
        res.setHeader("Content-Type", file.endsWith(".json") ? "application/json" : "application/octet-stream");
        if (range) {
          const a = Number(range[1]), b = range[2] ? Number(range[2]) : size - 1;
          res.statusCode = 206;
          res.setHeader("Content-Range", `bytes ${a}-${b}/${size}`);
          res.setHeader("Content-Length", String(b - a + 1));
          const src = createReadStream(file, { start: a, end: b }), slow = throttle();
          (slow ? src.pipe(slow) : src).pipe(res);
        } else {
          res.setHeader("Content-Length", String(size));
          const src = createReadStream(file), slow = throttle();
          (slow ? src.pipe(slow) : src).pipe(res);
        }
      });
    },
  };
}

export default defineConfig(({ command }) => ({
  base: command === "build" ? "/rewire/" : "/",
  plugins: [react(), localWeights()],
  worker: { format: "es" },
  build: { target: "es2022", sourcemap: true },
  server: { port: 5178 },
}));
