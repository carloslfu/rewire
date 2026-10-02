import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Tok } from "../src/model/types.ts";

const mock = vi.hoisted(() => ({
  check: vi.fn(), load: vi.fn(), firstTurn: vi.fn(), nextTurn: vi.fn(), pieces: vi.fn(), write: vi.fn(), compare: vi.fn(),
  inspect: vi.fn(), cancel: vi.fn(), setVersion: vi.fn(), pause: vi.fn(), use: vi.fn(), loadTiny: vi.fn(),
}));
vi.mock("../src/live/engine.ts", () => ({ EngineClient: class {
  check = mock.check; load = mock.load; firstTurn = mock.firstTurn; nextTurn = mock.nextTurn; pieces = mock.pieces;
  write = mock.write; compare = mock.compare; cancel = mock.cancel; setVersion = mock.setVersion; pause = mock.pause;
  use = mock.use; loadTiny = mock.loadTiny; inspect = mock.inspect;
} }));
const token: Tok = { id: 100, lp1: -.2, concept: 0, cut: 1, cands: [{ id: 100, p: 1 }], pushes: new Float32Array(477) };
const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
const deferred = <T>() => { let resolve!: (value: T) => void; const promise = new Promise<T>((r) => { resolve = r; }); return { promise, resolve }; };
let actions: typeof import("../src/state/actions.ts");
let store: typeof import("../src/state/store.ts").store;

beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();
  mock.check.mockResolvedValue({ webgpu: true, seconds: 3 });
  mock.load.mockResolvedValue({ stored: true, contextCap: 1024 });
  mock.firstTurn.mockResolvedValue([11, 12]);
  mock.nextTurn.mockResolvedValue([21, 22]);
  mock.pieces.mockImplementation(async (ids: number[]) => ids.map((i) => `word${i}`));
  mock.write.mockImplementation(async (_job: unknown, onToken: (t: Tok) => void) => { onToken(token); return { ended: true, cancelled: false }; });
  mock.compare.mockResolvedValue([]); mock.use.mockResolvedValue(true); mock.loadTiny.mockResolvedValue(true);
  vi.stubGlobal("matchMedia", () => ({ matches: true }));
  vi.stubGlobal("location", { origin: "http://localhost", href: "http://localhost/", hash: "", pathname: "/", search: "" });
  vi.stubGlobal("history", { replaceState: vi.fn() });
  vi.stubGlobal("localStorage", { getItem: () => null, setItem: vi.fn(), removeItem: vi.fn() });
  vi.stubGlobal("navigator", { gpu: {}, storage: { persist: async () => true } });
  vi.stubGlobal("screen", { width: 1200, height: 900 });
  vi.stubGlobal("addEventListener", vi.fn());
  vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("Page actions must not fetch prerecorded responses"); }));
  actions = await import("../src/state/actions.ts");
  store = (await import("../src/state/store.ts")).store;
  await actions.start();
  await actions.openStep(null);
});
afterEach(() => vi.unstubAllGlobals());

it("opens on freeform input and keeps interventions across a fresh conversation", async () => {
  expect(store.get().step).toBeNull();
  expect(store.get().turns).toHaveLength(0);
  await actions.applyChips({ zeroed: [{ floor: 2, tensor: "down", row: 5, col: 7 }] });
  await actions.send("An unrecorded question");
  const changes = store.get().chips;
  actions.freshStart();
  await actions.send("A different question");
  expect(store.get().chips).toEqual(changes);
  expect(store.get().turns).toHaveLength(1);
  expect(store.get().turns[0].changed?.changes).toEqual(changes);
  await actions.applyChips({});
  expect(store.get().turns[0].changed).toBeUndefined();
});

it("loads automatically once, without requiring an enable action", async () => {
  expect(store.get().mode).toBe("live");
  expect(store.get().device.kind).toBe("ready");
  expect(mock.load).toHaveBeenCalledTimes(1);
  await Promise.all([actions.checkDevice(), actions.checkDevice()]);
  expect(mock.load).toHaveBeenCalledTimes(1);
  expect(fetch).not.toHaveBeenCalled();
});

it("loads slow devices too, and a stale crash marker cannot block it", async () => {
  store.set({ device: { kind: "error", message: "Retry" }, mode: "unavailable" });
  mock.check.mockResolvedValueOnce({ webgpu: true, seconds: 15 });
  vi.stubGlobal("localStorage", { getItem: () => "1" });
  await actions.checkDevice();
  expect(store.get().device).toEqual({ kind: "ready", seconds: 15 });
  expect(store.get().mode).toBe("live");
});

it("deduplicates initialization and waits for actual model loading before accepting input", async () => {
  const load = deferred<{ stored: boolean; contextCap: number }>();
  store.set({ device: { kind: "error", message: "Retry" }, mode: "unavailable" });
  mock.load.mockReturnValueOnce(load.promise);
  const a = actions.checkDevice(), b = actions.checkDevice();
  await flush();
  expect(store.get().device.kind).toBe("downloading");
  await actions.send("Too early");
  expect(mock.write).not.toHaveBeenCalled();
  load.resolve({ stored: true, contextCap: 1024 }); await Promise.all([a, b]);
  expect(mock.load).toHaveBeenCalledTimes(2);
  await actions.send("Now ready");
  expect(store.get().turns[0].user).toBe("Now ready");
});

