// Moving between Qwen and the trained tiny model, with the engine worker failing along the way.
// What the page announces and what the device line shows must be about the model on screen: a tiny
// model that runs carries no Qwen error, a Qwen that is not loaded is never called ready, and
// switching back never reports a reply that was not stopped.
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Tok } from "../src/model/types.ts";

const mock = vi.hoisted(() => ({
  check: vi.fn(), load: vi.fn(), firstTurn: vi.fn(), nextTurn: vi.fn(), pieces: vi.fn(), write: vi.fn(), compare: vi.fn(),
  inspect: vi.fn(), cancel: vi.fn(), setVersion: vi.fn(), setStageOpen: vi.fn(), pause: vi.fn(), use: vi.fn(), loadTiny: vi.fn(),
}));
vi.mock("../src/live/engine.ts", () => ({ EngineClient: class {
  check = mock.check; load = mock.load; firstTurn = mock.firstTurn; nextTurn = mock.nextTurn; pieces = mock.pieces;
  write = mock.write; compare = mock.compare; cancel = mock.cancel; setVersion = mock.setVersion; setStageOpen = mock.setStageOpen; pause = mock.pause;
  use = mock.use; loadTiny = mock.loadTiny; inspect = mock.inspect;
} }));

const letter = (id: number): Tok => ({ id, lp1: -.2, concept: 0, cut: 1, cands: [{ id, p: 1 }], pushes: new Float32Array(21) });
const STOPPED = "QA: the engine worker stopped";
let actions: typeof import("../src/state/actions.ts");
let store: typeof import("../src/state/store.ts").store;
let Panels: typeof import("../src/ui/Panels.tsx");
let S: typeof import("../src/strings.ts").S;

/** The real client's rule, as the page meets it: a worker replaced for the tiny model alone does not hold Qwen until it is loaded again. */
let qwenLoaded = true;
const bar = () => {
  const html = renderToString(<Panels.DeviceBar />);
  return { text: html.replace(/<!-- -->/g, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(), retry: /<button[^>]*>Try again<\/button>/.test(html) };
};
const buttons = () => [...renderToString(<Panels.DeviceBar />).matchAll(/<button[^>]*>(.*?)<\/button>/g)].map((m) => m[1]);
const settle = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
const deferred = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>((r) => { resolve = r; }); return { promise, resolve }; };
const fail = (message: string) => { qwenLoaded = false; actions.liveEngine()!.onFailure!(message); };

beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();
  qwenLoaded = true;
  mock.check.mockResolvedValue({ webgpu: true, seconds: 3 });
  mock.load.mockImplementation(async () => { qwenLoaded = true; return { stored: true, contextCap: 1024 }; });
  mock.firstTurn.mockResolvedValue([11, 12]);
  mock.pieces.mockImplementation(async (ids: number[]) => ids.map((i) => ({ text: `word${i}` })));
  // The worker writes what it is asked for, up to the room left in the context of the model on screen.
  mock.write.mockImplementation(async (job: { cap: number; history: number[]; prefix: number[] }, onToken: (t: Tok) => void) => {
    const room = (store.get().model.id === "tiny" ? 512 : 1024) - job.history.length - job.prefix.length;
    for (let i = 0; i < Math.min(job.cap, room); i++) onToken(letter(30 + (i % 20)));
    return { ended: false, cancelled: false };
  });
  mock.compare.mockResolvedValue([]);
  mock.use.mockImplementation(async (model: string) => { if (model === "qwen" && !qwenLoaded) throw new Error("The model could not recover. Retry loading the model."); return true; });
  mock.loadTiny.mockResolvedValue({ floors: 4, heads: 4, contextCap: 512 });
  vi.stubGlobal("matchMedia", () => ({ matches: true, addEventListener() {}, removeEventListener() {} }));
  vi.stubGlobal("document", { documentElement: { dataset: {} } });
  vi.stubGlobal("getComputedStyle", () => ({ getPropertyValue: () => "#808080" }));
  vi.stubGlobal("location", { origin: "http://localhost", href: "http://localhost/", hash: "", pathname: "/", search: "" });
  vi.stubGlobal("history", { replaceState: vi.fn() });
  vi.stubGlobal("localStorage", { getItem: () => null, setItem: vi.fn(), removeItem: vi.fn() });
  vi.stubGlobal("navigator", { gpu: {}, storage: { persist: async () => true } });
  vi.stubGlobal("screen", { width: 1200, height: 900 });
  vi.stubGlobal("addEventListener", vi.fn());
  actions = await import("../src/state/actions.ts");
  store = (await import("../src/state/store.ts")).store;
  Panels = await import("../src/ui/Panels.tsx");
  ({ S } = await import("../src/strings.ts"));
  await actions.start();
  await actions.openStep(null);
});
afterEach(() => vi.unstubAllGlobals());

