// Live inference, interventions and conversation lifecycle. No prerecorded output path.
import { isNeutral } from "@rewire/engine/src/changes.ts";
import type { EngineClient } from "../live/engine.ts";
import type { Cand, ChangeSpec, FloorDetail, Focus, Reply, Side, Tok, Turn, WordRef } from "../model/types.ts";
import { loadPath, type PathData, type StepData, stepChanges } from "../path/steps.ts";
import { S } from "../strings.ts";
import { setDims } from "../ui/word.ts";
import { encode, letter } from "@rewire/tiny/src/data.ts";
import { TINY, type TinyConfig } from "@rewire/tiny/src/config.ts";
import { QWEN_INFO, TINY_INFO } from "../model/info.ts";
import { type DeviceState, store } from "./store.ts";

export const REPLY_CAP = 64;

// ---------------------------------------------------------------- pieces

const pieceText = new Map<number, string>();
const pieceListeners = new Set<() => void>();
export function piece(id: number): string {
  if (store.get().model.id === "tiny") return letter(id);
  return pieceText.get(id) ?? "…";
}
export function onPieces(f: () => void) {
  pieceListeners.add(f);
  return () => {
    pieceListeners.delete(f);
  };
}
function addPieces(entries: Iterable<[number, string]>) {
  for (const [k, v] of entries) pieceText.set(k, v);
  for (const f of pieceListeners) f();
}
async function ensurePieces(ids: number[]) {
  const missing = [...new Set(ids)].filter((i) => !pieceText.has(i));
  if (!missing.length || !engine) return;
  const txt = await engine.pieces(missing);
  addPieces(missing.map((id, i) => [id, txt[i]] as [number, string]));
}

// ---------------------------------------------------------------- experiments

const path: PathData = loadPath();

export function pathData() {
  return path;
}
export function stepData(n: number | null): StepData | undefined {
  return n === null ? undefined : path?.steps.find((s) => s.n === n);
}
export function shippingSteps(): StepData[] {
  return path?.steps ?? [];
}

// ---------------------------------------------------------------- jobs

/** Each side has at most one job writing into it; a newer job for the side cancels the older one. */
const sideJob: Record<Side, number> = { normal: 0, changed: 0 };
let jobSeq = 0;
let navigation = 0;
function claim(side: Side): number {
  sideJob[side] = ++jobSeq;
  return sideJob[side];
}
function current(side: Side, job: number) {
  return sideJob[side] === job;
}
function busy() {
  const t = store.get().turns;
  return t.some((x) => !x.normal.done || (x.changed && !x.changed.done));
}

function emptyReply(changes: ChangeSpec, read: number[], source: Reply["source"]): Reply {
  return { read, toks: [], ended: false, done: false, changes, source };
}

function patchReply(turn: number, side: Side, f: (r: Reply) => Reply) {
  store.set((s) => ({
    turns: s.turns.map((t, i) => {
      if (i !== turn) return t;
      const r = side === "normal" ? t.normal : t.changed;
      if (!r) return t;
      return side === "normal" ? { ...t, normal: f(r) } : { ...t, changed: f(r) };
    }),
  }));
  store.set({ busy: busy() });
}

function pushTok(turn: number, side: Side, tok: Tok) {
  patchReply(turn, side, (r) => ({ ...r, toks: [...r.toks, tok] }));
  const s = store.get();
  // While writing, the tower follows the newest word (the changed side when there is one) until the visitor taps a word.
  const t = s.turns[turn];
  const isStop = tok.id === 151645 || tok.id === 151643;
  if (s.follow && !isStop && (side === "changed" || !t.changed || t.changed.done)) {
    const r = side === "normal" ? t.normal : t.changed!;
    store.set({ word: { turn, side, index: r.toks.length - 1 } });
  }
}

// ---------------------------------------------------------------- the path

