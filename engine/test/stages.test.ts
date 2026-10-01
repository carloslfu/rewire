// Stage-by-stage check of one floor for one token, to localize kernel errors.
import { beforeAll, expect, it } from "vitest";
import { bitTable, encodeTable } from "../src/changes.ts";
import type { ModelConfig } from "../src/config.ts";
import { download, getDevice, upload } from "../src/gpu.ts";
import { Model } from "../src/model.ts";
import { deqQ4, synthModel } from "./cpuref.ts";

let dev: GPUDevice;
beforeAll(async () => {
  const wg = await import("webgpu");
  Object.assign(globalThis, wg.globals);
  dev = await getDevice(wg.create([]));
});

const CFG: ModelConfig = {
  name: "synth1", floors: 1, width: 128, queryHeads: 4, kvHeads: 2, headSize: 32, units: 256, vocabRows: 512,
  vocabReal: 500, ropeTheta: 10000, eps: 1e-6, maxContext: 64, group: 32, dictBits: 4, floorBits: 4,
};

it("one floor, one token, stage by stage", async () => {
  const m = synthModel(CFG, 5);
  const f = m.floors[0];
  const W = CFG.width, H = CFG.queryHeads, D = CFG.headSize, KV = CFG.kvHeads, U = CFG.units, G = CFG.group;
  const model = new Model(dev, CFG, {
    dict: upload(dev, m.dict), finalNorm: upload(dev, m.finalNorm), meanRow: upload(dev, m.meanRow),
    floors: [{ q: upload(dev, f.q), k: upload(dev, f.k), v: upload(dev, f.v), o: upload(dev, f.o), gate: upload(dev, f.gate),
      up: upload(dev, f.up), down: upload(dev, f.down), inNorm: upload(dev, f.inNorm), postNorm: upload(dev, f.postNorm),
      qkNorm: upload(dev, Float32Array.from([...f.qNorm, ...f.kNorm])) }],
  });
  const conv = model.conversation();
  conv.setTable(encodeTable({}, CFG));
  const tok = 17;
  conv.step(tok, { seed: 1, turn: 0, step: 0 });
  const get = async (b: GPUBuffer, n: number) => Array.from(new Float32Array(await download(dev, b)).slice(0, n));
  const dict = deqQ4(m.dict, CFG.vocabRows, W, G);
  const x0 = Array.from(dict.slice(tok * W, tok * W + W));
  const rms = (x: number[], w: Float32Array) => { const r = 1 / Math.sqrt(x.reduce((s, v) => s + v * v, 0) / x.length + 1e-6); return x.map((v, i) => v * r * w[i]); };
  const mv = (A: Float64Array, x: number[], out: number) => Array.from({ length: out }, (_, r) => x.reduce((s, v, i) => s + A[r * x.length + i] * v, 0));
  const h = rms(x0, f.inNorm);
  const err = (a: number[], b: number[]) => Math.max(...a.map((v, i) => Math.abs(v - b[i])));
  expect(err(await get(conv.h, W), h), "h").toBeLessThan(1e-4);
  const Q = deqQ4(f.q, H * D, W, G, bitTable(4));
  // q is normalized and rotated in place, so compare k's raw projection instead (kept in conv.k)
  const Kd = deqQ4(f.k, KV * D, W, G);
  expect(err(await get(conv.k, KV * D), mv(Kd, h, KV * D)), "k").toBeLessThan(1e-4);
  const Vd = deqQ4(f.v, KV * D, W, G);
  expect(err(await get(conv.v, KV * D), mv(Vd, h, KV * D)), "v").toBeLessThan(1e-4);
  void Q;
  // with one token, attention returns the value row (rounded to half) for each head's key/value head
  const v = mv(Vd, h, KV * D);
  const att = await get(conv.att, H * D);
  const expAtt: number[] = [];
  for (let hh = 0; hh < H; hh++) for (let d = 0; d < D; d++) expAtt.push(v[Math.floor(hh / (H / KV)) * D + d]);
  expect(err(att, expAtt), "att").toBeLessThan(2e-3);
  const Od = deqQ4(f.o, W, H * D, G);
  const o = mv(Od, att, W);
  expect(err(await get(conv.o, W), o), "o").toBeLessThan(1e-3);
  const mid = x0.map((x, i) => x + o[i]);
  expect(err(await get(conv.mid, W), mid), "mid").toBeLessThan(1e-3);
  const h2 = rms(mid, f.postNorm);
  expect(err(await get(conv.h2, W), h2), "h2").toBeLessThan(1e-3);
  const g = mv(deqQ4(f.gate, U, W, G), h2, U), u = mv(deqQ4(f.up, U, W, G), h2, U);
  const act = g.map((gv, i) => (gv / (1 + Math.exp(-gv))) * u[i]);
  expect(err(await get(conv.act, U), act), "act").toBeLessThan(1e-3);
  const mm = mv(deqQ4(f.down, W, U, G), act, W);
  expect(err(await get(conv.m, W), mm), "m").toBeLessThan(1e-3);
  const x1 = mid.map((x, i) => x + mm[i]);
  expect(err(await get(conv.x, W), x1), "x").toBeLessThan(1e-3);
  const xn = rms(x1, m.finalNorm);
  expect(err(await get(conv.xn, W), xn), "xn").toBeLessThan(1e-3);
  const sc = Array.from({ length: CFG.vocabReal }, (_, t) => xn.reduce((s, vv, i) => s + dict[t * W + i] * vv, 0));
  expect(err((await get(conv.scores, CFG.vocabReal)), sc), "scores").toBeLessThan(1e-3);
});
