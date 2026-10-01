import { readFileSync } from "node:fs";
import { resolve } from "node:path";
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
  vi.stubGlobal("fetch", vi.fn(async (input: string | URL, init?: RequestInit) => {
    if (init?.method === "HEAD") return new Response(null, { headers: { "content-length": "20" } });
    const path = new URL(String(input), "http://localhost").pathname;
    if (path.endsWith("manifest.json")) return Response.json({ total_bytes: 100 });
    const data = readFileSync(resolve(__dirname, "../public", path.slice(1)));
    return new Response(data);
  }));
  actions = await import("../src/state/actions.ts");
  store = (await import("../src/state/store.ts")).store;
  await actions.start();
  await actions.startDownload();
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

it("offers the chat download even on fast devices so Grow needs no pretrained model", async () => {
  mock.check.mockResolvedValueOnce({ webgpu: true, seconds: 0.5 });
  const loads = mock.load.mock.calls.length;
  await actions.checkDevice();
  expect(store.get().device.kind).toBe("offer");
  expect(mock.load).toHaveBeenCalledTimes(loads);
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

it("keeps the recording provenance when selecting a different experiment", async () => {
  await actions.openStep(1);
  const original = store.get().turns[0].normal;
  await actions.useExperiment(6);
  expect(store.get().turns[0].normal).toBe(original);
  expect(original.recording).toBe("step-1.rwr");
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

it("ignores a late example download after navigation", async () => {
  const fetch = globalThis.fetch;
  const pending = deferred<Response>();
  vi.stubGlobal("fetch", vi.fn((url: string | URL, init?: RequestInit) => String(url).endsWith("step-2.rwr") ? pending.promise : fetch(url, init)));
  const old = actions.openStep(2);
  await actions.openStep(3);
  pending.resolve(await fetch("/recordings/step-2.rwr")); await old;
  expect(store.get().step).toBe(3);
  expect(store.get().turns).toHaveLength(1);
  expect(store.get().turns[0].user).toBe("What is the capital of France?");
  expect(store.get().busy).toBe(false);
});


it("labels a recorded start continued by the live engine as mixed provenance", async () => {
  await actions.openStep(9);
  const before = store.get().turns[0].normal.toks.length;
  store.set((s) => ({ turns: s.turns.map((t) => ({ ...t, normal: { ...t.normal, ended: false } })) }));
  await actions.continueReply();
  expect(store.get().turns[0].normal.source).toBe("mixed");
  expect(store.get().turns[0].normal.toks).toHaveLength(before + 1);
  expect(mock.write.mock.calls.at(-1)?.[0].prefix).toHaveLength(before);
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

it("keeps failed recording downloads recoverable", async () => {
  const realFetch = globalThis.fetch;
  vi.stubGlobal("fetch", vi.fn(async (url: string | URL, init?: RequestInit) => {
    if (String(url).endsWith("step-2.rwr")) throw new Error("Offline");
    return realFetch(url, init);
  }));
  await actions.replayAlternative(actions.stepData(2)!, "Another question");
  expect(store.get().busy).toBe(false);
  expect(store.get().error).toContain("could not load");
  vi.stubGlobal("fetch", realFetch);
  await actions.openStep(2);
  expect(store.get().error).toBeNull();
  expect(store.get().turns).toHaveLength(1);
});
