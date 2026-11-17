import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { isNeutral } from "@rewire/engine/src/changes.ts";
import { canonical } from "../src/model/change-key.ts";
import { QWEN_INFO, TINY_INFO } from "../src/model/info.ts";
import type { ChangeSpec, Tok } from "../src/model/types.ts";

const mock = vi.hoisted(() => ({
  check: vi.fn(), load: vi.fn(), firstTurn: vi.fn(), pieces: vi.fn(), write: vi.fn(), compare: vi.fn(),
  inspect: vi.fn(), cancel: vi.fn(), setVersion: vi.fn(), pause: vi.fn(), use: vi.fn(), loadTiny: vi.fn(),
}));
vi.mock("../src/live/engine.ts", () => ({ EngineClient: class {
  check = mock.check; load = mock.load; firstTurn = mock.firstTurn; pieces = mock.pieces; write = mock.write; compare = mock.compare;
  cancel = mock.cancel; setVersion = mock.setVersion; pause = mock.pause; use = mock.use; loadTiny = mock.loadTiny; inspect = mock.inspect;
} }));
const token: Tok = { id: 100, lp1: -0.2, concept: 0, cut: 1, cands: [{ id: 100, p: 1 }], pushes: new Float32Array(477) };
const flush = async () => { for (let i = 0; i < 40; i++) await Promise.resolve(); };
const deferred = <T>() => { let resolve!: (value: T) => void; const promise = new Promise<T>((r) => { resolve = r; }); return { promise, resolve }; };

let actions: typeof import("../src/state/actions.ts");
let store: typeof import("../src/state/store.ts").store;
let I: typeof import("../src/stage/intervene.ts");
let D: typeof import("../src/ui/describe.ts");

beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();
  mock.check.mockResolvedValue({ webgpu: true, seconds: 3 });
  mock.load.mockResolvedValue({ stored: true, contextCap: 1024 });
  mock.firstTurn.mockResolvedValue([11, 12]);
  mock.pieces.mockImplementation(async (ids: number[]) => ids.map((i) => ({ text: `word${i}` })));
  mock.write.mockImplementation(async (_job: unknown, onToken: (t: Tok) => void) => { onToken(token); return { ended: true, cancelled: false }; });
  mock.compare.mockResolvedValue([{ id: 100, lp1: -0.3, concept: 0, pushes: new Float32Array(477) }]);
  mock.use.mockResolvedValue(true);
  vi.stubGlobal("matchMedia", () => ({ matches: true }));
  vi.stubGlobal("location", { origin: "http://localhost", href: "http://localhost/", hash: "", pathname: "/", search: "" });
  vi.stubGlobal("history", { replaceState: vi.fn() });
  vi.stubGlobal("navigator", { gpu: {}, storage: { persist: async () => true } });
  vi.stubGlobal("screen", { width: 1200, height: 900 });
  vi.stubGlobal("addEventListener", vi.fn());
  actions = await import("../src/state/actions.ts");
  store = (await import("../src/state/store.ts")).store;
  I = await import("../src/stage/intervene.ts");
  D = await import("../src/ui/describe.ts");
  await actions.start();
  await actions.openStep(null);
});
afterEach(() => vi.unstubAllGlobals());

const head = { kind: "head", floor: 20, head: 13 } as const, mlp = { kind: "mlp", floor: 9 } as const, layer = { kind: "layer", floor: 2 } as const;
const changedJobs = () => mock.write.mock.calls.map((c) => c[0] as { conv: number; changes: ChangeSpec }).filter((j) => j.conv === 1);

it("writes the same change spec as the 2D strength control for every kind of part", () => {
  const before: ChangeSpec = { bits: 2, heads: [{ floor: 1, head: 1, mult: 5 }] };
  expect(canonical(I.punched(before, head))).toBe(canonical(D.withMult(before, "head", 20, 13, 0)));
  expect(canonical(I.punched(before, mlp))).toBe(canonical(D.withMult(before, "memory", 9, 0, 0)));
  expect(canonical(I.punched(before, layer))).toBe(canonical(D.withMult(before, "floor", 2, 0, 0)));
  expect(canonical(I.withStrength(before, head, -1))).toBe(canonical(D.withMult(before, "head", 20, 13, -1)));
  expect(before).toEqual({ bits: 2, heads: [{ floor: 1, head: 1, mult: 5 }] });
  // A second punch seats the part again and leaves the rest of the experiment alone.
  expect(canonical(I.punched(I.punched(before, head), head))).toBe(canonical(before));
  expect(isNeutral(I.punched(I.punched({}, mlp), mlp))).toBe(true);
  expect(I.strengthOf(I.punched({}, layer), layer)).toBe(0);
  expect(I.isTarget({ kind: "kv", floor: 0, group: 0 })).toBe(false);
  expect(I.isTarget({ kind: "embed" })).toBe(false);
});

