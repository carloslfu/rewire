// Rewriting part of a reply, and what stays true of the numbers around it: a pick late in a long
// reply writes the picked piece, a comparison never outlives the tokens it was measured on, a
// measurement is kept for exactly the token it is of, a full context says so, and a change the model
// has no room for is refused before it is shown as active.
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Forced, Tok } from "../src/model/types.ts";
import { readByWrite, writeRoom } from "../src/live/pace.ts";

const mock = vi.hoisted(() => ({
  check: vi.fn(), load: vi.fn(), firstTurn: vi.fn(), nextTurn: vi.fn(), pieces: vi.fn(), write: vi.fn(), compare: vi.fn(),
  inspect: vi.fn(), cancel: vi.fn(), setVersion: vi.fn(), setStageOpen: vi.fn(), pause: vi.fn(), use: vi.fn(), loadTiny: vi.fn(),
}));
vi.mock("../src/live/engine.ts", () => ({ EngineClient: class {
  check = mock.check; load = mock.load; firstTurn = mock.firstTurn; nextTurn = mock.nextTurn; pieces = mock.pieces;
  write = mock.write; compare = mock.compare; cancel = mock.cancel; setVersion = mock.setVersion; setStageOpen = mock.setStageOpen; pause = mock.pause;
  use = mock.use; loadTiny = mock.loadTiny; inspect = mock.inspect;
} }));

interface Job { conv: number; cap: number; prefix: number[]; history: number[]; force?: number }
const tok = (id: number, picked = false): Tok => ({ id, lp1: -.2, concept: 0, cut: 1, cands: [{ id, p: 1 }], pushes: new Float32Array(477), ...(picked ? { picked } : {}) });
const flush = async () => { for (let i = 0; i < 40; i++) await Promise.resolve(); };
const deferred = <T>() => { let resolve!: (value: T) => void; const promise = new Promise<T>((r) => { resolve = r; }); return { promise, resolve }; };
let actions: typeof import("../src/state/actions.ts");
let store: typeof import("../src/state/store.ts").store;
let words: typeof import("../src/ui/word.ts");
let S: typeof import("../src/strings.ts").S;

/**
 * The worker as it answers a write: `cap` pieces after the prefix, the first of them the forced one,
 * and nothing at all for a cap that is not positive. Written ids continue from the prefix length, so
 * the same position always gets the same id.
 */
function writes() {
  mock.write.mockImplementation(async (job: Job, onToken: (t: Tok) => void) => {
    for (let i = 0; i < job.cap; i++) onToken(i === 0 && job.force !== undefined ? tok(job.force, true) : tok((job.conv === 0 ? 1000 : 2000) + job.prefix.length + i));
    return { ended: false, cancelled: false };
  });
}
const jobs = () => mock.write.mock.calls.map(([job]) => job as Job);
const reply = (turn = 0, side: "normal" | "changed" = "normal") => { const t = store.get().turns[turn]; return side === "normal" ? t.normal : t.changed!; };
const ids = (turn = 0, side: "normal" | "changed" = "normal") => reply(turn, side).toks.map((t) => t.id);
const at = (turn: number, side: "normal" | "changed", index: number) => ({ turn, side, index });
const cutLayer = { floors: [{ floor: 14, mult: 0 }] };

beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();
  mock.check.mockResolvedValue({ webgpu: true, seconds: 3 });
  mock.load.mockResolvedValue({ stored: true, contextCap: 1024 });
  mock.firstTurn.mockResolvedValue([11, 12]);
  mock.pieces.mockImplementation(async (ids: number[]) => ids.map((i) => ({ text: `word${i}` })));
  // The changed model's measurement of exactly the tokens it was given.
  mock.compare.mockImplementation(async (_conv, _changes, _history, ids: number[]): Promise<Forced[]> => ids.map((id) => ({ id, lp1: -0.01 * id, concept: 0, pushes: new Float32Array(477) })));
  mock.inspect.mockImplementation(async () => ({ detail: new Map([["f0.x", new Float32Array(1)]]), guesses: [] }));
  mock.use.mockResolvedValue(true); mock.loadTiny.mockResolvedValue({ floors: 4, heads: 4, contextCap: 512 });
  writes();
  vi.stubGlobal("matchMedia", () => ({ matches: true }));
  vi.stubGlobal("location", { origin: "http://localhost", href: "http://localhost/", hash: "", pathname: "/", search: "" });
  vi.stubGlobal("history", { replaceState: vi.fn() });
  vi.stubGlobal("navigator", { gpu: {}, storage: { persist: async () => true } });
  vi.stubGlobal("screen", { width: 1200, height: 900 });
  vi.stubGlobal("addEventListener", vi.fn());
  actions = await import("../src/state/actions.ts");
  store = (await import("../src/state/store.ts")).store;
  words = await import("../src/ui/word.ts");
  ({ S } = await import("../src/strings.ts"));
  await actions.start();
  await actions.openStep(null);
});
afterEach(() => vi.unstubAllGlobals());

it("writes a piece picked past the 64th of a continued Qwen reply, and keeps the reply its length", async () => {
  await actions.send("A long answer"); await actions.continueReply(0);
  expect(ids()).toHaveLength(128);
  const before = ids();
  await actions.pick(at(0, "normal", 100), 777);
  // The job asks for the rest of the reply from the picked piece on. It used to ask for 64 minus 100.
  expect(jobs().at(-1)).toMatchObject({ force: 777, cap: 28 });
  expect(jobs().at(-1)!.prefix).toEqual(before.slice(0, 100));
  expect(ids()).toHaveLength(128);
  expect(ids().slice(0, 100)).toEqual(before.slice(0, 100));
  expect(reply().toks[100]).toMatchObject({ id: 777, picked: true });
  expect(reply().pickedAt).toBe(100);
  // The picked piece stays selected and paused, and Undo brings every original piece back.
  expect(store.get()).toMatchObject({ word: at(0, "normal", 100), follow: false });
  actions.undoPick(0, "normal");
  expect(ids()).toEqual(before);
  // The reply can still be continued afterwards, from its own last piece.
  await actions.continueReply(0);
  expect(jobs().at(-1)).toMatchObject({ cap: 64 });
  expect(jobs().at(-1)!.prefix).toEqual(before);
  expect(ids()).toHaveLength(192);
});

it("rewrites a tiny-model text from any letter, late or early, to its full 160 letters", async () => {
  await actions.openTiny(new Float32Array(8));
  await actions.send("red circle = ");
  expect(ids()).toHaveLength(160);
  const before = ids();
  await actions.pick(at(0, "normal", 100), 5);
  expect(jobs().at(-1)).toMatchObject({ force: 5, cap: 60 });
  expect(ids()).toHaveLength(160);
  expect(reply().toks[100]).toMatchObject({ id: 5, picked: true });
  actions.undoPick(0, "normal");
  expect(ids()).toEqual(before);
  // An early letter keeps the text at 160 too, instead of shrinking it to 64.
  await actions.pick(at(0, "normal", 10), 6);
  expect(jobs().at(-1)).toMatchObject({ force: 6, cap: 150 });
  expect(ids()).toHaveLength(160);
  expect(reply().toks[10].id).toBe(6);
});

it("says a pick was stopped instead of naming a piece that was never written", async () => {
  await actions.send("Question");
  mock.write.mockImplementationOnce(async () => ({ ended: false, cancelled: true }));
  await actions.pick(at(0, "normal", 3), 777);
  // Nothing was written at the picked position: the reply holds only what came before it, and Undo is still there.
  expect(reply().toks).toHaveLength(3);
  expect(reply().pickedAt).toBe(3);
  expect(reply().toks[reply().pickedAt!]).toBeUndefined();
  expect(reply().original?.toks).toHaveLength(64);
  // The reply is finished as far as it got, which is what lets the page say the pick was stopped.
  expect(reply().done).toBe(true);
});