it("cannot generate or change a reply without WebGPU", async () => {
  vi.stubGlobal("navigator", {});
  store.set({ device: { kind: "checking" }, mode: "unavailable" });
  await actions.checkDevice();
  await actions.openStep(1);
  await actions.applyChips({ floors: [{ floor: 0, mult: 0 }] });
  await actions.send("Hello");
  expect(store.get().device.kind).toBe("no-webgpu");
  expect(store.get().turns).toHaveLength(0);
  expect(mock.write).not.toHaveBeenCalled();
  expect(fetch).not.toHaveBeenCalled();
});

it("reports loading failures honestly and can retry", async () => {
  store.set({ device: { kind: "checking" }, mode: "unavailable" });
  mock.load.mockRejectedValueOnce(new Error("Weights unavailable"));
  await actions.checkDevice();
  await actions.openStep(2);
  expect(store.get().device).toEqual({ kind: "error", message: "Weights unavailable" });
  expect(store.get().turns).toHaveLength(0);
  expect(fetch).not.toHaveBeenCalled();
  await actions.checkDevice();
  expect(store.get().mode).toBe("live");
  expect(store.get().turns[0].user).toBe(actions.stepData(2)!.message);
  expect(mock.write).toHaveBeenCalledTimes(1);
});

it("runs a pending preset after loading, unless the visitor has started fresh", async () => {
  const load = deferred<{ stored: boolean; contextCap: number }>();
  store.set({ device: { kind: "checking" }, mode: "unavailable" });
  mock.load.mockReturnValueOnce(load.promise);
  const pending = actions.checkDevice(); await flush();
  await actions.openStep(1); await actions.openStep(3);
  expect(store.get().turns).toHaveLength(0);
  load.resolve({ stored: true, contextCap: 1024 }); await pending;
  expect(store.get().turns[0].user).toBe(actions.stepData(3)!.message);
  expect(mock.write).toHaveBeenCalledTimes(1);
  actions.freshStart();
  store.set({ device: { kind: "checking" }, mode: "unavailable" });
  await actions.openStep(1); actions.freshStart(); await actions.checkDevice();
  expect(store.get().turns).toHaveLength(0);
});

it("accepts only one submission while tokenization is pending", async () => {
  const first = deferred<number[]>();
  mock.firstTurn.mockReturnValueOnce(first.promise);
  const a = actions.send("My own question"), b = actions.send("Accidental second submission");
  expect(store.get().busy).toBe(true);
  first.resolve([11, 12]); await Promise.all([a, b]);
  expect(store.get().turns.map((t) => t.user)).toEqual(["My own question"]);
  expect(mock.write).toHaveBeenCalledTimes(1);
  expect(store.get().busy).toBe(false);
});

it("does not resurrect an old question after starting a new chat", async () => {
  const first = deferred<number[]>(); mock.firstTurn.mockReturnValueOnce(first.promise);
  const pending = actions.send("Old question");
  await actions.openStep(null);
  first.resolve([11, 12]); await pending;
  expect(store.get().turns).toHaveLength(0);
  expect(store.get().busy).toBe(false);
  expect(mock.write).not.toHaveBeenCalled();
});

it("changes the experiment without replacing a visitor's question", async () => {
  await actions.send("Describe a quiet weekend.");
  const normal = store.get().turns[0].normal;
  await actions.useExperiment(6);
  expect(store.get().turns[0].normal).toBe(normal);
  expect(store.get().turns[0].user).toBe("Describe a quiet weekend.");
  await actions.stepAction(.35);
  const writes = mock.write.mock.calls.map(([job]) => job);
  expect(writes[1]).toMatchObject({ conv: 1, history: [11, 12], changes: { concept: { id: "ocean", strength: .35 } } });
  expect(writes[1].seed).toBe(writes[0].seed);
  expect(writes[1].temperature).toBe(writes[0].temperature);
  expect(store.get().turns[0].changed?.source).toBe("live");
  await actions.send("And what should I bring?");
  expect(store.get().turns).toHaveLength(2);
  expect(store.get().turns[1].changed).toBeDefined();
  await actions.applyChips({});
  expect(store.get().turns).toHaveLength(2);
  expect(store.get().turns.every((t) => !t.changed)).toBe(true);
});

it("generates preset answers live and preserves them when selecting another intervention", async () => {
  await actions.openStep(1);
  const original = store.get().turns[0].normal;
  await actions.useExperiment(6);
  expect(store.get().turns[0].normal).toBe(original);
  expect(original.source).toBe("live");
  expect(mock.firstTurn).toHaveBeenCalledWith(actions.stepData(1)!.message);
  expect(mock.write).toHaveBeenCalledTimes(1);
  expect(fetch).not.toHaveBeenCalled();
});

