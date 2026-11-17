import { beforeAll, describe, expect, it } from "vitest";
import { encodeTable, type ChangeSpec } from "../src/changes.ts";
import type { ModelConfig } from "../src/config.ts";
import { download, getDevice, upload } from "../src/gpu.ts";
import { Model, type Weights } from "../src/model.ts";
import { sample } from "../src/sampler.ts";
import { cpuForward, type CpuModel, synthModel } from "./cpuref.ts";

let dev: GPUDevice;

beforeAll(async () => {
  const wg = await import("webgpu");
  Object.assign(globalThis, wg.globals);
  dev = await getDevice(wg.create([]));
});

const CFG: ModelConfig = {
  name: "synth", floors: 2, width: 128, queryHeads: 4, kvHeads: 2, headSize: 32, units: 256, vocabRows: 512,
  vocabReal: 500, ropeTheta: 10000, eps: 1e-6, maxContext: 64, group: 32, dictBits: 4, floorBits: 4,
};

function toGpu(m: CpuModel): Weights {
  return {
    dict: upload(dev, m.dict), finalNorm: upload(dev, m.finalNorm), meanRow: upload(dev, m.meanRow),
    floors: m.floors.map((f) => ({
      q: upload(dev, f.q), k: upload(dev, f.k), v: upload(dev, f.v), o: upload(dev, f.o), gate: upload(dev, f.gate),
      up: upload(dev, f.up), down: upload(dev, f.down), inNorm: upload(dev, f.inNorm), postNorm: upload(dev, f.postNorm),
      qkNorm: upload(dev, Float32Array.from([...f.qNorm, ...f.kNorm])),
    })),
  };
}

async function runEngine(m: CpuModel, model: Model, tokens: number[], spec: ChangeSpec, conceptFirst = 0) {
  const conv = model.conversation();
  conv.setTable(encodeTable(spec, m.cfg, { vector: (id, L) => m.concepts!.get(id)![L], rho: m.rho! }, conceptFirst));
  conv.read(tokens.slice(0, -1));
  conv.step(tokens[tokens.length - 1], { seed: 7, turn: 0, step: 3 });
  const scores = new Float32Array(await download(dev, conv.scores));
  const out = new Uint32Array(await download(dev, conv.sampleOut));
  const pushes = new Float32Array(await download(dev, conv.pushes));
  const candLp = Array.from(new Float32Array(await download(dev, conv.candLp)));
  return { scores, token: out[0], cut: out[1], ids: Array.from(out.slice(2, 22)), probs: Array.from(new Float32Array(out.buffer).slice(22, 42)), pushes,
    lp1: new Float32Array(out.buffer)[42], candLp };
}

/** Log-softmax over the real vocabulary at temperature 1, in double precision, from the GPU's own scores. */
function logProbs(scores: Float32Array, n: number): Float64Array {
  let mx = -Infinity;
  for (let i = 0; i < n; i++) mx = Math.max(mx, scores[i]);
  let sum = 0;
  for (let i = 0; i < n; i++) sum += Math.exp(scores[i] - mx);
  const lse = mx + Math.log(sum);
  return Float64Array.from({ length: n }, (_, i) => scores[i] - lse);
}

function maxErr(a: ArrayLike<number>, b: ArrayLike<number>, n: number) {
  let e = 0;
  for (let i = 0; i < n; i++) e = Math.max(e, Math.abs(a[i] - b[i]));
  return e;
}

