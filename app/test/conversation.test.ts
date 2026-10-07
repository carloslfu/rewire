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

it("enables comparison while following the changed reply and keeps the original reference on later interventions", async () => {
  const { comparisonTarget, chosen, towerValues } = await import("../src/ui/word.ts");
  mock.compare.mockImplementation(async (_conv, _changes, _history, ids: number[]) => ids.map((id) => ({ ...token, id, pushes: new Float32Array(477).fill(2) })));
  await actions.send("Compare this");
  expect(comparisonTarget(store.get())).toBeNull();
  mock.write.mockImplementation(async (_job, emit) => { emit({ ...token, id: 101 }); return { ended: true, cancelled: false }; });
  await actions.applyChips({ memory: [{ floor: 27, mult: 0 }] });
  expect(store.get().word?.side).toBe("changed");
  expect(comparisonTarget(store.get())).toEqual({ turn: 0, side: "normal", index: 0 });
  actions.setTowerView("difference");
  expect(store.get().word?.side).toBe("normal");
  expect(towerValues(chosen(store.get()), "difference")?.[476]).toBe(2);
  await actions.applyChips({ memory: [{ floor: 27, mult: -1 }] });
  expect(store.get().view).toBe("difference");
  expect(store.get().word?.side).toBe("normal");
  actions.selectWord({ turn: 0, side: "changed", index: 0 });
  expect(store.get().view).toBe("push");
  expect(comparisonTarget(store.get())).not.toBeNull();
  actions.setTowerView("difference");
  await actions.applyChips({});
  expect(store.get().view).toBe("push");
  expect(comparisonTarget(store.get())).toBeNull();
});

it("tracks a pending comparison and discards it after a new chat", async () => {
  const { comparisonTarget } = await import("../src/ui/word.ts");
  const comparison = deferred<Tok[]>();
  mock.compare.mockReturnValueOnce(comparison.promise);
  await actions.send("Old question");
  const pending = actions.applyChips({ memory: [{ floor: 1, mult: 0 }] }); await flush();
  expect(store.get().turns[0].changed?.comparing).toBe(true);
  expect(comparisonTarget(store.get())).toBeNull();
  actions.setTowerView("difference");
  expect(store.get().view).toBe("push");
  actions.freshStart();
  await actions.send("New question");
  const current = store.get().turns[0];
  comparison.resolve([token]); await pending;
  expect(store.get().turns[0]).toBe(current);
  expect(store.get().view).toBe("push");
});

it("reports a comparison failure separately from generation and retries real measurements", async () => {
  const { comparisonTarget } = await import("../src/ui/word.ts");
  mock.compare.mockRejectedValueOnce(new Error("Comparison failed"));
  await actions.send("Hello");
  await actions.applyChips({ floors: [{ floor: 1, mult: 0 }] });
  expect(store.get().turns[0].changed).toMatchObject({ done: true, comparing: false, compareError: "Comparison failed" });
  expect(store.get().error).toBeNull();
  expect(comparisonTarget(store.get())).toBeNull();
  mock.compare.mockResolvedValueOnce([token]);
  await actions.retryComparison();
  expect(store.get().turns[0].changed?.compareError).toBeUndefined();
  expect(comparisonTarget(store.get())).not.toBeNull();
});

it("restores a valid original token when the changed reply is longer", async () => {
  const { chosen } = await import("../src/ui/word.ts");
  await actions.send("Short original");
  mock.write.mockImplementationOnce(async (_job, emit) => {
    for (let i = 0; i < 5; i++) emit({ ...token, id: 101 + i });
    return { ended: true, cancelled: false };
  });
  await actions.applyChips({ floors: [{ floor: 0, mult: 0 }] });
  expect(store.get().word?.index).toBe(4);
  await actions.applyChips({});
  expect(store.get().word).toEqual({ turn: 0, side: "normal", index: 0 });
  expect(chosen(store.get())).not.toBeNull();
});

it("compares a later original reply after the changed side's own conversation history", async () => {
  const { comparisonTarget } = await import("../src/ui/word.ts");
  mock.write.mockImplementation(async (job, emit) => { emit({ ...token, id: job.conv === 0 ? 100 : 101 }); return { ended: true, cancelled: false }; });
  mock.compare.mockImplementation(async (_conv, _changes, _history, ids: number[]) => ids.map((id) => ({ ...token, id })));
  await actions.send("First");
  await actions.applyChips({ floors: [{ floor: 2, mult: 0 }] });
  actions.setTowerView("difference");
  await actions.send("Second");
  expect(mock.compare.mock.calls.at(-1)?.slice(2, 4)).toEqual([[11, 12, 101, 21, 22], [100]]);
  expect(store.get().word).toEqual({ turn: 1, side: "normal", index: 0 });
  expect(comparisonTarget(store.get())).toEqual(store.get().word);
});

