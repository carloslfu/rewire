// Real tensors, named and indexed so one exact number can be read: the weight matrices of the tiny
// model, the two matrices of the taught adapter, and a layer's measured values. Each is the same
// tensor a plate on the stage draws, without the pooling: every number is reachable by its own row
// and column.
import { LESSON_RANK, type LessonWeights } from "@rewire/engine/src/lora.ts";
import { layout, type TinyConfig } from "@rewire/tiny/src/config.ts";
import { signed } from "../ui/color.ts";
import { type Plate, rankStrength, TINY_MATRICES } from "./adapters.ts";
import type { Part } from "./arch.ts";

export interface Matrix {
  /** The id of the plate that draws it on the stage. */
  id: string;
  name: string;
  /** Its shape, and the formula it stands in, said once under the name. */
  detail: string;
  /** The heading it is listed under when a model has many: "Layer 2". */
  group?: string;
  /** The part whose plates include it. Choosing the matrix selects this part, so the stage shows the matrix. */
  part?: Part;
  rows: number;
  cols: number;
  /** What a row and a column count, in the singular. A vector has only the second. */
  axes: [string, string];
  /** The number the first row and the first column go by. Positions in a context count from 0, everything else from 1. */
  first: [number, number];
  /** One number's name, as the model's own code would index it. */
  cell: (row: number, col: number) => string;
  /** Row-major, rows × cols: the numbers as they are now. */
  values: ArrayLike<number>;
  /** The same numbers before training began. Measurements have no earlier state. */
  start?: ArrayLike<number>;
  /** What one number is: a weight, a value. */
  unit: string;
}

/** One number of one matrix, by its place in `Matrix.values`. */
export interface CellRef { id: string; index: number }

export interface Spread {
  /** Root-mean-square over the numbers that are numbers. */
  rms: number;
  /** The largest magnitude among them, and where it is. -1 when nothing is a number. */
  max: number;
  at: number;
}

export interface MatrixStats {
  count: number;
  /** Numbers that are not finite: a masked score, or a value the model did not produce. They are in neither spread. */
  unavailable: number;
  now: Spread;
  /** Against the start, for matrices that have one. `changed` counts the numbers that differ at all. */
  change?: Spread & { changed: number };
}

function spread(n: number, value: (i: number) => number): Spread & { counted: number; nonzero: number } {
  let ss = 0, max = 0, at = -1, counted = 0, nonzero = 0;
  for (let i = 0; i < n; i++) {
    const v = value(i), a = Math.abs(v);
    if (!Number.isFinite(a)) continue;
    counted++;
    if (v !== 0) nonzero++;
    ss += v * v;
    if (at < 0 || a > max) { max = a; at = i; }
  }
  return { rms: counted ? Math.sqrt(ss / counted) : 0, max, at, counted, nonzero };
}

/** Size and movement of one matrix, over all of its numbers. */
export function matrixStats(m: Pick<Matrix, "values" | "start">): MatrixStats {
  const count = m.values.length, { values, start } = m;
  const now = spread(count, (i) => values[i]);
  const out: MatrixStats = { count, unavailable: count - now.counted, now: { rms: now.rms, max: now.max, at: now.at } };
  if (start && start.length === count) {
    const moved = spread(count, (i) => values[i] - start[i]);
    out.change = { rms: moved.rms, max: moved.max, at: moved.at, changed: moved.nonzero };
  }
  return out;
}

/** The number a matrix opens on: where it moved the most, or where it is largest. */
export function defaultCell(m: Matrix, stats = matrixStats(m)): number {
  return Math.max(0, stats.change && stats.change.max > 0 ? stats.change.at : stats.now.at);
}

/** A number with enough digits to tell neighbors apart, and with the words for one that is not a number. */
export function exact(v: number): string {
  if (!Number.isFinite(v)) return signed(v);
  const a = Math.abs(v);
  if (a === 0) return "0";
  return `${v < 0 ? "−" : "+"}${a >= 1000 ? a.toFixed(1) : a >= 1 ? a.toFixed(4) : a.toFixed(6)}`;
}