describe("engine against the CPU reference (synthetic model)", () => {
  const m = synthModel(CFG, 3);
  const tokens = [3, 17, 250, 41, 99, 7, 480, 12, 5, 333, 61];
  const specs: [string, ChangeSpec][] = [
    ["normal", {}],
    ["individual neuron pushes", { neurons: [{ floor: 0, unit: 9, delta: 2.5 }, { floor: 1, unit: 17, delta: -3 }] }],
    ["neuron push on disabled MLP", { neurons: [{ floor: 1, unit: 17, delta: 50 }], memory: [{ floor: 1, mult: 0 }] }],
    ["neuron push with zeroed down weight", { neurons: [{ floor: 1, unit: 9, delta: 2.5 }], zeroed: [{ floor: 1, tensor: "down", row: 5, col: 9 }] }],
    ["rotation 45", { geometry: [{ floor: 0, head: 1, kind: "rotate", angle: 45, seed: 2 }] }],
    ["rotation 90", { geometry: [{ floor: 1, head: 2, kind: "rotate", angle: 90, seed: 17 }] }],
    ["rotation 180 with multiplier", { heads: [{ floor: 0, head: 1, mult: 2 }], geometry: [{ floor: 0, head: 1, kind: "rotate", angle: 180, seed: 2 }] }],
    ["remove overlap", { geometry: [{ floor: 0, head: 0, kind: "remove", amount: 1 }] }],
    ["remove half and scramble", { geometry: [{ floor: 0, head: 0, kind: "remove", amount: 0.5 }, { floor: 1, head: 2, kind: "shuffle", seed: 73 }] }],
    ["rotate and scramble with zeroed output weights", { geometry: [{ floor: 0, head: 0, kind: "rotate", angle: -90, seed: 3 }, { floor: 0, head: 1, kind: "shuffle", seed: 0 }], zeroed: [{ floor: 0, tensor: "o", row: 7, col: 40 }] }],
    ["head and memory multipliers", { heads: [{ floor: 0, head: 1, mult: 0 }, { floor: 1, head: 2, mult: -1 }], memory: [{ floor: 1, mult: 2 }] }],
    ["floor off", { floors: [{ floor: 0, mult: 0 }] }],
    ["swap", { swaps: [[17, 250], [5, 6]] }],
    ["hidden words", { hidden: [{ key: 0, from: 1 }, { key: 3, from: 5 }] }],
    ["bits 3", { bits: 3 }],
    ["bits 2", { bits: 2 }],
    ["zeroed", { zeroed: [{ floor: 0, tensor: "down", row: 5, col: 9 }, { floor: 1, tensor: "o", row: 7, col: 40 }, { floor: 1, tensor: "gate", row: 3, col: 2 }] }],
    ["concept", { concept: { id: "test", floor: 1, strength: 1.5 } }],
  ];
  for (const [name, spec] of specs) {
    it(`matches with ${name}`, async () => {
      const model = new Model(dev, CFG, toGpu(m));
      const e = await runEngine(m, model, tokens, spec, 2);
      const c = cpuForward(m, tokens, spec, e.token, 2);
      const err = maxErr(e.scores, c.scores, CFG.vocabReal);
      expect(err).toBeLessThan(2e-3);
      // the GPU's pick is the CPU sampler's pick on the GPU's scores
      const s = sample(e.scores, CFG.vocabReal, 7, 0, 3);
      expect(e.token).toBe(s.id);
      expect(e.ids).toEqual(s.ids);
      // Each listed candidate carries the model's own log-probability: temperature 1, whole vocabulary.
      const lp = logProbs(e.scores, CFG.vocabReal);
      for (let k = 0; k < 20; k++) expect(Math.abs(e.candLp[k] - lp[e.ids[k]])).toBeLessThan(1e-4);
      expect(Math.abs(e.lp1 - lp[e.token])).toBeLessThan(1e-4);
      expect(Math.abs(e.candLp[e.ids.indexOf(e.token)] - e.lp1)).toBeLessThan(1e-5);
      const pe = maxErr(e.pushes, c.pushes, c.pushes.length);
      expect(pe).toBeLessThan(2e-3);
      if (!spec.concept) {
        // pushes add up to the score minus the mean score over real ids
        let mean = 0;
        for (let t = 0; t < CFG.vocabReal; t++) mean += c.scores[t];
        mean /= CFG.vocabReal;
        const sum = Array.from(e.pushes.slice(0, c.pushes.length)).reduce((a, b) => a + b, 0);
        expect(Math.abs(sum - (c.scores[e.token] - mean))).toBeLessThan(5e-3);
      }
      model.destroy();
    });
  }
});