it("restores exactly a part's own changes and names the button for that scope", () => {
  const spec: ChangeSpec = {
    lesson: 3, bits: 2, swaps: [[5, 6]], hidden: [{ key: 0, from: 1 }],
    heads: [{ floor: 20, head: 13, mult: -1 }, { floor: 20, head: 12, mult: 0 }, { floor: 9, head: 1, mult: 5 }],
    geometry: [{ floor: 20, head: 13, kind: "rotate", angle: 90, seed: 1 }, { floor: 20, head: 12, kind: "shuffle", seed: 3 }, { floor: 2, head: 0, kind: "remove", amount: 1 }],
    memory: [{ floor: 9, mult: 2 }, { floor: 20, mult: 0 }], floors: [{ floor: 20, mult: 0 }, { floor: 2, mult: -1 }],
    neurons: [{ floor: 9, unit: 2753, delta: 15 }, { floor: 12, unit: 2473, delta: -21 }, { floor: 20, unit: 7, delta: 1 }],
    zeroed: [{ floor: 2, tensor: "down", row: 1, col: 2 }, { floor: 20, tensor: "q", row: 3, col: 4 }],
    concept: { id: "ocean", floor: 20, strength: 4 },
  };
  const before = structuredClone(spec);
  // A head: its strength and its direction change, nothing else on its layer.
  expect(I.partChanged(spec, head)).toBe(true);
  const a = I.restored(spec, head);
  expect(a.heads).toEqual([{ floor: 20, head: 12, mult: 0 }, { floor: 9, head: 1, mult: 5 }]);
  expect(a.geometry).toEqual([{ floor: 20, head: 12, kind: "shuffle", seed: 3 }, { floor: 2, head: 0, kind: "remove", amount: 1 }]);
  expect({ ...a, heads: spec.heads, geometry: spec.geometry }).toEqual(spec);
  // An MLP: its strength and its neuron additions. The taught adapter is not the MLP's own change.
  const b = I.restored(spec, mlp);
  expect(b.memory).toEqual([{ floor: 20, mult: 0 }]);
  expect(b.neurons).toEqual([{ floor: 12, unit: 2473, delta: -21 }, { floor: 20, unit: 7, delta: 1 }]);
  expect({ ...b, memory: spec.memory, neurons: spec.neurons }).toEqual(spec);
  expect(I.partChanged({ lesson: 3 }, { kind: "mlp", floor: 27 })).toBe(false);
  expect(I.restored({ lesson: 3 }, { kind: "mlp", floor: 27 }).lesson).toBe(3);
  // A layer: everything on its deck, and the zeroed weights and concept addressed to it.
  const deck = { kind: "layer", floor: 20 } as const, c = I.restored(spec, deck);
  expect(c).toEqual({
    lesson: 3, bits: 2, swaps: [[5, 6]], hidden: [{ key: 0, from: 1 }], concept: null,
    heads: [{ floor: 9, head: 1, mult: 5 }], geometry: [{ floor: 2, head: 0, kind: "remove", amount: 1 }],
    memory: [{ floor: 9, mult: 2 }], floors: [{ floor: 2, mult: -1 }],
    neurons: [{ floor: 9, unit: 2753, delta: 15 }, { floor: 12, unit: 2473, delta: -21 }], zeroed: [{ floor: 2, tensor: "down", row: 1, col: 2 }],
  });
  // Layer 3 keeps its own zeroed weight until it is the one restored.
  expect(I.restored(spec, layer).zeroed).toEqual([{ floor: 20, tensor: "q", row: 3, col: 4 }]);
  expect(I.restored(spec, layer).floors).toEqual([{ floor: 20, mult: 0 }]);
  expect(spec).toEqual(before);
  // The button is live exactly when it would do something, and doing it leaves nothing of that scope behind.
  const parts = [head, mlp, layer, deck, { kind: "head", floor: 20, head: 12 }, { kind: "mlp", floor: 20 }, { kind: "layer", floor: 9 }, { kind: "head", floor: 5, head: 5 }, { kind: "layer", floor: 12 }] as const;
  for (const p of parts) {
    const after = I.restored(spec, p);
    expect(I.partChanged(spec, p)).toBe(canonical(after) !== canonical(spec));
    expect(I.partChanged(after, p)).toBe(false);
    expect(canonical(I.restored(after, p))).toBe(canonical(after));
  }
  for (const each of [{ zeroed: [{ floor: 4, tensor: "o", row: 0, col: 0 }] }, { concept: { id: "x", floor: 4, strength: 1 } }, { heads: [{ floor: 4, head: 2, mult: 0 }] },
    { neurons: [{ floor: 4, unit: 1, delta: 2 }] }, { geometry: [{ floor: 4, head: 0, kind: "shuffle", seed: 1 }] }] as ChangeSpec[]) {
    expect(I.partChanged(each, { kind: "layer", floor: 4 })).toBe(true);
    expect(isNeutral(I.restored(each, { kind: "layer", floor: 4 }))).toBe(true);
    expect(I.partChanged(each, { kind: "layer", floor: 5 })).toBe(false);
  }
  // Global changes are nobody's part.
  expect(I.partChanged({ bits: 2, swaps: [[1, 2]], lesson: 1 }, { kind: "layer", floor: 27 })).toBe(false);
  expect(I.partChanged({ concept: { id: "x", floor: 4, strength: 0 } }, { kind: "layer", floor: 4 })).toBe(false);
  expect([I.restoreLabel(head), I.restoreLabel(mlp), I.restoreLabel(layer)]).toEqual(["Restore this head", "Restore this MLP", "Restore this layer and its parts"]);
});

