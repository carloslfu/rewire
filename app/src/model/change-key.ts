import { geometryActive } from "@rewire/engine/src/changes.ts";
import type { ChangeSpec } from "./types.ts";

/** A canonical string for a change spec: neutral entries dropped, lists sorted. */
export function canonical(spec: ChangeSpec | undefined | null): string {
  if (!spec) return "{}";
  const o: Record<string, unknown> = {};
  if (spec.lesson) o.lesson = spec.lesson;
  const heads = (spec.heads ?? []).filter((x) => x.mult !== 1).map((x) => [x.floor, x.head, x.mult]).sort(cmp);
  const memory = (spec.memory ?? []).filter((x) => x.mult !== 1).map((x) => [x.floor, x.mult]).sort(cmp);
  const floors = (spec.floors ?? []).filter((x) => x.mult !== 1).map((x) => [x.floor, x.mult]).sort(cmp);
  const swaps = (spec.swaps ?? []).map(([a, b]) => (a < b ? [a, b] : [b, a])).sort(cmp);
  const hidden = (spec.hidden ?? []).map((x) => [x.key, x.from]).sort(cmp);
  const zeroed = (spec.zeroed ?? []).map((x) => [x.floor, x.tensor, x.row, x.col]).sort(cmp);
  const geometry = (spec.geometry ?? []).filter(geometryActive).map((g) => g.kind === "rotate"
    ? [g.floor, g.head, g.kind, g.angle, g.seed] : g.kind === "remove"
      ? [g.floor, g.head, g.kind, g.amount] : [g.floor, g.head, g.kind, g.seed]).sort(cmp);
  if (geometry.length) o.geometry = geometry;
  if (heads.length) o.heads = heads;
  if (memory.length) o.memory = memory;
  if (floors.length) o.floors = floors;
  if (spec.concept && spec.concept.strength !== 0) o.concept = [spec.concept.id, spec.concept.floor, spec.concept.strength];
  if (swaps.length) o.swaps = swaps;
  if (hidden.length) o.hidden = hidden;
  if (zeroed.length) o.zeroed = zeroed;
  if (spec.bits && spec.bits !== 4) o.bits = spec.bits;
  return JSON.stringify(o);
}

function cmp(a: unknown[], b: unknown[]): number {
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    if (a[i] === b[i]) continue;
    return (a[i] as number) < (b[i] as number) ? -1 : 1;
  }
  return a.length - b.length;
}
