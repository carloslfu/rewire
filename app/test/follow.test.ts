// Follow output, driven through the real actions with token streams the test releases one piece at a
// time: following selects the newest output, paused keeps the visitor's token, and nothing late or
// stale moves either.
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Tok, WordRef } from "../src/model/types.ts";

const mock = vi.hoisted(() => ({
  check: vi.fn(), load: vi.fn(), firstTurn: vi.fn(), nextTurn: vi.fn(), pieces: vi.fn(), write: vi.fn(), compare: vi.fn(),
  inspect: vi.fn(), cancel: vi.fn(), setVersion: vi.fn(), pause: vi.fn(), use: vi.fn(), loadTiny: vi.fn(),
}));
vi.mock("../src/live/engine.ts", () => ({ EngineClient: class {
  check = mock.check; load = mock.load; firstTurn = mock.firstTurn; nextTurn = mock.nextTurn; pieces = mock.pieces;
  write = mock.write; compare = mock.compare; cancel = mock.cancel; setVersion = mock.setVersion; pause = mock.pause;
  use = mock.use; loadTiny = mock.loadTiny; inspect = mock.inspect;
} }));

const STOP = 151645;
const tok = (id: number): Tok => ({ id, lp1: -.2, concept: 0, cut: 1, cands: [{ id, p: 1 }], pushes: new Float32Array(477) });
const flush = async () => { for (let i = 0; i < 40; i++) await Promise.resolve(); };
const at = (turn: number, side: WordRef["side"], index: number): WordRef => ({ turn, side, index });
const head = (mult: number) => ({ heads: [{ floor: 20, head: 13, mult }] });

interface Job { conv: number; history: number[]; prefix: number[] }
interface Stream { job: Job; emit: (id: number) => void; end: (ended?: boolean) => void }
let streams: Stream[];
/** From now on every reply waits for the test to write its tokens and to finish it. */
function defer() {
  mock.write.mockImplementation((job: Job, onToken: (t: Tok) => void) => {
    let resolve!: (r: { ended: boolean; cancelled: boolean }) => void;
    const done = new Promise<{ ended: boolean; cancelled: boolean }>((r) => { resolve = r; });
    streams.push({ job, emit: (id) => onToken(tok(id)), end: (ended = true) => resolve({ ended, cancelled: false }) });
    return done;
  });
}
/** Replies written at once: the original says 100 101 and stops, a changed model says 200 201 202. */
function instant() {
  mock.write.mockImplementation(async (job: Job, onToken: (t: Tok) => void) => {
    for (const id of job.conv === 0 ? [100, 101, STOP] : [200, 201, 202]) onToken(tok(id));
    return { ended: true, cancelled: false };
  });
}

let actions: typeof import("../src/state/actions.ts");
let store: typeof import("../src/state/store.ts").store;
let words: typeof import("../src/ui/word.ts");
const word = () => store.get().word;
const shown = () => words.chosen(store.get())?.tok.id;

beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();
  streams = [];
  mock.check.mockResolvedValue({ webgpu: true, seconds: 3 });
  mock.load.mockResolvedValue({ stored: true, contextCap: 1024 });
  mock.firstTurn.mockResolvedValue([11, 12]);
  mock.pieces.mockImplementation(async (ids: number[]) => ids.map((i) => ({ text: `word${i}` })));
  mock.compare.mockImplementation(async (_conv, _changes, _history, ids: number[]) => ids.map((id) => tok(id)));
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
  words = await import("../src/ui/word.ts");
  await actions.start();
  await actions.openStep(null);
});
afterEach(() => vi.unstubAllGlobals());

it("follows each token as it is written, skips the stop marker, and holds a chosen token through Continue until resumed", async () => {
  defer();
  const sent = actions.send("Tell me a story."); await flush();
  expect(store.get().follow).toBe(true);
  expect(word()).toBeNull(); // Following, and waiting for the first token.
  streams[0].emit(100); expect(word()).toEqual(at(0, "normal", 0));
  streams[0].emit(101); expect(word()).toEqual(at(0, "normal", 1));
  streams[0].end(false); await sent;
  expect(word()).toEqual(at(0, "normal", 1));

  actions.chooseWord(at(0, "normal", 0));
  expect(store.get().follow).toBe(false);
  const continued = actions.continueReply(0); await flush();
  streams[1].emit(102);
  expect(word()).toEqual(at(0, "normal", 0));
  expect(store.get().follow).toBe(false);

  const revision = store.get().followRevision;
  actions.setFollowing(true);
  expect(word()).toEqual(at(0, "normal", 2));
  expect(store.get().followRevision).toBe(revision + 1);
  streams[1].emit(103); expect(word()).toEqual(at(0, "normal", 3));
  streams[1].emit(STOP); expect(word()).toEqual(at(0, "normal", 3));
  streams[1].end(); await continued;
  expect(word()).toEqual(at(0, "normal", 3));
  expect(store.get().follow).toBe(true);
});