export async function openStep(n: number | null) {
  if (store.get().model.id === "tiny") {
    await backToQwen(n);
    return;
  }
  if (stepData(n)?.control.kind === "tiny") {
    stopReply();
    store.set({ tiny: true, pathOpen: false, sheet: false });
    setHash(n);
    return;
  }
  ++navigation;
  engine?.cancel();
  claim("normal");
  claim("changed");
  const s = store.get();
  store.set({
    step: n, stepTried: false, pathOpen: false, chips: {}, version: s.version + 1, turns: [], fork: -1, word: null, follow: true,
    focus: { kind: "word" }, view: "push", tiny: false, busy: false, full: false, sheet: false, error: null,
  });
  engine?.setVersion(store.get().version);
  setHash(n);
  const st = stepData(n);
  if (st?.message && store.get().mode === "live") await send(st.message);
}

/** Select a model modification for an existing live chat without replacing its messages. */
export async function useExperiment(n: number) {
  const s = store.get(), st = stepData(n);
  if (!st || s.busy || s.mode !== "live" || s.model.id !== "qwen" || !canUseInChat(st)) return;
  await applyChips({});
  store.set({ step: n, stepTried: false, pathOpen: false, sheet: false, error: null });
  setHash(n);
}

export function canUseInChat(st: StepData) {
  return !["pick", "guesses", "madeup", "tiny"].includes(st.control.kind);
}

function setHash(n: number | null) {
  const h = n === null ? "" : `#step-${n}`;
  if (location.hash !== h) history.replaceState(null, "", h || location.pathname + location.search);
}

/** The step's control was used. */
export async function stepAction(stop?: number) {
  const s = store.get();
  const st = stepData(s.step);
  if (!st || s.mode !== "live" || s.busy) return;
  const c = st.control;
  const turn = s.turns.length - 1;
  if (c.kind === "pick") {
    const t = s.turns[turn];
    if (!t) return;
    const candidates = t.normal.toks.map((tok, index) => ({ tok, index }));
    const at = candidates.find((x) => x.index >= c.index && x.tok.cands[c.rank - 1]?.id !== x.tok.id && x.tok.cands[c.rank - 1]?.p > 0)
      ?? candidates.find((x) => x.tok.cands[c.rank - 1]?.id !== x.tok.id && x.tok.cands[c.rank - 1]?.p > 0);
    if (!at) { store.set({ error: "This reply has no third candidate to try. Ask another question." }); return; }
    await pick({ turn, side: "normal", index: at.index }, at.tok.cands[c.rank - 1].id);
    store.set({ stepTried: true });
    return;
  }
  if (c.kind === "guesses" || c.kind === "madeup") {
    const last = (s.turns[turn]?.normal.toks.map((t, i) => [151643, 151645].includes(t.id) ? -1 : i).filter((i) => i >= 0).at(-1)) ?? -1;
    if (last < 0) return;
    store.set({ word: { turn, side: "normal", index: Math.min(c.index, last) }, focus: c.kind === "guesses" ? { kind: "words-out" } : { kind: "word" }, stepTried: true, sheet: true, inspectView: "word" });
    return;
  }
  if (c.kind === "floors") {
    // stop encodes floor * 100 + multiplier index; the floors' knobs set chips directly
    return;
  }
  const spec = stepChanges(c, stop);
  await applyChips(spec);
  store.set({ stepTried: true });

}

// ---------------------------------------------------------------- changes and the fork rule

export function chipsWith(f: (c: ChangeSpec) => ChangeSpec) {
  return applyChips(f(structuredClone(store.get().chips)));
}

