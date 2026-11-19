import { expect, it } from "vitest";
import { initialLesson, LESSON_RANK } from "@rewire/engine/src/lora.ts";
import { layout, TINY } from "@rewire/tiny/src/config.ts";
import { VOCAB } from "@rewire/tiny/src/data.ts";
import { mutateWeights, weightStats } from "@rewire/tiny/src/lab.ts";
import { QWEN_INFO, TINY_INFO } from "../src/model/info.ts";
import { attentionRow, layerPlates, lessonDelta, lessonPlates, lessonStats, paint, plate, pooled, pushValues, rankStrength, tinyDictPlate, tinyLayerPlates, tinyRanges, tinyValues, tray, vectorRows } from "../src/stage/adapters.ts";
import { buildArch, partIndex, pushIndex, pushLength } from "../src/stage/arch.ts";
import { Latest, measure, type Measured, measurementKey } from "../src/stage/latest.ts";
import { spring } from "../src/stage/motion.ts";
import { DARK, LIGHT, ramp, unlit } from "../src/stage/theme.ts";

const cfg = { ...TINY, vocab: VOCAB };
const tensors = new Map(layout(cfg).tensors.map((t) => [t.name, t]));
const deferred = <T>() => { let resolve!: (v: T) => void, reject!: (e: Error) => void; const promise = new Promise<T>((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };

it("places a token's measured pushes on the parts that made them and nothing on the rest", () => {
  const arch = buildArch(QWEN_INFO), pushes = Float32Array.from({ length: pushLength(QWEN_INFO) }, (_, i) => Math.sin(i) * 3);
  pushes[pushIndex(QWEN_INFO, { kind: "head", floor: 20, head: 13 })] = -9;
  const v = pushValues(arch, pushes)!;
  expect(v.scale).toBe(9);
  expect(v.raw[partIndex(QWEN_INFO, { kind: "head", floor: 20, head: 13 })]).toBe(-9);
  expect(v.scaled[partIndex(QWEN_INFO, { kind: "head", floor: 20, head: 13 })]).toBe(-1);
  expect(v.raw[0]).toBe(pushes[0]);
  arch.parts.forEach((p, i) => {
    const k = pushIndex(QWEN_INFO, p);
    if (k >= 0) expect(v.raw[i]).toBe(pushes[k]);
    else if (p.kind !== "layer") expect(Number.isNaN(v.raw[i])).toBe(true);
    if (!Number.isNaN(v.scaled[i])) expect(Math.abs(v.scaled[i])).toBeLessThanOrEqual(1);
  });
  // A deck carries the sum of the heads and MLP on it.
  let sum = 0;
  for (let h = 0; h < 16; h++) sum += pushes[pushIndex(QWEN_INFO, { kind: "head", floor: 5, head: h })];
  sum += pushes[pushIndex(QWEN_INFO, { kind: "mlp", floor: 5 })];
  expect(v.raw[partIndex(QWEN_INFO, { kind: "layer", floor: 5 })]).toBeCloseTo(sum, 4);
  expect(pushValues(arch, null)).toBeNull();
  expect(pushValues(arch, new Float32Array(20))).toBeNull();
  expect(pushValues(arch, new Float32Array(pushLength(QWEN_INFO)))!.scale).toBe(1);
  // A value that is not a number leaves its own part, and the layer that sums it, unlit. The rest keep their values and their scale.
  const broken = pushes.slice(), lost = { kind: "head", floor: 5, head: 1 } as const, loud = { kind: "mlp", floor: 7 } as const;
  broken[pushIndex(QWEN_INFO, lost)] = Number.NaN;
  broken[pushIndex(QWEN_INFO, loud)] = Number.POSITIVE_INFINITY;
  const partial = pushValues(arch, broken)!;
  expect(partial.scale).toBe(v.scale);
  for (const p of [lost, loud, { kind: "layer", floor: 5 } as const, { kind: "layer", floor: 7 } as const]) expect(partial.scaled[partIndex(arch, p)]).toBeNaN();
  arch.parts.forEach((p, i) => {
    if ("floor" in p && (p.floor === 5 || p.floor === 7)) return;
    expect(Object.is(partial.scaled[i], v.scaled[i]) || partial.scaled[i] === v.scaled[i]).toBe(true);
  });
});

it("gives every weight of a tiny-model layer to exactly one part", () => {
  const arch = buildArch(TINY_INFO), total = layout(cfg).total;
  expect(total).toBe(800_256);
  for (let L = 0; L < cfg.floors; L++) {
    const owners = new Uint8Array(total);
    arch.parts.forEach((p, i) => {
      if (!("floor" in p) || p.floor !== L || p.kind === "layer") return;
      for (const { tensor, r0, r1, c0, c1 } of tinyRanges(arch, cfg, i)) {
        const cols = tensor.shape[1] ?? 1;
        for (let r = r0; r < r1; r++) for (let c = c0; c < c1; c++) owners[tensor.offset + r * cols + c]++;
      }
    });
    for (const name of ["q", "k", "v", "o", "gate", "up", "down"]) {
      const t = tensors.get(`f${L}.${name}`)!;
      for (let i = t.offset; i < t.offset + t.size; i++) if (owners[i] !== 1) throw new Error(`f${L}.${name} weight ${i - t.offset} has ${owners[i]} owners`);
    }
    // The deck covers the whole layer, normalization weights included.
    let deck = 0;
    for (const { r0, r1, c0, c1 } of tinyRanges(arch, cfg, partIndex(TINY_INFO, { kind: "layer", floor: L }))) deck += (r1 - r0) * (c1 - c0);
    expect(deck).toBe(layout(cfg).tensors.filter((t) => t.name.startsWith(`f${L}.`)).reduce((n, t) => n + t.size, 0));
  }
});

it("colors each tiny-model part from its own slice of the real parameters", () => {
  const arch = buildArch(TINY_INFO), total = layout(cfg).total, D = cfg.headSize, W = cfg.width;
  const reference = Float32Array.from({ length: total }, (_, i) => Math.sin(i * 0.37) * 0.05), params = reference.slice();
  const at = (p: Parameters<typeof partIndex>[1]) => partIndex(TINY_INFO, p);
  expect(tinyValues(arch, cfg, params, reference)!.raw.every((v) => v === 0)).toBe(true);
  // Move one head's query rows: only that head and its deck change.
  const q = tensors.get("f2.q")!;
  for (let r = 3 * D; r < 4 * D; r++) for (let c = 0; c < W; c++) params[q.offset + r * W + c] += 0.5;
  let v = tinyValues(arch, cfg, params, reference)!;
  const moved = arch.parts.map((_, i) => i).filter((i) => v.raw[i] > 0);
  expect(moved.sort((a, b) => a - b)).toEqual([at({ kind: "layer", floor: 2 }), at({ kind: "head", floor: 2, head: 3 })].sort((a, b) => a - b));
  // Half of that head's weights (its query rows, not its output columns) moved by 0.5.
  expect(v.raw[at({ kind: "head", floor: 2, head: 3 })]).toBeCloseTo(Math.sqrt(0.25 / 2), 5);
  expect(v.scaled[at({ kind: "head", floor: 2, head: 3 })]).toBe(1);
  // Shared key rows belong to the pair's base, not to either head.
  const k = tensors.get("f0.k")!;
  for (let r = D; r < 2 * D; r++) for (let c = 0; c < W; c++) params[k.offset + r * W + c] -= 0.2;
  v = tinyValues(arch, cfg, params, reference)!;
  expect(v.raw[at({ kind: "kv", floor: 0, group: 1 })]).toBeCloseTo(Math.sqrt(0.04 / 2), 5);
  expect(v.raw[at({ kind: "kv", floor: 0, group: 0 })]).toBe(0);
  expect(v.raw[at({ kind: "head", floor: 0, head: 2 })]).toBe(0);
  // Output columns belong to the head that writes them.
  const o = tensors.get("f1.o")!;
  for (let r = 0; r < W; r++) params[o.offset + r * (cfg.heads * D) + D] += 1;
  v = tinyValues(arch, cfg, params, reference)!;
  expect(v.raw[at({ kind: "head", floor: 1, head: 1 })]).toBeGreaterThan(0);
  expect(v.raw[at({ kind: "head", floor: 1, head: 0 })]).toBe(0);
  // Whole-part numbers agree with the lab's own statistics, and the real mutation shows up where it was applied.
  const dict = tensors.get("dict")!;
  const damaged = mutateWeights(reference, cfg, { kind: "noise", amount: 0.25, seed: 3, floor: 1 });
  v = tinyValues(arch, cfg, damaged, reference)!;
  expect(v.raw[at({ kind: "embed" })]).toBe(0);
  expect(v.raw[at({ kind: "layer", floor: 0 })]).toBe(0);
  expect(v.raw[at({ kind: "mlp", floor: 1 })]).toBeGreaterThan(0);
  expect(v.raw[at({ kind: "head", floor: 1, head: 2 })]).toBeGreaterThan(0);
  const now = tinyValues(arch, cfg, reference, null)!;
  expect(now.raw[at({ kind: "embed" })]).toBeCloseTo(weightStats(reference.subarray(dict.offset, dict.offset + dict.size), new Float32Array(dict.size)).rms, 6);
  expect(tinyValues(arch, cfg, null, reference)).toBeNull();
  expect(tinyValues(arch, cfg, new Float32Array(10), null)).toBeNull();
});

it("shows tiny-model matrices as their real weights or their real change", () => {
  const total = layout(cfg).total, reference = Float32Array.from({ length: total }, (_, i) => Math.cos(i * 0.11) * 0.02), params = reference.slice();
  const down = tensors.get("f3.down")!;
  params[down.offset + 5 * down.shape[1] + 7] += 0.75;
  const plates = tinyLayerPlates(cfg, params, reference, 3);
  expect(plates.map((p) => p.id)).toEqual(["f3.q", "f3.k", "f3.v", "f3.o", "f3.gate", "f3.up", "f3.down"]);
  expect(plates.map((p) => p.band)).toEqual([0, 0, 0, 0, 1, 1, 1]);
  const q = plates[0], d = plates[6];
  expect([q.rows, q.cols, q.pool]).toEqual([128, 128, [1, 1]]);
  expect([d.rows, d.cols, d.pool]).toEqual([128, 128, [1, 3]]);
  expect(q.values.every((x) => x === 0)).toBe(true);
  expect(d.values[5 * 128 + 2]).toBeCloseTo(0.75, 6);
  expect(d.scale).toBeCloseTo(0.75, 6);
  // The readout names the cell the value was read from (column 8), not the first cell of its block (column 7).
  expect(d.origin(5, 2)).toEqual({ row: 5, col: 7, index: 5 * 384 + 7, count: 3 });
  expect(d.describe(5, 2)).toBe("W_down[6, 8]: 0.750, the largest of the 3 cells from W_down[6, 7] to W_down[6, 9]");
  expect(q.describe(0, 0)).toBe("W_q[1, 1]: 0.000");
  // Without a reference the plate holds the weights themselves, cell for cell.
  const raw = tinyLayerPlates(cfg, params, null, 3)[0], qt = tensors.get("f3.q")!;
  expect(Array.from(raw.values.subarray(0, 6))).toEqual(Array.from(params.subarray(qt.offset, qt.offset + 6)));
  const dict = tinyDictPlate(cfg, params, null);
  expect([dict.rows, dict.cols]).toEqual([VOCAB, cfg.width]);
});

it("pools large tensors by keeping the strongest value, sign included", () => {
  const p = pooled([1, -5, 2, 0, 3, 4, -1, 0.5], 2, 4, 1, 2);
  expect([p.rows, p.cols, p.pool]).toEqual([1, 2, [2, 2]]);
  expect(Array.from(p.values)).toEqual([-5, 2]);
  const same = pooled([1, 2, 3, 4], 2, 2, 8, 8);
  expect([same.rows, same.cols, same.pool, Array.from(same.values)]).toEqual([2, 2, [1, 1], [1, 2, 3, 4]]);
  const odd = pooled(Float32Array.from({ length: 10 }, (_, i) => i - 4.5), 1, 10, 1, 4);
  expect(odd.cols).toBe(4);
  expect(odd.pool).toEqual([1, 3]);
  expect(Array.from(odd.values)).toEqual([-4.5, -1.5, 3.5, 4.5]);
  expect([vectorRows(1024), vectorRows(3072), vectorRows(128), vectorRows(384), vectorRows(7)]).toEqual([16, 32, 8, 8, 1]);
  const named = plate({ id: "x", title: "X", band: 0, rows: 1, cols: 3, data: [0.25, -2, 0.004] });
  expect(named.scale).toBe(2);
  expect(named.describe(0, 1)).toBe("2: −2.000");
  expect(named.describe(0, 2)).toBe("3: 0.00400");
  // Every pooled readout credits the value to the cell it came from and counts the cells it stands for.
  const data = Float32Array.from({ length: 3 * 10 }, (_, i) => ((i * 7) % 11) - 5);
  const big = plate({ id: "m", title: "M", band: 0, rows: 3, cols: 10, data, maxRows: 2, maxCols: 4, name: (r, c) => `[${r},${c}]` });
  expect([big.rows, big.cols, big.pool]).toEqual([2, 4, [2, 3]]);
  for (let r = 0; r < big.rows; r++) {
    for (let c = 0; c < big.cols; c++) {
      const o = big.origin(r, c), value = big.values[r * big.cols + c];
      expect(data[o.row * 10 + o.col]).toBe(value);
      expect(Math.floor(o.row / 2)).toBe(r);
      expect(Math.floor(o.col / 3)).toBe(c);
      // No cell of the block is larger in magnitude, and blocks cut off by an edge count only real cells.
      let cells = 0;
      for (let rr = r * 2; rr < Math.min(3, r * 2 + 2); rr++) for (let cc = c * 3; cc < Math.min(10, c * 3 + 3); cc++) { cells++; expect(Math.abs(data[rr * 10 + cc])).toBeLessThanOrEqual(Math.abs(value)); }
      expect(o.count).toBe(cells);
      expect(big.describe(r, c).startsWith(`[${o.row},${o.col}]: `)).toBe(true);
      if (cells > 1) expect(big.describe(r, c)).toContain(`the largest of the ${cells} cells from [${r * 2},${c * 3}] to [${Math.min(2, r * 2 + 1)},${Math.min(9, c * 3 + 2)}]`);
    }
  }
  expect([big.origin(0, 0).count, big.origin(0, 3).count, big.origin(1, 0).count, big.origin(1, 3).count]).toEqual([6, 2, 3, 1]);
  expect(big.describe(1, 3)).not.toContain("largest");
  // A block of equal values is credited to its first cell, and masked scores read as minus infinity.
  const flat = plate({ id: "z", title: "Z", band: 0, rows: 1, cols: 4, data: [0, 0, Number.NEGATIVE_INFINITY, 2], maxCols: 2 });
  expect(flat.origin(0, 0)).toEqual({ row: 0, col: 0, index: 0, count: 2 });
  expect(flat.describe(0, 1)).toBe("3: −∞, the largest of the 2 cells from 3 to 4");
  expect(flat.scale).toBe(2);
});

it("turns one inspection pass into the layer's steps in computation order, skipping what was not captured", () => {
  const model = TINY_INFO, n = 5, detail = new Map<string, Float32Array>();
  const fill = (key: string, len: number, seed: number) => detail.set(key, Float32Array.from({ length: len }, (_, i) => Math.sin(i + seed)));
  for (const L of [1, 2]) {
    fill(`f${L}.x`, 128, L); fill(`f${L}.h`, 128, 2); fill(`f${L}.q_raw`, 4 * 32, 3); fill(`f${L}.k_raw`, 2 * 32, 4); fill(`f${L}.v`, 2 * 32, 5);
    fill(`f${L}.q_n`, 4 * 32, 20); fill(`f${L}.k_n`, 2 * 32, 21); fill(`f${L}.q`, 4 * 32, 22); fill(`f${L}.k`, 2 * 32, 23);
    detail.set(`f${L}.scores`, Float32Array.from({ length: 4 * n }, (_, i) => (i === 7 ? Number.NEGATIVE_INFINITY : (i % n) - 2)));
    detail.set(`f${L}.probs`, Float32Array.from({ length: 4 * n }, (_, i) => (i % n === 0 ? 0.6 : 0.1)));
    fill(`f${L}.att`, 4 * 32, 6); fill(`f${L}.o`, 128, 7); fill(`f${L}.mid`, 128, 8); fill(`f${L}.h2`, 128, 9);
    fill(`f${L}.gate`, 384, 10); fill(`f${L}.up`, 384, 11); fill(`f${L}.act`, 384, 12); fill(`f${L}.mem`, 128, 13);
  }
  fill("final.x", 128, 99);
  const plates = layerPlates(model, detail, 1);
  // Project, normalize and rotate the queries and keys, score and mix, then the MLP: every step the pass measured.
  expect(plates.map((p) => p.id)).toEqual(["x", "h", "q_raw", "k_raw", "v", "q_n", "k_n", "q", "k", "scores", "probs", "att", "o", "mid", "h2", "gate", "up", "act", "mem", "out"]);
  expect(plates.map((p) => p.band)).toEqual([0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 2, 3, 3, 3, 3, 3, 3]);
  expect(plates.map((p) => p.phase)).toEqual([...new Array(14).fill("attention"), ...new Array(6).fill("mlp")]);
  const by = new Map(plates.map((p) => [p.id, p]));
  // Normalized and rotated queries keep one row per head, keys one row per shared group, with the pass's own numbers.
  expect([by.get("q_n")!.rows, by.get("k_n")!.rows, by.get("q")!.rows, by.get("k")!.rows, by.get("scores")!.rows, by.get("scores")!.cols]).toEqual([4, 2, 4, 2, 4, n]);
  expect(by.get("q_n")!.values[5]).toBeCloseTo(Math.sin(5 + 20), 6);
  expect(by.get("k")!.values[40]).toBeCloseTo(Math.sin(40 + 23), 6);
  expect(by.get("q")!.describe(3, 31)).toBe(`head 4, 32: ${Math.sin(127 + 22) < 0 ? "−" : ""}${Math.abs(Math.sin(127 + 22)).toFixed(3)}`);
  // Scores are signed and scaled by their largest finite value; a hidden position stays minus infinity.
  expect([by.get("scores")!.ramp, by.get("scores")!.scale, by.get("scores")!.formula]).toEqual(["signed", 2, "s_j = q · k_j / √32"]);
  expect(by.get("scores")!.describe(1, 2)).toBe("head 2, position 2: −∞");
  expect(by.get("scores")!.describe(0, 4)).toBe("head 1, position 4: 2.000");
  expect([by.get("q_raw")!.rows, by.get("k_raw")!.rows, by.get("probs")!.rows, by.get("probs")!.cols]).toEqual([4, 2, 4, n]);
  // Attention is a probability: it keeps a fixed scale so plates are comparable between tokens.
  expect([by.get("probs")!.scale, by.get("probs")!.ramp]).toEqual([1, "size"]);
  expect(by.get("probs")!.describe(2, 0)).toBe("head 3, position 0: 0.600");
  expect(by.get("x")!.values[3]).toBeCloseTo(Math.sin(3 + 1), 6);
  // The stream leaving a layer is what the next layer actually read.
  expect(Array.from(by.get("out")!.values)).toEqual(Array.from(detail.get("f2.x")!));
  expect(Array.from(layerPlates(model, detail, 3).map((p) => p.id))).toEqual(["out"]);
  expect(layerPlates(model, detail, 3)[0].values[0]).toBeCloseTo(Math.sin(99), 6);
  detail.delete("f1.act");
  expect(layerPlates(model, detail, 1).map((p) => p.id)).not.toContain("act");
  // One head's attention row, exactly as measured.
  expect(Array.from(attentionRow(model, detail, 1, 2)!)).toEqual([0.6, 0.1, 0.1, 0.1, 0.1].map((x) => Math.fround(x)));
  expect(attentionRow(model, null, 1, 2)).toBeNull();
  expect(attentionRow(model, detail, 0, 0)).toBeNull();
});

it("fits any context into the tray without losing attention", () => {
  expect(tray(0, 16)).toEqual([]);
  const short = tray(3, 16, [0.5, 0.3, 0.2]);
  expect(short).toEqual([{ from: 0, to: 1, weight: 0.5 }, { from: 1, to: 2, weight: 0.3 }, { from: 2, to: 3, weight: 0.2 }]);
  const row = Float32Array.from({ length: 40 }, (_, i) => (i + 1) / 820);
  const long = tray(40, 16, row);
  expect(long).toHaveLength(16);
  expect(long[0]).toMatchObject({ from: 0, to: 25 });
  expect(long.slice(1).map((s) => s.from)).toEqual(Array.from({ length: 15 }, (_, i) => 25 + i));
  expect(long.at(-1)).toMatchObject({ from: 39, to: 40 });
  expect(long.reduce((a, s) => a + s.weight, 0)).toBeCloseTo(1, 5);
  expect(tray(16, 16)).toHaveLength(16);
  expect(tray(17, 16)[0]).toMatchObject({ from: 0, to: 2 });
  expect(tray(5, 16).every((s) => Number.isNaN(s.weight))).toBe(true);
});

it("reads the taught adapter's real matrices, rank by rank", () => {
  const W = 1024, U = 3072, reference = initialLesson({ width: W, units: U });
  const zero = lessonStats(reference, reference);
  expect(zero).toEqual({ changed: 0, rms: 0, max: 0 });
  // B starts at zero, so the untrained adapter contributes nothing on any rank.
  expect(Array.from(rankStrength(reference, W, U))).toEqual(new Array(LESSON_RANK).fill(0));
  const trained = { a: reference.a.slice(), b: reference.b.slice() };
  for (let i = 0; i < W; i++) trained.b[i * LESSON_RANK + 5] = i === 10 ? 3 : 0;
  trained.b[700 * LESSON_RANK + 2] = -0.5;
  trained.a[2 * U + 9] += 0.25;
  const stats = lessonStats(trained, reference);
  expect(stats.changed).toBe(3);
  expect(stats.max).toBe(3);
  expect(stats.rms).toBeCloseTo(Math.sqrt((9 + 0.25 + 0.0625) / 32768), 7);
  const strength = rankStrength(trained, W, U);
  let a5 = 0;
  for (let j = 0; j < U; j++) a5 += trained.a[5 * U + j] ** 2;
  expect(strength[5]).toBeCloseTo(3 * Math.sqrt(a5), 4);
  expect(strength[2]).toBeGreaterThan(0);
  expect([0, 1, 3, 4, 6, 7].every((r) => strength[r] === 0)).toBe(true);
  expect(lessonDelta(reference, trained)).toBeCloseTo(stats.rms, 7);
  expect(lessonDelta(null, trained)).toBe(0);

  const [a, rank, b] = lessonPlates(trained, reference, W, U);
  expect([a.rows, a.cols, a.pool]).toEqual([8, 192, [1, 16]]);
  expect([rank.rows, rank.cols, rank.ramp]).toEqual([8, 1, "size"]);
  expect([b.rows, b.cols, b.pool]).toEqual([8, 128, [1, 8]]);
  // Each row of every plate is the same rank: A's row, its size, and B's column laid on its side.
  expect(a.values[2 * 192 + 0]).toBeCloseTo(0.25, 6);
  expect(a.values.filter((x) => x !== 0)).toHaveLength(1);
  expect(b.values[5 * 128 + 1]).toBe(3);
  expect(b.values[2 * 128 + 87]).toBe(-0.5);
  // The trained weight is B[11, 6]. Its tile covers B[9..16, 6] and the readout says exactly that.
  expect(b.describe(5, 1)).toBe("B[11, 6]: 3.000, the largest of the 8 cells from B[9, 6] to B[16, 6]");
  expect(b.origin(2, 87)).toEqual({ row: 2, col: 700, index: 2 * 1024 + 700, count: 8 });
  expect(a.describe(2, 0)).toBe("A[3, 10]: 0.250, the largest of the 16 cells from A[3, 1] to A[3, 16]");
  expect(Array.from(rank.values)).toEqual(Array.from(strength));
  // Weights now, rather than change: A shows its random start, B the same learned values.
  const [rawA, , rawB] = lessonPlates(trained, null, W, U);
  expect(rawA.values.every((x) => x !== 0)).toBe(true);
  expect(rawB.values[5 * 128 + 1]).toBe(3);
  const [, rankChange] = lessonPlates(reference, trained, W, U);
  expect(rankChange.ramp).toBe("signed");
  expect(rankChange.values[5]).toBe(-strength[5]);
});

it("paints values with the page's ramps and never emits an invalid color", () => {
  const color = (v: number, kind: "signed" | "size") => ramp(LIGHT, v, kind).map(Math.round) as [number, number, number];
  const bytes = paint({ values: Float32Array.from([-2, 0, 1, Number.NaN, Number.NEGATIVE_INFINITY]), scale: 2, ramp: "signed" }, color);
  expect(Array.from(bytes.subarray(0, 4))).toEqual([...LIGHT.neg, 255]);
  expect(Array.from(bytes.subarray(4, 8))).toEqual([...LIGHT.zero, 255]);
  expect(Array.from(bytes.subarray(12, 16))).toEqual([...LIGHT.zero, 255]);
  expect(Array.from(bytes.subarray(16, 20))).toEqual([...LIGHT.neg, 255]);
  expect(bytes.every((b) => b >= 0 && b <= 255)).toBe(true);
  expect(ramp(LIGHT, 1, "signed")).toEqual(LIGHT.pos);
  expect(ramp(LIGHT, 1, "size")).toEqual(LIGHT.changed);
  expect(ramp(DARK, Number.NaN, "signed")).toEqual(unlit(DARK));
  // Small values stay visible, with the same curve as the page's own diverging colors.
  expect(ramp(LIGHT, 0.1, "signed")[0]).toBeCloseTo(LIGHT.zero[0] + (LIGHT.pos[0] - LIGHT.zero[0]) * 0.1 ** 0.7, 6);
});

it("drops a measurement that resolves after the token, model or changes moved on", async () => {
  const gate = new Latest(), seen: Measured<string>[] = [];
  const first = deferred<string | null>(), second = deferred<string | null>();
  const a = measure(gate, "token-1", () => first.promise, (m) => seen.push(m));
  const b = measure(gate, "token-2", () => second.promise, (m) => seen.push(m));
  second.resolve("two");
  await b;
  first.resolve("one");
  await a;
  expect(seen).toEqual([{ state: "loading", key: "token-1" }, { state: "loading", key: "token-2" }, { state: "ready", key: "token-2", value: "two" }]);
  // A failed or empty pass is reported as unavailable instead of leaving older numbers on screen.
  seen.length = 0;
  await measure<string>(gate, "k3", async () => null, (m) => seen.push(m));
  await measure<string>(gate, "k4", async () => { throw new Error("GPU reset"); }, (m) => seen.push(m));
  expect(seen.filter((m) => m.state !== "loading")).toEqual([{ state: "unavailable", key: "k3" }, { state: "unavailable", key: "k4" }]);
  // Cancelling (the stage closed, or nothing is selected) silences a pending result.
  seen.length = 0;
  const late = deferred<string | null>();
  const c = measure(gate, "k5", () => late.promise, (m) => seen.push(m));
  gate.cancel();
  late.resolve("late");
  await c;
  expect(seen).toEqual([{ state: "loading", key: "k5" }]);
  const base = { model: "qwen", version: 4, turn: 0, side: "normal", index: 3, token: 99, length: 12 };
  const keys = [base, { ...base, model: "tiny" }, { ...base, version: 5 }, { ...base, turn: 1 }, { ...base, side: "changed" }, { ...base, index: 4 }, { ...base, token: 98 }, { ...base, length: 13 }].map(measurementKey);
  expect(new Set(keys).size).toBe(keys.length);
});

it("settles springs on their target and survives long or broken frames", () => {
  const cur = new Float32Array([0, 5]), vel = new Float32Array([0, 0]), target = new Float32Array([1, 5]);
  let frames = 0, overshoot = 0;
  while (!spring(cur, vel, target, 0, 1 / 60) && frames++ < 600) overshoot = Math.max(overshoot, cur[0] - 1);
  expect(cur[0]).toBe(1);
  expect(vel[0]).toBe(0);
  expect(frames).toBeLessThan(120);
  expect(overshoot).toBeLessThan(0.15);
  expect(spring(cur, vel, target, 1, 1 / 60)).toBe(true);
  // A kick moves the part and it returns.
  vel[0] = -8;
  expect(spring(cur, vel, target, 0, 1 / 60)).toBe(false);
  expect(cur[0]).toBeLessThan(1);
  for (let i = 0; i < 600 && !spring(cur, vel, target, 0, 1 / 60); i++);
  expect(cur[0]).toBe(1);
  // A ten second frame is treated as a short one.
  cur[0] = 0; vel[0] = 0;
  spring(cur, vel, target, 0, 10);
  expect(Number.isFinite(cur[0]) && Math.abs(cur[0]) < 3).toBe(true);
  cur[0] = Number.NaN;
  expect(spring(cur, vel, target, 0, 1 / 60)).toBe(true);
  expect(cur[0]).toBe(1);
});