it("anchors a followed comparison to the newest original token of each sample, and keeps following across view switches", async () => {
  await actions.send("First"); await actions.send("Second");
  await actions.applyChips(head(0));
  expect(word()).toEqual(at(1, "changed", 2));
  actions.setTowerView("difference");
  expect(store.get()).toMatchObject({ view: "difference", follow: true, word: at(1, "normal", 1) });

  defer();
  const update = actions.applyChips(head(-1)); await flush();
  // Sample 1 of 2 is being rewritten: its newest original token, never position 0 and never a changed token.
  expect(store.get()).toMatchObject({ view: "difference", follow: true, word: at(0, "normal", 1), replay: { turn: 0 } });
  streams[0].emit(300); streams[0].emit(301); streams[0].emit(302);
  expect(word()).toEqual(at(0, "normal", 1));
  streams[0].end(); await flush();
  expect(store.get()).toMatchObject({ word: at(1, "normal", 1), replay: { turn: 1 } });
  streams[1].emit(300); streams[1].end(); await update;
  expect(store.get()).toMatchObject({ view: "difference", follow: true, word: at(1, "normal", 1), replay: null });
  expect(words.towerValues(words.chosen(store.get()), "difference")).not.toBeNull();

  // Push shows the changed reply's newest token at once, without toggling Follow output.
  actions.setTowerView("push");
  expect(store.get()).toMatchObject({ view: "push", follow: true, word: at(1, "changed", 0) });
  actions.setTowerView("difference");
  expect(store.get()).toMatchObject({ view: "difference", follow: true, word: at(1, "normal", 1) });

  // Paused, the same switches keep the visitor's token and stay paused.
  actions.setTowerView("push");
  actions.chooseWord(at(0, "changed", 1));
  actions.setTowerView("difference");
  expect(store.get()).toMatchObject({ view: "difference", follow: false, word: at(0, "normal", 1) });
  actions.setTowerView("push");
  expect(store.get()).toMatchObject({ view: "push", follow: false, word: at(0, "normal", 1) });
});

it("prefers the changed reply in Push: the original is a fallback, and its late tokens do not take the selection back", async () => {
  await actions.applyChips(head(0));
  defer();
  const sent = actions.send("Compare"); await flush();
  const original = streams.find((s) => s.job.conv === 0)!, changed = streams.find((s) => s.job.conv === 1)!;
  original.emit(100);
  expect(word()).toEqual(at(0, "normal", 0)); // The changed reply is still empty.
  changed.emit(200);
  expect(word()).toEqual(at(0, "changed", 0));
  original.emit(101);
  expect(word()).toEqual(at(0, "changed", 0));
  changed.emit(STOP); changed.end(); await flush();
  expect(store.get().turns[0].changed?.done).toBe(true);
  original.emit(102);
  expect(word()).toEqual(at(0, "changed", 0));
  original.end(); await sent;
  expect(word()).toEqual(at(0, "changed", 0));
  expect(store.get().follow).toBe(true);
});

it("settles on a remaining sample when the selected one is removed, following or paused, and after undoing the last removal", async () => {
  await actions.send("First"); await actions.send("Second");
  const [first, second] = store.get().turns;
  expect(word()).toEqual(at(1, "normal", 1));
  actions.removeSample(second.id);
  expect(store.get()).toMatchObject({ follow: true, word: at(0, "normal", 1) });
  expect(shown()).toBe(101);
  await actions.undoRemoveSample();
  expect(store.get()).toMatchObject({ follow: true, word: at(1, "normal", 1) });

  actions.selectWord(at(1, "normal", 0));
  actions.removeSample(second.id);
  expect(store.get()).toMatchObject({ follow: false, word: at(0, "normal", 1) });
  // An earlier sample's removal only renumbers a selection that still exists.
  await actions.undoRemoveSample();
  actions.chooseWord(at(1, "normal", 0));
  actions.removeSample(first.id);
  expect(store.get()).toMatchObject({ follow: false, word: at(0, "normal", 0) });
  expect(store.get().turns[0].id).toBe(second.id);

  // The final sample: nothing is left to select, and undo selects it again in either mode.
  actions.removeSample(second.id);
  expect(store.get()).toMatchObject({ follow: false, word: null, turns: [] });
  await actions.undoRemoveSample();
  expect(store.get()).toMatchObject({ follow: false, word: at(0, "normal", 1) });
  actions.setFollowing(true);
  actions.removeSample(second.id);
  expect(word()).toBeNull();
  await actions.undoRemoveSample();
  expect(store.get()).toMatchObject({ follow: true, word: at(0, "normal", 1) });
  expect(shown()).toBe(101);
});

