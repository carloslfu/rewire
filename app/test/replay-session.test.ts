// The visual replay bound to the real store and actions: it starts only on finished output, walks
// the selection through the reply, and gives way the moment the model writes or the samples change.
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Tok, WordRef } from "../src/model/types.ts";

const mock = vi.hoisted(() => ({
  check: vi.fn(), load: vi.fn(), firstTurn: vi.fn(), nextTurn: vi.fn(), pieces: vi.fn(), write: vi.fn(), compare: vi.fn(),
  inspect: vi.fn(), cancel: vi.fn(), setVersion: vi.fn(), setStageOpen: vi.fn(), pause: vi.fn(), use: vi.fn(), loadTiny: vi.fn(),
}));
vi.mock("../src/live/engine.ts", () => ({ EngineClient: class {
  check = mock.check; load = mock.load; firstTurn = mock.firstTurn; nextTurn = mock.nextTurn; pieces = mock.pieces;
  write = mock.write; compare = mock.compare; cancel = mock.cancel; setVersion = mock.setVersion; setStageOpen = mock.setStageOpen; pause = mock.pause;
  use = mock.use; loadTiny = mock.loadTiny; inspect = mock.inspect;
} }));

const STOP = 151645;
const tok = (id: number): Tok => ({ id, lp1: -.2, concept: 0, cut: 1, cands: [{ id, p: 1 }], pushes: new Float32Array(477) });
const flush = async () => { for (let i = 0; i < 40; i++) await Promise.resolve(); };
const at = (turn: number, side: WordRef["side"], index: number): WordRef => ({ turn, side, index });
const head = (mult: number) => ({ heads: [{ floor: 20, head: 13, mult }] });

interface Job { conv: number }
let streams: { emit: (id: number) => void; end: () => void }[];
function defer() {
  mock.write.mockImplementation((_job: Job, onToken: (t: Tok) => void) => {
    let resolve!: (r: { ended: boolean; cancelled: boolean }) => void;
    const done = new Promise<{ ended: boolean; cancelled: boolean }>((r) => { resolve = r; });
    streams.push({ emit: (id) => onToken(tok(id)), end: () => resolve({ ended: true, cancelled: false }) });
    return done;
  });
}
/** The original says 100 101 102 and stops; a changed model says 200 201. */
function instant() {
  mock.write.mockImplementation(async (job: Job, onToken: (t: Tok) => void) => {
    for (const id of job.conv === 0 ? [100, 101, 102, STOP] : [200, 201, STOP]) onToken(tok(id));
    return { ended: true, cancelled: false };
  });
}

let actions: typeof import("../src/state/actions.ts");
let store: typeof import("../src/state/store.ts").store;
let R: typeof import("../src/stage/replay-session.ts");
let beats: number;
const mode = () => R.session.get().mode;
/** Frames until the replay reaches a state, as the stage would lend them. */
const frames = (until: () => boolean, each = 100) => { for (let i = 0; i < 20_000 && !until(); i++) R.session.frame(each); };

beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();
  streams = [];
  mock.check.mockResolvedValue({ webgpu: true, seconds: 3 });
  mock.load.mockResolvedValue({ stored: true, contextCap: 1024 });
  mock.firstTurn.mockResolvedValue([11, 12]);
  mock.pieces.mockImplementation(async (ids: number[]) => ids.map((i) => ({ text: `word${i}` })));
  mock.compare.mockImplementation(async (_conv, _changes, _history, ids: number[]) => ids.map((id) => tok(id)));
  mock.inspect.mockResolvedValue({ detail: new Map(), guesses: [[{ id: 100, p: 1 }]] });
  mock.use.mockResolvedValue(true); mock.loadTiny.mockResolvedValue(true);
  instant();
  vi.stubGlobal("matchMedia", () => ({ matches: true }));
  vi.stubGlobal("location", { origin: "http://localhost", href: "http://localhost/", hash: "", pathname: "/", search: "" });
  vi.stubGlobal("history", { replaceState: vi.fn() });
  vi.stubGlobal("navigator", { gpu: {}, storage: { persist: async () => true } });
  vi.stubGlobal("screen", { width: 1200, height: 900 });
  vi.stubGlobal("addEventListener", vi.fn());
  actions = await import("../src/state/actions.ts");
  store = (await import("../src/state/store.ts")).store;
  R = await import("../src/stage/replay-session.ts");
  beats = (await import("../src/stage/playback.ts")).beatCount(store.get().model);
  await actions.start();
  await actions.openStep(null);
});
afterEach(() => vi.unstubAllGlobals());

