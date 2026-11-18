import { expect, it } from "vitest";
import { QWEN3_06B } from "@rewire/engine/src/config.ts";
import { TINY } from "@rewire/tiny/src/config.ts";
import { QWEN_INFO, TINY_INFO, type ModelInfo } from "../src/model/info.ts";
import { buildArch, groupHeads, kvGroup, layerChildren, movePart, partCount, partIndex, partKey, pushIndex, pushLength } from "../src/stage/arch.ts";
import { headIndex, memIndex, setDims } from "../src/ui/word.ts";

const count = (model: ModelInfo, kind: string) => buildArch(model).parts.filter((p) => p.kind === kind).length;

it("draws every real component of both models exactly once, at a stable index", () => {
  expect(QWEN_INFO).toMatchObject({ floors: QWEN3_06B.floors, heads: QWEN3_06B.queryHeads, kvHeads: QWEN3_06B.kvHeads, width: QWEN3_06B.width, units: QWEN3_06B.units });
  expect(TINY_INFO).toMatchObject({ floors: TINY.floors, heads: TINY.heads, kvHeads: TINY.kvHeads, width: TINY.width, units: TINY.units });
  for (const [model, layers, heads, groups] of [[QWEN_INFO, 28, 448, 224], [TINY_INFO, 4, 16, 8]] as const) {
    const arch = buildArch(model);
    expect([count(model, "layer"), count(model, "head"), count(model, "kv"), count(model, "mlp")]).toEqual([layers, heads, groups, layers]);
    expect([count(model, "embed"), count(model, "norm"), count(model, "unembed")]).toEqual([1, 1, 1]);
    expect(arch.parts).toHaveLength(partCount(model));
    expect(new Set(arch.parts.map(partKey)).size).toBe(arch.parts.length);
    arch.parts.forEach((p, i) => expect(partIndex(model, p)).toBe(i));
    expect(arch.pos).toHaveLength(arch.parts.length);
  }
  expect(buildArch(QWEN_INFO).parts).toHaveLength(731);
  for (const bad of [{ kind: "head", floor: 28, head: 0 }, { kind: "head", floor: 0, head: 16 }, { kind: "kv", floor: 0, group: 8 }, { kind: "mlp", floor: -1 }, { kind: "layer", floor: 1.5 }] as const) {
    expect(partIndex(QWEN_INFO, bad)).toBe(-1);
  }
});

it("seats query heads on the key/value group the engine gives them", () => {
  // The engine repeats each key/value head H / KV times along the head axis.
  expect(Array.from({ length: 16 }, (_, h) => kvGroup(QWEN_INFO, h))).toEqual([0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7]);
  expect(Array.from({ length: 4 }, (_, h) => kvGroup(TINY_INFO, h))).toEqual([0, 0, 1, 1]);
  expect(groupHeads(QWEN_INFO, 6)).toEqual([12, 13]);
  for (const model of [QWEN_INFO, TINY_INFO]) {
    const arch = buildArch(model);
    for (let L = 0; L < model.floors; L += model.floors - 1) {
      for (let h = 0; h < model.heads; h++) {
        const head = partIndex(model, { kind: "head", floor: L, head: h }), base = partIndex(model, { kind: "kv", floor: L, group: kvGroup(model, h) });
        const [x, y] = arch.pos[head], [bx, by] = arch.pos[base], w = arch.size[head][0], bw = arch.size[base][0];
        expect(x - w / 2).toBeGreaterThanOrEqual(bx - bw / 2);
        expect(x + w / 2).toBeLessThanOrEqual(bx + bw / 2);
        expect(y).toBeGreaterThan(by);
      }
    }
  }
  expect(() => buildArch({ ...QWEN_INFO, kvHeads: 5 })).toThrow();
});

it("reads each part's push from the slot the engine writes it to", () => {
  for (const model of [QWEN_INFO, TINY_INFO]) {
    setDims(model);
    const arch = buildArch(model), seen = new Set<number>();
    for (const p of arch.parts) {
      const k = pushIndex(model, p);
      if (p.kind === "head") expect(k).toBe(headIndex(p.floor, p.head));
      else if (p.kind === "mlp") expect(k).toBe(memIndex(p.floor));
      else if (p.kind === "embed") expect(k).toBe(0);
      else expect(k).toBe(-1);
      if (k >= 0) { expect(seen.has(k)).toBe(false); seen.add(k); }
    }
    expect(seen.size).toBe(pushLength(model));
  }
  setDims(QWEN_INFO);
  expect(pushLength(QWEN_INFO)).toBe(477);
});