it("drops a comparison measured on a picked reply when the pick is undone, and measures the restored reply again", async () => {
  await actions.send("Capital of France?");
  const original = ids();
  await actions.pick(at(0, "normal", 2), 777);
  const picked = ids();
  expect(picked[2]).toBe(777);
  await actions.applyChips(cutLayer); await flush();
  // The comparison is of the picked reply: it is valid for those tokens.
  expect(words.comparison(store.get().turns[0])?.map((x) => x.id)).toEqual(picked);
  const compared = mock.compare.mock.calls.length;
  actions.undoPick(0, "normal");
  // At once: the old comparison describes other tokens and is gone, not read by position against the restored reply.
  expect(ids()).toEqual(original);
  expect(reply(0, "changed").compare).toBeUndefined();
  expect(words.comparison(store.get().turns[0])).toBeUndefined();
  expect(words.chosen({ ...store.get(), word: at(0, "normal", 2) })?.forced).toBeUndefined();
  // And it is measured again, on the restored tokens, without the visitor asking.
  await flush();
  expect(mock.compare).toHaveBeenCalledTimes(compared + 1);
  expect(mock.compare.mock.calls.at(-1)![3]).toEqual(original);
  expect(words.comparison(store.get().turns[0])?.map((x) => x.id)).toEqual(original);
  expect(words.chosen({ ...store.get(), word: at(0, "normal", 2) })?.forced?.id).toBe(original[2]);
});

it("never reads a comparison by position against tokens it was not measured on", async () => {
  await actions.send("Question"); await actions.applyChips(cutLayer); await flush();
  const turn = store.get().turns[0], measured = turn.changed!.compare!;
  expect(words.comparison(turn)).toBe(measured);
  // Another id at one position, another length, or a stale reply: no comparison at all.
  const other = { ...turn, normal: { ...turn.normal, toks: turn.normal.toks.map((t, i) => (i === 5 ? tok(9999) : t)) } };
  expect(words.comparison(other)).toBeUndefined();
  expect(words.comparison({ ...turn, normal: { ...turn.normal, toks: turn.normal.toks.slice(0, -1) } })).toBeUndefined();
  expect(words.comparison({ ...turn, changed: { ...turn.changed!, stale: true } })).toBeUndefined();
  expect(words.comparison({ ...turn, changed: undefined })).toBeUndefined();
});

it("keeps a measurement through Stop, and asks again after a request that could not be answered", async () => {
  await actions.send("First"); await actions.send("Second");
  // The inspection of an older sample's token is still running when the visitor presses Stop.
  const slow = deferred<{ guesses: never[]; detail: Map<string, Float32Array> }>();
  mock.inspect.mockReturnValueOnce(slow.promise);
  const pending = actions.floorDetail(at(0, "normal", 4));
  actions.stopReply();
  slow.resolve({ guesses: [], detail: new Map([["f0.x", new Float32Array([4])]]) });
  // The token is the same token: its measurement is good, and it is kept, not replaced by "unavailable".
  const detail = await pending;
  expect(detail?.get("f0.x")).toEqual(new Float32Array([4]));
  expect(await actions.floorDetail(at(0, "normal", 4))).toBe(detail);
  expect(mock.inspect).toHaveBeenCalledTimes(1);

  // While the model is reloading nothing can be measured. That answer is not remembered:
  store.set({ mode: "unavailable" });
  expect(await actions.floorDetail(at(0, "normal", 5))).toBeNull();
  expect(mock.inspect).toHaveBeenCalledTimes(1);
  // once it is back, the same token is measured.
  store.set({ mode: "live" });
  expect(await actions.floorDetail(at(0, "normal", 5))).not.toBeNull();
  expect(mock.inspect).toHaveBeenCalledTimes(2);
  // A request the worker fails is not remembered either.
  mock.inspect.mockRejectedValueOnce(new Error("The GPU was reset; the model is reloading."));
  await expect(actions.floorDetail(at(0, "normal", 6))).rejects.toThrow("GPU was reset");
  expect(await actions.floorDetail(at(0, "normal", 6))).not.toBeNull();
  expect(mock.inspect).toHaveBeenCalledTimes(4);
});