it("explains why there is nothing to replay yet, and replays only finished output", async () => {
  expect(R.replayWait(store.get())).toBe("Ask a question first. Once the reply is finished you can replay it here.");
  expect(R.startReplay("answer")).toBe(false);
  defer();
  const sending = actions.send("Hello"); await flush();
  streams[0].emit(100); streams[0].emit(101);
  // Output is on screen but still being written: no replay, and following is not touched.
  expect(R.replayWait(store.get())).toBe("Replay is ready when this reply is finished.");
  expect(R.startReplay("answer")).toBe(false);
  expect(R.startReplay("token")).toBe(false);
  expect(store.get()).toMatchObject({ follow: true, word: at(0, "normal", 1) });
  expect(mode()).toBe("live");
  streams[0].emit(102); streams[0].emit(STOP); streams[0].end(); await sending;
  expect(R.replayWait(store.get())).toBe("");
  // The store's `replay` is the model rewriting changed answers. While that runs there is no visual replay either.
  defer();
  const updating = actions.applyChips(head(0)); await flush();
  expect(store.get().replay).toMatchObject({ status: "running" });
  expect(R.replayWait(store.get())).toBe("Replay is ready when the sample update is finished.");
  expect(R.startReplay("answer")).toBe(false);
  actions.stopReply(); streams.at(-1)!.end(); await updating;
  expect(R.replayWait(store.get())).toBe("Retry the sample update or restore the originals, then replay.");
  expect(R.startReplay("answer")).toBe(false);
});

it("walks the selected token through the whole answer from its first token and stops at the last, without asking the model for anything", async () => {
  await actions.send("Hello");
  expect(store.get().word).toEqual(at(0, "normal", 2));
  const calls = () => mock.write.mock.calls.length + mock.compare.mock.calls.length + mock.inspect.mock.calls.length;
  const before = calls(), toks = store.get().turns[0].normal.toks;
  expect(R.startReplay("answer")).toBe(true);
  expect(R.session.get()).toMatchObject({ mode: "replay", scope: "answer", playing: true, token: 0, tokens: 3, step: 1, beats });
  // The replay holds the selection, so following pauses while it lasts.
  expect(store.get()).toMatchObject({ word: at(0, "normal", 0), follow: false });
  const seen: number[] = [];
  const off = store.subscribe(() => { const i = store.get().word!.index; if (seen.at(-1) !== i) seen.push(i); });
  frames(() => R.session.get().ended);
  off();
  // Every visible token in order, never the stop marker, and the last one stays selected.
  expect(seen).toEqual([1, 2]);
  expect(store.get().word).toEqual(at(0, "normal", 2));
  expect(R.session.get()).toMatchObject({ ended: true, playing: false, token: 2, step: beats });
  // Cached values only: no generation, comparison or inspection, and the tokens are the very same objects.
  expect(calls()).toBe(before);
  expect(store.get().turns[0].normal.toks).toBe(toks);
  expect(store.get().replay).toBeNull();
});

