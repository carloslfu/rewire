// The change table (section 7.2): a storage buffer every kernel reads, one per conversation.
import {
  H_BITS, H_CONCEPT_FIRST, H_CONCEPT_FLOOR, H_CONCEPT_SCALE, H_FLAGS, H_MAGIC, H_NHIDDEN, H_NSWAPS, H_NZEROED,
  H_VERSION, MAX_HIDDEN, MAX_SWAPS, MAX_ZEROED, NO_CONCEPT, TABLE_MAGIC, TENSOR_ID, type ModelConfig, type TensorName,
  tableLayout,
} from "./config.ts";

/** Changes, as in schemas/changes.schema.json. Zero-based floors, heads, positions and token ids. */
export interface ChangeSpec {
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
  u[H_VERSION] = 1;
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