/** Sets the chips. The first change forks at the latest message; a later change re-forks there. */
export async function applyChips(spec: ChangeSpec) {
  const s = store.get();
  if (s.mode !== "live" || !engine) return;
  if (s.model.id === "qwen" && spec.swaps?.length) {
    const visit = navigation;
    try { await ensurePieces(spec.swaps.flat()); }
    catch (e) { if (visit === navigation) endWithError(e); return; }
    if (visit !== navigation || store.get().version !== s.version || store.get().mode !== "live") return;
  }
  const version = s.version + 1;
  engine?.setVersion(version);
  claim("changed");
  if (isNeutral(spec)) {
    store.set({ chips: {}, version, fork: -1, view: "push", turns: s.turns.map((t) => ({ ...t, changed: undefined })) });
    const w = store.get().word;
    if (w?.side === "changed") store.set({ word: { ...w, side: "normal" } });
    store.set({ busy: busy() });
    return;
  }
  const last = s.turns.length - 1;
  const turns = s.turns.map((t, i): Turn => {
    if (i < last) return t.changed ? { ...t, changed: { ...t.changed, stale: true } } : t;
    return { ...t, changed: emptyReply(spec, t.normal.read, "live") };
  });
  store.set({ chips: spec, version, turns, fork: last, busy: last >= 0, follow: true });
  if (last >= 0) {
    try { await writeChanged(last, version); }
    catch (e) { if (store.get().version === version) endWithError(e); }
  }
}

/** Tokens the given side has read before turn k's reply. */
function historyBefore(k: number, side: Side, turns = store.get().turns, fork = store.get().fork): number[] {
  const out: number[] = [];
  for (let i = 0; i <= k; i++) {
    const t = turns[i];
    const r = side === "changed" && i >= fork && t.changed ? t.changed : t.normal;
    out.push(...r.read);
    if (i < k) out.push(...r.toks.map((x) => x.id));
  }
  return out;
}

async function writeChanged(k: number, version: number) {
  if (!engine || store.get().mode !== "live" || store.get().version !== version) return;
  await writeChangedLive(k);
}

/** The changed model fed the normal reply: underlines and the Difference view. */
async function compareTurn(k: number, version: number) {
  const s = store.get();
  const t = s.turns[k];
  if (!engine || !t?.changed || !t.normal.done) return;
  const history = historyBefore(k, "changed");
  // the changed side's own history up to this turn's read, then the normal reply
  const forced = await engine.compare(2, s.chips, history, t.normal.toks.map((x) => x.id), version);
  if (!forced || store.get().version !== version) return;
  patchReply(k, "changed", (r) => ({ ...r, compare: forced }));
}

// ---------------------------------------------------------------- talking

export async function send(message: string) {
  const text = message.trim();
  if (!text || !engine || store.get().mode !== "live") return;
  const s = store.get();
  if (s.busy) return;
  const visit = navigation;
  // Lock before tokenization, so a double submit cannot create two turns with the same history.
  store.set({ busy: true, error: null, full: false });
  try {
    if (s.model.id === "tiny") { await sendTiny(message); return; }
    const k = s.turns.length;
    const forked = !isNeutral(s.chips);
    const prevN = k ? s.turns[k - 1].normal.toks.map((x) => x.id) : null;
    const readN = prevN ? await engine.nextTurn(prevN, text) : await engine.firstTurn(text);
    let readC = readN;
    if (forked && k) {
      const p = s.turns[k - 1];
      const prev = s.fork >= 0 && k - 1 >= s.fork && p.changed ? p.changed : p.normal;
      readC = await engine.nextTurn(prev.toks.map((x) => x.id), text);
    }
    await ensurePieces([...readN, ...readC]);
    if (visit !== navigation) return;
    const fork = forked ? (s.fork >= 0 ? s.fork : k) : -1;
    store.set({
      turns: [...s.turns, { user: text, seed: s.seed, temperature: s.temperature, normal: emptyReply({}, readN, "live"), changed: forked ? emptyReply(s.chips, readC, "live") : undefined }],
      fork, busy: true, word: null, follow: true,
    });
    await Promise.all([writeNormal(k), forked ? writeChangedLive(k) : Promise.resolve()]);
  } catch (e) {
    if (visit === navigation) endWithError(e);
  }
}

