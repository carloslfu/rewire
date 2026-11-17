// What the inspector shows is always of the thing it is showing. A full attention map asked for one
// head must never be drawn under another head or token, and a layer's numbers asked for while the
// model was reloading are asked for again when it is back. The real hooks run in a real React root.
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { FloorDetail, Tok, Turn } from "../src/model/types.ts";

const mock = vi.hoisted(() => ({ floorDetail: vi.fn() }));
vi.mock("../src/state/actions.ts", async (original) => ({ ...(await original<typeof import("../src/state/actions.ts")>()), floorDetail: mock.floorDetail }));

let store: typeof import("../src/state/store.ts").store;
let useStore: typeof import("../src/state/store.ts").useStore;
let initial: typeof import("../src/state/store.ts").initial;
let useDetail: typeof import("../src/ui/Detail.tsx").useDetail;
let useFullMap: typeof import("../src/ui/Detail.tsx").useFullMap;
let words: typeof import("../src/ui/word.ts");
let root: Root;

type FullMap = { map: Float32Array; tokens: number[] };
const tok = (id: number): Tok => ({ id, lp1: -0.1, concept: 0, cut: 1, cands: [{ id, p: 1 }], pushes: new Float32Array(4) });
/** A finished reply as the actions leave it: `rev` is new for every writing, whatever the latest pick was. */
const turn = (ids: number[], rev = 1, pickedAt?: number): Turn => ({ id: 1, user: "Capital of France?", seed: 1, temperature: 0.7,
  normal: { read: [5], toks: ids.map(tok), ended: true, done: true, changes: {}, source: "live", rev, ...(pickedAt === undefined ? {} : { pickedAt }) } });
const deferred = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>((r) => { resolve = r; }); return { promise, resolve }; };
const settle = () => new Promise((r) => setTimeout(r, 30));

beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();
  const noop = () => {};
  const doc: Record<string, unknown> = { nodeType: 9, addEventListener: noop, removeEventListener: noop, activeElement: null };
  const container = { nodeType: 1, tagName: "DIV", namespaceURI: "http://www.w3.org/1999/xhtml", addEventListener: noop, removeEventListener: noop, ownerDocument: doc };
  const win = { event: undefined, document: doc, HTMLIFrameElement: class {} };
  doc.defaultView = win; doc.documentElement = container;
  vi.stubGlobal("window", win);
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener: noop, removeEventListener: noop }));
  ({ store, useStore, initial } = await import("../src/state/store.ts"));
  store.set({ ...initial, mode: "live", turns: [turn([100, 101, 102])], word: { turn: 0, side: "normal", index: 1 }, follow: false });
  ({ useDetail, useFullMap } = await import("../src/ui/Detail.tsx"));
  words = await import("../src/ui/word.ts");
  root = createRoot(container as unknown as Element);
});
afterEach(async () => { root.unmount(); await settle(); vi.unstubAllGlobals(); });

it("never draws a full attention map under a head or token it was not computed for", async () => {
  // One request per identity, answered when the test says so, as a slow GPU pass would be.
  const pending = new Map<string, ReturnType<typeof deferred<FullMap | null>>>();
  const compute = (id: string) => () => { const d = deferred<FullMap | null>(); pending.set(id, d); return d.promise; };
  const mapOf = (mark: number): FullMap => ({ map: new Float32Array([mark]), tokens: [5] });
  let id = "head 3";
  let now!: ReturnType<typeof useFullMap>, rerender!: () => void;
  function Panel() {
    const tick = useStore((s) => s.announce);
    void tick;
    rerender = () => store.set({ announce: `${id} ${Math.random()}` });
    now = useFullMap(id, compute(id));
    return null;
  }
  const show = async (next: string) => { id = next; rerender(); await settle(); };
  root.render(<Panel />);
  await settle();
  expect(now).toMatchObject({ map: null, computing: false, failed: false });
  // The visitor asks for head 3's map, then looks at head 7 before it arrives.
  now.ask(); await settle();
  expect(now.computing).toBe(true);
  await show("head 7");
  expect(now).toMatchObject({ map: null, computing: false, failed: false });
  pending.get("head 3")!.resolve(mapOf(3)); await settle();
  // Head 3's map has arrived. Head 7 shows no map, and is not waiting for one it never asked for.
  expect(now).toMatchObject({ map: null, computing: false, failed: false });
  // Asked for under head 7, it is head 7's own.
  now.ask(); await settle();
  expect(now.computing).toBe(true);
  pending.get("head 7")!.resolve(mapOf(7)); await settle();
  expect(now.map?.map[0]).toBe(7);
  // Back on head 3 nothing is drawn from memory under another name, and the same holds for another token of the same head.
  await show("head 3");
  expect(now.map).toBeNull();
  await show("head 7, next token");
  expect(now.map).toBeNull();
  // A map that cannot be computed is reported for the head it was asked for, and asking again tries again.
  now.ask(); await settle();
  pending.get("head 7, next token")!.resolve(null); await settle();
  expect(now).toMatchObject({ map: null, computing: false, failed: true });
  now.ask(); await settle();
  expect(now).toMatchObject({ computing: true, failed: false });
  pending.get("head 7, next token")!.resolve(mapOf(8)); await settle();
  expect(now.map?.map[0]).toBe(8);
});

