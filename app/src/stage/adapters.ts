// Turns measured values and real parameter arrays into what the specimen draws. Nothing here invents
// a number: a part without a measurement gets NaN and stays unlit.
import { LESSON_RANK, type LessonWeights } from "@rewire/engine/src/lora.ts";
import { layout, type Tensor, type TinyConfig } from "@rewire/tiny/src/config.ts";
import type { ModelInfo } from "../model/info.ts";
import type { FloorDetail, Tok } from "../model/types.ts";
import { type Arch, pushIndex, pushLength } from "./arch.ts";

export interface PartValues {
  /** One number per part in the part's own units, NaN where nothing was measured. */
  raw: Float32Array;
  /** The same numbers divided by `scale` and clamped to [-1, 1]. */
  scaled: Float32Array;
  scale: number;
}

function finish(raw: Float32Array, scale: number): PartValues {
  const s = scale > 0 && Number.isFinite(scale) ? scale : 1;
  // A value that is not a number, or not finite, is no measurement: its part stays unlit instead of reading as the strongest.
  return { raw, scale: s, scaled: raw.map((v) => (Number.isFinite(v) ? Math.max(-1, Math.min(1, v / s)) : NaN)) };
}

export interface OutputBar { id: number; p: number; chosen: boolean }

/**
 * The bars over Words out for one written token: the model's own probability of the pieces it ranked
 * highest and of the piece that was written, all at temperature 1 over the whole vocabulary. The
 * written piece always has a bar, with exp(lp1), also when it was picked by hand from outside the
 * list. The draw's odds are never used here, so one chart never mixes the two measures; a candidate
 * with no model probability is left out rather than drawn with the other kind of number. A written
 * piece whose log-probability is not a number keeps its bar with NaN, which is labelled unavailable.
 */
export function outputBars(tok: Pick<Tok, "id" | "lp1" | "cands">, limit: number): OutputBar[] {
  const own: OutputBar = { id: tok.id, p: Number.isNaN(tok.lp1) ? Number.NaN : Math.max(0, Math.min(1, Math.exp(tok.lp1))), chosen: true };
  const others = tok.cands.filter((c) => c.id !== tok.id && c.modelP !== undefined && c.modelP >= 0 && c.modelP <= 1)
    .map((c): OutputBar => ({ id: c.id, p: c.modelP!, chosen: false })).sort((a, b) => b.p - a.p).slice(0, Math.max(0, limit - 1));
  const at = Number.isNaN(own.p) ? -1 : others.findIndex((o) => o.p < own.p);
  others.splice(at < 0 ? others.length : at, 0, own);
  return others;
}

/** A token's direct pushes placed on the parts that made them. A layer's deck carries the sum of its parts. */
export function pushValues(arch: Arch, pushes: ArrayLike<number> | null | undefined): PartValues | null {
  if (!pushes || pushes.length < pushLength(arch.model)) return null;
  const raw = new Float32Array(arch.parts.length).fill(NaN);
  let scale = 0;
  // The scale comes from the values that are numbers, so one that is not cannot unlight or rescale the rest.
  for (let i = 0; i < pushLength(arch.model); i++) { const a = Math.abs(pushes[i]); if (Number.isFinite(a) && a > scale) scale = a; }
  const layer = new Float64Array(arch.floors);
  arch.parts.forEach((p, i) => {
    const k = pushIndex(arch.model, p);
    if (k < 0) return;
    raw[i] = pushes[k];
    if (p.kind === "head" || p.kind === "mlp") layer[p.floor] += pushes[k];
  });
  arch.parts.forEach((p, i) => { if (p.kind === "layer") raw[i] = layer[p.floor]; });
  return finish(raw, scale);
}

// ------------------------------------------------------------------ the tiny model's parameters

interface Range { tensor: Tensor; r0: number; r1: number; c0: number; c1: number }

function whole(t: Tensor): Range {
  return { tensor: t, r0: 0, r1: t.shape[0], c0: 0, c1: t.shape[1] ?? 1 };
}

function rms(params: Float32Array, reference: Float32Array | null, ranges: Range[]): number {
  let ss = 0, n = 0;
  for (const { tensor, r0, r1, c0, c1 } of ranges) {
    const cols = tensor.shape[1] ?? 1;
    for (let r = r0; r < r1; r++) {
      for (let c = c0; c < c1; c++) {
        const i = tensor.offset + r * cols + c, d = params[i] - (reference ? reference[i] : 0);
        ss += d * d;
      }
    }
    n += (r1 - r0) * (c1 - c0);
  }
  return n ? Math.sqrt(ss / n) : 0;
}

