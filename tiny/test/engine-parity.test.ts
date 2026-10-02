// jax-js and the engine produce the same outputs for the same tiny weights (section 6.3).
import { init, numpy as np } from "@jax-js/jax";
import { download, getDevice } from "@rewire/engine/src/gpu.ts";
import { Model } from "@rewire/engine/src/model.ts";
import { beforeAll, describe, expect, it } from "vitest";
import { encode, VOCAB } from "../src/data.ts";
import { engineConfig, engineWeights } from "../src/engine.ts";
import { adamTrainer, forward, initParams, ropeTables, TINY, type TinyConfig } from "../src/model.ts";
import { mutateWeights } from "../src/lab.ts";

const cfg: TinyConfig = { ...TINY, vocab: VOCAB, context: 32 };

beforeAll(async () => {
  await init("wasm");
  const wg = await import("webgpu");
  Object.assign(globalThis, wg.globals);
});

describe("tiny model in the engine", () => {
  it("uses physically erased parameters and restores exactly the original logits", async () => {
    const original = initParams(cfg, 12);
    const erased = mutateWeights(original, cfg, { kind: "erase", amount: 1, seed: 5 });
    const wg = await import("webgpu");
    const dev = await getDevice(wg.create([]));
    const scores = async (params: Float32Array) => {
      const model = new Model(dev, engineConfig(cfg), engineWeights(dev, cfg, params));
      try {
        const conv = model.conversation();
        conv.step(encode("r")[0], { seed: 42, turn: 0, step: 0 });
        return new Float32Array(await download(dev, conv.scores)).slice(0, VOCAB);
      } finally { model.destroy(); }
    };
    try {
      const before = await scores(original);
      expect(before.some((v) => Math.abs(v) > 0.01)).toBe(true);
      expect((await scores(erased)).every((v) => v === 0)).toBe(true);
      expect(await scores(original)).toEqual(before);
    } finally { dev.destroy(); }
  }, 60_000);

  it("matches jax-js logits at every position", async () => {
    // a few training steps so the weights are not just noise
    const text = encode("Alice was beginning to get very tired of sitting by her sister on the bank, and of having nothing to do. ".repeat(4));
    const tr = adamTrainer(cfg, initParams(cfg, 2), { lr: 3e-3, b1: 0.9, b2: 0.99, eps: 1e-8 });
    for (let s = 0; s < 5; s++) {
      const x = new Int32Array(4 * cfg.context), y = new Int32Array(4 * cfg.context);
      for (let b = 0; b < 4; b++) for (let t = 0; t < cfg.context; t++) { x[b * cfg.context + t] = text[b * 7 + s + t]; y[b * cfg.context + t] = text[b * 7 + s + t + 1]; }
      await tr.step(x, y, 4);
    }
    const P = await tr.params();
    tr.dispose();
    const ids = Array.from(text.slice(0, 24));
    const T = ids.length;
    const r = ropeTables({ ...cfg, context: T });
    const logits = forward(cfg, np.array(new Float32Array(P)), np.array(new Int32Array(ids), { dtype: np.int32 }).reshape([1, T]),
      np.array(r.cos.slice()).reshape([T, cfg.headSize]), np.array(r.sin.slice()).reshape([T, cfg.headSize]));
    const jx = (await logits.data()) as Float32Array;
    const wg = await import("webgpu");
    const dev = await getDevice(wg.create([]));
    const model = new Model(dev, engineConfig(cfg), engineWeights(dev, cfg, P));
    const conv = model.conversation();
    let worst = 0, agree = 0;
    for (let t = 0; t < T; t++) {
      conv.step(ids[t], { seed: 1, turn: 0, step: t });
      const s = new Float32Array(await download(dev, conv.scores));
      let bj = 0, be = 0;
      for (let v = 0; v < VOCAB; v++) {
        worst = Math.max(worst, Math.abs(s[v] - jx[t * VOCAB + v]));
        if (jx[t * VOCAB + v] > jx[t * VOCAB + bj]) bj = v;
        if (s[v] > s[be]) be = v;
      }
      if (bj === be) agree++;
    }
    console.log("max |engine - jax| over", T, "positions:", worst.toExponential(2), "top agree", agree, "/", T);
    expect(worst).toBeLessThan(2e-3);
    expect(agree).toBe(T);
  }, 300_000);
});

it("applies geometry to float32 heads during prefill and decode, then restores", async () => {
  const { encodeTable } = await import("@rewire/engine/src/changes.ts");
  const wg = await import("webgpu"), dev = await getDevice(wg.create([]));
  const ec = engineConfig(cfg), model = new Model(dev, ec, engineWeights(dev, cfg, initParams(cfg, 8)));
  const conv = model.conversation(), ids = Array.from(encode("rain?"));
  const run = async (spec: Parameters<typeof encodeTable>[0], sequential = false) => {
    conv.setTable(encodeTable(spec, ec)); conv.length = 0;
    if (sequential) for (const id of ids.slice(0, -1)) conv.step(id, { seed: 4, turn: 0, step: 0 });
    else conv.read(ids.slice(0, -1));
    conv.step(ids.at(-1)!, { seed: 4, turn: 0, step: 0 });
    return new Float32Array(await download(dev, conv.scores)).slice(0, VOCAB);
  };
  try {
    const original = await run({});
    const spec = { geometry: [{ floor: 0, head: 1, kind: "rotate" as const, angle: 90, seed: 5 },
      { floor: 2, head: 0, kind: "shuffle" as const, seed: 23 }, { floor: 1, head: 3, kind: "remove" as const, amount: 1 }] };
    const changed = await run(spec), sequential = await run(spec, true);
    expect(Math.max(...changed.map((x, i) => Math.abs(x - original[i])))).toBeGreaterThan(1e-4);
    expect(Math.max(...changed.map((x, i) => Math.abs(x - sequential[i])))).toBeLessThan(2e-3);
    expect(await run({})).toEqual(original);
  } finally { model.destroy(); dev.destroy(); }
});
