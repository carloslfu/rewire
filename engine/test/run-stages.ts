// Run the stage test outside vitest: npx tsx test/run-stages.ts
import { bitTable, encodeTable } from "../src/changes.ts";
import type { ModelConfig } from "../src/config.ts";
import { download, getDevice, upload } from "../src/gpu.ts";
import { Model } from "../src/model.ts";
import { deqQ4, synthModel } from "./cpuref.ts";
import { writeSync } from "node:fs";
const log = (m: string) => writeSync(2, m + "\n");

const wg = await import("webgpu");
Object.assign(globalThis, wg.globals);
log("a: before device");
const dev = await getDevice(wg.create([]));
log("b: device " + JSON.stringify({ws: dev.limits.maxComputeWorkgroupStorageSize, sb: dev.limits.maxStorageBuffersPerShaderStage}));
dev.addEventListener("uncapturederror", (e: any) => log("GPU error: " + e.error?.message));

const CFG: ModelConfig = {
  name: "synth1", floors: 1, width: 128, queryHeads: 4, kvHeads: 2, headSize: 32, units: 256, vocabRows: 512,
  vocabReal: 500, ropeTheta: 10000, eps: 1e-6, maxContext: 64, group: 32, dictBits: 4, floorBits: 4,
};
const m = synthModel(CFG, 5);
const f = m.floors[0];
const W = CFG.width, H = CFG.queryHeads, D = CFG.headSize, KV = CFG.kvHeads, U = CFG.units, G = CFG.group;
const model = new Model(dev, CFG, {
  dict: upload(dev, m.dict), finalNorm: upload(dev, m.finalNorm), meanRow: upload(dev, m.meanRow),
  floors: [{ q: upload(dev, f.q), k: upload(dev, f.k), v: upload(dev, f.v), o: upload(dev, f.o), gate: upload(dev, f.gate),
    up: upload(dev, f.up), down: upload(dev, f.down), inNorm: upload(dev, f.inNorm), postNorm: upload(dev, f.postNorm),
    qkNorm: upload(dev, Float32Array.from([...f.qNorm, ...f.kNorm])) }],
});
log("c: model");
const conv = model.conversation();
log("d: conversation");
conv.setTable(encodeTable({}, CFG));
const tok = 17;
conv.step(tok, { seed: 1, turn: 0, step: 0 });
log("e: step submitted");
await dev.queue.onSubmittedWorkDone();
log("e2: work done");
const get = async (b: GPUBuffer, n: number) => Array.from(new Float32Array(await download(dev, b)).slice(0, n));
const dict = deqQ4(m.dict, CFG.vocabRows, W, G);
const x0 = Array.from(dict.slice(tok * W, tok * W + W));
const rms = (x: number[], w: Float32Array) => { const r = 1 / Math.sqrt(x.reduce((s, v) => s + v * v, 0) / x.length + 1e-6); return x.map((v, i) => v * r * w[i]); };
const mv = (A: Float64Array, x: number[], out: number) => Array.from({ length: out }, (_, r) => x.reduce((s, v, i) => s + A[r * x.length + i] * v, 0));
const err = (a: number[], b: number[]) => Math.max(...a.map((v, i) => Math.abs(v - b[i])));
const report = (name: string, e: number) => log([name.padEnd(8), e.toExponential(2), e < 2e-3 ? "ok" : "BAD"].join(" "));
const xg = await get(conv.x, W);
log("f: downloaded x");
const h = rms(x0, f.inNorm);
report("h", err(await get(conv.h, W), h));
const Kd = deqQ4(f.k, KV * D, W, G);
report("k", err(await get(conv.k, KV * D), mv(Kd, h, KV * D)));
const Vd = deqQ4(f.v, KV * D, W, G);
const v = mv(Vd, h, KV * D);
report("v", err(await get(conv.v, KV * D), v));
const att = await get(conv.att, H * D);
const expAtt: number[] = [];
for (let hh = 0; hh < H; hh++) for (let d = 0; d < D; d++) expAtt.push(v[Math.floor(hh / (H / KV)) * D + d]);
report("att", err(att, expAtt));
const o = mv(deqQ4(f.o, W, H * D, G), att, W);
report("o", err(await get(conv.o, W), o));
const mid = x0.map((x, i) => x + o[i]);
report("mid", err(await get(conv.mid, W), mid));
const h2 = rms(mid, f.postNorm);
report("h2", err(await get(conv.h2, W), h2));
const g = mv(deqQ4(f.gate, U, W, G), h2, U), u = mv(deqQ4(f.up, U, W, G), h2, U);
const act = g.map((gv, i) => (gv / (1 + Math.exp(-gv))) * u[i]);
report("act", err(await get(conv.act, U), act));
const mm = mv(deqQ4(f.down, W, U, G), act, W);
report("m", err(await get(conv.m, W), mm));
const x1 = mid.map((x, i) => x + mm[i]);
report("x", err(xg, x1));
const xn = rms(x1, m.finalNorm);
report("xn", err(await get(conv.xn, W), xn));
const sc = Array.from({ length: CFG.vocabReal }, (_, t) => xn.reduce((s, vv, i) => s + dict[t * W + i] * vv, 0));
report("scores", err(await get(conv.scores, CFG.vocabReal), sc));
void bitTable;
process.exit(0);