/** The slices of the flat parameter array that belong to one part of the tiny model. */
export function tinyRanges(arch: Arch, cfg: TinyConfig, partAt: number): Range[] {
  const p = arch.parts[partAt], D = cfg.headSize;
  const by = new Map(layout(cfg).tensors.map((t) => [t.name, t]));
  const t = (name: string) => by.get(name)!;
  if (p.kind === "embed" || p.kind === "unembed") return [whole(t("dict"))];
  if (p.kind === "norm") return [whole(t("final_norm"))];
  const f = (name: string) => t(`f${p.floor}.${name}`);
  if (p.kind === "head") return [{ ...whole(f("q")), r0: p.head * D, r1: (p.head + 1) * D }, { ...whole(f("o")), c0: p.head * D, c1: (p.head + 1) * D }];
  if (p.kind === "kv") return (["k", "v"] as const).map((n) => ({ ...whole(f(n)), r0: p.group * D, r1: (p.group + 1) * D }));
  if (p.kind === "mlp") return (["gate", "up", "down"] as const).map((n) => whole(f(n)));
  return ["in_norm", "post_norm", "q_norm", "k_norm", "q", "k", "v", "o", "gate", "up", "down"].map((n) => whole(f(n)));
}

/**
 * Root-mean-square size of each part's parameters, or of their change from `reference`. A head owns
 * its rows of the query matrix and its columns of the output matrix; paired heads share key and value rows.
 */
export function tinyValues(arch: Arch, cfg: TinyConfig, params: Float32Array | null, reference: Float32Array | null): PartValues | null {
  if (!params || params.length !== layout(cfg).total || (reference && reference.length !== params.length)) return null;
  const raw = new Float32Array(arch.parts.length);
  let scale = 0;
  arch.parts.forEach((p, i) => {
    raw[i] = rms(params, reference, tinyRanges(arch, cfg, i));
    if (p.kind !== "layer") scale = Math.max(scale, raw[i]);
  });
  return finish(raw, scale);
}

// ------------------------------------------------------------------ plates: real tensors as readable tiles

export interface Plate {
  id: string;
  /** Short name drawn above the plate. */
  title: string;
  formula?: string;
  /** What the tiles are, for the readout: shape and unit. */
  shape: string;
  rows: number;
  cols: number;
  /** Row-major tile values after pooling. */
  values: Float32Array;
  /** Color scale: the largest magnitude, unless the tensor has a natural range. */
  scale: number;
  /** Source cells per tile, down and across. A pooled tile shows its largest-magnitude cell. */
  pool: [number, number];
  /** The source cell a tile's value came from, and how many source cells the tile stands for. */
  origin: (row: number, col: number) => { row: number; col: number; count: number };
  /** The replay beat this plate belongs to, for plates of a measured layer. */
  phase?: "attention" | "mlp";
  /** Unsigned sizes use the single-color ramp; signed values use blue and orange. */
  ramp: "signed" | "size";
  /** Plain description of one tile, with its real value. */
  describe: (row: number, col: number) => string;
  /** Row of the bay this plate stands in. */
  band: number;
}

/**
 * Shrink a matrix for display by keeping, in each block, the value with the largest magnitude.
 * `source` records which cell each kept value came from, so a readout never credits it to another cell.
 */
export function pooled(values: ArrayLike<number>, rows: number, cols: number, maxRows: number, maxCols: number) {
  const pr = Math.max(1, Math.ceil(rows / maxRows)), pc = Math.max(1, Math.ceil(cols / maxCols));
  const R = Math.ceil(rows / pr), C = Math.ceil(cols / pc), out = new Float32Array(R * C), source = new Int32Array(R * C).fill(-1);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const v = values[r * cols + c], k = Math.floor(r / pr) * C + Math.floor(c / pc);
      // The first cell of a block stands until a strictly larger magnitude replaces it.
      if (source[k] < 0 || Math.abs(v) > Math.abs(out[k])) { out[k] = v; source[k] = r * cols + c; }
    }
  }
  return { values: out, rows: R, cols: C, pool: [pr, pc] as [number, number], source };
}

function largest(values: ArrayLike<number>): number {
  let m = 0;
  for (let i = 0; i < values.length; i++) { const a = Math.abs(values[i]); if (Number.isFinite(a) && a > m) m = a; }
  return m || 1;
}

