// Plain names for changes: chip labels, changed-reply labels and screen-reader text.
import type { ChangeSpec } from "../model/types.ts";
import { piece } from "../state/actions.ts";
import { S } from "../strings.ts";

export interface ChipDef {
  key: string;
  label: string;
  without: () => ChangeSpec;
}

const word = (id: number) => piece(id).trim() || piece(id);

function conceptLabel(id: string) {
  return id;
}

export function chips(spec: ChangeSpec, readTokens?: number[]): ChipDef[] {
  const out: ChipDef[] = [];
  const copy = () => structuredClone(spec);
  for (const [i, h] of (spec.heads ?? []).entries()) {
    if (h.mult === 1) continue;
    out.push({ key: `h${h.floor}.${h.head}`, label: S.chip.head(h.floor + 1, h.head + 1, S.mult(h.mult)),
      without: () => ({ ...copy(), heads: spec.heads!.filter((_, j) => j !== i) }) });
  }
  for (const [i, m] of (spec.memory ?? []).entries()) {
    if (m.mult === 1) continue;
    out.push({ key: `m${m.floor}`, label: S.chip.memory(m.floor + 1, S.mult(m.mult)),
      without: () => ({ ...copy(), memory: spec.memory!.filter((_, j) => j !== i) }) });
  }
  for (const [i, f] of (spec.floors ?? []).entries()) {
    if (f.mult === 1) continue;
    out.push({ key: `f${f.floor}`, label: S.chip.floor(f.floor + 1, S.mult(f.mult)),
      without: () => ({ ...copy(), floors: spec.floors!.filter((_, j) => j !== i) }) });
  }
  for (const [i, [a, b]] of (spec.swaps ?? []).entries()) {
    out.push({ key: `s${a}.${b}`, label: S.chip.swap(word(a), word(b)),
      without: () => ({ ...copy(), swaps: spec.swaps!.filter((_, j) => j !== i) }) });
  }
  for (const [i, h] of (spec.hidden ?? []).entries()) {
    const w = readTokens?.[h.key] !== undefined ? word(readTokens[h.key]) : `position ${h.key}`;
    const label = h.key === 0 ? `the start marker hidden${h.from > 1 ? ` from word ${h.from + 1} on` : ""}` : S.chip.hidden(w);
    out.push({ key: `x${h.key}.${h.from}`, label, without: () => ({ ...copy(), hidden: spec.hidden!.filter((_, j) => j !== i) }) });
  }
  if (spec.concept && spec.concept.strength !== 0) {
    out.push({ key: "c", label: S.chip.concept(conceptLabel(spec.concept.id), spec.concept.floor + 1, spec.concept.strength),
      without: () => ({ ...copy(), concept: null }) });
  }
  // zeroed weights read as one chip per floor ("5 weights on floor 3 set to zero")
  const perFloor = new Map<number, number>();
  for (const z of spec.zeroed ?? []) perFloor.set(z.floor, (perFloor.get(z.floor) ?? 0) + 1);
  for (const [floor, n] of perFloor) {
    out.push({ key: `z${floor}`, label: S.chip.zeroed(floor + 1, n), without: () => ({ ...copy(), zeroed: spec.zeroed!.filter((z) => z.floor !== floor) }) });
  }
  if (spec.bits && spec.bits !== 4) out.push({ key: "b", label: S.chip.bits(spec.bits), without: () => ({ ...copy(), bits: 4 }) });
  return out;
}

export function describe(spec: ChangeSpec, readTokens?: number[]): string {
  const c = chips(spec, readTokens).map((x) => x.label);
  if (!c.length) return "no changes";
  if (c.length === 1) return c[0];
  return `${c.slice(0, -1).join(", ")} and ${c[c.length - 1]}`;
}

/** Multiplier currently set for a part (1 when untouched). */
export function multOf(spec: ChangeSpec, kind: "head" | "memory" | "floor", floor: number, head = 0): number {
  if (kind === "head") return spec.heads?.find((h) => h.floor === floor && h.head === head)?.mult ?? 1;
  if (kind === "memory") return spec.memory?.find((h) => h.floor === floor)?.mult ?? 1;
  return spec.floors?.find((h) => h.floor === floor)?.mult ?? 1;
}

export function withMult(spec: ChangeSpec, kind: "head" | "memory" | "floor", floor: number, head: number, mult: number): ChangeSpec {
  const s = structuredClone(spec);
  if (kind === "head") {
    s.heads = (s.heads ?? []).filter((h) => !(h.floor === floor && h.head === head));
    if (mult !== 1) s.heads.push({ floor, head, mult });
  } else if (kind === "memory") {
    s.memory = (s.memory ?? []).filter((h) => h.floor !== floor);
    if (mult !== 1) s.memory.push({ floor, mult });
  } else {
    s.floors = (s.floors ?? []).filter((h) => h.floor !== floor);
    if (mult !== 1) s.floors.push({ floor, mult });
  }
  return s;
}