it("measures a token again when the tokens before it were rewritten, even if it came back the same", async () => {
  await actions.send("Question");
  const before = words.replyMark(reply());
  const first = await actions.floorDetail(at(0, "normal", 8));
  expect(mock.inspect.mock.calls.at(-1)![2]).toEqual([11, 12, ...ids().slice(0, 8)]);
  // A pick at an earlier position rewrites everything after it. The piece at position 8 has the same id as before.
  const same = ids()[8];
  await actions.pick(at(0, "normal", 3), 777);
  expect(ids()[8]).toBe(same);
  expect(ids()).toHaveLength(64);
  const again = await actions.floorDetail(at(0, "normal", 8));
  expect(mock.inspect).toHaveBeenCalledTimes(2);
  expect(mock.inspect.mock.calls.at(-1)![2]).toEqual([11, 12, ...ids().slice(0, 8)]);
  expect(mock.inspect.mock.calls.at(-1)![2][5]).toBe(777);
  expect(again).not.toBe(first);
  // What the 3D view and the inspector key their requests on moves with the rewrite as well,
  // and Undo brings back the reply it restores under the identity that reply had.
  const picked = words.replyMark(reply());
  expect(picked).not.toBe(before);
  actions.undoPick(0, "normal");
  expect(words.replyMark(reply())).toBe(before);
});

it("gives every rewrite its own identity, also when a later pick repeats an earlier one after other tokens", async () => {
  const session = await import("../src/stage/replay-session.ts");
  const out = () => session.outputIdentity({ ...store.get(), word: at(0, "normal", 8) });
  await actions.send("Question");
  const marks = [words.replyMark(reply())], outputs = [out()];
  const note = () => { marks.push(words.replyMark(reply())); outputs.push(out()); };
  // Pick 777 at position 5. Then change position 2, which rewrites everything after it. Then pick 777 at position 5 again.
  await actions.pick(at(0, "normal", 5), 777); note();
  const first = await actions.floorDetail(at(0, "normal", 8));
  const firstContext = mock.inspect.mock.calls.at(-1)![2] as number[];
  await actions.pick(at(0, "normal", 2), 555); note();
  await actions.pick(at(0, "normal", 5), 777); note();
  // The latest pick is the same piece at the same place as the first one, and the piece at position 8 has the same id.
  expect(reply().pickedAt).toBe(5);
  expect(ids()[5]).toBe(777);
  expect(ids()[2]).toBe(555);
  // Each of the four writings has its own identity: nothing keyed on one can be read under another.
  expect(new Set(marks).size).toBe(4);
  expect(new Set(outputs).size).toBe(4);
  // The token at position 8 is measured again, with the tokens that now precede it.
  const calls = mock.inspect.mock.calls.length;
  const second = await actions.floorDetail(at(0, "normal", 8));
  expect(mock.inspect).toHaveBeenCalledTimes(calls + 1);
  const secondContext = mock.inspect.mock.calls.at(-1)![2] as number[];
  expect(secondContext).not.toEqual(firstContext);
  expect(secondContext[2 + 2]).toBe(555);
  expect(second).not.toBe(first);
  // Continue adds tokens after the ones measured, so it keeps the identity. Undo returns to the first writing's.
  const beforeContinue = words.replyMark(reply());
  await actions.continueReply(0);
  expect(reply().toks.length).toBeGreaterThan(64);
  expect(words.replyMark(reply())).toBe(beforeContinue);
  actions.undoPick(0, "normal");
  expect(words.replyMark(reply())).toBe(marks[0]);
  // A new question is a new writing too.
  await actions.send("Another");
  expect(marks).not.toContain(words.replyMark(reply(1)));
});