it("replays all questions in order when adding or removing one change, with a separate regenerated history", async () => {
  // Model the tokenizer's different delimiter when a reply stops naturally vs. hits its cap.
  mock.nextTurn.mockImplementation(async (previous: number[]) => [previous.at(-1) === 151645 ? 21 : 23, 22]);
  mock.write.mockImplementation(async (job, emit) => {
    const id = job.conv === 0 ? 100 + job.turn : (job.changes.heads?.length ? 200 : 300) + job.turn;
    emit({ ...token, id });
    if (job.conv === 0) emit({ ...token, id: 151645 });
    return { ended: job.conv === 0, cancelled: false };
  });
  mock.compare.mockImplementation(async (_conv, _spec, _history, ids: number[]) => ids.map((id) => ({ ...token, id })));
  for (const question of ["Colombia?", "Peru?", "What have I asked?"]) await actions.send(question);
  const originals = store.get().turns.map((t) => t.normal);
  const two = { heads: [{ floor: 20, head: 13, mult: -1 }], memory: [{ floor: 27, mult: 2 }] };
  await actions.applyChips(two);
  const replay = mock.write.mock.calls.slice(3).map(([job]) => job);
  expect(replay.map((job) => job.turn)).toEqual([0, 1, 2]);
  expect(replay.map((job) => job.history)).toEqual([
    [11, 12], [11, 12, 200, 23, 22], [11, 12, 200, 23, 22, 201, 23, 22],
  ]);
  expect(mock.compare.mock.calls.map((call) => call[2])).toEqual(replay.map((job) => job.history));
  expect(store.get().fork).toBe(0);
  expect(store.get().turns.every((t) => t.changed?.compare?.length === t.normal.toks.length)).toBe(true);
  store.get().turns.forEach((t, i) => expect(t.normal).toBe(originals[i]));
  await actions.applyChips({ memory: two.memory });
  expect(mock.write.mock.calls.slice(6).map(([job]) => job.history)).toEqual([
    [11, 12], [11, 12, 300, 23, 22], [11, 12, 300, 23, 22, 301, 23, 22],
  ]);
  expect(store.get().turns.map((t) => t.changed?.toks[0].id)).toEqual([300, 301, 302]);
  expect(store.get().turns.every((t) => !t.changed?.stale)).toBe(true);
  expect(store.get().replay).toBeNull();
  expect(store.get().busy).toBe(false);
  await actions.send("And Chile?");
  expect(mock.write.mock.calls.at(-2)?.[0].history).toEqual([11, 12, 100, 151645, 21, 22, 101, 151645, 21, 22, 102, 151645, 21, 22]);
  expect(mock.write.mock.calls.at(-1)?.[0].history).toEqual([11, 12, 300, 23, 22, 301, 23, 22, 302, 23, 22]);
  const beforeRestore = mock.write.mock.calls.length;
  await actions.applyChips({});
  expect(mock.write).toHaveBeenCalledTimes(beforeRestore);
  expect(store.get().turns.every((t) => !t.changed)).toBe(true);
  originals.forEach((r, i) => expect(store.get().turns[i].normal).toBe(r));
});

it("retains each turn's sampling settings and extended original reply budget during replay", async () => {
  await actions.send("First");
  store.set({ seed: 17, temperature: .3 });
  await actions.send("Second");
  const old = store.get().turns[0];
  store.set((s) => ({ turns: [{ ...old, normal: { ...old.normal, toks: Array(128).fill(token) } }, s.turns[1]] }));
  store.set({ seed: 99, temperature: 1.2 });
  await actions.applyChips({ memory: [{ floor: 1, mult: 2 }] });
  expect(mock.write.mock.calls.slice(2).map(([j]) => [j.seed, j.temperature, j.cap])).toEqual([[11, .7, 128], [17, .3, 64]]);
});

it("stops the entire replay, ignores late tokens, and blocks follow-ups until a clean restart", async () => {
  await actions.send("First"); await actions.send("Second"); await actions.send("Third");
  const done = deferred<{ ended: boolean; cancelled: boolean }>();
  let emit!: (t: Tok) => void;
  mock.write.mockImplementationOnce((_job, cb) => { emit = cb; cb({ ...token, id: 200 }); return done.promise; });
  const pending = actions.applyChips({ memory: [{ floor: 1, mult: 0 }] }); await flush();
  expect(store.get().replay).toEqual({ turn: 0, status: "running" });
  actions.stopReply();
  emit({ ...token, id: 201 });
  done.resolve({ ended: false, cancelled: true }); await pending;
  expect(store.get().replay).toEqual({ turn: 0, status: "stopped" });
  expect(store.get().turns[0].changed?.toks.map((t) => t.id)).toEqual([200]);
  expect(store.get().turns[1].changed?.read).toEqual([]);
  await actions.send("Must wait"); await actions.continueReply(); await actions.retryComparison();
  expect(mock.write).toHaveBeenCalledTimes(4);
  expect(mock.compare).not.toHaveBeenCalled();
  await actions.restartReplay();
  expect(mock.write.mock.calls.slice(4).map(([j]) => [j.turn, j.prefix])).toEqual([[0, []], [1, []], [2, []]]);
  expect(store.get().replay).toBeNull();
  await actions.send("Now complete");
  expect(store.get().turns).toHaveLength(4);
});