it("generates exactly one letter with the trained checkpoint and requests a token replay", async () => {
  store.set({ stage3d: true, tiny: true, temperature: 1.2 });
  const params = new Float32Array([1, 2]);
  await actions.openTiny(params, "red circle = ");
  const s = store.get();
  expect(mock.loadTiny.mock.lastCall?.[0]).toEqual(params);
  expect(mock.write.mock.lastCall?.[0]).toMatchObject({ cap: 1, temperature: 0 });
  expect(s.temperature).toBe(1.2);
  expect(s.turns[0].normal).toMatchObject({ done: true });
  expect(s.turns[0].normal.toks).toHaveLength(1);
  expect(s.replayRequest).toMatchObject({ sample: s.turns[0].id, side: "normal", scope: "token" });
});

it("keeps the new workspace if the visitor leaves Grow during the checkpoint handoff", async () => {
  store.set({ tiny: true });
  const loading = deferred<{ floors: number; heads: number; contextCap: number }>();
  mock.loadTiny.mockReturnValueOnce(loading.promise);
  const handoff = actions.openTiny(new Float32Array([1, 2]), "red circle = ");
  store.set({ tiny: false, teach: true });
  loading.resolve({ floors: 4, heads: 4, contextCap: 512 });
  await handoff;
  expect(mock.use).not.toHaveBeenCalledWith("tiny");
  expect(store.get()).toMatchObject({ model: { id: "qwen" }, teach: true, replayRequest: null });
});

it("says what is true of Qwen when leaving the tiny model, not that a reply was stopped", async () => {
  expect(store.get()).toMatchObject({ mode: "live", device: { kind: "ready" } });
  await actions.openTiny(new Float32Array(8));
  expect(store.get().announce).toBe(S.tinyReady);
  // The tiny model writes to its reply cap, and Continue takes it on until its context is full.
  await actions.send("red star = ");
  for (let i = 0; i < 8; i++) await actions.continueReply(0);
  const text = store.get().turns[0].normal;
  expect(text.read.length + text.toks.length).toBe(512);
  expect(store.get().busy).toBe(false);
  // Back to Qwen: the tiny text is gone, the bench is empty, and nothing of Qwen's was stopped.
  await actions.backToQwen();
  expect(store.get()).toMatchObject({ mode: "live", turns: [], busy: false });
  expect(store.get().model.id).toBe("qwen");
  expect(store.get().announce).toBe(S.ready);
  expect(store.get().announce).not.toMatch(/Stopped|continue/i);
  expect(bar()).toEqual({ text: "", retry: false });
  // The same from the navigation, which goes through openStep.
  await actions.openTiny(new Float32Array(8));
  await actions.send("blue moon = ");
  await actions.openStep(null);
  expect(store.get().model.id).toBe("qwen");
  expect(store.get().announce).toBe(S.ready);
});

