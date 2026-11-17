// The specimen's parts and where they sit. Counts and indices come from the model's real shape;
// the positions and sizes are a drawing, not a claim about what a model looks like.
import type { ModelInfo } from "../model/info.ts";

export type Part =
  | { kind: "embed" }
  | { kind: "layer"; floor: number }
  | { kind: "kv"; floor: number; group: number }
  | { kind: "head"; floor: number; head: number }
  | { kind: "mlp"; floor: number }
  | { kind: "norm" }
  | { kind: "unembed" };

export type Vec3 = [number, number, number];

export interface Metrics {
  headW: number; headH: number; headD: number; headGap: number; groupGap: number;
  pitch: number; deckT: number; deckD: number; margin: number;
  spineSlot: number; spineR: number; mlpW: number; plinthH: number; saddleH: number; crownH: number;
}

const LARGE: Metrics = { headW: 0.4, headH: 0.3, headD: 0.5, headGap: 0.06, groupGap: 0.2, pitch: 0.66, deckT: 0.06, deckD: 1.2,
  margin: 0.25, spineSlot: 1.1, spineR: 0.15, mlpW: 2, plinthH: 0.5, saddleH: 0.05, crownH: 0.3 };
const SMALL: Metrics = { headW: 1, headH: 0.62, headD: 1, headGap: 0.14, groupGap: 0.44, pitch: 1.55, deckT: 0.1, deckD: 2,
  margin: 0.4, spineSlot: 1.6, spineR: 0.22, mlpW: 3.2, plinthH: 0.6, saddleH: 0.08, crownH: 0.4 };

export interface Arch {
  model: ModelInfo;
  floors: number;
  heads: number;
  kvHeads: number;
  /** Query heads that share one key/value group. */
  perGroup: number;
  /** Parts in a fixed order: embed, then per layer its deck, key/value groups, heads and MLP, then norm and unembed. */
  parts: Part[];
  /** Center of each part at rest. */
  pos: Vec3[];
  size: Vec3[];
  m: Metrics;
  deckW: number;
  /** Left edge of the attention bank. */
  bankX: number;
  spineX: number;
  /** The residual spine runs behind the modules. */
  spineZ: number;
  mlpX: number;
  /** Top of the highest component. */
  topY: number;
  /** Height of a candidate bar at probability 1. */
  barRoom: number;
  bounds: { min: Vec3; max: Vec3 };
}

/** Grouped-query attention: consecutive query heads read the same keys and values. */
export const kvGroup = (model: Pick<ModelInfo, "heads" | "kvHeads">, head: number) => Math.floor(head / (model.heads / model.kvHeads));

export function groupHeads(model: Pick<ModelInfo, "heads" | "kvHeads">, group: number): number[] {
  const per = model.heads / model.kvHeads;
  return Array.from({ length: per }, (_, j) => group * per + j);
}

export const partsPerLayer = (model: Pick<ModelInfo, "heads" | "kvHeads">) => 2 + model.kvHeads + model.heads;
export const partCount = (model: Pick<ModelInfo, "floors" | "heads" | "kvHeads">) => 3 + model.floors * partsPerLayer(model);

/** Position of a part in `Arch.parts`, or -1 when the model has no such part. */
export function partIndex(model: Pick<ModelInfo, "floors" | "heads" | "kvHeads">, p: Part): number {
  const per = partsPerLayer(model);
  if (p.kind === "embed") return 0;
  if (p.kind === "norm") return 1 + model.floors * per;
  if (p.kind === "unembed") return 2 + model.floors * per;
  if (!Number.isInteger(p.floor) || p.floor < 0 || p.floor >= model.floors) return -1;
  const base = 1 + p.floor * per;
  if (p.kind === "layer") return base;
  if (p.kind === "kv") return Number.isInteger(p.group) && p.group >= 0 && p.group < model.kvHeads ? base + 1 + p.group : -1;
  if (p.kind === "head") return Number.isInteger(p.head) && p.head >= 0 && p.head < model.heads ? base + 1 + model.kvHeads + p.head : -1;
  return base + 1 + model.kvHeads + model.heads;
}

/** Where a part's direct push sits in a token's push vector, or -1 for parts without one. */
export function pushIndex(model: Pick<ModelInfo, "heads">, p: Part): number {
  if (p.kind === "embed") return 0;
  if (p.kind === "head") return 1 + p.floor * (model.heads + 1) + p.head;
  if (p.kind === "mlp") return 1 + p.floor * (model.heads + 1) + model.heads;
  return -1;
}

export const pushLength = (model: Pick<ModelInfo, "floors" | "heads">) => 1 + model.floors * (model.heads + 1);

export function samePart(a: Part | null, b: Part | null): boolean {
  if (!a || !b) return a === b;
  return partKey(a) === partKey(b);
}

export function partKey(p: Part): string {
  switch (p.kind) {
    case "layer": return `layer:${p.floor}`;
    case "kv": return `kv:${p.floor}:${p.group}`;
    case "head": return `head:${p.floor}:${p.head}`;
    case "mlp": return `mlp:${p.floor}`;
    default: return p.kind;
  }
}

export function partName(model: Pick<ModelInfo, "heads" | "kvHeads">, p: Part): string {
  switch (p.kind) {
    case "embed": return "Words in · dictionary";
    case "layer": return `Layer ${p.floor + 1}`;
    case "kv": {
      const hs = groupHeads(model, p.group);
      return `Shared keys and values · heads ${hs[0] + 1} to ${hs[hs.length - 1] + 1} · Layer ${p.floor + 1}`;
    }
    case "head": return `Attention head ${p.head + 1} · Layer ${p.floor + 1}`;
    case "mlp": return `MLP · Layer ${p.floor + 1}`;
    case "norm": return "Final normalization";
    case "unembed": return "Words out";
  }
}