it("tracks the sample being written, not the last one in the list, when an older sample is continued or edited", async () => {
  await actions.send("Older"); await actions.send("Newer");
  const older = store.get().turns[0];
  store.set((s) => ({ turns: s.turns.map((t, i) => (i ? t : { ...t, normal: { ...t.normal, toks: t.normal.toks.slice(0, 2), ended: false } })) }));
  defer();
  const continued = actions.continueReply(0); await flush();
  expect(word()).toEqual(at(0, "normal", 1));
  streams[0].emit(102); expect(word()).toEqual(at(0, "normal", 2));

  // Paused on the newer sample mid-update, then resumed: back to the reply still being written.
  actions.chooseWord(at(1, "normal", 0));
  streams[0].emit(103);
  expect(word()).toEqual(at(1, "normal", 0));
  actions.setFollowing(true);
  expect(word()).toEqual(at(0, "normal", 3));
  streams[0].end(); await continued;
  expect(word()).toEqual(at(0, "normal", 3));

  const edited = actions.editSample(older.id, "Older, edited"); await flush();
  expect(store.get()).toMatchObject({ follow: true, word: null });
  streams[1].emit(300); expect(word()).toEqual(at(0, "normal", 0));
  streams[1].emit(301); streams[1].end(); expect(await edited).toBe(true);
  expect(word()).toEqual(at(0, "normal", 1));
  expect(shown()).toBe(301);
});

it("keeps a paused selection through questions, edits and model changes, and moves it only when its token is gone", async () => {
  await actions.send("First"); await actions.send("Second");
  const [first, second] = store.get().turns;
  actions.chooseWord(at(0, "normal", 0));
  const held = word();

  await actions.send("Third");
  expect(store.get()).toMatchObject({ follow: false, word: held });
  await actions.applyChips(head(0));
  expect(store.get()).toMatchObject({ follow: false, word: held });
  expect(await actions.editSample(second.id, "Second, edited")).toBe(true);
  expect(store.get()).toMatchObject({ follow: false, word: held });
  expect(store.get().word).toBe(held);

  // A selected changed token is replaced by the next model change: the same sample's original, nearest position.
  actions.chooseWord(at(0, "changed", 2));
  defer();
  const update = actions.applyChips(head(-1)); await flush();
  expect(store.get()).toMatchObject({ follow: false, word: at(0, "normal", 1) });
  for (const k of [0, 1, 2]) { streams[k].emit(300); streams[k].emit(301); streams[k].end(); await flush(); }
  await update;
  expect(store.get()).toMatchObject({ follow: false, word: at(0, "normal", 1), replay: null });

  // The selected sample's replies are replaced by an edit: the nearest sample that still has output.
  const edited = actions.editSample(first.id, "First, edited"); await flush();
  expect(store.get()).toMatchObject({ follow: false, word: at(1, "changed", 1) });
  for (const s of streams.slice(3)) { s.emit(400); s.end(); }
  expect(await edited).toBe(true);
  expect(store.get()).toMatchObject({ follow: false, word: at(1, "changed", 1) });

  // A reply made stale (a newer lesson) cannot stay selected: its sample's original instead.
  store.set((s) => ({ turns: s.turns.map((t, i) => (i === 1 ? { ...t, changed: { ...t.changed!, stale: true } } : t)) }));
  actions.settleSelection();
  expect(store.get()).toMatchObject({ follow: false, word: at(1, "normal", 1) });
  expect(shown()).toBe(101);
});

