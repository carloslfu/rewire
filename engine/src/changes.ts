// The change table (section 7.2): a storage buffer every kernel reads, one per conversation.
import {
  H_BITS, H_CONCEPT_FIRST, H_CONCEPT_FLOOR, H_CONCEPT_SCALE, H_FLAGS, H_MAGIC, H_NHIDDEN, H_NSWAPS, H_NZEROED,
  H_VERSION, MAX_HIDDEN, MAX_SWAPS, MAX_ZEROED, NO_CONCEPT, TABLE_MAGIC, TENSOR_ID, type ModelConfig, type TensorName,
  tableLayout,
} from "./config.ts";

export type HeadGeometry = { floor: number; head: number } & (
  | { kind: "rotate"; angle: number; seed: number }
  | { kind: "remove"; amount: number }
  | { kind: "shuffle"; seed: number }
);

export function geometryActive(g: HeadGeometry): boolean {
  return g.kind === "shuffle" || (g.kind === "rotate" ? g.angle !== 0 : g.amount !== 0);
}

/** Deterministic coordinate pairing and permutation. Width must be a power of two. */
export function geometryAxes(width: number, seed: number) {
  let h = (Math.imul(seed >>> 0, 747796405) + 2891336453) >>> 0;
  h = Math.imul(((h >>> ((h >>> 28) + 4)) ^ h) >>> 0, 277803737) >>> 0;
  h = ((h >>> 22) ^ h) >>> 0;
  const mask = 1 + h % (width - 1);
  return { mask, bit: mask & -mask, mul: ((h >>> 12) | 1) & (width - 1), add: 1 + (h >>> 20) % (width - 1) };
}

/** Changes, as in schemas/changes.schema.json. Zero-based floors, heads, positions and token ids. */
export interface ChangeSpec {
  geometry?: HeadGeometry[];
  heads?: { floor: number; head: number; mult: number }[];
  memory?: { floor: number; mult: number }[];
  floors?: { floor: number; mult: number }[];
  concept?: { id: string; floor: number; strength: number } | null;
  swaps?: [number, number][];
  hidden?: { key: number; from: number }[];
  zeroed?: { floor: number; tensor: TensorName; row: number; col: number }[];
  bits?: 4 | 3 | 2;
}

export const FLAG_ANY = 1;

/** t[code] for a bit width: 4 bits is the identity; 3 and 2 snap codes to 8 or 4 levels. */
export function bitTable(bits: number): number[] {
  if (bits === 4) return Array.from({ length: 16 }, (_, c) => c);
  const n = (1 << bits) - 1;
  // Python's round() rounds halves to even; none of these products land on .5 exactly.
  return Array.from({ length: 16 }, (_, c) => (Math.round((c * n) / 15) * 15) / n);
}

export interface ConceptLookup {
  /** Unit vector of a built-in concept at a floor. */
  vector(id: string, floor: number): Float32Array;
  /** Median stream size entering each floor. */
  rho: Float32Array | number[];
}

export function isNeutral(spec: ChangeSpec | undefined | null): boolean {
  if (!spec) return true;
  return !(
    (spec.geometry?.some(geometryActive)) ||
    (spec.heads?.some((h) => h.mult !== 1)) ||
    (spec.memory?.some((m) => m.mult !== 1)) ||
    (spec.floors?.some((m) => m.mult !== 1)) ||
    (spec.concept && spec.concept.strength !== 0) ||
    (spec.swaps?.length) ||
    (spec.hidden?.length) ||
    (spec.zeroed?.length) ||
    (spec.bits && spec.bits !== 4)
  );
}