const n = (x: number) => x.toLocaleString("en-US");

/** The measured tensors of a layer, or any plates already on the stage, as matrices. */
export function plateMatrices(plates: Plate[], part?: Part, unit = "value"): Matrix[] {
  return plates.map((p) => {
    const s = p.source, vector = !!s.vector || s.rows === 1, rows = vector ? 1 : s.rows, cols = vector ? s.rows * s.cols : s.cols;
    return { id: p.id, name: p.title, detail: [p.shape, p.formula].filter(Boolean).join(" · "), part, rows, cols, unit, axes: s.axes, first: s.first,
      cell: (r, c) => { const i = r * cols + c; return s.name(Math.floor(i / s.cols), i % s.cols); }, values: s.data };
  });
}

/**
 * Every weight matrix of the tiny model: the letter embeddings, then seven for each layer. The ids
 * are the tensors' own names, which are also the ids of their plates.
 */
export function tinyMatrices(cfg: TinyConfig, params: Float32Array, reference: Float32Array | null): Matrix[] {
  const by = new Map(layout(cfg).tensors.map((t) => [t.name, t]));
  const make = (name: string, title: string, formula: string, group: string | undefined, part: Part): Matrix => {
    const t = by.get(name)!, [rows, cols] = t.shape;
    return { id: name, name: title, detail: `${n(rows)} × ${n(cols)} weights · ${formula}`, group, part, rows, cols, axes: ["row", "column"], first: [1, 1], unit: "weight",
      cell: (r, c) => `${formula}[${r + 1}, ${c + 1}]`, values: params.subarray(t.offset, t.offset + t.size),
      start: reference && reference.length === params.length ? reference.subarray(t.offset, t.offset + t.size) : undefined };
  };
  const out = [make("dict", "Letter embeddings", "E", undefined, { kind: "embed" })];
  for (let L = 0; L < cfg.floors; L++) for (const [name, title, formula] of TINY_MATRICES) out.push(make(`f${L}.${name}`, title, formula, `Layer ${L + 1}`, { kind: "layer", floor: L }));
  return out;
}

/**
 * The adapter's two matrices and the size of each rank, in the rows the stage draws them in: one row
 * per rank. B is 1,024 × 8 in the model and stands on its side here, so its numbers keep their real names.
 */
export function lessonMatrices(weights: LessonWeights, reference: LessonWeights, width: number, units: number, part?: Part): Matrix[] {
  const onSide = (b: Float32Array) => { const out = new Float32Array(LESSON_RANK * width); for (let i = 0; i < width; i++) for (let r = 0; r < LESSON_RANK; r++) out[r * width + i] = b[i * LESSON_RANK + r]; return out; };
  return [
    { id: "lora.b", name: "Matrix B · writes to the stream", detail: `${n(width)} × ${LESSON_RANK} weights, one row here for each rank · m += B z`, part, rows: LESSON_RANK, cols: width,
      axes: ["rank", "stream number"], first: [1, 1], unit: "weight", cell: (r, c) => `B[${c + 1}, ${r + 1}]`, values: onSide(weights.b), start: onSide(reference.b) },
    { id: "lora.a", name: "Matrix A · reads the neurons", detail: `${LESSON_RANK} × ${n(units)} weights · z = A a`, part, rows: LESSON_RANK, cols: units,
      axes: ["rank", "neuron"], first: [1, 1], unit: "weight", cell: (r, c) => `A[${r + 1}, ${c + 1}]`, values: weights.a, start: reference.a },
    { id: "lora.rank", name: "Rank size", detail: `${LESSON_RANK} ranks · ‖B_r‖ · ‖A_r‖`, part, rows: LESSON_RANK, cols: 1,
      axes: ["rank", ""], first: [1, 1], unit: "size", cell: (r) => `rank ${r + 1}`, values: rankStrength(weights, width, units), start: rankStrength(reference, width, units) },
  ];
}