it("goes back to live on request: following again, on the newest token", async () => {
  await actions.send("Hello");
  actions.chooseWord(at(0, "normal", 1));
  expect(store.get().follow).toBe(false);
  R.startReplay("token");
  expect(R.session.get()).toMatchObject({ scope: "token", token: 1, step: 1 });
  expect(store.get().word).toEqual(at(0, "normal", 1));
  const revision = store.get().followRevision;
  R.session.exit("live");
  expect(mode()).toBe("live");
  expect(store.get()).toMatchObject({ follow: true, word: at(0, "normal", 2), followRevision: revision + 1 });
  // Nothing plays afterwards.
  R.session.frame(60_000); R.session.play();
  expect(R.session.get()).toMatchObject({ mode: "live", playing: false });
});

it("gives way to a new question and follows it, or keeps a paused selection if following was paused before the replay", async () => {
  await actions.send("Hello");
  R.startReplay("answer");
  frames(() => R.session.get().token === 1);
  defer();
  const sending = actions.send("Another"); await flush();
  // The replay is over before the first new token, and it did not move the selection afterwards.
  expect(mode()).toBe("live");
  expect(store.get().follow).toBe(true);
  streams[0].emit(100);
  expect(store.get().word).toEqual(at(1, "normal", 0));
  R.session.frame(60_000);
  expect(store.get().word).toEqual(at(1, "normal", 0));
  streams[0].emit(STOP); streams[0].end(); await sending;

  // Following was paused by the visitor before this replay: it is still paused after it.
  actions.chooseWord(at(0, "normal", 1));
  R.startReplay("answer");
  expect(store.get().word).toEqual(at(0, "normal", 0));
  instant();
  await actions.send("Third");
  expect(mode()).toBe("live");
  expect(store.get()).toMatchObject({ follow: false, word: at(0, "normal", 0) });
});

it("ends for Continue, a model change, a punch put back, an edit, a removal, an undo, a clear and a model switch", async () => {
  const start = async () => { await flush(); expect(R.startReplay("answer")).toBe(true); expect(mode()).toBe("replay"); };
  await actions.send("One"); await actions.send("Two");
  // Continue on a reply that stopped early.
  store.set((s) => ({ turns: s.turns.map((t) => ({ ...t, normal: { ...t.normal, ended: false } })) }));
  await start();
  await actions.continueReply(0);
  expect(mode()).toBe("live");
  // Changing the model, and restoring it.
  await start();
  await actions.applyChips(head(0));
  expect(mode()).toBe("live");
  await start();
  expect(store.get().word).toMatchObject({ side: "changed", index: 0 });
  await actions.applyChips({});
  expect(mode()).toBe("live");
  expect(store.get().word?.side).toBe("normal");
  // Editing, removing and restoring a sample.
  await start();
  await actions.editSample(store.get().turns[0].id, "One, edited");
  expect(mode()).toBe("live");
  await start();
  actions.removeSample(store.get().turns[1].id);
  expect(mode()).toBe("live");
  await start();
  await actions.undoRemoveSample();
  expect(mode()).toBe("live");
  // Clearing the samples, then switching models.
  await start();
  actions.clearSamples();
  expect(mode()).toBe("live");
  expect(store.get()).toMatchObject({ word: null, follow: true });
  await actions.send("Again");
  await start();
  await actions.openTiny(new Float32Array(8));
  expect(mode()).toBe("live");
  expect(store.get()).toMatchObject({ word: null, follow: true });
  // In every case the replay is simply over: frames do nothing and nothing is selected by it.
  R.session.frame(60_000);
  expect(store.get().word).toBeNull();
});

