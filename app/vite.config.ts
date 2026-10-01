import { existsSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

// In development the converted weights are served from artifacts/weights/<id>/ at /weights/.
// In production they come from Hugging Face (VITE_WEIGHTS_URL); they are never part of the build.
function localWeights(): Plugin {
  const root = resolve(__dirname, "..", "artifacts", "weights");
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
          createReadStream(file, { start: a, end: b }).pipe(res);
        } else {
          res.setHeader("Content-Length", String(size));
          createReadStream(file).pipe(res);
        }
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), localWeights()],
  worker: { format: "es" },
  build: { target: "es2022", sourcemap: true },
  server: { port: 5178 },
});