it("gives Qwen and the tiny model the same preference: paused stays paused, and an empty selection takes the first token once", async () => {
  const firstOnly = async () => {
    defer();
    const before = streams.length;
    const sent = actions.send("red circle"); await flush();
    expect(store.get()).toMatchObject({ follow: false, word: null });
    streams[before].emit(5); expect(word()).toEqual(at(0, "normal", 0));
    streams[before].emit(6); streams[before].emit(7);
    expect(word()).toEqual(at(0, "normal", 0));
    streams[before].end(); await sent;
    expect(store.get()).toMatchObject({ follow: false, word: at(0, "normal", 0) });
    instant();
  };
  actions.setFollowing(false);
  await firstOnly(); // Qwen, no earlier selection.

  // Opening the tiny model is a new experiment and follows again; each of its messages replaces the sample.
  await actions.openTiny(new Float32Array(8));
  expect(store.get()).toMatchObject({ follow: true, word: null });
  await actions.send("red circle");
  expect(store.get()).toMatchObject({ follow: true, word: at(0, "normal", 1) });
  actions.chooseWord(at(0, "normal", 0));
  await firstOnly(); // Tiny: the chosen letter's sample was replaced.
  await actions.applyChips({ floors: [{ floor: 1, mult: 0 }] });
  expect(store.get()).toMatchObject({ follow: false, word: at(0, "normal", 0) });
  actions.setFollowing(true);
  expect(word()).toEqual(at(0, "changed", 2));
  await actions.send("blue star");
  expect(store.get()).toMatchObject({ follow: true, word: at(0, "changed", 2) });

  // Back to Qwen and Clear are new experiments too; a paused Qwen question behaves as the tiny one did.
  await actions.backToQwen();
  expect(store.get()).toMatchObject({ follow: true, word: null });
  actions.setFollowing(false);
  actions.clearSamples();
  expect(store.get()).toMatchObject({ follow: true, word: null });
});

it("drops late tokens and stale completions instead of moving a manual choice or the current sample", async () => {
  defer();
  const sent = actions.send("Tell me a story."); await flush();
  streams[0].emit(100); streams[0].emit(101);
  actions.chooseWord(at(0, "normal", 0));
  streams[0].emit(102);
  expect(word()).toEqual(at(0, "normal", 0));
  actions.stopReply();
  streams[0].emit(103); streams[0].end(); await sent;
  expect(store.get()).toMatchObject({ follow: false, word: at(0, "normal", 0) });
  expect(store.get().turns[0].normal.toks).toHaveLength(3);
  actions.setFollowing(true);
  expect(word()).toEqual(at(0, "normal", 2));

  // A reply that is only a stop marker selects nothing of its own.
  const empty = actions.send("Say nothing."); await flush();
  expect(word()).toBeNull();
  streams[1].emit(STOP);
  expect(word()).toBeNull();
  streams[1].end(); await empty;
  expect(store.get()).toMatchObject({ follow: true, word: at(0, "normal", 2) });

  // An update superseded by Clear: its late tokens and its completion select nothing.
  const update = actions.applyChips(head(0)); await flush();
  streams[2].emit(200);
  expect(word()).toEqual(at(0, "changed", 0));
  actions.clearSamples();
  streams[2].emit(201); streams[2].end(); await update;
  expect(store.get()).toMatchObject({ follow: true, word: null, turns: [], replay: null });

  // Stopping an update mid-sample leaves following on the newest token that was really written.
  await actions.applyChips({});
  instant(); await actions.send("Again"); defer();
  const stopped = actions.applyChips(head(0)); await flush();
  streams[3].emit(200); streams[3].emit(201);
  actions.stopReply(); streams[3].emit(202); streams[3].end(); await stopped;
  expect(store.get()).toMatchObject({ follow: true, word: at(0, "changed", 1), replay: { status: "stopped" } });
});

it("hands a 3D replay back to following even when the followed token is the one already selected", async () => {
  const { advance, applyReplay, beatCount } = await import("../src/stage/playback.ts");
  await actions.send("Replay me");
  const beats = beatCount(store.get().model), newest = word();
  let clock = { t: beats, playing: false, speed: 2 };
  // Replay on the newest token: the control reports a manual action and the component pauses following.
  const played = applyReplay(clock, { kind: "play" }, beats);
  expect(played).toEqual({ clock: { t: 0, playing: true, speed: 2 }, manual: true });
  actions.setFollowing(false);
  clock = advance(played.clock, 100, beats);
  expect(clock.playing).toBe(true);
  expect(store.get().word).toBe(newest);

  // Resuming changes no token, so the revision is what tells the replay to stop and show everything.
  const revision = store.get().followRevision;
  actions.setFollowing(true);
  expect(store.get().word).toBe(newest);
  expect(store.get().followRevision).toBe(revision + 1);
  expect(applyReplay(clock, { kind: "reveal" }, beats).clock).toEqual({ t: beats, playing: false, speed: 2 });
  // Pausing never signals the replay.
  actions.setFollowing(false);
  expect(store.get().followRevision).toBe(revision + 1);
});