it("asks for a layer's numbers again when the model is back, and after a pick rewrote the tokens before this one", async () => {
  const detail = (mark: number) => new Map([["f0.x", new Float32Array([mark])]]) as FloorDetail;
  let now!: ReturnType<typeof useDetail>;
  function Inspector() {
    const turns = useStore((s) => s.turns), word = useStore((s) => s.word), fork = useStore((s) => s.fork);
    now = useDetail(words.chosen({ turns, word, fork }));
    return null;
  }
  // The device is lost while the first request is out: the worker has nothing to answer with.
  mock.floorDetail.mockResolvedValueOnce(null);
  root.render(<Inspector />);
  await settle();
  expect(mock.floorDetail).toHaveBeenCalledTimes(1);
  expect(now).toMatchObject({ detail: null, loading: false });
  store.set({ mode: "unavailable" }); await settle();
  expect(now).toMatchObject({ detail: null, loading: false });
  expect(mock.floorDetail).toHaveBeenCalledTimes(1);
  // The model is ready again. The token on screen is the same token, and it is measured now.
  mock.floorDetail.mockResolvedValueOnce(detail(1));
  store.set({ mode: "live" }); await settle();
  expect(mock.floorDetail).toHaveBeenCalledTimes(2);
  expect(now.detail?.get("f0.x")).toEqual(new Float32Array([1]));
  // A pick at the first piece rewrites the reply. The selected piece came back with the same id, after other tokens.
  mock.floorDetail.mockResolvedValueOnce(detail(2));
  store.set({ turns: [turn([777, 101, 102], 2, 0)] }); await settle();
  expect(mock.floorDetail).toHaveBeenCalledTimes(3);
  expect(now.detail?.get("f0.x")).toEqual(new Float32Array([2]));
  // Nothing else changed: nothing is asked again.
  store.set({ announce: "unrelated" }); await settle();
  expect(mock.floorDetail).toHaveBeenCalledTimes(3);
});

it("measures again after a repeated pick: the same piece picked at the same place after different earlier tokens", async () => {
  const detail = (mark: number) => new Map([["f0.x", new Float32Array([mark])]]) as FloorDetail;
  let now!: ReturnType<typeof useDetail>;
  const keys: string[] = [];
  function Inspector() {
    const turns = useStore((s) => s.turns), word = useStore((s) => s.word), fork = useStore((s) => s.fork);
    const c = words.chosen({ turns, word, fork });
    now = useDetail(c);
    // What the attention map and the 3D view key on, built as they build it.
    if (c) keys.push(`${c.ref.index}.${c.tok.id}.${c.reply.toks.length}.${words.replyMark(c.reply)}`);
    return null;
  }
  // Token 102 is selected. The reply was picked at position 1 (id 900) after token 100.
  mock.floorDetail.mockResolvedValueOnce(detail(1));
  store.set({ turns: [turn([100, 900, 102], 2, 1)], word: { turn: 0, side: "normal", index: 2 } });
  root.render(<Inspector />);
  await settle();
  expect(now.detail?.get("f0.x")).toEqual(new Float32Array([1]));
  const first = keys.at(-1);
  // After another pick at position 0 and the same pick at position 1 again, the page shows this in one
  // update: the latest pick, the selected token and the length are all what they were. Only the first token differs.
  mock.floorDetail.mockResolvedValueOnce(detail(2));
  store.set({ turns: [turn([555, 900, 102], 4, 1)] });
  // Nothing of the first measurement is shown under the new tokens, not even while the new one is on its way.
  await Promise.resolve();
  expect(now.detail).toBeNull();
  await settle();
  expect(mock.floorDetail).toHaveBeenCalledTimes(2);
  expect(now.detail?.get("f0.x")).toEqual(new Float32Array([2]));
  expect(keys.at(-1)).not.toBe(first);
});