it("pauses on a token the visitor chooses, in either reply or another sample, and resumes from there", async () => {
  await actions.send("One"); await actions.send("Two");
  await actions.applyChips(head(0)); await flush();
  expect(R.startReplay("answer", { sample: store.get().turns[0].id, side: "normal" })).toBe(true);
  expect(store.get().word).toEqual(at(0, "normal", 0));
  // A token of the same reply.
  actions.chooseWord(at(0, "normal", 2));
  expect(R.session.get()).toMatchObject({ mode: "replay", playing: false, picked: true, token: 2, step: beats });
  // The changed reply of the same sample, then another sample: the replay is now of that reply.
  actions.chooseWord(at(0, "changed", 1));
  expect(R.session.get()).toMatchObject({ mode: "replay", playing: false, picked: true, token: 1, tokens: 2 });
  actions.chooseWord(at(1, "normal", 1));
  expect(R.session.get()).toMatchObject({ mode: "replay", playing: false, token: 1, tokens: 3 });
  // Resume plays that token from its first step and goes on to the end of that reply.
  R.session.play();
  expect(R.session.get()).toMatchObject({ playing: true, token: 1, step: 1 });
  frames(() => R.session.get().ended);
  expect(store.get().word).toEqual(at(1, "normal", 2));
  // The reply-level entry works during a replay too, and starts that reply from its first token.
  expect(R.startReplay("answer", { sample: store.get().turns[1].id, side: "changed" })).toBe(true);
  expect(store.get()).toMatchObject({ word: at(1, "changed", 0), view: "push", follow: false });
  // Back to live still returns to following, as it was before the first replay.
  R.session.exit("live");
  expect(store.get().follow).toBe(true);
  // A reply that no longer exists cannot be replayed.
  expect(R.startReplay("answer", { sample: 999, side: "normal" })).toBe(false);
  expect(mode()).toBe("live");
});

it("pauses when the inspector opens, so tokens going by are never measured one after another", async () => {
  await actions.send("Hello");
  R.startReplay("answer");
  actions.setFocus({ kind: "memory", floor: 3 });
  expect(store.get().sheet).toBe(true);
  expect(R.session.get()).toMatchObject({ mode: "replay", playing: false, token: 0, step: 1 });
  R.session.frame(60_000);
  expect(R.session.get().step).toBe(1);
  expect(mock.inspect).not.toHaveBeenCalled();
});

it("keeps playing when a measurement of the selected token arrives, since the reply itself did not change", async () => {
  await actions.send("Hello");
  R.startReplay("token");
  const detail = await actions.floorDetail(store.get().word!);
  expect(detail).not.toBeNull();
  // The token now carries its per-layer guesses, in a new reply object with the same tokens.
  expect(store.get().turns[0].normal.toks[2].guesses).toBeDefined();
  expect(R.session.get()).toMatchObject({ mode: "replay", playing: true, token: 2 });
});

it("opens the 3D view for a reply-level replay request, and ignores one while the model is writing", async () => {
  await actions.send("Hello");
  const id = store.get().turns[0].id;
  actions.askReplay(id, "normal");
  expect(store.get()).toMatchObject({ scopeView: "3d", replayRequest: { sample: id, side: "normal" } });
  // Asking does not start anything by itself: the 3D view does, once it is drawing.
  expect(mode()).toBe("live");
  store.set({ scopeView: "2d", replayRequest: null, busy: true });
  actions.askReplay(id, "normal");
  expect(store.get()).toMatchObject({ scopeView: "2d", replayRequest: null });
  store.set({ busy: false, stage3d: false });
  actions.askReplay(id, "normal");
  expect(store.get().replayRequest).toBeNull();
});

it("tells the engine when a 3D view is open, so writing and comparing leave the GPU room to draw it", async () => {
  // The engine was connected with no stage open.
  expect(mock.setStageOpen.mock.calls).toEqual([[false]]);
  actions.stageShown(true);
  expect(mock.setStageOpen).toHaveBeenLastCalledWith(true);
  // A second bench mounting while the first unmounts never reports closed in between.
  actions.stageShown(true); actions.stageShown(false);
  expect(mock.setStageOpen).toHaveBeenLastCalledWith(true);
  actions.stageShown(false);
  expect(mock.setStageOpen).toHaveBeenLastCalledWith(false);
  actions.stageShown(false);
  expect(mock.setStageOpen).toHaveBeenLastCalledWith(false);
});

