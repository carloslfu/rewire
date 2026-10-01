// The tiny model trains (loss falls) and its gradient can be checked against a 64-bit reference.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { init, numpy as np, valueAndGrad } from "@jax-js/jax";
import { beforeAll, describe, expect, it } from "vitest";
import { adamTrainer, deviceParams, initParams, layout, loss, ropeTables, sampler, slowStep, TINY, type TinyConfig } from "../src/model.ts";

const cfg: TinyConfig = { ...TINY, vocab: 40, context: 16 };

beforeAll(async () => {
  await init("wasm");
});

function batch(seed: number, B: number, T: number) {
  // a repeating pattern the model can learn: "abcdefg..." shifted per row
  const x = new Int32Array(B * T), y = new Int32Array(B * T);
  for (let b = 0; b < B; b++) for (let t = 0; t < T; t++) {
    x[b * T + t] = (b + t + seed) % 20 + 1;
    y[b * T + t] = (b + t + 1 + seed) % 20 + 1;
  }
  return { x, y };
}

describe("tiny model", () => {
  it("has the planned size", () => {
    const full = layout({ ...TINY, vocab: 100 });
    expect(full.total).toBeGreaterThan(700_000);
    expect(full.total).toBeLessThan(900_000);
  });

  it("writes a gradient case for the 64-bit check", async () => {
    const P0 = initParams(cfg, 3);
    const { x, y } = batch(0, 2, cfg.context);
    const r = ropeTables(cfg);
    const [l, g] = valueAndGrad((p: np.Array, xx: np.Array, yy: np.Array, c: np.Array, s: np.Array) => loss(cfg, p, xx, yy, c, s))(
      np.array(P0.slice()), np.array(x.slice(), { dtype: np.int32 }).reshape([2, cfg.context]), np.array(y.slice(), { dtype: np.int32 }).reshape([2, cfg.context]),
      np.array(r.cos.slice()).reshape([cfg.context, cfg.headSize]), np.array(r.sin.slice()).reshape([cfg.context, cfg.headSize])) as unknown as [np.Array, np.Array];
    const lv = (await l.data())[0];
    const gd = Array.from((await g.data()) as Float32Array);
    expect(Number.isFinite(lv)).toBe(true);
    expect(lv).toBeGreaterThan(Math.log(cfg.vocab) - 0.5);
    mkdirSync(join(__dirname, "..", "..", "artifacts", "tiny"), { recursive: true });
    writeFileSync(join(__dirname, "..", "..", "artifacts", "tiny", "grad-case.json"), JSON.stringify({ cfg, params: Array.from(P0), x: Array.from(x), y: Array.from(y),
      loss: lv, grad: gd, layout: layout(cfg).tensors }));
  }, 120_000);

  it("writes a slow-motion case for the 64-bit check", async () => {
    // exactly what the training worker does for "Show the math": one plain gradient step on one example, then
    // each right next letter's probability before and after, from the compiled sampler
    const tr = adamTrainer(cfg, initParams(cfg, 5), { lr: 1e-2, b1: 0.9, b2: 0.99, eps: 1e-8 });
    for (let i = 0; i < 20; i++) { const { x, y } = batch(i, 8, cfg.context); await tr.step(x, y, 8); }
    const P0 = await tr.params();
    tr.dispose();
    const { x, y } = batch(3, 1, cfg.context);
    const res = await slowStep(cfg, P0, x, y);
    const lr = res.lr;
    const S = sampler(cfg);
    const D0 = deviceParams(P0), D1 = deviceParams(res.params);
    const pb = await S.all(D0, x), pa = await S.all(D1, x);
    D0.dispose(); D1.dispose();
    const V = cfg.vocab;
    const before = Array.from(y, (t, i) => pb[i * V + t]), after = Array.from(y, (t, i) => pa[i * V + t]);
    expect(res.lossAfter).toBeLessThan(res.loss);
    writeFileSync(join(__dirname, "..", "..", "artifacts", "tiny", "slow-case.json"), JSON.stringify({ cfg, params: Array.from(P0), x: Array.from(x), y: Array.from(y),
      lr, loss: res.loss, lossAfter: res.lossAfter, before, after, layout: layout(cfg).tensors }));
  }, 300_000);

  it("learns a pattern with Adam", async () => {
    const tr = adamTrainer(cfg, initParams(cfg, 1), { lr: 1e-2, b1: 0.9, b2: 0.99, eps: 1e-8 });
    const losses: number[] = [];
    const t0 = performance.now();
    for (let i = 0; i < 60; i++) {
      const { x, y } = batch(i, 8, cfg.context);
      losses.push(await tr.step(x, y, 8));
    }
    const ms = (performance.now() - t0) / 60;
    console.log("first", losses[0].toFixed(3), "last", losses[losses.length - 1].toFixed(3), "ms/step", ms.toFixed(1));
    tr.dispose();
    expect(losses[losses.length - 1]).toBeLessThan(losses[0] * 0.5);
  }, 300_000);
});
