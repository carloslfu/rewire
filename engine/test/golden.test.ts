// Parity against the Python reference's golden traces (section 7.5), on the real converted model.
// Needs artifacts/weights/<id> and artifacts/golden/<id> (py/tools/convert.py and golden.py); skips otherwise.
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { type ChangeSpec, encodeTable } from "../src/changes.ts";
import { download, getDevice, storage } from "../src/gpu.ts";
import { configOf, type Loaded, loadWeights, type Manifest } from "../src/manifest.ts";
import { Model } from "../src/model.ts";

const ROOT = join(__dirname, "..", "..", "artifacts");
const WID = process.env.REWIRE_WEIGHTS ?? (existsSync(join(ROOT, "weights")) ? readdirSync(join(ROOT, "weights"))[0] : "");
const WDIR = join(ROOT, "weights", WID ?? "");
const GDIR = join(ROOT, "golden", WID ?? "");
const have = !!WID && existsSync(join(WDIR, "manifest.json")) && existsSync(GDIR);

export function readSafetensors(path: string): Map<string, { dtype: string; shape: number[]; data: ArrayBuffer }> {
  const buf = readFileSync(path);
  const n = Number(buf.readBigUInt64LE(0));
  const header = JSON.parse(buf.subarray(8, 8 + n).toString("utf8"));
  const base = 8 + n;
  const out = new Map();
  for (const [k, v] of Object.entries<any>(header)) {
    if (k === "__metadata__") continue;
    const [a, b] = v.data_offsets;
    out.set(k, { dtype: v.dtype, shape: v.shape, data: buf.buffer.slice(buf.byteOffset + base + a, buf.byteOffset + base + b) });
  }
  return out;
}

let dev: GPUDevice;
let man: Manifest;
let loaded: Loaded;
let model: Model;
const MAXCTX = 256;

describe.skipIf(!have)("golden traces", () => {
  beforeAll(async () => {
    const wg = await import("webgpu");
    Object.assign(globalThis, wg.globals);
    dev = await getDevice(wg.create([]));
    man = JSON.parse(readFileSync(join(WDIR, "manifest.json"), "utf8"));
    loaded = await loadWeights(dev, man, async (f) => {
      const b = readFileSync(join(WDIR, f.name));
      return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
    });
    model = new Model(dev, configOf(man, MAXCTX), loaded.weights);
  }, 300_000);

  const cases = have ? readdirSync(GDIR).filter((f) => f.endsWith(".json") && existsSync(join(GDIR, f.replace(".json", ".safetensors"))))
    .map((f) => f.replace(".json", "")) : [];
  const report: Record<string, unknown> = {};
  for (const name of cases) {
    it(`matches ${name}`, async () => {
      const c = JSON.parse(readFileSync(join(GDIR, `${name}.json`), "utf8"));
      const g = readSafetensors(join(GDIR, `${name}.safetensors`));
      const cfg = model.cfg, W = cfg.width;
      const conv = model.conversation();
      const cap = storage(dev, (cfg.floors + 1) * MAXCTX * W * 4, "capture");
      conv.setCapture(cap);
      conv.setTable(encodeTable(c.changes as ChangeSpec, cfg, { vector: (id, L) => loaded.concepts.get(id)![L], rho: man.rho },
        c.concept_first));
      const prompt: number[] = c.tokens.slice(0, c.prompt_length);
      const gen: number[] = c.generated;
      conv.read(prompt.slice(0, -1));
      const topS = new Float32Array(g.get("top_scores")!.data), topI = new Int32Array(g.get("top_ids")!.data);
      const pyPush = new Float32Array(g.get("pushes")!.data);
      const P = cfg.floors * (cfg.queryHeads + 1) + 1;
      const errs: number[] = [];
      let pushErr = 0, agree = 0, topChecked = 0, topAgree = 0;
      let worstPush: Record<string, number> = {};
      let pushRatio = 0;
      for (let i = 0; i < gen.length; i++) {
        conv.step(i === 0 ? prompt[prompt.length - 1] : gen[i - 1], { seed: c.seed, turn: 0, step: i });
        const s = new Float32Array(await download(dev, conv.scores));
        const out = new Uint32Array(await download(dev, conv.sampleOut));
        const pu = new Float32Array(await download(dev, conv.pushes));
        if (out[0] === gen[i]) agree++;
        const pos = prompt.length - 1 + i;
        for (let k = 0; k < 64; k++) errs.push(Math.abs(s[topI[pos * 64 + k]] - topS[pos * 64 + k]));
        if (topS[pos * 64] - topS[pos * 64 + 1] > 0.05) {
          topChecked++;
          let best = 0;
          for (let t = 1; t < cfg.vocabReal; t++) if (s[t] > s[best]) best = t;
          if (best === topI[pos * 64]) topAgree++;
        }
        // pushes are computed toward the engine's own pick; compare when it matches Python's
        // Pushes agree within 0.01 or 0.5% of the push, whichever is larger: about twice the reference's own float32
        // noise against float64 (tools/push_noise.py; up to 0.018, or 0.23% of the push, on large pushes).
        if (out[0] === gen[i]) for (let p = 0; p < P; p++) {
          const py = pyPush[i * P + p], e = Math.abs(pu[p] - py);
          pushRatio = Math.max(pushRatio, e / Math.max(0.01, 0.005 * Math.abs(py)));
          if (e > pushErr) { pushErr = e; worstPush = { step: i, p, floor: p === 0 ? -1 : Math.floor((p - 1) / (cfg.queryHeads + 1)), part: p === 0 ? -1 : (p - 1) % (cfg.queryHeads + 1), engine: pu[p], python: py }; }
        }
      }
      errs.sort((a, b) => a - b);
      const maxErr = errs[errs.length - 1], p99 = errs[Math.floor(errs.length * 0.99)];
      // streams: relative error per floor over all positions read
      const capd = new Float32Array(await download(dev, cap));
      const T = prompt.length - 1 + gen.length;
      let worstStream = 0;
      for (let L = 0; L <= cfg.floors; L++) {
        const ref = new Float32Array(g.get(`stream_${L}`)!.data);
        let num = 0, den = 0;
        for (let p = 0; p < T; p++) {
          for (let i = 0; i < W; i++) {
            const a = capd[(L * MAXCTX + p) * W + i], b = ref[p * W + i];
            num += (a - b) ** 2; den += b * b;
          }
        }
        worstStream = Math.max(worstStream, Math.sqrt(num / den));
      }
      const r = { tokens: T, maxErr, p99, pushErr, pushRatio, worstPush, sampleAgree: agree / gen.length, topAgree: `${topAgree}/${topChecked}`, worstStream };
      report[name] = r;
      writeFileSync(join(GDIR, "engine-report.json"), JSON.stringify(report, null, 1));
      console.log(name, JSON.stringify(r));
      // Section 7.5, with the 99th percentile set from measured noise: the float32 reference itself differs from
      // float64 by about 0.005 at the 99th percentile (py/tools/noise.py), so 0.002 sat below the reference's own
      // noise. See db/records/decisions/2026-10-01-score-tolerance.md.
      expect(maxErr).toBeLessThan(0.01);
      expect(p99).toBeLessThan(0.01);
      expect(worstStream).toBeLessThan(0.001);
      expect(pushRatio).toBeLessThan(1);
      expect(topAgree).toBe(topChecked);
    }, 300_000);
  }
});