/** A failed write: the context limit offers a fresh start; anything else is announced. */
function endWithError(e: unknown) {
  const msg = String((e as Error)?.message ?? e);
  store.set((s) => ({
    turns: s.turns.map((t) => ({ ...t, normal: { ...t.normal, done: true }, changed: t.changed && { ...t.changed, done: true } })),
    busy: false, full: msg.includes("context-full") ? true : s.full, announce: msg.includes("context-full") ? S.contextFull : msg,
    error: msg.includes("context-full") ? null : msg,
  }));
}

export function freshStart() {
  setHash(null);
  navigation++;
  engine?.cancel();
  claim("normal");
  claim("changed");
  store.set((s) => ({ turns: [], fork: -1, word: null, step: null, stepTried: false, full: false, busy: false, follow: true, sheet: false, error: null, version: s.version + 1 }));
  engine?.setVersion(store.get().version);
}

export function stopReply() {
  navigation++;
  engine?.cancel();
  claim("normal"); claim("changed");
  store.set((s) => ({ busy: false, turns: s.turns.map((t) => ({ ...t,
    normal: { ...t.normal, done: true }, changed: t.changed && { ...t.changed, done: true } })),
    announce: "Stopped. You can continue the reply or ask another question." }));
}

/** The tiny model continues the text you type (letters, no chat template). Each message starts fresh. */
async function sendTiny(message: string) {
  const s = store.get();
  const read = Array.from(encode(message));
  if (!read.length) return;
  const forked = !isNeutral(s.chips);
  claim("normal");
  claim("changed");
  store.set({
    turns: [{ user: message, seed: s.seed, temperature: s.temperature, normal: emptyReply({}, read, "live"), changed: forked ? emptyReply(s.chips, read, "live") : undefined }],
    fork: forked ? 0 : -1, busy: true, word: null,
  });
  await Promise.all([writeNormal(0, [], undefined, TINY_INFO.replyCap), forked ? writeChangedLive(0, [], undefined, TINY_INFO.replyCap) : Promise.resolve()]);
}

let tinyParams: Float32Array | null = null;

/** Hands the trained tiny model to the engine and shows it in the same screen. */
export async function openTiny(params: Float32Array) {
  stopReply();
  tinyParams = params;
  if (!engine) {
    const { EngineClient } = await import("../live/engine.ts");
    engine = new EngineClient();
    connectEngine(engine);
  }
  const cfg: TinyConfig = { ...TINY, vocab: TINY_INFO.vocab };
  await engine.loadTiny(params.slice(), cfg);
  await engine.use("tiny");
  claim("normal");
  claim("changed");
  setDims(TINY_INFO);
  const s = store.get();
  store.set({ model: TINY_INFO, tiny: false, mode: "live", step: null, chips: {}, version: s.version + 1, turns: [], fork: -1, word: null,
    focus: { kind: "word" }, view: "push", qwenMode: s.model.id === "qwen" ? s.mode : s.qwenMode, busy: false, full: false, error: null, sheet: false });
  engine.setVersion(store.get().version);
  setHash(null);
}

export async function backToQwen(n: number | null = null) {
  stopReply();
  claim("normal");
  claim("changed");
  await engine?.use("qwen");
  setDims(QWEN_INFO);
  const s = store.get();
  store.set({ model: QWEN_INFO, mode: s.qwenMode ?? s.mode, chips: {}, version: s.version + 1, turns: [], fork: -1, word: null, focus: { kind: "word" }, busy: false, full: false, error: null });
  await openStep(n);
}

export function hasTiny() {
  return tinyParams !== null;
}