const num = (v: number) => (Number.isNaN(v) ? "not a number" : !Number.isFinite(v) ? (v < 0 ? "−∞" : "∞")
  : `${v < 0 ? "−" : ""}${Math.abs(v).toFixed(Math.abs(v) < 0.01 && v !== 0 ? 5 : 3)}`);

/** Rows for a vector drawn as a block about four times wider than tall. */
export function vectorRows(n: number): number {
  const rows = 2 ** Math.round(Math.log2(Math.sqrt(n / 4)));
  return rows >= 1 && n % rows === 0 ? rows : 1;
}

interface PlateInput { id: string; title: string; formula?: string; shape?: string; band: number; phase?: Plate["phase"]; rows: number; cols: number; data: ArrayLike<number>;
  scale?: number; ramp?: Plate["ramp"]; name?: (row: number, col: number) => string; maxRows?: number; maxCols?: number }

export function plate(p: PlateInput): Plate {
  const s = pooled(p.data, p.rows, p.cols, p.maxRows ?? 128, p.maxCols ?? 128);
  const [pr, pc] = s.pool;
  const name = p.name ?? ((r, c) => (p.rows === 1 ? `${c + 1}` : `row ${r + 1}, ${c + 1}`));
  // A tile's block of source cells. Blocks on the last row or column can be smaller than the pooling step.
  const block = (r: number, c: number) => ({ r0: r * pr, r1: Math.min(p.rows, (r + 1) * pr) - 1, c0: c * pc, c1: Math.min(p.cols, (c + 1) * pc) - 1 });
  const origin = (r: number, c: number) => {
    const at = s.source[r * s.cols + c], b = block(r, c);
    return { row: Math.floor(at / p.cols), col: at % p.cols, count: (b.r1 - b.r0 + 1) * (b.c1 - b.c0 + 1) };
  };
  return { id: p.id, title: p.title, formula: p.formula, band: p.band, phase: p.phase, rows: s.rows, cols: s.cols, values: s.values, pool: s.pool, origin,
    shape: p.shape ?? (p.rows === 1 ? `${p.cols.toLocaleString("en-US")} numbers` : `${p.rows.toLocaleString("en-US")} × ${p.cols.toLocaleString("en-US")} numbers`),
    scale: p.scale ?? largest(p.data), ramp: p.ramp ?? "signed",
    // The value is named by the cell it was actually read from; a pooled tile also says which cells it stands for.
    describe: (r, c) => {
      const o = origin(r, c), b = block(r, c), value = `${name(o.row, o.col)}: ${num(s.values[r * s.cols + c])}`;
      return o.count === 1 ? value : `${value}, the largest of the ${o.count} cells from ${name(b.r0, b.c0)} to ${name(b.r1, b.c1)}`;
    } };
}

function vector(id: string, title: string, formula: string, band: number, data: ArrayLike<number>, phase?: Plate["phase"]): Plate {
  const rows = vectorRows(data.length), cols = data.length / rows;
  return plate({ id, title, formula, band, phase, rows, cols, data, shape: `${data.length.toLocaleString("en-US")} numbers`, name: (r, c) => `number ${r * cols + c + 1}` });
}

/**
 * One layer's measured computation for the selected token, in the order it happens: read and project,
 * normalize and rotate the queries and keys, score and mix, then the MLP. Returns only the steps the
 * inspection pass actually captured.
 */