it("drops a result that arrives for a token that no longer exists, and forgets measurements of an earlier model", async () => {
  await actions.send("Question");
  const slow = deferred<{ guesses: never[]; detail: Map<string, Float32Array> }>();
  mock.inspect.mockReturnValueOnce(slow.promise);
  const pending = actions.floorDetail(at(0, "normal", 8));
  await actions.pick(at(0, "normal", 3), 777);
  slow.resolve({ guesses: [], detail: new Map() });
  expect(await pending).toBeNull();
  // A change to the model starts every measurement over: nothing measured before it is handed out again.
  await actions.floorDetail(at(0, "normal", 1));
  const calls = mock.inspect.mock.calls.length;
  await actions.applyChips(cutLayer); await flush();
  await actions.applyChips({}); await flush();
  await actions.floorDetail(at(0, "normal", 1));
  expect(mock.inspect).toHaveBeenCalledTimes(calls + 1);
});

it("does not offer to continue a reply that fills the context, and says so if asked", async () => {
  expect(actions.contextCap(store.get())).toBe(1024);
  await actions.send("Question");
  const fill = (n: number) => store.set((s) => ({ turns: s.turns.map((t) => ({ ...t, normal: { ...t.normal, toks: Array.from({ length: n }, (_, i) => tok(3000 + i)) } })) }));
  // Two prompt tokens and 1022 written: nothing more fits.
  fill(1022);
  expect(words.contextFull(reply(), actions.contextCap(store.get()))).toBe(true);
  const before = mock.write.mock.calls.length;
  await actions.continueReply(0);
  expect(mock.write).toHaveBeenCalledTimes(before);
  expect(store.get().announce).toBe(S.contextFull);
  expect(store.get().busy).toBe(false);
  // One piece short of full: it continues.
  fill(1021);
  expect(words.contextFull(reply(), actions.contextCap(store.get()))).toBe(false);
  await actions.continueReply(0);
  expect(mock.write).toHaveBeenCalledTimes(before + 1);
  // A model that has not said how much it holds is never called full by the page; the worker still refuses.
  expect(words.contextFull(reply(), undefined)).toBe(false);
});

it("gives a write the room that is left, and an error instead of an empty reply when there is none", () => {
  expect(writeRoom(1024, 30, 64)).toBe(64);
  expect(writeRoom(1024, 1000, 64)).toBe(24);
  expect(writeRoom(1024, 1023, 64)).toBe(1);
  expect(() => writeRoom(1024, 1024, 64)).toThrow("context-full");
  expect(() => writeRoom(1024, 1500, 64)).toThrow("context-full");
  // A request for nothing is a mistake of the page, never a reply that silently loses its end.
  for (const none of [0, -36, Number.NaN]) expect(() => writeRoom(1024, 30, none)).toThrow("at least one piece");
  // What a write leaves in the cache: nothing if no step ran, otherwise the token it started from and all but the newest piece.
  expect(readByWrite(9, [])).toEqual([]);
  expect(readByWrite(9, [4])).toEqual([9]);
  expect(readByWrite(9, [4, 5, 6])).toEqual([9, 4, 5]);
});

it("refuses a change the model has no room for before showing it as active", async () => {
  await actions.send("Question");
  const sixteen = Array.from({ length: 16 }, (_, i) => ({ key: i, from: i + 1 }));
  await actions.applyChips({ hidden: sixteen }); await flush();
  expect(store.get().chips.hidden).toHaveLength(16);
  const version = store.get().version, written = mock.write.mock.calls.length;
  await actions.applyChips({ hidden: [...sixteen, { key: 16, from: 17 }] }); await flush();
  // Nothing changed: the sixteen stay, no reply is rewritten, and the reason is stated.
  expect(store.get().chips.hidden).toHaveLength(16);
  expect(store.get().version).toBe(version);
  expect(mock.write).toHaveBeenCalledTimes(written);
  expect(store.get().error).toContain("At most 16 hidden words");
  await actions.applyChips({ swaps: Array.from({ length: 17 }, (_, i): [number, number] => [i, 100 + i]) });
  expect(store.get().chips.swaps).toBeUndefined();
  expect(store.get().error).toContain("At most 16 dictionary swaps");
});
