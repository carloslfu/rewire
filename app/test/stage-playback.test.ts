import { expect, it } from "vitest";
import { QWEN_INFO, TINY_INFO } from "../src/model/info.ts";
import { buildArch, pushLength } from "../src/stage/arch.ts";
import { advance, applyReplay, BASE_RATE, beatAt, beatCount, beatLabel, beatOf, lit, plateLit, pushSoFar, runningPush, seek, spineFraction, stepClock } from "../src/stage/playback.ts";

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

it("advances only while playing, at the chosen speed, and stops at the end", () => {
  const n = beatCount(TINY_INFO);
  const paused = { t: 2, playing: false, speed: 1 };
  expect(advance(paused, 500, n)).toBe(paused);
  expect(advance({ t: 2, playing: true, speed: 1 }, 100, n).t).toBeCloseTo(2 + 0.1 * BASE_RATE, 6);
  expect(advance({ t: 2, playing: true, speed: 4 }, 100, n).t).toBeCloseTo(2 + 0.4 * BASE_RATE, 6);
  // A tab returning from the background cannot skip the replay ahead.
  expect(advance({ t: 0, playing: true, speed: 1 }, 60_000, n).t).toBeCloseTo(0.1 * BASE_RATE, 6);
  expect(advance({ t: 1, playing: true, speed: 1 }, -50, n).t).toBe(1);
  const end = advance({ t: n - 0.01, playing: true, speed: 4 }, 100, n);
  expect(end).toEqual({ t: n, playing: false, speed: 4 });
  let c = { t: 0, playing: true, speed: 2 }, frames = 0;
  while (c.playing && frames++ < 10_000) c = advance(c, 16, n);
  expect(c.t).toBe(n);
  expect(frames).toBeGreaterThan(n / (BASE_RATE * 2) / 0.016 - 2);
});

it("steps and scrubs within the replay, and lights a part only from its own beat", () => {
  expect(stepClock(0, 1, 10)).toBe(1);
  expect(stepClock(2.4, 1, 10)).toBe(3);
  expect(stepClock(2.4, -1, 10)).toBe(2);
  expect(stepClock(3, -1, 10)).toBe(2);
  expect(stepClock(10, 1, 10)).toBe(10);
  expect(stepClock(0, -1, 10)).toBe(0);
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

it("pauses following for every manual replay control, and reveals the whole token without losing the speed", () => {
  const n = beatCount(TINY_INFO), complete = { t: n, playing: false, speed: 4 };
  // Play restarts a finished replay and resumes a paused one where it was.
  expect(applyReplay(complete, { kind: "play" }, n)).toEqual({ clock: { t: 0, playing: true, speed: 4 }, manual: true });
  expect(applyReplay({ t: 3.5, playing: false, speed: 1 }, { kind: "play" }, n)).toEqual({ clock: { t: 3.5, playing: true, speed: 1 }, manual: true });
  // Back, Step and the scrubber stop a running replay at their position, and are manual too.
  const running = { t: 3.5, playing: true, speed: 2 };
  expect(applyReplay(running, { kind: "step", direction: -1 }, n)).toEqual({ clock: { t: 3, playing: false, speed: 2 }, manual: true });
  expect(applyReplay(running, { kind: "step", direction: 1 }, n)).toEqual({ clock: { t: 4, playing: false, speed: 2 }, manual: true });
  expect(applyReplay(complete, { kind: "step", direction: -1 }, n)).toEqual({ clock: { t: n - 1, playing: false, speed: 4 }, manual: true });
  expect(applyReplay(running, { kind: "seek", t: 0 }, n)).toEqual({ clock: { t: 0, playing: false, speed: 2 }, manual: true });
  expect(applyReplay(running, { kind: "seek", t: 999 }, n).clock.t).toBe(n);
  // Pause and Speed are not a position in the token.
  expect(applyReplay(running, { kind: "pause" }, n)).toEqual({ clock: { t: 3.5, playing: false, speed: 2 }, manual: false });
  expect(applyReplay(running, { kind: "speed", speed: 0.5 }, n)).toEqual({ clock: { t: 3.5, playing: true, speed: 0.5 }, manual: false });
  // A new token or resumed following: stopped, complete, same speed, whether it was running, scrubbed to 0 or already complete.
  for (const from of [running, { t: 0, playing: false, speed: 2 }, { t: n, playing: false, speed: 2 }]) {
    expect(applyReplay(from, { kind: "reveal" }, n)).toEqual({ clock: { t: n, playing: false, speed: 2 }, manual: false });
  }
  expect(advance(applyReplay(running, { kind: "reveal" }, n).clock, 100, n).t).toBe(n);
});