it("keeps replay locked while the next prompt is tokenized and cancels on a new chat", async () => {
  await actions.send("First"); await actions.send("Second");
  const next = deferred<number[]>(); mock.nextTurn.mockReturnValueOnce(next.promise);
  const pending = actions.applyChips({ memory: [{ floor: 1, mult: 2 }] }); await flush();
  expect(store.get().replay).toEqual({ turn: 1, status: "running" });
  expect(store.get().busy).toBe(true);
  await actions.send("Must wait");
  expect(store.get().turns).toHaveLength(2);
  actions.freshStart();
  next.resolve([21, 22]); await pending;
  expect(store.get().turns).toHaveLength(0);
  expect(store.get().replay).toBeNull();
  expect(mock.write).toHaveBeenCalledTimes(3);
});

it("keeps replay locked through its last comparison and ignores a superseded comparison", async () => {
  await actions.send("First"); await actions.send("Second");
  const comparison = deferred<Tok[]>();
  mock.compare.mockResolvedValueOnce([token]).mockReturnValueOnce(comparison.promise);
  const pending = actions.applyChips({ memory: [{ floor: 1, mult: 2 }] }); await flush();
  expect(store.get().replay).toEqual({ turn: 1, status: "running" });
  expect(store.get().busy).toBe(true);
  await actions.send("Must wait"); expect(store.get().turns).toHaveLength(2);
  await actions.applyChips({ memory: [{ floor: 1, mult: 5 }] });
  const final = store.get().turns;
  comparison.resolve([{ ...token, id: 999 }]); await pending;
  expect(store.get().turns).toBe(final);
  expect(store.get().turns.every((t) => t.changed?.changes.memory?.[0].mult === 5)).toBe(true);
  expect(store.get().replay).toBeNull();
});

it("marks a failed replay as incomplete, preserves originals, and restores without fabricated output", async () => {
  await actions.send("First"); await actions.send("Second"); await actions.send("Third");
  const originals = store.get().turns.map((t) => t.normal);
  mock.nextTurn.mockRejectedValueOnce(new Error("Tokenizer failed"));
  await actions.applyChips({ memory: [{ floor: 1, mult: 0 }] });
  expect(store.get().replay).toEqual({ turn: 1, status: "error" });
  expect(store.get().error).toBe("Tokenizer failed");
  expect(store.get().busy).toBe(false);
  expect(store.get().turns[2].changed?.toks).toEqual([]);
  await actions.send("Must wait"); expect(store.get().turns).toHaveLength(3);
  await actions.applyChips({});
  expect(store.get().replay).toBeNull();
  expect(store.get().error).toBeNull();
  expect(store.get().turns.map((t) => t.normal)).toEqual(originals);
  expect(mock.write).toHaveBeenCalledTimes(4);
});

it("does not continue replay after a context limit or an unexpected worker cancellation", async () => {
  await actions.send("First"); await actions.send("Second");
  mock.write.mockRejectedValueOnce(new Error("context-full"));
  await actions.applyChips({ memory: [{ floor: 1, mult: 2 }] });
  expect(store.get().replay?.status).toBe("error");
  expect(store.get().full).toBe(true);
  expect(mock.write).toHaveBeenCalledTimes(3);
  await actions.applyChips({});
  expect(store.get().full).toBe(false);
  mock.write.mockResolvedValueOnce({ ended: false, cancelled: true });
  await actions.applyChips({ memory: [{ floor: 1, mult: 5 }] });
  expect(store.get().replay?.status).toBe("stopped");
  expect(store.get().busy).toBe(false);
  expect(mock.write).toHaveBeenCalledTimes(4);
});

it("replays the trained model with its 160-letter budget and no chat template", async () => {
  await actions.openTiny(new Float32Array(8));
  await actions.send("red circle=");
  await actions.applyChips({ floors: [{ floor: 1, mult: 0 }] });
  expect(mock.write.mock.calls.at(-1)?.[0]).toMatchObject({ conv: 1, turn: 0, cap: 160, history: store.get().turns[0].normal.read });
  expect(mock.nextTurn).not.toHaveBeenCalled();
  expect(store.get().replay).toBeNull();
});

it("locks an existing conversation before resolving dictionary swap names", async () => {
  await actions.send("Existing question");
  const names = deferred<string[]>(); mock.pieces.mockReturnValueOnce(names.promise);
  const pending = actions.applyChips({ swaps: [[900, 901]] });
  expect(store.get().busy).toBe(true);
  await actions.send("Must wait");
  expect(store.get().turns).toHaveLength(1);
  actions.freshStart();
  names.resolve(["a", "b"]); await pending;
  expect(store.get().turns).toHaveLength(0);
  expect(mock.write).toHaveBeenCalledTimes(1);
});