/** A stage that records what the link asks of it, and keeps the hold as the real stage does. */
function fakeStage() {
  const log: string[] = [];
  const st = {
    log, held: false, replaying: false, driver: null as unknown,
    setDriver(d: unknown) { st.driver = d; log.push(d ? "driver" : "no driver"); },
    setPlayhead(t: number | null) { st.replaying = t !== null; if (t === null) st.held = false; log.push(`playhead ${t}`); },
    holdOutput(held = true) { held &&= st.replaying; if (held !== st.held) { st.held = held; log.push(held ? "hold" : "release"); } },
    setCandidates(list: { label: string }[]) { st.held = false; log.push(`candidates ${list.map((c) => c.label).join(",")}`); },
  };
  return st;
}
/** What React does after a render: hand over the selected token's candidates with its identity. */
const handOver = (link: ReturnType<typeof R.linkStage>) => {
  const s = store.get(), w = s.word!, turn = s.turns[w.turn], reply = w.side === "normal" ? turn.normal : turn.changed!;
  link.deliver([{ label: `tok${reply.toks[w.index].id}`, p: 0.5, chosen: true }], R.outputIdentity(s));
};

it("holds the output from the moment a replay reaches a token until that token's own result is handed over", async () => {
  await actions.send("One"); await actions.send("Two");
  await actions.applyChips(head(0)); await flush();
  const stage = fakeStage(), link = R.linkStage(stage as never);
  // Live: results are handed over and shown at once; nothing is ever held.
  handOver(link);
  expect(stage.log).toEqual(["driver", "playhead null", "candidates tok201"]);
  actions.chooseWord(at(1, "normal", 1)); handOver(link);
  expect(stage.held).toBe(false);
  expect(stage.log).not.toContain("hold");

  // A replay of the whole answer goes to the first token: held before anything else can be drawn, until its result arrives.
  stage.log.length = 0;
  expect(R.startReplay("answer")).toBe(true);
  expect(stage.log).toEqual(["playhead 1", "hold"]);
  handOver(link);
  expect(stage.log.slice(2)).toEqual(["candidates tok100"]);
  expect(stage.held).toBe(false);
  // Playing on into the next token: its first step and the hold arrive together, before React has rendered anything.
  stage.log.length = 0;
  frames(() => R.session.get().token === 1);
  expect(stage.log.slice(-2)).toEqual(["playhead 1", "hold"]);
  expect(stage.log.filter((l) => l === "hold")).toHaveLength(1);
  handOver(link);
  expect(stage.held).toBe(false);

  // The same index in the changed reply is another token: held, though the index did not move.
  R.session.pause();
  stage.log.length = 0;
  actions.chooseWord(at(1, "changed", 1));
  expect(R.session.get().token).toBe(1);
  expect(stage.log).toEqual([`playhead ${beats}`, "hold"]);
  handOver(link);
  expect(stage.log.at(-1)).toBe("candidates tok201");
  expect(stage.held).toBe(false);
  // And the same index of the same side in another sample.
  stage.log.length = 0;
  actions.chooseWord(at(0, "changed", 1));
  expect(stage.log).toEqual([`playhead ${beats}`, "hold"]);
  // Back to the token whose result is already there, before React rendered the one in between: released, since nothing new will arrive.
  actions.chooseWord(at(1, "changed", 1));
  expect(stage.held).toBe(false);
  expect(stage.log.at(-1)).toBe("release");
  // A step within the token never holds.
  stage.log.length = 0;
  R.session.seek(3); R.session.stepBy(1);
  expect(stage.log).toEqual(["playhead 3", "playhead 4"]);

  // Back to live while a result is still awaited: live output is not held.
  actions.chooseWord(at(0, "normal", 0));
  expect(stage.held).toBe(true);
  R.session.exit("live");
  expect(stage.held).toBe(false);
  expect(stage.log.at(-1)).toBe("playhead null");
  // Closing the link: the stage is let go, the replay is not left running, and nothing reaches the stage afterwards.
  R.startReplay("answer");
  stage.log.length = 0;
  link.close();
  expect(stage.log).toEqual(["no driver"]);
  expect(R.session.get().playing).toBe(false);
  R.session.play(); R.session.seek(5);
  expect(stage.log).toEqual(["no driver"]);
});

