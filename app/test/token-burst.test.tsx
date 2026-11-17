// Tokens can arrive faster than React finishes its deferred work: the tiny model writes 160 letters
// in one burst of worker messages. Every token is a synchronous store update. A component that also
// sets state in an effect after each of them is counted by React as an update loop, and the 51st
// token throws "Maximum update depth exceeded" from inside the store update. These tests mount the
// real hooks in a real React root (no page: the components render nothing) and write such a burst.
import { useEffect, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { FloorDetail, Tok, Turn } from "../src/model/types.ts";

let store: typeof import("../src/state/store.ts").store;
let useStore: typeof import("../src/state/store.ts").useStore;
let initial: typeof import("../src/state/store.ts").initial;
let useMeasured: typeof import("../src/stage/useMeasured.ts").useMeasured;
let useDetail: typeof import("../src/ui/Detail.tsx").useDetail;
let words: typeof import("../src/ui/word.ts");
let root: Root;

const tok = (id: number): Tok => ({ id, lp1: -0.1, concept: 0, cut: 1, cands: [{ id, p: 1 }], pushes: new Float32Array(4) });
const writing = (n: number, done = false): Turn => ({ id: 1, user: "red circle = ", seed: 1, temperature: 0.7,
  normal: { read: [5], toks: Array.from({ length: n }, (_, i) => tok(100 + i)), ended: done, done, changes: {}, source: "live" } });
/** One token arrives: the reply grows and following selects it, as pushTok does. Only microtasks run before the next. */
async function burst(count: number, from = 1) {
  for (let i = from; i < from + count; i++) {
    store.set({ turns: [writing(i)], busy: true });
    store.set({ word: { turn: 0, side: "normal", index: i - 1 } });
    for (let k = 0; k < 8; k++) await Promise.resolve();
  }
}
const settle = () => new Promise((r) => setTimeout(r, 30));

beforeEach(async () => {
  vi.resetModules();
  const noop = () => {};
  const doc: Record<string, unknown> = { nodeType: 9, addEventListener: noop, removeEventListener: noop, activeElement: null };
  const container = { nodeType: 1, tagName: "DIV", namespaceURI: "http://www.w3.org/1999/xhtml", addEventListener: noop, removeEventListener: noop, ownerDocument: doc };
  const win = { event: undefined, document: doc, HTMLIFrameElement: class {} };
  doc.defaultView = win; doc.documentElement = container;
  vi.stubGlobal("window", win);
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener: noop, removeEventListener: noop }));
  ({ store, useStore, initial } = await import("../src/state/store.ts"));
  store.set({ ...initial, mode: "live" });
  ({ useMeasured } = await import("../src/stage/useMeasured.ts"));
  ({ useDetail } = await import("../src/ui/Detail.tsx"));
  words = await import("../src/ui/word.ts");
  root = createRoot(container as unknown as Element);
});
afterEach(async () => { root.unmount(); await settle(); vi.unstubAllGlobals(); });

it("shows what goes wrong: setting state after every token of a burst is thrown by React as an update loop", async () => {
  function Old() {
    const word = useStore((s) => s.word);
    const [, setDetail] = useState<{ state: string }>({ state: "none" });
    // What the 3D view did for a reply still being written: "nothing", again, as a new object.
    useEffect(() => { setDetail({ state: "none" }); }, [word?.index]);
    return null;
  }
  root.render(<Old />);
  await settle();
  await expect(burst(160)).rejects.toThrow("Maximum update depth exceeded");
  // It is thrown out of the store update itself, so the token that hit it was only half handled.
  expect(store.get().turns[0].normal.toks.length).toBeLessThan(60);
});