export function encodeTable(
  spec: ChangeSpec | null | undefined,
  cfg: Pick<ModelConfig, "floors" | "queryHeads" | "width">,
  concepts?: ConceptLookup,
  conceptFirst = 0,
): Uint32Array {
  const lay = tableLayout(cfg);
  const buf = new ArrayBuffer(lay.words * 4);
  const u = new Uint32Array(buf);
  const f = new Float32Array(buf);
  const s = spec ?? {};
  u[H_MAGIC] = TABLE_MAGIC;
  u[H_VERSION] = 2;
  u[H_FLAGS] = isNeutral(s) ? 0 : FLAG_ANY;
  const bits = s.bits ?? 4;
  u[H_BITS] = bits;
  f.fill(1, lay.head, lay.head + cfg.floors * cfg.queryHeads + 2 * cfg.floors);
  for (const h of s.heads ?? []) f[lay.head + h.floor * cfg.queryHeads + h.head] = h.mult;
  for (const m of s.memory ?? []) f[lay.mem + m.floor] = m.mult;
  for (const m of s.floors ?? []) f[lay.floor + m.floor] = m.mult;
  u[H_CONCEPT_FLOOR] = NO_CONCEPT;
  if (s.concept && concepts) {
    const v = concepts.vector(s.concept.id, s.concept.floor);
    u[H_CONCEPT_FLOOR] = s.concept.floor;
    f[H_CONCEPT_SCALE] = s.concept.strength * Number(concepts.rho[s.concept.floor]);
    u[H_CONCEPT_FIRST] = conceptFirst;
    f.set(v, lay.concept);
  }
  const swaps = (s.swaps ?? []).slice(0, MAX_SWAPS);
  u[H_NSWAPS] = swaps.length;
  swaps.forEach(([a, b], i) => {
    u[lay.swaps + 2 * i] = a;
    u[lay.swaps + 2 * i + 1] = b;
  });
  const hidden = (s.hidden ?? []).slice(0, MAX_HIDDEN);
  u[H_NHIDDEN] = hidden.length;
  hidden.forEach((h, i) => {
    u[lay.hidden + 2 * i] = h.key;
    u[lay.hidden + 2 * i + 1] = h.from;
  });
  const zeroed = (s.zeroed ?? []).slice(0, MAX_ZEROED);
  u[H_NZEROED] = zeroed.length;
  zeroed.forEach((z, i) => {
    u.set([z.floor, TENSOR_ID[z.tensor], z.row, z.col], lay.zeroed + 4 * i);
  });
  f.set(bitTable(bits), lay.bitTable);
  const seen = new Set<number>();
  for (const g of s.geometry ?? []) {
    if (!Number.isInteger(g.floor) || g.floor < 0 || g.floor >= cfg.floors ||
        !Number.isInteger(g.head) || g.head < 0 || g.head >= cfg.queryHeads) throw new Error("Invalid geometry head");
    const index = g.floor * cfg.queryHeads + g.head;
    if (seen.has(index)) throw new Error("Only one geometry transform per head");
    seen.add(index);
    if (cfg.width < 2 || (cfg.width & (cfg.width - 1)) !== 0) throw new Error("Geometry needs a power-of-two model width");
    if (g.kind === "rotate" && (!Number.isFinite(g.angle) || Math.abs(g.angle) > 180)) throw new Error("Invalid rotation angle");
    if (g.kind === "remove" && (!Number.isFinite(g.amount) || g.amount < 0 || g.amount > 1)) throw new Error("Invalid removal amount");
    if (g.kind !== "remove" && (!Number.isInteger(g.seed) || g.seed < 0 || g.seed > 0xffffffff)) throw new Error("Invalid geometry seed");
    if (!geometryActive(g)) continue;
    const base = lay.geometry + index * 8;
    u[base] = g.kind === "rotate" ? 1 : g.kind === "remove" ? 2 : 3;
    if (g.kind === "rotate") {
      const a = g.angle * Math.PI / 180;
      // Exact cardinal angles make identity, tangent and flip exact at the intervention itself.
      f[base + 1] = Math.abs(g.angle) === 90 ? 0 : Math.cos(a);
      f[base + 2] = Math.abs(g.angle) === 180 ? 0 : Math.sin(a);
    }
    if (g.kind === "remove") f[base + 3] = g.amount;
    const axes = geometryAxes(cfg.width, g.kind === "remove" ? 0 : g.seed);
    u.set([axes.mask, axes.bit, axes.mul, axes.add], base + 4);
  }
  return u;
}

/** The token-id map of the swaps: map[id] for the ids that move. */
export function swapMap(spec: ChangeSpec | null | undefined): Map<number, number> {
  const m = new Map<number, number>();
  for (const [a, b] of spec?.swaps ?? []) {
    m.set(a, b);
    m.set(b, a);
  }
  return m;
}