it("poses each part from the change spec alone", () => {
  const pose = (spec: ChangeSpec, p: Parameters<typeof I.poseOf>[1], model = QWEN_INFO) => I.poseOf(spec, p, model);
  expect(pose({}, head)).toEqual({ mult: 1, off: false, edited: false, roll: 0 });
  expect(pose({ heads: [{ ...head, mult: 0 }] }, head)).toMatchObject({ off: true, edited: true, mult: 0 });
  expect(pose({ heads: [{ ...head, mult: -1 }] }, head)).toMatchObject({ off: false, roll: 180 });
  expect(pose({ heads: [{ ...head, mult: 5 }] }, head)).toMatchObject({ mult: 5, edited: true, roll: 0 });
  expect(pose({ geometry: [{ floor: 20, head: 13, kind: "rotate", angle: 45, seed: 1 }] }, head)).toMatchObject({ edited: true, roll: 45 });
  // Reversing a head and rotating it half a turn cancel, in the model and in the drawing.
  expect(pose({ heads: [{ ...head, mult: -1 }], geometry: [{ floor: 20, head: 13, kind: "rotate", angle: 180, seed: 1 }] }, head).roll % 360).toBe(0);
  expect(pose({ geometry: [{ floor: 20, head: 13, kind: "rotate", angle: 0, seed: 1 }] }, head).edited).toBe(false);
  expect(pose({ geometry: [{ floor: 20, head: 13, kind: "shuffle", seed: 2 }] }, head)).toMatchObject({ edited: true, roll: 0 });
  // A layer that is off silences everything on its deck without marking each part as edited.
  const cut: ChangeSpec = { floors: [{ floor: 20, mult: 0 }] };
  expect(pose(cut, head)).toMatchObject({ off: true, edited: false, mult: 1 });
  expect(pose(cut, { kind: "kv", floor: 20, group: 6 }).off).toBe(true);
  expect(pose(cut, { kind: "mlp", floor: 20 }).off).toBe(true);
  expect(pose(cut, { kind: "layer", floor: 20 })).toMatchObject({ off: true, edited: true });
  expect(pose(cut, { kind: "layer", floor: 19 })).toMatchObject({ off: false, edited: false });
  expect(pose({ neurons: [{ floor: 9, unit: 2753, delta: 15 }] }, mlp).edited).toBe(true);
  expect(pose({ neurons: [{ floor: 9, unit: 2753, delta: 0 }] }, mlp).edited).toBe(false);
  // The taught adapter lives in the last MLP of Qwen only.
  expect(pose({ lesson: 2 }, { kind: "mlp", floor: 27 }).edited).toBe(true);
  expect(pose({ lesson: 2 }, { kind: "mlp", floor: 26 }).edited).toBe(false);
  expect(pose({ lesson: 2 }, { kind: "mlp", floor: 3 }, TINY_INFO).edited).toBe(false);
  expect(pose({ zeroed: [{ floor: 2, tensor: "down", row: 1, col: 2 }] }, layer).edited).toBe(true);
  expect(pose({ swaps: [[1, 2]] }, { kind: "embed" }).edited).toBe(true);
  expect(pose({ swaps: [[1, 2]] }, { kind: "unembed" }).edited).toBe(true);
});