it("reports full-vocabulary candidate probabilities without changing the draw, at any temperature, forced or not", async () => {
  const m = synthModel(CFG, 3), model = new Model(dev, CFG, toGpu(m)), conv = model.conversation();
  const tokens = [3, 17, 250, 41, 99, 7, 480, 12];
  const run = async (p: { temperature?: number; force?: number }) => {
    conv.length = 0;
    conv.read(tokens.slice(0, -1));
    conv.step(tokens.at(-1)!, { seed: 7, turn: 0, step: 3, slot: 0, ...p });
    const r = await conv.result(0);
    return { r, scores: new Float32Array(await download(dev, conv.scores)), sample: new Uint32Array(await download(dev, conv.sampleOut)), pushes: new Float32Array(await download(dev, conv.pushes)) };
  };
  const base = await run({});
  const lp = logProbs(base.scores, CFG.vocabReal), P = CFG.floors * (CFG.queryHeads + 1) + 1;
  // The staged result keeps every earlier field where it was, and the new one follows them.
  expect(base.r.drawn).toBe(base.sample[0]);
  expect(base.r.cut).toBe(base.sample[1]);
  expect(Array.from(base.r.ids)).toEqual(Array.from(base.sample.slice(2, 22)));
  expect(Array.from(base.r.probs)).toEqual(Array.from(new Float32Array(base.sample.buffer).slice(22, 42)));
  expect(base.r.lp1).toBe(new Float32Array(base.sample.buffer)[42]);
  expect(Array.from(base.r.pushes)).toEqual(Array.from(base.pushes.slice(0, P)));
  expect(base.r.concept).toBe(base.pushes[P]);
  expect(base.r.candLp).toHaveLength(20);
  for (let k = 0; k < 20; k++) expect(Math.abs(base.r.candLp[k] - lp[base.r.ids[k]])).toBeLessThan(1e-4);
  // They are probabilities of the whole vocabulary: in order, each below 1, and together less than 1.
  const probs = Array.from(base.r.candLp, Math.exp);
  expect(probs).toEqual([...probs].sort((a, b) => b - a));
  expect(probs.reduce((a, b) => a + b, 0)).toBeLessThan(1);
  // The draw's own odds are another thing: renormalized over the 20 at the sampling temperature, they add up to 1.
  expect(Array.from(base.r.probs).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 4);
  // Greedy and hot sampling change the draw's odds and never the model's probabilities.
  for (const temperature of [0, 0.2, 2]) {
    const t = await run({ temperature });
    expect(Array.from(t.r.ids)).toEqual(Array.from(base.r.ids));
    expect(maxErr(t.r.candLp, base.r.candLp, 20)).toBeLessThan(1e-6);
    if (temperature === 0) {
      expect(Array.from(t.r.probs)).toEqual([1, ...new Array(19).fill(0)]);
      expect(Math.exp(t.r.candLp[0])).toBeLessThan(1);
      expect(t.r.lp1).toBeCloseTo(t.r.candLp[0], 5);
    }
  }
  // A forced word outside the top 20: its probability is in lp1, and the list is the same list.
  let outside = 0;
  while (base.r.ids.includes(outside)) outside++;
  const forced = await run({ force: outside });
  expect(forced.r.token).toBe(outside);
  expect(forced.r.drawn).toBe(base.r.drawn);
  expect(Array.from(forced.r.ids)).toEqual(Array.from(base.r.ids));
  expect(Array.from(forced.r.probs)).toEqual(Array.from(base.r.probs));
  expect(maxErr(forced.r.candLp, base.r.candLp, 20)).toBeLessThan(1e-6);
  expect(Math.abs(forced.r.lp1 - lp[outside])).toBeLessThan(1e-4);
  expect(forced.r.lp1).toBeLessThan(base.r.candLp[19]);
  // The scores themselves are untouched by any of it.
  expect(maxErr(forced.scores, base.scores, CFG.vocabReal)).toBe(0);
  model.destroy();
});

