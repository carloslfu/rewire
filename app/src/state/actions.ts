// What the page does: plays recordings, drives the live engine, and applies the fork rule (section 4.3).
import { isNeutral } from "@rewire/engine/src/changes.ts";
import type { CheckResult, EngineClient } from "../live/engine.ts";
import { canonical, loadRecording, parseFeatured, type Recording, type RecordedRun } from "../model/recording.ts";
import type { Cand, ChangeSpec, FloorDetail, Focus, Reply, Side, Tok, Turn, WordRef } from "../model/types.ts";
import { loadPath, type PathData, type StepData, stepChanges } from "../path/steps.ts";
import { S } from "../strings.ts";
import { setDims } from "../ui/word.ts";
import { encode, letter } from "@rewire/tiny/src/data.ts";
import { TINY, type TinyConfig } from "@rewire/tiny/src/config.ts";
import { QWEN_INFO, TINY_INFO } from "../model/info.ts";
import { type DeviceState, store } from "./store.ts";

export const REPLY_CAP = 64;
const PLAY_MS = 38; // replay pace, about 26 pieces a second
const CRASH_FLAG = "rewire-live-session";

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

// ---------------------------------------------------------------- path and recordings

let path: PathData | null = null;
const recordings = new Map<string, Promise<Recording>>();

export function pathData() {
  return path;
}
export function stepData(n: number | null): StepData | undefined {
  return n === null ? undefined : path?.steps.find((s) => s.n === n);
}
export function shippingSteps(): StepData[] {
  return path?.steps ?? [];
}