it("maps 3D parts to the inspector's panels and back", () => {
  for (const p of [head, mlp, layer, { kind: "embed" }, { kind: "unembed" }] as const) expect(I.partOf(I.focusOf(p)!)).toEqual(p);
  expect(I.focusOf({ kind: "kv", floor: 4, group: 1 })).toEqual({ kind: "floor", floor: 4 });
  expect(I.partOf({ kind: "word" })).toBeNull();
  expect(I.partOf({ kind: "bits" })).toBeNull();
});

it("a punch runs one real changed generation, and a second punch restores the original answers", async () => {
  await actions.send("Capital of France?");
  expect(store.get().turns).toHaveLength(1);
  expect(I.blocked(store.get())).toBeNull();
  mock.write.mockClear();
  await actions.chipsWith((spec) => I.punched(spec, head));
  expect(store.get().chips).toEqual({ heads: [{ floor: 20, head: 13, mult: 0 }] });
  expect(changedJobs()).toHaveLength(1);
  expect(changedJobs()[0].changes).toEqual({ heads: [{ floor: 20, head: 13, mult: 0 }] });
  expect(store.get().turns[0].changed?.done).toBe(true);
  expect(store.get().turns[0].normal.toks).toHaveLength(1);
  mock.write.mockClear();
  await actions.chipsWith((spec) => I.punched(spec, head));
  expect(isNeutral(store.get().chips)).toBe(true);
  expect(store.get().turns[0].changed).toBeUndefined();
  expect(store.get().announce).toBe("Original answers restored.");
  expect(mock.write).not.toHaveBeenCalled();
});

it("keeps every punch in a quick series, each from the newest changes", async () => {
  await actions.send("Capital of France?");
  const first = actions.chipsWith((spec) => I.punched(spec, head));
  const second = actions.chipsWith((spec) => I.punched(spec, mlp));
  const third = actions.chipsWith((spec) => I.withStrength(spec, layer, -1));
  await Promise.all([first, second, third]);
  await flush();
  expect(canonical(store.get().chips)).toBe(canonical({ heads: [{ floor: 20, head: 13, mult: 0 }], memory: [{ floor: 9, mult: 0 }], floors: [{ floor: 2, mult: -1 }] }));
  expect(store.get().replay).toBeNull();
  expect(canonical(store.get().turns[0].changed?.changes)).toBe(canonical(store.get().chips));
  // Restore removes all of them at once and brings back the untouched original reply.
  await actions.applyChips({});
  expect(store.get().chips).toEqual({});
  expect(store.get().turns[0].changed).toBeUndefined();
});

it("refuses to edit while a reply is being written, while teaching, or before the model is ready", async () => {
  const writing = deferred<{ ended: boolean; cancelled: boolean }>();
  mock.write.mockImplementationOnce(async () => writing.promise);
  const pending = actions.send("Tell me a story");
  await flush();
  expect(store.get().busy).toBe(true);
  expect(I.blocked(store.get())).toMatch(/reply to finish/);
  await actions.chipsWith((spec) => I.punched(spec, head));
  expect(store.get().chips).toEqual({});
  writing.resolve({ ended: true, cancelled: false });
  await pending;
  expect(I.blocked(store.get())).toBeNull();

  store.set({ teachingBusy: true });
  expect(I.blocked(store.get())).toMatch(/Teaching/);
  store.set({ teachingBusy: false, mode: "unavailable" });
  expect(I.blocked(store.get())).toMatch(/ready/);
  await actions.chipsWith((spec) => I.punched(spec, head));
  expect(store.get().chips).toEqual({});
  // An update that is replaying samples can be redirected by a newer edit, as in the 2D lab.
  expect(I.blocked({ mode: "live", busy: true, replay: { turn: 0, status: "running" }, teachingBusy: false })).toBeNull();
});