it("does not call Qwen ready while it is still loading, and says so once it is", async () => {
  // Qwen is still downloading when the visitor trains a tiny model and opens it.
  store.set({ device: { kind: "checking" }, mode: "unavailable", qwenMode: undefined });
  let finish!: () => void;
  mock.load.mockImplementationOnce(() => new Promise((resolve) => { finish = () => { qwenLoaded = true; resolve({ stored: true, contextCap: 1024 }); }; }));
  const loading = actions.checkDevice();
  for (let i = 0; i < 20; i++) await Promise.resolve();
  expect(store.get().device.kind).toBe("downloading");
  await actions.openTiny(new Float32Array(8));
  // A tiny model that runs says nothing of Qwen's download.
  expect(store.get().mode).toBe("live");
  expect(bar()).toEqual({ text: "", retry: false });
  await actions.send("red star = ");
  await actions.backToQwen();
  expect(store.get().mode).toBe("unavailable");
  expect(store.get().announce).toBe(S.downloading(0, 0));
  expect(bar().text).toContain("Loading the model onto your device");
  finish(); await loading;
  expect(store.get()).toMatchObject({ mode: "live", announce: S.ready });
});

it("shows no Qwen error on a tiny model handed to a fresh worker, and keeps that error with Try again for Qwen", async () => {
  // Qwen is loaded. The engine worker stops while the visitor is on the Grow bench.
  fail(STOPPED);
  expect(store.get()).toMatchObject({ mode: "unavailable", qwenMode: "unavailable", device: { kind: "error", message: STOPPED } });
  expect(bar()).toEqual({ text: `The model could not start: ${STOPPED}. Try again`, retry: true });
  // Open this model in the full lab: the client starts a fresh worker for the tiny model, and it writes.
  await actions.openTiny(new Float32Array(8));
  await actions.send("red star = ");
  expect(store.get().turns[0].normal.toks).toHaveLength(160);
  expect(store.get()).toMatchObject({ mode: "live", error: null });
  expect(store.get().model.id).toBe("tiny");
  // The announcement and the composer agree: the model on screen is ready, and no error of another model is beside it.
  expect(bar()).toEqual({ text: "", retry: false });
  // Qwen's failure has not been forgotten: it is not loaded in the new worker.
  expect(store.get()).toMatchObject({ qwenMode: "unavailable", device: { kind: "error", message: STOPPED } });

  // Back to Qwen: unavailable, with the reason and the way to load it. Never "ready", never "Stopped".
  await actions.backToQwen();
  expect(store.get().model.id).toBe("qwen");
  expect(store.get()).toMatchObject({ mode: "unavailable", turns: [], device: { kind: "error", message: STOPPED } });
  expect(store.get().announce).toBe(`The model could not start: ${STOPPED}. Use Try again to load it.`);
  expect(bar()).toEqual({ text: `The model could not start: ${STOPPED}. Try again`, retry: true });
  await actions.send("Capital of France?");
  expect(store.get().turns).toHaveLength(0);
  // Try again loads Qwen into the worker, and it answers.
  await actions.checkDevice();
  expect(mock.load).toHaveBeenCalledTimes(2);
  expect(store.get()).toMatchObject({ mode: "live", device: { kind: "ready" }, announce: S.ready });
  expect(bar()).toEqual({ text: "", retry: false });
  await actions.send("Capital of France?");
  expect(store.get().turns[0].normal.toks.length).toBeGreaterThan(0);
});

it("shows a failure of the tiny model's own worker, and recovers it from there", async () => {
  fail(STOPPED);
  await actions.openTiny(new Float32Array(8));
  await actions.send("red star = ");
  expect(bar()).toEqual({ text: "", retry: false });
  // The fresh worker stops too. This one is the tiny model's failure, and it is shown with the way to start again.
  fail("QA: the second worker stopped");
  expect(store.get().model.id).toBe("tiny");
  expect(store.get()).toMatchObject({ mode: "unavailable", busy: false });
  expect(bar()).toEqual({ text: "The model could not start: QA: the second worker stopped. Try again", retry: true });
  await actions.send("blue moon = ");
  expect(store.get().turns.every((t) => t.user !== "blue moon = ")).toBe(true);
  // A GPU reset while the tiny model is on screen is shown as well, and goes when it has recovered.
  store.set({ mode: "live", device: { kind: "ready", seconds: 3 } });
  actions.liveEngine()!.onLost!();
  expect(bar().text).toBe(S.recovering);
  actions.liveEngine()!.onRecovered!();
  expect(store.get().mode).toBe("live");
  expect(bar()).toEqual({ text: "", retry: false });
  // Try again after the worker failure reloads the worker and the tiny model runs again.
  fail("QA: the second worker stopped");
  await actions.checkDevice();
  expect(store.get().model.id).toBe("tiny");
  expect(store.get()).toMatchObject({ mode: "live", device: { kind: "ready" } });
  expect(bar()).toEqual({ text: "", retry: false });
  await actions.send("blue moon = ");
  expect(store.get().turns.at(-1)!.normal.toks).toHaveLength(160);
});