export function layerPlates(model: ModelInfo, detail: FloorDetail, floor: number): Plate[] {
  const g = (k: string) => detail.get(`f${floor}.${k}`);
  const H = model.heads, KV = model.kvHeads, D = (g("q_raw")?.length ?? 0) / H;
  const out: Plate[] = [];
  const v = (k: string, title: string, formula: string, band: number, data = g(k)) => {
    if (data?.length) out.push(vector(k, title, formula, band, data, band === 3 ? "mlp" : "attention"));
  };
  const m = (k: string, title: string, formula: string, band: number, rows: number, unit: string, scale?: number) => {
    const data = g(k);
    if (!data?.length || data.length % rows) return;
    const cols = data.length / rows, positions = k === "probs" || k === "scores";
    out.push(plate({ id: k, title, formula, band, phase: "attention", rows, cols, data, scale, ramp: scale ? "size" : "signed",
      shape: positions ? `${rows} heads × ${cols} positions` : `${rows} ${unit}s × ${cols} numbers`,
      name: (r, c) => `${unit} ${r + 1}, ${positions ? `position ${c}` : c + 1}` }));
  };
  v("x", "Stream in", "x", 0);
  v("h", "Normalize", "h = x / rms(x) · w", 0);
  m("q_raw", "Queries", "q = W_q h", 0, H, "head");
  m("k_raw", "Keys, shared", "k = W_k h", 0, KV, "group");
  m("v", "Values, shared", "v = W_v h", 0, KV, "group");
  m("q_n", "Queries, normalized", "q ← q / rms(q) · w_q", 1, H, "head");
  m("k_n", "Keys, normalized", "k ← k / rms(k) · w_k", 1, KV, "group");
  m("q", "Queries, rotated", "q ← q·cos θp + rot(q)·sin θp", 1, H, "head");
  m("k", "Keys, rotated", "k ← k·cos θp + rot(k)·sin θp", 1, KV, "group");
  m("scores", "Scores", D ? `s_j = q · k_j / √${D}` : "s_j = q · k_j / √d", 2, H, "head");
  m("probs", "Attention", "a = softmax(s)", 2, H, "head", 1);
  m("att", "Mixed values", "o_h = Σ a_j v_j", 2, H, "head");
  v("o", "Combine heads", "o = W_o [o_1 … o_H]", 2);
  v("mid", "Add to stream", "middle = x + o", 2);
  v("h2", "Normalize", "h₂ = middle / rms(middle) · w", 3);
  v("gate", "Gate", "g = W_gate h₂", 3);
  v("up", "Up", "u = W_up h₂", 3);
  v("act", "Neurons", "a = silu(g) · u", 3);
  v("mem", "Project down", "m = W_down a", 3);
  v("out", "Stream out", "middle + m", 3, floor + 1 < model.floors ? detail.get(`f${floor + 1}.x`) : detail.get("final.x"));
  return out;
}

/** Where one head looks from the selected token: its real attention row over every earlier position. */
export function attentionRow(model: Pick<ModelInfo, "heads">, detail: FloorDetail | null, floor: number, head: number): Float32Array | null {
  const probs = detail?.get(`f${floor}.probs`);
  if (!probs || probs.length % model.heads) return null;
  const n = probs.length / model.heads;
  return probs.subarray(head * n, head * n + n);
}

export interface TraySlot {
  /** First position in this slot; the first slot gathers every earlier position when the context is longer than the tray. */
  from: number;
  to: number;
  /** Attention on the slot (the sum over its positions), or NaN when nothing was measured. */
  weight: number;
}

/** Fit a context of n positions into a tray: the newest positions one per slot, anything older summed into the first. */
export function tray(n: number, slots: number, row?: ArrayLike<number> | null): TraySlot[] {
  if (n <= 0 || slots <= 0) return [];
  const single = n <= slots ? n : slots - 1, start = n - single, out: TraySlot[] = [];
  const sum = (a: number, b: number) => { if (!row) return NaN; let s = 0; for (let j = a; j < b; j++) s += row[j] ?? 0; return s; };
  if (start > 0) out.push({ from: 0, to: start, weight: sum(0, start) });
  for (let j = start; j < n; j++) out.push({ from: j, to: j + 1, weight: sum(j, j + 1) });
  return out;
}

const TINY_MATRICES: [string, string, string, number][] = [
  ["q", "Queries", "W_q", 0], ["k", "Keys", "W_k", 0], ["v", "Values", "W_v", 0], ["o", "Head output", "W_o", 0],
  ["gate", "MLP gate", "W_gate", 1], ["up", "MLP up", "W_up", 1], ["down", "MLP down", "W_down", 1],
];

function tensorPlate(t: Tensor, title: string, formula: string, band: number, params: Float32Array, reference: Float32Array | null): Plate {
  const data = params.slice(t.offset, t.offset + t.size);
  if (reference) for (let i = 0; i < data.length; i++) data[i] -= reference[t.offset + i];
  const [rows, cols] = t.shape.length === 2 ? t.shape : [1, t.shape[0]];
  return plate({ id: t.name, title, formula, band, rows, cols, data, shape: `${rows} × ${cols} weights`, name: (r, c) => `${formula}[${r + 1}, ${c + 1}]` });
}

/** The real weight matrices of one tiny-model layer, or their change from `reference`. */
export function tinyLayerPlates(cfg: TinyConfig, params: Float32Array, reference: Float32Array | null, floor: number): Plate[] {
  const by = new Map(layout(cfg).tensors.map((t) => [t.name, t]));
  return TINY_MATRICES.map(([name, title, formula, band]) => tensorPlate(by.get(`f${floor}.${name}`)!, title, formula, band, params, reference));
}