async function writeNormal(k: number, prefix: Tok[] = [], force?: number, cap = REPLY_CAP) {
  if (!engine) return;
  const s = store.get();
  const job = claim("normal");
  patchReply(k, "normal", (r) => ({ ...r, source: "live" }));
  const history = historyBefore(k, "normal");
  const res = await engine.write({ conv: 0, changes: {}, history, prefix: prefix.map((x) => x.id), force, seed: s.turns[k]?.seed ?? s.seed, turn: k, cap,
    temperature: s.turns[k]?.temperature ?? s.temperature, version: -1 }, (tok) => { if (current("normal", job)) pushTok(k, "normal", tok); });
  if (!current("normal", job)) return;
  patchReply(k, "normal", (r) => ({ ...r, done: true, ended: res.ended }));
  const t = store.get().turns[k];
  if (t.changed?.done && !t.changed.stale) await compareTurn(k, store.get().version);
}

async function writeChangedLive(k: number, prefix: Tok[] = [], force?: number, cap = REPLY_CAP) {
  if (!engine) return;
  const s = store.get();
  const job = claim("changed");
  const version = s.version;
  patchReply(k, "changed", (r) => ({ ...r, source: "live" }));
  const history = historyBefore(k, "changed");
  const res = await engine.write({ conv: 1, changes: s.chips, history, prefix: prefix.map((x) => x.id), force, seed: s.turns[k]?.seed ?? s.seed, turn: k,
    cap, temperature: s.turns[k]?.temperature ?? s.temperature, version }, (tok) => { if (current("changed", job)) pushTok(k, "changed", tok); });
  if (!current("changed", job) || res.cancelled) return;
  patchReply(k, "changed", (r) => ({ ...r, done: true, ended: res.ended }));
  if (store.get().turns[k].normal.done) await compareTurn(k, version);
}

/** Continue: up to 64 more pieces for the latest turn, on both sides. */
export async function continueReply() {
  const s = store.get();
  const k = s.turns.length - 1;
  if (k < 0 || s.mode !== "live" || s.busy) return;
  const visit = navigation;
  try {
    await continueInner(s, k);
  } catch (e) {
    if (visit === navigation) endWithError(e);
  }
}

async function continueInner(s: ReturnType<typeof store.get>, k: number) {
  const t = s.turns[k];
  const jobs: Promise<void>[] = [];
  if (!t.normal.ended) {
    patchReply(k, "normal", (r) => ({ ...r, done: false }));
    jobs.push(writeNormal(k, t.normal.toks, undefined, REPLY_CAP));
  }
  if (t.changed && !t.changed.ended && !t.changed.stale) {
    patchReply(k, "changed", (r) => ({ ...r, done: false, compare: undefined }));
    jobs.push(writeChangedLive(k, t.changed.toks, undefined, REPLY_CAP));
  }
  await Promise.all(jobs);
}

/** Forcing a word: the reply is rewritten from that word on. Not a change to the model, so no chip. */
export async function pick(w: WordRef, candId: number) {
  const visit = navigation;
  try { await pickInner(w, candId, visit); }
  catch (e) { if (visit === navigation) endWithError(e); }
}

async function pickInner(w: WordRef, candId: number, visit: number) {
  const s = store.get();
  const t = s.turns[w.turn];
  const r = w.side === "normal" ? t?.normal : t?.changed;
  if (!r || !r.done || s.busy || s.mode !== "live" || w.turn !== s.turns.length - 1) return;
  const original = r.original ?? r;
  const keep = r.toks.slice(0, w.index);
  if (!engine) return;
  patchReply(w.turn, w.side, (x) => ({ ...x, original, toks: keep, done: false, ended: false, pickedAt: w.index, compare: undefined }));
  const mark = (tok: Tok) => tok;
  const cap = REPLY_CAP - 0;
  if (w.side === "normal") await writeNormal(w.turn, keep, candId, cap - keep.length);
  else await writeChangedLive(w.turn, keep, candId, cap - keep.length);
  if (visit !== navigation) return;
  patchReply(w.turn, w.side, (x) => ({ ...x, toks: x.toks.map((tk, i) => (i === w.index ? mark({ ...tk, picked: true }) : tk)) }));
}