it("names a token by its model, sample, reply and place, so the same index elsewhere is not the same token", async () => {
  await actions.send("One"); await actions.send("Two");
  await actions.applyChips(head(0)); await flush();
  const id = (w: WordRef) => R.outputIdentity({ ...store.get(), word: w });
  const all = [at(0, "normal", 1), at(0, "changed", 1), at(1, "normal", 1), at(1, "changed", 1), at(0, "normal", 0)].map(id);
  expect(new Set(all).size).toBe(all.length);
  expect(id(at(0, "normal", 1))).toBe(id(at(0, "normal", 1)));
  // A model change makes every token a new one; a measurement patched into the reply does not.
  const before = id(at(0, "normal", 1));
  await actions.floorDetail(at(0, "normal", 1));
  expect(id(at(0, "normal", 1))).toBe(before);
  await actions.applyChips(head(2)); await flush();
  expect(id(at(0, "normal", 1))).not.toBe(before);
  expect(R.outputIdentity({ ...store.get(), word: null })).toBe("");
});

it("keeps a pause the visitor made during a replay: choosing a token, then using another word, does not turn following back on", async () => {
  await actions.send("Capital of France?");
  expect(store.get().follow).toBe(true);
  expect(R.startReplay("answer")).toBe(true);
  // The visitor opens a token of the reply being replayed and uses another word there.
  actions.selectWord(at(0, "normal", 1));
  expect(R.session.get()).toMatchObject({ mode: "replay", playing: false, token: 1 });
  defer();
  const picking = actions.pick(at(0, "normal", 1), 555); await flush();
  // The rewrite ends the replay. Following was on before it, but the pick is the visitor's own pause.
  expect(mode()).toBe("live");
  expect(store.get().follow).toBe(false);
  streams[0].emit(555);
  expect(store.get().word).toEqual(at(0, "normal", 1));
  // New pieces arrive after the picked one: the selection stays on the pick instead of running to the end.
  streams[0].emit(301); streams[0].emit(302);
  expect(store.get()).toMatchObject({ word: at(0, "normal", 1), follow: false });
  streams[0].emit(STOP); streams[0].end(); await picking;
  expect(store.get()).toMatchObject({ word: at(0, "normal", 1), follow: false });
  expect(store.get().turns[0].normal.toks.map((t) => t.id)).toEqual([100, 555, 301, 302, STOP]);
});

it("treats a token chosen by hand during a replay as a pause that outlasts it, and the replay's own steps as none", async () => {
  await actions.send("One");
  // The replay moving through tokens itself, and its own Previous and Next, are not the visitor pausing.
  R.startReplay("answer");
  frames(() => R.session.get().token === 1);
  R.session.toToken(2);
  instant();
  await actions.send("Two");
  expect(mode()).toBe("live");
  expect(store.get().follow).toBe(true);
  // A token chosen in a reply during the replay is. The replay ending by itself leaves it paused there.
  R.startReplay("answer");
  actions.chooseWord(at(0, "normal", 1));
  await actions.applyChips(head(0)); await flush();
  expect(mode()).toBe("live");
  expect(store.get()).toMatchObject({ follow: false, word: at(0, "normal", 1) });
  // Back to live is the visitor asking to follow again, whatever was chosen during the replay.
  R.startReplay("answer");
  actions.chooseWord(at(1, "normal", 0));
  R.session.exit("live");
  expect(store.get().follow).toBe(true);
});