it("stacks layers upward in order without overlapping modules", () => {
  for (const model of [QWEN_INFO, TINY_INFO]) {
    const arch = buildArch(model);
    let below = arch.pos[0][1];
    for (let L = 0; L < model.floors; L++) {
      const deck = partIndex(model, { kind: "layer", floor: L });
      expect(arch.pos[deck][1]).toBeGreaterThan(below);
      below = arch.pos[deck][1];
      const modules = layerChildren(arch, L).filter((i) => arch.parts[i].kind !== "kv").sort((a, b) => arch.pos[a][0] - arch.pos[b][0]);
      expect(modules).toHaveLength(model.heads + 1);
      for (let k = 1; k < modules.length; k++) {
        expect(arch.pos[modules[k]][0] - arch.size[modules[k]][0] / 2).toBeGreaterThan(arch.pos[modules[k - 1]][0] + arch.size[modules[k - 1]][0] / 2);
      }
      // The spine has its own slot between the attention bank and the MLP.
      const lastHead = modules[modules.length - 2], mlp = modules[modules.length - 1];
      expect(arch.spineX).toBeGreaterThan(arch.pos[lastHead][0] + arch.size[lastHead][0] / 2);
      expect(arch.spineX).toBeLessThan(arch.pos[mlp][0] - arch.size[mlp][0] / 2);
    }
    arch.parts.forEach((_, i) => {
      for (let axis = 0; axis < 3; axis++) {
        expect(arch.pos[i][axis] - arch.size[i][axis] / 2).toBeGreaterThanOrEqual(arch.bounds.min[axis] - 1e-9);
        expect(arch.pos[i][axis] + arch.size[i][axis] / 2).toBeLessThanOrEqual(arch.bounds.max[axis] + 1e-9);
      }
    });
  }
});

it("moves the keyboard selection over the tower's own grid", () => {
  const m = QWEN_INFO;
  expect(movePart(m, { kind: "head", floor: 3, head: 5 }, "ArrowUp")).toEqual({ kind: "head", floor: 4, head: 5 });
  expect(movePart(m, { kind: "head", floor: 3, head: 5 }, "ArrowDown")).toEqual({ kind: "head", floor: 2, head: 5 });
  expect(movePart(m, { kind: "head", floor: 3, head: 15 }, "ArrowRight")).toEqual({ kind: "mlp", floor: 3 });
  expect(movePart(m, { kind: "mlp", floor: 3 }, "ArrowRight")).toBeNull();
  expect(movePart(m, { kind: "mlp", floor: 3 }, "ArrowLeft")).toEqual({ kind: "head", floor: 3, head: 15 });
  expect(movePart(m, { kind: "head", floor: 3, head: 0 }, "ArrowLeft")).toEqual({ kind: "layer", floor: 3 });
  expect(movePart(m, { kind: "layer", floor: 3 }, "ArrowLeft")).toBeNull();
  expect(movePart(m, { kind: "mlp", floor: 27 }, "ArrowUp")).toEqual({ kind: "norm" });
  expect(movePart(m, { kind: "norm" }, "ArrowUp")).toEqual({ kind: "unembed" });
  expect(movePart(m, { kind: "head", floor: 0, head: 2 }, "ArrowDown")).toEqual({ kind: "embed" });
  expect(movePart(m, { kind: "embed" }, "ArrowUp")).toEqual({ kind: "layer", floor: 0 });
  expect(movePart(m, null, "ArrowUp")).toEqual({ kind: "embed" });
  // Every part can be reached from the dictionary with arrow keys alone.
  const reached = new Set<string>(), queue = [{ kind: "embed" } as ReturnType<typeof movePart>];
  while (queue.length) {
    const at = queue.pop()!;
    if (!at || reached.has(partKey(at))) continue;
    reached.add(partKey(at));
    for (const key of ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"]) queue.push(movePart(m, at, key));
  }
  expect(reached.size).toBe(buildArch(m).parts.filter((p) => p.kind !== "kv").length);
});
