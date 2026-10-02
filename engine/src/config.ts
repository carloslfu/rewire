// Model configuration and the change table layout (schemas/conventions.json, section 7.2).

export interface ModelConfig {
  name: string;
  floors: number;
  width: number;
  queryHeads: number;
  kvHeads: number;
  headSize: number;
  units: number;
  vocabRows: number;
  vocabReal: number;
  ropeTheta: number;
  eps: number;
  maxContext: number;
  /** Group size of the 4-bit format; 0 for a float32 model (the tiny model). */
  group: number;
  /** Bits of the dictionary: 4, 8, 16 (f16) or 32 (f32). */
  dictBits: number;
  /** Bits of the weights inside the floors: 4 or 32. */
  floorBits: number;
}

export const QWEN3_06B: Omit<ModelConfig, "group" | "dictBits" | "maxContext"> = {
  name: "Qwen3-0.6B",
  floors: 28,
  width: 1024,
  queryHeads: 16,
  kvHeads: 8,
  headSize: 128,
  units: 3072,
  vocabRows: 151936,
  vocabReal: 151669,
  ropeTheta: 1_000_000,
  eps: 1e-6,
  floorBits: 4,
};

export const STOP_TOKENS = [151645, 151643];

/** Word offsets of the change table for a configuration. */
export interface TableLayout {
  header: number;
  head: number;
  mem: number;
  floor: number;
  concept: number;
  swaps: number;
  hidden: number;
  zeroed: number;
  bitTable: number;
  geometry: number;
  words: number;
}

export const MAX_SWAPS = 16;
export const MAX_HIDDEN = 16;
export const MAX_ZEROED = 8;

export function tableLayout(c: Pick<ModelConfig, "floors" | "queryHeads" | "width">): TableLayout {
  const header = 0;
  const head = 16;
  const mem = head + c.floors * c.queryHeads;
  const floor = mem + c.floors;
  const concept = floor + c.floors;
  const swaps = concept + c.width;
  const hidden = swaps + MAX_SWAPS * 2;
  const zeroed = hidden + MAX_HIDDEN * 2;
  const bitTable = zeroed + MAX_ZEROED * 4;
  const geometry = bitTable + 16;
  const words = geometry + c.floors * c.queryHeads * 8;
  return { header, head, mem, floor, concept, swaps, hidden, zeroed, bitTable, geometry, words };
}

// Header words
export const H_MAGIC = 0, H_VERSION = 1, H_FLAGS = 2, H_BITS = 3, H_CONCEPT_FLOOR = 4, H_CONCEPT_SCALE = 5,
  H_CONCEPT_FIRST = 6, H_NSWAPS = 7, H_NHIDDEN = 8, H_NZEROED = 9;
export const TABLE_MAGIC = 0x52574354; // 'RWCT'
export const NO_CONCEPT = 0xffffffff;

export const TENSORS = ["q", "k", "v", "o", "gate", "up", "down"] as const;
export type TensorName = (typeof TENSORS)[number];
export const TENSOR_ID: Record<TensorName, number> = { q: 0, k: 1, v: 2, o: 3, gate: 4, up: 5, down: 6 };