it("measures nothing and sets no state while a reply is written, however fast the tokens arrive", async () => {
  let renders = 0, jobs = 0;
  const seen: string[] = [];
  function Stage() {
    const turns = useStore((s) => s.turns), word = useStore((s) => s.word), fork = useStore((s) => s.fork), version = useStore((s) => s.version);
    const c = words.chosen({ turns, word, fork });
    const key = c ? `${version}.${c.ref.index}.${c.reply.toks.length}` : "";
    // As DismantleStage asks: a layer is selected, and the reply can be measured once it is finished.
    const detail = useMeasured<FloorDetail>(key, !!c && c.reply.done, false, async () => { jobs++; return new Map() as FloorDetail; });
    renders++;
    seen.push(detail.state);
    return null;
  }
  root.render(<Stage />);
  await settle();
  const before = renders;
  await burst(160);
  expect(store.get().turns[0].normal.toks).toHaveLength(160);
  expect(store.get().word).toEqual({ turn: 0, side: "normal", index: 159 });
  // One render per token and none besides, nothing measured, and nothing but "none" was ever shown.
  expect(renders - before).toBe(160);
  expect(jobs).toBe(0);
  expect(new Set(seen)).toEqual(new Set(["none"]));
  // Burst after burst, as with Continue: still no loop.
  await burst(160, 161);
  await burst(160, 321);
  expect(store.get().turns[0].normal.toks).toHaveLength(480);
  // The reply finishes: now it is measured, once, for the selected token.
  store.set({ turns: [writing(480, true)], busy: false });
  await settle();
  expect(jobs).toBe(1);
  expect(seen.at(-1)).toBe("ready");
});

it("keeps the 2D inspector out of the same loop when it is open over a reply being written", async () => {
  let renders = 0;
  const shown: boolean[] = [];
  function Inspector() {
    const turns = useStore((s) => s.turns), word = useStore((s) => s.word), fork = useStore((s) => s.fork);
    const d = useDetail(words.chosen({ turns, word, fork }));
    renders++;
    shown.push(d.loading || !!d.detail);
    return null;
  }
  root.render(<Inspector />);
  await settle();
  const before = renders;
  await burst(160);
  expect(store.get().turns[0].normal.toks).toHaveLength(160);
  expect(renders - before).toBe(160);
  expect(shown.every((x) => !x)).toBe(true);
});

it("still delivers a measurement only for the token it was made for, and holds or drops it as asked", async () => {
  const pending: ((d: FloorDetail | null) => void)[] = [];
  let props = { key: "a", enabled: true, hold: false };
  const seen: string[] = [];
  let rerender!: () => void;
  function Probe() {
    const [, tick] = useState(0);
    rerender = () => tick((n) => n + 1);
    const d = useMeasured<FloorDetail>(props.key, props.enabled, props.hold, () => new Promise((r) => { pending.push(r); }));
    seen.push(d.state === "none" ? "none" : `${d.state}:${d.key}`);
    return null;
  }
  const apply = async (next: Partial<typeof props>) => { props = { ...props, ...next }; rerender(); await settle(); };
  root.render(<Probe />);
  await settle();
  expect(seen.at(-1)).toBe("loading:a");
  // Another token is selected before the first result arrives: the late result is dropped.
  await apply({ key: "b" });
  pending[0](new Map() as FloorDetail); await settle();
  expect(seen.at(-1)).toBe("loading:b");
  pending[1](new Map() as FloorDetail); await settle();
  expect(seen.at(-1)).toBe("ready:b");
  // Held (a whole answer playing): the finished measurement stays for its own token and starts nothing new.
  await apply({ hold: true });
  expect(seen.at(-1)).toBe("ready:b");
  await apply({ key: "c" });
  expect(seen.at(-1)).toBe("none");
  expect(pending).toHaveLength(2);
  // Released (paused): the token on screen is measured. A failed measurement says so.
  await apply({ hold: false });
  expect(seen.at(-1)).toBe("loading:c");
  pending[2](null); await settle();
  expect(seen.at(-1)).toBe("unavailable:c");
  await apply({ enabled: false });
  expect(seen.at(-1)).toBe("none");
});