it("marks candidate slots that hold no word when the vocabulary is smaller than the list", async () => {
  const { NO_CANDIDATE } = await import("../src/kernels.ts");
  const small: ModelConfig = { ...CFG, vocabRows: 32, vocabReal: 12 };
  const m = synthModel(small, 5), model = new Model(dev, small, toGpu(m)), conv = model.conversation();
  conv.read([3, 7, 1]);
  conv.step(9, { seed: 7, turn: 0, step: 0, slot: 0 });
  const r = await conv.result(0), lp = logProbs(new Float32Array(await download(dev, conv.scores)), small.vocabReal);
  const real = Array.from(r.ids).filter((id) => id < small.vocabReal);
  expect(real).toHaveLength(12);
  for (let k = 0; k < 20; k++) {
    if (r.ids[k] < small.vocabReal) expect(Math.abs(r.candLp[k] - lp[r.ids[k]])).toBeLessThan(1e-4);
    else expect(r.candLp[k]).toBe(NO_CANDIDATE);
  }
  // All twelve words are listed, so here the model's probabilities do add up to 1.
  expect(real.map((id) => Math.exp(r.candLp[Array.from(r.ids).indexOf(id)])).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 4);
  model.destroy();
});

it("rebuilds plans, restores exactly, and inspects the vectors actually used", async () => {
  const m = synthModel(CFG, 3), model = new Model(dev, CFG, toGpu(m)), conv = model.conversation();
  const tokens = [3, 17, 250, 41, 99, 7];
  const score = async (spec: ChangeSpec, sequential = false) => {
    conv.setTable(encodeTable(spec, CFG)); conv.length = 0;
    if (sequential) for (const t of tokens.slice(0, -1)) conv.step(t, { seed: 7, turn: 0, step: 0 });
    else conv.read(tokens.slice(0, -1));
    conv.step(tokens.at(-1)!, { seed: 7, turn: 0, step: 0 });
    return new Float32Array(await download(dev, conv.scores));
  };
  const baseline = await score({});
  const spec: ChangeSpec = { neurons: [{ floor: 0, unit: 19, delta: 2.5 }, { floor: 1, unit: 9, delta: -1.5 }], geometry: [{ floor: 0, head: 1, kind: "rotate", angle: 90, seed: 4 }, { floor: 1, head: 2, kind: "remove", amount: 1 }] };
  const changed = await score(spec);
  expect(maxErr(changed, baseline, CFG.vocabReal)).toBeGreaterThan(0.01);
  expect(maxErr(await score(spec, true), changed, CFG.vocabReal)).toBeLessThan(2e-3);
  const inspected = await conv.inspect(tokens.length - 1, tokens.at(-1)!, 3, {
    qkNorm: m.floors.map((f) => Float32Array.from([...f.qNorm, ...f.kNorm])), meanRow: m.meanRow, finalNorm: m.finalNorm, table: encodeTable(spec, CFG),
  });
  const { vectorStats } = await import("../src/geometry.ts");
  const before = inspected.detail.get("f0.heads_before")!.slice(CFG.width, 2 * CFG.width);
  const after = inspected.detail.get("f0.heads_after")!.slice(CFG.width, 2 * CFG.width);
  expect(vectorStats(before, after).angle).toBeCloseTo(90, 4);
  expect(vectorStats(before, after).ratio).toBeCloseTo(1, 6);
  const inspectedScores = new Float32Array(await download(dev, conv.scores));
  expect(maxErr(inspectedScores, changed, CFG.vocabReal)).toBeLessThan(2e-3);
  expect(await score({})).toEqual(baseline);
  model.destroy();
});