export function tinyDictPlate(cfg: TinyConfig, params: Float32Array, reference: Float32Array | null): Plate {
  return tensorPlate(layout(cfg).tensors.find((t) => t.name === "dict")!, "Letter embeddings", "E", 0, params, reference);
}

// ------------------------------------------------------------------ the taught adapter

export function lessonStats(weights: LessonWeights, reference: LessonWeights) {
  let changed = 0, ss = 0, max = 0;
  for (const k of ["a", "b"] as const) {
    for (let i = 0; i < weights[k].length; i++) {
      const d = weights[k][i] - reference[k][i];
      if (d !== 0) changed++;
      ss += d * d;
      max = Math.max(max, Math.abs(d));
    }
  }
  return { changed, rms: Math.sqrt(ss / (weights.a.length + weights.b.length)), max };
}

/** Size of each rank's contribution to the update B·A: the norm of its column of B times the norm of its row of A. */
export function rankStrength(w: LessonWeights, width: number, units: number): Float32Array {
  const out = new Float32Array(LESSON_RANK);
  for (let r = 0; r < LESSON_RANK; r++) {
    let aa = 0, bb = 0;
    for (let j = 0; j < units; j++) aa += w.a[r * units + j] ** 2;
    for (let i = 0; i < width; i++) bb += w.b[i * LESSON_RANK + r] ** 2;
    out[r] = Math.sqrt(aa * bb);
  }
  return out;
}

/** Root-mean-square movement of the adapter between two training snapshots. */
export function lessonDelta(before: LessonWeights | null, after: LessonWeights): number {
  if (!before || before.a.length !== after.a.length || before.b.length !== after.b.length) return 0;
  let ss = 0;
  for (let i = 0; i < after.a.length; i++) ss += (after.a[i] - before.a[i]) ** 2;
  for (let i = 0; i < after.b.length; i++) ss += (after.b[i] - before.b[i]) ** 2;
  return Math.sqrt(ss / (after.a.length + after.b.length));
}

/**
 * The adapter as three aligned plates. Each row is one of its eight ranks: what the rank reads from the
 * MLP's neurons (A), how much it contributes, and what it writes to the stream (B, drawn on its side).
 */
export function lessonPlates(weights: LessonWeights, reference: LessonWeights | null, width: number, units: number): Plate[] {
  const a = weights.a.slice(), bt = new Float32Array(LESSON_RANK * width);
  if (reference) for (let i = 0; i < a.length; i++) a[i] -= reference.a[i];
  for (let i = 0; i < width; i++) for (let r = 0; r < LESSON_RANK; r++) bt[r * width + i] = weights.b[i * LESSON_RANK + r] - (reference ? reference.b[i * LESSON_RANK + r] : 0);
  const strength = rankStrength(weights, width, units);
  return [
    plate({ id: "lora.a", title: "A reads the neurons", formula: "z = A a", band: 0, rows: LESSON_RANK, cols: units, data: a, maxCols: 192,
      shape: `${LESSON_RANK} × ${units.toLocaleString("en-US")} weights`, name: (r, c) => `A[${r + 1}, ${c + 1}]` }),
    plate({ id: "lora.rank", title: "Rank size", formula: "‖B_r‖ · ‖A_r‖", band: 0, rows: LESSON_RANK, cols: 1, data: strength, ramp: "size",
      shape: `${LESSON_RANK} ranks`, name: (r) => `rank ${r + 1}` }),
    plate({ id: "lora.b", title: "B writes to the stream", formula: "m += B z", band: 0, rows: LESSON_RANK, cols: width, data: bt, maxCols: 128,
      shape: `${width.toLocaleString("en-US")} × ${LESSON_RANK} weights, drawn on its side`, name: (r, c) => `B[${c + 1}, ${r + 1}]` }),
  ];
}

/** Paint tile values into RGBA bytes with the page's color ramps. */
export function paint(p: Pick<Plate, "values" | "scale" | "ramp">, color: (v: number, ramp: Plate["ramp"]) => [number, number, number]): Uint8Array {
  const out = new Uint8Array(p.values.length * 4);
  for (let i = 0; i < p.values.length; i++) {
    const v = p.values[i], [r, g, b] = color(Number.isFinite(v) ? Math.max(-1, Math.min(1, v / p.scale)) : v < 0 ? -1 : 0, p.ramp);
    out[4 * i] = r; out[4 * i + 1] = g; out[4 * i + 2] = b; out[4 * i + 3] = 255;
  }
  return out;
}