function recording(file: string): Promise<Recording> {
  let p = recordings.get(file);
  if (!p) {
    p = loadRecording(`${import.meta.env.BASE_URL}recordings/${file}`).then((r) => {
      addPieces(Object.entries(r.header.pieces).map(([k, v]) => [Number(k), v] as [number, string]));
      return r;
    });
    p.catch(() => recordings.delete(file));
    recordings.set(file, p);
  }
  return p;
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

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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

/** Plays recorded pieces into a reply at reading pace. */
async function play(turn: number, side: Side, toks: Tok[], job: number, ended: boolean) {
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  for (const t of toks) {
    if (!current(side, job)) return false;
    if (!reduce) await sleep(PLAY_MS);
    if (!current(side, job)) return false;
    pushTok(turn, side, t);
  }
  patchReply(turn, side, (r) => ({ ...r, done: true, ended }));
  return true;
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
  const visit = ++navigation;
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
  if (!st?.recording || !st.message) return;
  store.set({ busy: true });
  try {
    const rec = await recording(st.recording);
    if (visit !== navigation) return;
    const run = rec.find({}, st.message);
    if (!run) throw new Error("This example could not be found.");
    await playRun(run, "normal", {}, rec);
    if (visit !== navigation) return;
    if (st.featured?.side === "normal") store.set({ word: { turn: 0, side: "normal", index: st.featured.index } });
  } catch {
    if (visit === navigation) store.set({ busy: false, error: "This example could not load. Try opening it again from Experiments, or start a new chat." });
  }
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

/** Puts a recorded run into the conversation: as the normal side (a fresh turn) or as the changed side. */
async function playRun(run: RecordedRun, side: Side, changes: ChangeSpec, rec?: Recording) {
  const job = claim(side);
  const turns = run.turns;
  for (let k = 0; k < turns.length; k++) {
    const t = turns[k];
    const featured = rec?.header.featured.filter((f) => f.run === run.info.id && f.turn === k).map((f) => f.index);
    if (side === "normal") {
      store.set((s) => ({ busy: true, turns: [...s.turns, { user: run.info.messages[k], seed: run.info.seed, normal: { ...emptyReply({}, t.read, "recording"), recording: rec?.url.split("/").pop(), featured } }] }));
    } else {
      store.set((s) => ({
        busy: true, turns: s.turns.map((x, i) => (i === k ? { ...x, changed: { ...emptyReply(changes, t.read, "recording"), recording: rec?.url.split("/").pop(), compare: run.compare, featured } } : x)),
      }));
    }
    if (!(await play(k, side, t.toks, job, t.ended))) return false;
  }
  return true;
}

/** Replay-only devices: "Try it on another question" plays a recorded alternative, normal and changed. */
export async function replayAlternative(st: StepData, message: string) {
  if (!st.recording) return;
  const visit = ++navigation;
  store.set({ busy: true, error: null });
  try {
    const rec = await recording(st.recording);
    if (visit !== navigation) return;
    const normal = rec.find({}, message);
    if (!normal) { store.set({ busy: false }); return; }
    claim("normal");
    claim("changed");
    const chips = store.get().chips;
    store.set({ turns: [], fork: isNeutral(chips) ? -1 : 0, word: null });
    await playRun(normal, "normal", {}, rec);
    if (visit !== navigation) return;
    if (isNeutral(chips)) return;
    const changed = rec.find(chips, message);
    if (changed) await playRun(changed, "changed", chips, rec);
    else store.set((s) => ({ turns: s.turns.map((t, i) => (i === 0 ? { ...t, changed: { ...emptyReply(chips, t.normal.read, "recording"), done: true, missing: true } } : t)) }));
  } catch {
    if (visit === navigation) store.set({ busy: false, error: "This recorded question could not load. Try it again, or choose another experiment." });
  }
}

/** The step's control was used. */
export async function stepAction(stop?: number) {
  const s = store.get();
  const st = stepData(s.step);
  if (!st) return;
  const c = st.control;
  if (c.kind === "pick") {
    const t = s.turns[0];
    if (!t) return;
    const cand = t.normal.toks[c.index]?.cands[c.rank - 1];
    if (cand) await pick({ turn: 0, side: "normal", index: c.index }, cand.id);
    store.set({ stepTried: true });
    return;
  }
  if (c.kind === "guesses" || c.kind === "madeup") {
    store.set({ word: { turn: 0, side: "normal", index: c.index }, focus: c.kind === "guesses" ? { kind: "words-out" } : { kind: "word" }, stepTried: true, sheet: true, inspectView: "word" });
    return;
  }
  if (c.kind === "floors") {
    // stop encodes floor * 100 + multiplier index; the floors' knobs set chips directly
    return;
  }
  const spec = stepChanges(c, stop);
  await applyChips(spec);
  store.set({ stepTried: true });
  // then show where the change bites: the Difference view on the step's featured normal word
  const after = store.get();
  const f = st.featured;
  if (!isNeutral(spec) && f?.side === "normal" && after.turns.length === 1 && after.turns[0]?.normal.recording === st.recording && after.turns[0]?.changed?.compare && after.step === st.n) {
    store.set({ word: { turn: 0, side: "normal", index: f.index }, view: "difference", follow: false });
  }
}

// ---------------------------------------------------------------- changes and the fork rule

export function chipsWith(f: (c: ChangeSpec) => ChangeSpec) {
  return applyChips(f(structuredClone(store.get().chips)));
}

/** Sets the chips. The first change forks at the latest message; a later change re-forks there. */
export async function applyChips(spec: ChangeSpec) {
  const s = store.get();
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
    return { ...t, changed: emptyReply(spec, t.normal.read, store.get().mode === "live" ? "live" : "recording") };
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
  const s = store.get();
  const t = s.turns[k];
  if (!t) return;
  const job = sideJob.changed;
  const st = stepData(s.step);
  // A step's own prompt plays its recording, live or not; anything else runs live when it can.
  const file = t.normal.recording ?? st?.recording;
  if (t.normal.source === "recording" && file) {
    const rec = await recording(file);
    const run = rec.find(s.chips, t.user);
    if (!current("changed", job)) return;
    if (run) {
      const featured = rec.header.featured.filter((f) => f.run === run.info.id && f.turn === 0).map((f) => f.index);
      patchReply(k, "changed", (r) => ({ ...r, source: "recording", recording: file, compare: run.compare, read: run.turns[0].read, featured }));
      await play(k, "changed", run.turns[0].toks, job, run.turns[0].ended);
      return;
    }
    if (s.mode !== "live" || !engine) {
      patchReply(k, "changed", (r) => ({ ...r, done: true, missing: true }));
      return;
    }
  }
  if (!engine || s.mode !== "live") {
    patchReply(k, "changed", (r) => ({ ...r, done: true, missing: true }));
    return;
  }
  const history = historyBefore(k, "changed");
  patchReply(k, "changed", (r) => ({ ...r, source: "live" }));
  const res = await engine.write({ conv: 1, changes: s.chips, history, prefix: [], seed: t.seed ?? s.seed, turn: k, cap: REPLY_CAP,
    temperature: s.temperature, version }, (tok) => { if (current("changed", job)) pushTok(k, "changed", tok); });
  if (!current("changed", job) || res.cancelled) return;
  patchReply(k, "changed", (r) => ({ ...r, done: true, ended: res.ended }));
  await compareTurn(k, version);
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
      turns: [...s.turns, { user: text, normal: emptyReply({}, readN, "live"), changed: forked ? emptyReply(s.chips, readC, "live") : undefined }],
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
  navigation++;
  engine?.cancel();
  claim("normal");
  claim("changed");
  store.set((s) => ({ turns: [], fork: -1, word: null, full: false, busy: false, follow: true, sheet: false, error: null, version: s.version + 1 }));
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
    turns: [{ user: message, normal: emptyReply({}, read, "live"), changed: forked ? emptyReply(s.chips, read, "live") : undefined }],
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
  patchReply(k, "normal", (r) => ({ ...r, source: r.source !== "live" && prefix.length ? "mixed" : "live" }));
  const history = historyBefore(k, "normal");
  const res = await engine.write({ conv: 0, changes: {}, history, prefix: prefix.map((x) => x.id), force, seed: s.turns[k]?.seed ?? s.seed, turn: k, cap,
    temperature: s.temperature, version: -1 }, (tok) => { if (current("normal", job)) pushTok(k, "normal", tok); });
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
  patchReply(k, "changed", (r) => ({ ...r, source: r.source !== "live" && prefix.length ? "mixed" : "live" }));
  const history = historyBefore(k, "changed");
  const res = await engine.write({ conv: 1, changes: s.chips, history, prefix: prefix.map((x) => x.id), force, seed: s.turns[k]?.seed ?? s.seed, turn: k,
    cap, temperature: s.temperature, version }, (tok) => { if (current("changed", job)) pushTok(k, "changed", tok); });
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
  if (!r || !r.done || s.busy) return;
  const original = r.original ?? r;
  const keep = r.toks.slice(0, w.index);
  const st = stepData(s.step);
  const file = r.recording ?? st?.recording;
  if (r.source === "recording" && file) {
    const rec = await recording(file);
    if (visit !== navigation) return;
    const run = [...rec.runs.values()].find((x) => x.info.picked && x.info.picked.index === w.index && x.info.picked.id === candId &&
      x.info.messages[0] === t.user && canonical(x.info.changes) === canonical(r.changes));
    if (run) {
      const job = claim(w.side);
      patchReply(w.turn, w.side, (x) => ({ ...x, original, toks: keep, done: false, pickedAt: w.index }));
      await play(w.turn, w.side, run.turns[0].toks.slice(w.index).map((x, i) => (i === 0 ? { ...x, picked: true } : x)), job,
        run.turns[0].ended);
      return;
    }
    if (s.mode !== "live") return;
  }
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

/** Full floor detail for a word: a featured recording, or one live pass. */
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
    const st = stepData(s.step);
    const file = r.recording ?? st?.recording;
    if (r.source === "recording" && file) {
      const rec = await recording(file);
      const run = rec.find(r.changes, t.user);
      const url = run && (r.pickedAt === undefined || w.index < r.pickedAt) && rec.featured(run.info.id, w.turn, w.index);
      if (url) {
        const b = await fetch(url).then((x) => x.arrayBuffer());
        return parseFeatured(b);
      }
      if (s.mode !== "live") return null;
    }
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

export async function checkDevice(force = false) {
  let crashed = false;
  try {
    crashed = localStorage.getItem(CRASH_FLAG) === "1";
  } catch {
    /* storage refused: no crash flag */
  }
  if (crashed && !force) return setDevice({ kind: "crashed" });
  if (!("gpu" in navigator)) return setDevice({ kind: "no-webgpu" });
  setDevice({ kind: "checking" });
  const { EngineClient } = await import("../live/engine.ts");
  engine ??= new EngineClient();
  connectEngine(engine);
  let r: CheckResult;
  try {
    r = await engine.check();
  } catch (e) {
    return setDevice({ kind: "error", message: String((e as Error).message ?? e) });
  }
  if (!r.webgpu) return setDevice({ kind: "no-webgpu" });
  if (r.seconds > 4 && !force) return setDevice({ kind: "slow", seconds: r.seconds });
  // Loading chat is explicit, so a visitor can train the tiny model without downloading Qwen.
  setDevice({ kind: "offer", seconds: r.seconds, bytes: await downloadBytes() });
}

function weightsBase() {
  const b = (import.meta.env.VITE_WEIGHTS_URL as string | undefined) ?? `${location.origin}/weights/`;
  return b.endsWith("/") ? b : b + "/";
}

/** What "Get the model" will download: the weight files plus the tokenizer (null if the host can't say). */
async function downloadBytes(): Promise<number | null> {
  try {
    const base = weightsBase();
    const m = (await (await fetch(`${base}manifest.json`)).json()) as { total_bytes?: number };
    const responses = await Promise.all(["tokenizer.json", "tokenizer_config.json"].map((name) => fetch(base + name, { method: "HEAD" })));
    if (responses.some((r) => !r.ok)) return null;
    const n = Number(m.total_bytes ?? 0) + responses.reduce((sum, r) => sum + Number(r.headers.get("content-length") ?? 0), 0);
    return n > 0 ? n : null;
  } catch {
    return null;
  }
}

export async function startDownload(seconds = 0) {
  if (!engine) return;
  engine.pause(false);
  setDevice({ kind: "downloading", loaded: 0, total: 0, paused: false, seconds });
  try {
    localStorage.setItem(CRASH_FLAG, "1");
  } catch {
    /* ignore */
  }
  try {
    const info = await engine.load(weightsBase(), isPhone(), path?.manifest_hash);
    void navigator.storage?.persist?.().catch(() => false);
    setDevice({ kind: "ready", seconds });
    store.set({ mode: "live", modelStored: info.stored, announce: S.ready });
    if (new URLSearchParams(location.search).has("bench")) {
      const r = await engine.bench();
      const out = { device_check_predicted_s: seconds, ...r, userAgent: navigator.userAgent };
      console.log("REWIRE_BENCH", JSON.stringify(out));
      store.set({ bench: out });
    }
  } catch (e) {
    if (store.get().device.kind === "recovering") return;
    setDevice({ kind: "error", message: String((e as Error).message ?? e) });
    try {
      localStorage.removeItem(CRASH_FLAG);
    } catch {
      /* ignore */
    }
  }
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
    claim("normal"); claim("changed");
    endWithError(S.recovering);
    store.set((s) => ({ mode: "replay", device: { kind: "recovering" }, version: s.version + 1 }));
    client.setVersion(store.get().version);
  };
  client.onRecovered = () => {
    const prior = before;
    before = null;
    const loading = prior?.device.kind === "downloading" || prior?.device.kind === "loading" ? prior.device : null;
    store.set({
      mode: loading ? "live" : prior?.mode ?? "replay",
      device: loading ? { kind: "ready", seconds: loading.seconds } : prior?.device ?? { kind: "ready", seconds: 0 },
      announce: S.recovered,
      error: null,
    });
  };
  client.onFailure = (message) => {
    endWithError(message);
    store.set({ mode: "replay", device: { kind: "error", message }, qwenMode: "replay" });
  };
}

export function pauseDownload(paused: boolean) {
  const d = store.get().device;
  if (d.kind !== "downloading") return;
  engine?.pause(paused);
  setDevice({ ...d, paused });
}

/** A normal exit clears the crash flag; a crash leaves it set for the next visit. */
export function watchExit() {
  addEventListener("pagehide", () => {
    try {
      localStorage.removeItem(CRASH_FLAG);
    } catch {
      /* ignore */
    }
  });
}

// ---------------------------------------------------------------- start

export async function start() {
  watchExit();
  path = await loadPath();
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
