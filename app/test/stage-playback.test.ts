import { expect, it } from "vitest";
import { QWEN_INFO, TINY_INFO } from "../src/model/info.ts";
import { buildArch, pushLength } from "../src/stage/arch.ts";
import { beatAt, beatCount, beatLabel, beatOf, lit, plateLit, pushCoverage, pushSoFar, runningPush, seek, spineFraction } from "../src/stage/playback.ts";

it("replays the architecture in the order it computes: token in, each layer's attention then MLP, token out", () => {
  for (const model of [QWEN_INFO, TINY_INFO]) {
    const n = beatCount(model);
    expect(n).toBe(2 + 2 * model.floors);
    expect(beatAt(model, 0)).toEqual({ kind: "embed" });
    expect(beatAt(model, n - 1)).toEqual({ kind: "output" });
    for (let L = 0; L < model.floors; L++) {
      expect(beatAt(model, 1 + 2 * L)).toEqual({ kind: "attention", floor: L });
      expect(beatAt(model, 2 + 2 * L)).toEqual({ kind: "mlp", floor: L });
    }
    expect(beatAt(model, -5)).toEqual({ kind: "embed" });
    expect(beatAt(model, n + 9)).toEqual({ kind: "output" });
    // Every lit part belongs to the beat that names its layer and kind.
    for (const p of buildArch(model).parts) {
      const b = beatOf(model, p);
      if (p.kind === "layer") { expect(b).toBe(-1); continue; }
      const beat = beatAt(model, b);
      if (p.kind === "head" || p.kind === "kv") expect(beat).toEqual({ kind: "attention", floor: p.floor });
      else if (p.kind === "mlp") expect(beat).toEqual({ kind: "mlp", floor: p.floor });
      else expect(beat.kind).toBe(p.kind === "embed" ? "embed" : "output");
    }
  }
  expect(beatLabel(beatAt(QWEN_INFO, 25))).toBe("Layer 13 · attention");
});

it("adds up the measured pushes of exactly the parts that have run", () => {
  const model = TINY_INFO, pushes = Float32Array.from({ length: pushLength(model) }, (_, i) => ((i * 37) % 11) - 5 + i / 100);
  const running = runningPush(model, pushes);
  expect(running).toHaveLength(beatCount(model));
  expect(running[0]).toBeCloseTo(pushes[0], 5);
  const per = model.heads + 1;
  const heads = (L: number) => Array.from({ length: model.heads }, (_, h) => pushes[1 + L * per + h]).reduce((a, b) => a + b, 0);
  expect(running[1] - running[0]).toBeCloseTo(heads(0), 4);
  expect(running[2] - running[1]).toBeCloseTo(pushes[1 + model.heads], 4);
  expect(running[5] - running[4]).toBeCloseTo(heads(2), 4);
  const total = pushes.reduce((a, b) => a + b, 0);
  expect(running[running.length - 1]).toBeCloseTo(total, 3);
  expect(running[running.length - 2]).toBeCloseTo(total, 3);
  // Only completed beats count, and the finished replay reports the full sum.
  expect(pushSoFar(running, 0)).toBe(0);
  expect(pushSoFar(running, 0.99)).toBe(0);
  expect(pushSoFar(running, 1)).toBeCloseTo(pushes[0], 5);
  expect(pushSoFar(running, 2.5)).toBeCloseTo(running[1], 5);
  expect(pushSoFar(running, null)).toBeCloseTo(total, 3);
  expect(pushSoFar(running, 999)).toBeCloseTo(total, 3);
  expect(pushSoFar(new Float32Array(0), 3)).toBe(0);
});

it("keeps the playhead inside the token, and lights a part only from its own beat", () => {
  expect(seek(-3, 10)).toBe(0);
  expect(seek(99, 10)).toBe(10);
  expect(seek(Number.NaN, 10)).toBe(0);
  expect(lit(4, 3.9)).toBe(0);
  expect(lit(4, 4.25)).toBeCloseTo(0.25, 6);
  expect(lit(4, 5)).toBe(1);
  expect(lit(4, null)).toBe(1);
  expect(lit(-1, 0)).toBe(1);
  expect(spineFraction(TINY_INFO, null)).toBe(1);
  expect(spineFraction(TINY_INFO, 5)).toBeCloseTo(0.5, 6);
});

it("brings a layer's plates up in computation order, only during that layer's own beats", () => {
  const floor = 12, attention = 1 + 2 * floor, mlp = attention + 1, n = 14;
  // Before the layer runs nothing of it is shown; once the replay is complete everything is.
  for (let i = 0; i < n; i++) {
    expect(plateLit(floor, "attention", i, n, attention - 0.01)).toBe(0);
    expect(plateLit(floor, "attention", i, n, attention + 1)).toBe(1);
    expect(plateLit(floor, "attention", i, n, null)).toBe(1);
  }
  // Through the attention beat they appear one after another, never out of order.
  for (let t = attention; t <= attention + 1; t += 0.03) {
    const levels = Array.from({ length: n }, (_, i) => plateLit(floor, "attention", i, n, t));
    for (let i = 1; i < n; i++) expect(levels[i]).toBeLessThanOrEqual(levels[i - 1]);
    expect(levels.filter((v) => v > 0 && v < 1).length).toBeLessThanOrEqual(1);
  }
  expect(plateLit(floor, "attention", 6, n, attention + 0.5)).toBeCloseTo(1, 6);
  expect(plateLit(floor, "attention", 7, n, attention + 0.5)).toBeCloseTo(0, 6);
  // The MLP's plates wait for the MLP beat, and another layer's beats do not touch them.
  expect(plateLit(floor, "mlp", 0, 6, attention + 0.99)).toBe(0);
  expect(plateLit(floor, "mlp", 0, 6, mlp + 0.1)).toBeCloseTo(0.6, 6);
  expect(plateLit(floor, "mlp", 5, 6, mlp + 1)).toBe(1);
  expect(plateLit(floor + 1, "attention", 0, n, mlp + 0.5)).toBe(0);
  // Whole steps (reduced motion): a beat's plates show once the step past it is reached.
  expect(plateLit(floor, "attention", 0, n, Math.floor(attention + 0.7))).toBe(0);
  expect(plateLit(floor, "attention", n - 1, n, attention + 1)).toBe(1);
});

it("counts a push as measured only when it is a number, and calls the set complete only when all are", () => {
  const model = { floors: 2, heads: 2 }, all = Float32Array.from([0.1, 0.2, -0.3, 0.4, 0, 0.5, -0.6]);
  expect(pushCoverage(model, all)).toEqual({ measured: 7, of: 7, complete: true });
  // Zero is a measurement. NaN, an infinity and a value that is not there are not.
  const some = all.slice(); some[2] = Number.NaN; some[5] = Number.NEGATIVE_INFINITY;
  expect(pushCoverage(model, some)).toEqual({ measured: 5, of: 7, complete: false });
  expect(pushCoverage(model, all.slice(0, 4))).toEqual({ measured: 4, of: 7, complete: false });
  expect(pushCoverage(model, null)).toEqual({ measured: 0, of: 7, complete: false });
  // Values past the model's own are not counted.
  expect(pushCoverage(model, Float32Array.from([...all, 9, 9]))).toEqual({ measured: 7, of: 7, complete: true });
});