export function buildArch(model: ModelInfo): Arch {
  if (model.heads % model.kvHeads !== 0) throw new Error("Query heads must divide evenly into key/value groups");
  const m = model.floors > 8 ? LARGE : SMALL;
  const F = model.floors, H = model.heads, KV = model.kvHeads, per = H / KV;
  const groupW = per * m.headW + (per - 1) * m.headGap;
  const bankW = KV * groupW + (KV - 1) * m.groupGap;
  const deckW = m.margin * 2 + bankW + m.spineSlot + m.mlpW;
  const left = -deckW / 2, bankLeft = left + m.margin;
  const spineX = bankLeft + bankW + m.spineSlot / 2, mlpX = spineX + m.spineSlot / 2 + m.mlpW / 2;
  const front = m.deckD / 2, spineZ = -m.deckD / 4;
  const deckY = (L: number) => m.plinthH + 0.5 + m.deckT / 2 + L * m.pitch;
  const parts: Part[] = [], pos: Vec3[] = [], size: Vec3[] = [];
  const add = (p: Part, at: Vec3, s: Vec3) => { parts.push(p); pos.push(at); size.push(s); };
  add({ kind: "embed" }, [0, m.plinthH / 2, 0.6], [deckW + 0.8, m.plinthH, m.deckD + 1.6]);
  for (let L = 0; L < F; L++) {
    const y = deckY(L), top = y + m.deckT / 2;
    add({ kind: "layer", floor: L }, [0, y, 0], [deckW, m.deckT, m.deckD]);
    for (let g = 0; g < KV; g++) {
      add({ kind: "kv", floor: L, group: g }, [bankLeft + g * (groupW + m.groupGap) + groupW / 2, top + m.saddleH / 2, front - 0.08 - m.headD / 2],
        [groupW + 0.06, m.saddleH, m.headD + 0.08]);
    }
    for (let h = 0; h < H; h++) {
      const g = Math.floor(h / per), j = h % per;
      add({ kind: "head", floor: L, head: h }, [bankLeft + g * (groupW + m.groupGap) + j * (m.headW + m.headGap) + m.headW / 2,
        top + m.saddleH + m.headH / 2, front - 0.08 - m.headD / 2], [m.headW, m.headH, m.headD]);
    }
    add({ kind: "mlp", floor: L }, [mlpX, top + (m.headH + m.saddleH) / 2, front - 0.08 - m.headD / 2], [m.mlpW, m.headH + m.saddleH, m.headD]);
  }
  const topY = deckY(F - 1) + m.deckT / 2 + m.saddleH + m.headH;
  add({ kind: "norm" }, [spineX, topY + m.pitch * 0.55, spineZ], [m.spineR * 6, m.spineR, m.spineR * 6]);
  const crownY = topY + m.pitch * 1.1 + m.crownH / 2;
  add({ kind: "unembed" }, [spineX, crownY, 0], [m.mlpW + m.spineSlot + 2, m.crownH, m.deckD]);
  const barRoom = Math.min(m.pitch * 2, 1.5);
  return { model, floors: F, heads: H, kvHeads: KV, perGroup: per, parts, pos, size, m, deckW, bankX: bankLeft, spineX, spineZ, mlpX, topY, barRoom,
    bounds: { min: [left - 0.4, 0, -front - 0.2], max: [deckW / 2 + 0.4, crownY + m.crownH / 2 + barRoom + 0.2, front + 1.4] } };
}

/** The parts drawn on one layer's deck (they move with it). */
export function layerChildren(arch: Arch, floor: number): number[] {
  const per = partsPerLayer(arch), base = 1 + floor * per;
  return Array.from({ length: per - 1 }, (_, i) => base + 1 + i);
}

/** Keyboard movement across the same grid as the 2D tower: rows are layers, columns are heads and then the MLP. */
export function movePart(model: Pick<ModelInfo, "floors" | "heads" | "kvHeads">, from: Part | null, key: string): Part | null {
  const col = (p: Part) => p.kind === "head" ? p.head : p.kind === "mlp" ? model.heads : -1;
  const at = (floor: number, c: number): Part => c < 0 ? { kind: "layer", floor } : c >= model.heads ? { kind: "mlp", floor } : { kind: "head", floor, head: c };
  if (!from) return key === "ArrowUp" || key === "ArrowRight" ? { kind: "embed" } : key === "ArrowDown" || key === "ArrowLeft" ? { kind: "unembed" } : null;
  if (from.kind === "embed") return key === "ArrowUp" ? at(0, -1) : null;
  if (from.kind === "unembed") return key === "ArrowDown" ? { kind: "norm" } : null;
  if (from.kind === "norm") return key === "ArrowUp" ? { kind: "unembed" } : key === "ArrowDown" ? at(model.floors - 1, -1) : null;
  if (from.kind === "kv") {
    const first = groupHeads(model, from.group)[0];
    return key === "ArrowUp" ? at(from.floor, first) : key === "ArrowLeft" && from.group > 0 ? { ...from, group: from.group - 1 }
      : key === "ArrowRight" && from.group < model.kvHeads - 1 ? { ...from, group: from.group + 1 } : null;
  }
  const floor = from.floor, c = col(from);
  if (key === "ArrowUp") return floor < model.floors - 1 ? at(floor + 1, c) : { kind: "norm" };
  if (key === "ArrowDown") return floor > 0 ? at(floor - 1, c) : { kind: "embed" };
  if (key === "ArrowLeft") return c > -1 ? at(floor, c - 1) : null;
  if (key === "ArrowRight") return c < model.heads ? at(floor, c + 1) : null;
  return null;
}