export function undoPick(turn: number, side: Side) {
  claim(side);
  patchReply(turn, side, (r) => (r.original ? { ...r.original } : r));
}

// ---------------------------------------------------------------- inspection

const details = new Map<string, Promise<FloorDetail | null>>();

/** Recompute the selected token with its actual context and interventions. */
export function floorDetail(w: WordRef): Promise<FloorDetail | null> {
  const s = store.get();
  const visit = navigation;
  const t = s.turns[w.turn];
  const r = w.side === "normal" ? t?.normal : t?.changed;
  if (!r || r.stale || !r.toks[w.index]) return Promise.resolve(null);
  const key = `${s.version}:${w.turn}:${w.side}:${w.index}:${r.toks.length}:${r.toks[w.index].id}`;
  let p = details.get(key);
  if (p) return p;
  p = (async () => {
    if (!engine || s.mode !== "live") return null;
    const tokens = [...historyBefore(w.turn, w.side), ...r.toks.slice(0, w.index).map((x) => x.id)];
    const res = await engine.inspect(w.side === "normal" ? 0 : 2, r.changes, tokens, r.toks[w.index].id);
    if (visit !== navigation || store.get().version !== s.version) return null;
    patchReply(w.turn, w.side, (x) => ({ ...x, toks: x.toks.map((tk, i) => (i === w.index && !tk.guesses ? { ...tk, guesses: res.guesses } : tk)) }));
    await ensurePieces(res.guesses.flat().map((c: Cand) => c.id));
    return res.detail;
  })();
  p.catch(() => details.delete(key));
  details.set(key, p);
  if (details.size > 24) details.delete(details.keys().next().value!);
  return p;
}

/** A head's full attention map for the word's reply, up to and including the word's position (live only). */
export async function attentionMap(w: WordRef, floor: number, head: number): Promise<{ map: Float32Array; tokens: number[] } | null> {
  const s = store.get();
  const t = s.turns[w.turn];
  const r = w.side === "normal" ? t?.normal : t?.changed;
  if (!engine || s.mode !== "live" || !r || r.stale) return null;
  const tokens = [...historyBefore(w.turn, w.side), ...r.toks.slice(0, w.index).map((x) => x.id)];
  const map = await engine.attentionMap(w.side === "normal" ? 0 : 2, r.changes, tokens, floor, head);
  return { map, tokens };
}

export function selectWord(w: WordRef | null, focus?: Focus) {
  store.set({ word: w, follow: false, focus: focus ?? { kind: "word" }, sheet: true, inspectView: "word" });
}

export function setFocus(focus: Focus) {
  store.set((s) => ({ focus, sheet: true, inspectView: s.inspectView === "model" && !matchMedia("(max-width: 1000px)").matches ? "model" : "word" }));
}

// ---------------------------------------------------------------- device check and the live model

let engine: EngineClient | null = null;
export function liveEngine() {
  return engine;
}

function isPhone() {
  return matchMedia("(pointer: coarse)").matches && Math.min(screen.width, screen.height) < 820;
}

function setDevice(d: DeviceState) {
  store.set({ device: d });
}

let initialization: Promise<void> | null = null;

/** Loading is the default. Concurrent starts/retries share one initialization. */
export function checkDevice(): Promise<void> {
  if (initialization) return initialization;
  if (store.get().device.kind === "ready") return Promise.resolve();
  initialization = initialize().finally(() => { initialization = null; });
  return initialization;
}