it("shows every step of a retry beside a tiny model that cannot run, with progress and Pause, until it is back", async () => {
  fail(STOPPED);
  await actions.openTiny(new Float32Array(8));
  await actions.send("red star = ");
  fail("QA: the second worker stopped");
  expect(bar().retry).toBe(true);
  // Try again. The check and the load are slow, as on a first visit with nothing cached.
  const check = deferred<{ webgpu: boolean; seconds: number }>(), load = deferred<{ stored: boolean; contextCap: number }>();
  mock.check.mockReturnValueOnce(check.promise);
  mock.load.mockReturnValueOnce(load.promise);
  const retry = actions.checkDevice();
  await settle();
  // Checking: the tiny model still cannot run, and the line says what is happening instead of going blank.
  expect(store.get().model.id).toBe("tiny");
  expect(store.get()).toMatchObject({ mode: "unavailable", device: { kind: "checking" } });
  expect(bar()).toEqual({ text: S.checking, retry: false });
  check.resolve({ webgpu: true, seconds: 3 });
  await settle();
  // Downloading: the amount so far, and the download can be paused and resumed from here.
  expect(store.get().device.kind).toBe("downloading");
  expect(bar().text).toContain(S.downloading(0, 0));
  expect(buttons()).toEqual([S.pause]);
  actions.liveEngine()!.onProgress!(120e6, 385e6);
  expect(bar().text).toContain(S.downloading(120, 385));
  expect(renderToString(<Panels.DeviceBar />)).toMatch(/role="progressbar"[^>]*aria-valuenow="120000000"/);
  actions.pauseDownload(true);
  expect(mock.pause).toHaveBeenLastCalledWith(true);
  expect(buttons()).toEqual([S.resume]);
  actions.pauseDownload(false);
  expect(buttons()).toEqual([S.pause]);
  // Everything has arrived and the model is being started.
  actions.liveEngine()!.onProgress!(385e6, 385e6);
  expect(store.get().device.kind).toBe("loading");
  expect(bar()).toEqual({ text: S.loadingModel, retry: false });
  // Nothing can be sent until it is back, so the line is the only word on why.
  await actions.send("blue moon = ");
  expect(store.get().turns.every((t) => t.user !== "blue moon = ")).toBe(true);
  expect(store.get().mode).toBe("unavailable");
  // Done: the tiny model runs again and the line goes.
  qwenLoaded = true;
  load.resolve({ stored: true, contextCap: 1024 });
  await retry;
  expect(store.get().model.id).toBe("tiny");
  expect(store.get()).toMatchObject({ mode: "live", device: { kind: "ready" } });
  expect(bar()).toEqual({ text: "", retry: false });
  await actions.send("blue moon = ");
  expect(store.get().turns.at(-1)!.normal.toks).toHaveLength(160);

  // A retry that fails says so beside the tiny model, with Try again, and never a blank line.
  fail("QA: the third worker stopped");
  mock.load.mockRejectedValueOnce(new Error("Weights unavailable"));
  await actions.checkDevice();
  expect(store.get().model.id).toBe("tiny");
  expect(store.get().mode).toBe("unavailable");
  expect(bar()).toEqual({ text: "The model could not start: Weights unavailable. Try again", retry: true });
});
