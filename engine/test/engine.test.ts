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
  return { scores, token: out[0], cut: out[1], ids: Array.from(out.slice(2, 22)), probs: Array.from(new Float32Array(out.buffer).slice(22, 42)), pushes };
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
    });
  }
});