async function initialize() {
  if (!("gpu" in navigator)) { setDevice({ kind: "no-webgpu" }); return; }
  setDevice({ kind: "checking" });
  try {
    const { EngineClient } = await import("../live/engine.ts");
    if (!engine) { engine = new EngineClient(); connectEngine(engine); }
    const r = await engine.check();
    if (!r.webgpu) { setDevice({ kind: "no-webgpu" }); return; }
    engine.pause(false);
    setDevice({ kind: "downloading", loaded: 0, total: 0, paused: false, seconds: r.seconds });
    const info = await engine.load(weightsBase(), isPhone(), path.manifest_hash);
    void navigator.storage?.persist?.().catch(() => false);
    setDevice({ kind: "ready", seconds: r.seconds });
    store.set({ mode: "live", qwenMode: "live", modelStored: info.stored, announce: S.ready });
    await runPendingExperiment();
    if (new URLSearchParams(location.search).has("bench")) {
      const result = await engine.bench();
      store.set({ bench: { device_check_predicted_s: r.seconds, ...result, userAgent: navigator.userAgent } });
    }
  } catch (e) {
    if (store.get().device.kind === "recovering") return;
    const message = String((e as Error).message ?? e);
    setDevice({ kind: "error", message });
    store.set((s) => ({ mode: s.model.id === "tiny" ? s.mode : "unavailable", qwenMode: "unavailable" }));
  }
}

function weightsBase() {
  const b = (import.meta.env.VITE_WEIGHTS_URL as string | undefined) ?? `${location.origin}/weights/`;
  return b.endsWith("/") ? b : b + "/";
}

/** An explicitly selected preset waits for the model, never substitutes a saved answer. */
async function runPendingExperiment() {
  const s = store.get(), st = stepData(s.step);
  if (!s.tiny && s.model.id === "qwen" && s.mode === "live" && !s.busy && !s.turns.length && st?.message) await send(st.message);
}

/** One reset cancels current writes; the rebuilt worker re-reads their tokens when Continue is used. */
function connectEngine(client: EngineClient) {
  let before: ReturnType<typeof store.get> | null = null;
  client.onProgress = (loaded, total) => {
    const d = store.get().device;
    if (d.kind !== "downloading") return;
    setDevice(loaded >= total && total > 0 ? { kind: "loading", seconds: d.seconds } : { ...d, loaded, total });
  };
  client.onPieces = addPieces;
  client.onLost = () => {
    before = store.get();
    navigation++;
    claim("normal"); claim("changed");
    endWithError(S.recovering);
    store.set((s) => ({ mode: "unavailable", device: { kind: "recovering" }, version: s.version + 1 }));
    client.setVersion(store.get().version);
  };
  client.onRecovered = () => {
    const prior = before;
    before = null;
    const loading = prior?.device.kind === "downloading" || prior?.device.kind === "loading" ? prior.device : null;
    store.set({
      mode: loading ? "live" : prior?.mode ?? "unavailable",
      device: loading ? { kind: "ready", seconds: loading.seconds } : prior?.device ?? { kind: "ready", seconds: 0 },
      qwenMode: loading ? "live" : prior?.qwenMode,
      announce: S.recovered,
      error: null,
    });
    void runPendingExperiment();
  };
  client.onFailure = (message) => {
    navigation++;
    claim("normal"); claim("changed");
    endWithError(message);
    store.set({ mode: "unavailable", device: { kind: "error", message }, qwenMode: "unavailable" });
  };
}

export function pauseDownload(paused: boolean) {
  const d = store.get().device;
  if (d.kind !== "downloading") return;
  engine?.pause(paused);
  setDevice({ ...d, paused });
}

// ---------------------------------------------------------------- start

export async function start() {
  const m = /^#step-(\d+)$/.exec(location.hash);
  const n = m ? Number(m[1]) : null;
  const exists = path?.steps.some((s) => s.n === n);
  if (m && !exists) store.set({ pathOpen: true });
  await Promise.all([openStep(exists ? n : null), checkDevice()]);
  addEventListener("hashchange", () => {
    const mm = /^#step-(\d+)$/.exec(location.hash);
    if (!mm) return;
    const k = Number(mm[1]);
    if (path?.steps.some((s) => s.n === k)) void openStep(k);
    else store.set({ pathOpen: true });
  });
}