it("stops a reply and ignores late tokens from the cancelled job", async () => {
  const done = deferred<{ ended: boolean; cancelled: boolean }>();
  let emit!: (t: Tok) => void;
  mock.write.mockImplementationOnce((_job, callback) => { emit = callback; emit(token); return done.promise; });
  const pending = actions.send("Tell me a story."); await flush();
  expect(store.get().turns[0].normal.toks).toHaveLength(1);
  actions.stopReply(); emit({ ...token, id: 101 });
  done.resolve({ ended: false, cancelled: true }); await pending;
  expect(store.get().busy).toBe(false);
  expect(store.get().turns[0].normal.toks).toHaveLength(1);
  expect(store.get().turns[0].normal.done).toBe(true);
  expect(mock.cancel).toHaveBeenCalled();
  await actions.continueReply();
  expect(mock.write.mock.calls.at(-1)?.[0]).toMatchObject({ prefix: [100], history: [11, 12] });
});

it("reports tokenizer errors and unlocks chat instead of leaving a stuck composer", async () => {
  mock.firstTurn.mockRejectedValueOnce(new Error("Tokenizer unavailable"));
  await actions.send("Hello");
  expect(store.get().busy).toBe(false);
  expect(store.get().error).toBe("Tokenizer unavailable");
  await actions.send("Try again");
  expect(store.get().error).toBeNull();
  expect(store.get().turns).toHaveLength(1);
});

it("ignores a sample question still being tokenized after navigation", async () => {
  const first = deferred<number[]>(); mock.firstTurn.mockReturnValueOnce(first.promise);
  const old = actions.openStep(2); await flush();
  await actions.openStep(3);
  first.resolve([11, 12]); await old;
  expect(store.get().step).toBe(3);
  expect(store.get().turns).toHaveLength(1);
  expect(store.get().turns[0].user).toBe("What is the capital of France?");
  expect(mock.write).toHaveBeenCalledTimes(1);
});

it("continues live sample replies from the actual token prefix", async () => {
  await actions.openStep(9);
  const before = store.get().turns[0].normal.toks.length;
  store.set((s) => ({ turns: s.turns.map((t) => ({ ...t, normal: { ...t.normal, ended: false } })) }));
  await actions.continueReply();
  expect(store.get().turns[0].normal.source).toBe("live");
  expect(store.get().turns[0].normal.toks).toHaveLength(before + 1);
  expect(mock.write.mock.calls.at(-1)?.[0].prefix).toEqual([100]);
});

it("keeps the original sampling settings when re-running with a changed model", async () => {
  await actions.send("Compare fairly");
  store.set({ seed: 99, temperature: 1.3 });
  await actions.applyChips({ floors: [{ floor: 0, mult: 0 }] });
  const [normal, changed] = mock.write.mock.calls.map(([job]) => job);
  expect(changed.seed).toBe(normal.seed);
  expect(changed.temperature).toBe(normal.temperature);
});

it("does not attach late inspection results to a new conversation", async () => {
  await actions.send("Inspect this reply.");
  const result = deferred<{ guesses: never[]; detail: Map<string, Float32Array> }>();
  mock.inspect.mockReturnValueOnce(result.promise);
  const old = actions.floorDetail({ turn: 0, side: "normal", index: 0 });
  await actions.openStep(null); await actions.send("A new question.");
  result.resolve({ guesses: [], detail: new Map() });
  expect(await old).toBeNull();
  expect(store.get().turns[0].normal.toks[0].guesses).toBeUndefined();
});

it("clamps inspection presets to a real token even for short replies", async () => {
  await actions.openStep(7); await actions.stepAction();
  expect(store.get().word).toEqual({ turn: 0, side: "normal", index: 0 });
});

it("does not relabel Qwen as unavailable when it finishes loading while using the trained model", async () => {
  store.set({ device: { kind: "checking" }, mode: "unavailable" });
  const load = deferred<{ stored: boolean; contextCap: number }>(); mock.load.mockReturnValueOnce(load.promise);
  const pending = actions.checkDevice(); await flush();
  await actions.openTiny(new Float32Array(8));
  load.resolve({ stored: true, contextCap: 1024 }); await pending;
  expect(store.get().model.id).toBe("tiny");
  expect(store.get().qwenMode).toBe("live");
  await actions.backToQwen();
  expect(store.get().mode).toBe("live");
  expect(store.get().model.id).toBe("qwen");
});

it("invalidates in-flight tokenization on GPU loss and allows recovery", async () => {
  const first = deferred<number[]>(); mock.firstTurn.mockReturnValueOnce(first.promise);
  const pending = actions.send("Interrupted question");
  actions.liveEngine()!.onLost!();
  first.resolve([11, 12]); await pending;
  expect(store.get().turns).toHaveLength(0);
  expect(store.get().mode).toBe("unavailable");
  actions.liveEngine()!.onRecovered!();
  expect(store.get().mode).toBe("live");
  await actions.send("Recovered");
  expect(store.get().turns[0].user).toBe("Recovered");
});

it("resolves swapped token names from the actual tokenizer", async () => {
  await actions.openStep(1); await actions.stepAction();
  expect(mock.pieces.mock.calls.some(([ids]) => ids.includes(12095) && ids.includes(21718))).toBe(true);
  expect(actions.piece(12095)).toBe("word12095");
});
