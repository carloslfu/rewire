// Live inference, interventions and independent sample lifecycle. No prerecorded output path.
import { isNeutral, specLimit } from "@rewire/engine/src/changes.ts";
import type { EngineClient } from "../live/engine.ts";
import type { Cand, ChangeSpec, FloorDetail, Focus, Reply, Side, Tok, Turn, WordRef } from "../model/types.ts";
import { loadPath, type PathData, type StepData, stepChanges } from "../path/steps.ts";
import { S } from "../strings.ts";
import { chosen, comparison, comparisonTarget, contextFull, latestWord, setDims, settledSelection } from "../ui/word.ts";
import { encode, letter } from "@rewire/tiny/src/data.ts";
import { TINY, type TinyConfig } from "@rewire/tiny/src/config.ts";
import { QWEN_INFO, TINY_INFO } from "../model/info.ts";
import { type DeviceState, store } from "./store.ts";
import release from "../live/release.json";
import { canonical } from "../model/change-key.ts";
import { textSegments, type TokenPiece } from "@rewire/engine/src/token-text.ts";

export const REPLY_CAP = 64;

// ---------------------------------------------------------------- pieces

const pieceText = new Map<number, TokenPiece>();
const pieceListeners = new Set<() => void>();
export function piece(id: number): string {
  return tokenPiece(id).text;
}
export function tokenPiece(id: number): TokenPiece {
  return store.get().model.id === "tiny" ? { text: letter(id) } : pieceText.get(id) ?? { text: "…" };
}
/** Contextual display text, retaining exact token ranges for inspection. */
export function sequence(ids: number[], final = true) {
  return textSegments(ids.map(tokenPiece), final);
}
export function onPieces(f: () => void) {
  pieceListeners.add(f);
  return () => {
    pieceListeners.delete(f);
  };
}
function addPieces(entries: Iterable<[number, TokenPiece]>) {
  for (const [k, v] of entries) pieceText.set(k, v);
  for (const f of pieceListeners) f();
}
async function ensurePieces(ids: number[]) {
  const missing = [...new Set(ids)].filter((i) => !pieceText.has(i));
  if (!missing.length || !engine) return;
  const txt = await engine.pieces(missing);
  addPieces(missing.map((id, i) => [id, txt[i]] as [number, TokenPiece]));
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
let sampleSeq = 0;
function claim(side: Side): number {
  sideJob[side] = ++jobSeq;
  return sideJob[side];
}
function current(side: Side, job: number) {
  return sideJob[side] === job;
}
function busy() {
  const { turns: t, replay } = store.get();
  if (replay?.status === "running") return true;
  return t.some((x) => !x.normal.done || (x.changed && (!x.changed.done || x.changed.comparing)));
}

/** Counts writings of replies. Every new reply and every rewrite of one from a picked piece takes the next number. */
let writings = 0;

function emptyReply(changes: ChangeSpec, read: number[], source: Reply["source"]): Reply {
  return { read, toks: [], ended: false, done: false, changes, source, rev: ++writings };
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
  // Following moves to the new token. Paused, only a missing selection is filled, by the first visible token.
  settleSelection();
}

// ---------------------------------------------------------------- selection
//
// Every action that adds, replaces or removes output ends here, so the selected token is decided in
// one place (settledSelection) from the state as it is now, never from a value captured before a wait.

/** A new experiment: nothing selected, following again. Used by Clear, guided steps and model switches. */
const FRESH_SELECTION = { word: null, follow: true, outputSample: null, view: "push" } as const;

/**
 * The visitor chose a token or a candidate themselves: following is paused, and the choice is
 * recorded so that a 3D replay ending later does not turn following back on over it.
 */
function paused() {
  return { follow: false, pauseRevision: store.get().pauseRevision + 1 } as const;
}

/** Settle the selected token and view on what exists now. The follow preference is never changed here. */
export function settleSelection(near?: number) {
  const s = store.get(), next = settledSelection(s, near);
  if (next.word !== s.word || next.view !== s.view) store.set(next);
}

/** The sample about to be written becomes the one that following tracks. */
function beginOutput(sample: number) {
  store.set({ outputSample: sample });
  settleSelection();
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
  const st = stepData(n);
  store.set({
    step: n, stepTried: false, pathOpen: false, chips: {}, version: s.version + 1, turns: [], removed: [], fork: -1, ...FRESH_SELECTION,
    focus: { kind: "word" }, tiny: false, busy: false, replay: null, full: false, sheet: false, error: null,
    draft: st?.guide ? st.message ?? "" : "",
  });
  engine?.setVersion(store.get().version);
  setHash(n);
  if (st?.message && !st.guide && store.get().mode === "live") await send(st.message);
}

/** Select a model modification without replacing the existing samples. */
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
    store.set({ word: { turn, side: "normal", index: Math.min(c.index, last) }, ...paused(), focus: c.kind === "guesses" ? { kind: "words-out" } : { kind: "word" }, stepTried: true, sheet: true, inspectView: "word" });
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

// ---------------------------------------------------------------- changes and conversation replay

export function chipsWith(f: (c: ChangeSpec) => ChangeSpec) {
  return applyChips(f(structuredClone(store.get().chips)));
}

/** Update each independent question with the changed model, preserving its original answer. */
export async function applyChips(spec: ChangeSpec) {
  const s = store.get();
  if (s.mode !== "live" || !engine || (s.busy && !s.replay)) return;
  // A change the model has no room for is refused before anything is shown as active.
  const limit = specLimit(spec);
  if (limit) { store.set({ error: limit, announce: limit }); return; }
  spec = structuredClone(spec);
  const version = s.version + 1;
  const visit = navigation;
  engine?.setVersion(version);
  claim("changed");
  if (isNeutral(spec)) {
    // The exact original replies already exist. Restoring them needs no simulated or duplicate output.
    store.set({ chips: {}, version, fork: -1, replay: null, error: null, full: false,
      announce: "Original answers restored.", turns: s.turns.map((t) => ({ ...t, changed: undefined })) });
    // A selected changed token moves to its sample's original reply, and the view returns to Push.
    settleSelection();
    store.set({ busy: busy() });
    return;
  }
  const turns = s.turns.map((t): Turn => ({ ...t, changed: emptyReply(spec, [], "live") }));
  const hasTurns = turns.length > 0;
  store.set({ chips: spec, version, turns, fork: hasTurns ? 0 : -1, busy: hasTurns,
    replay: hasTurns ? { turn: 0, status: "running" } : null, error: null, full: false });
  // Every changed reply was replaced. A paused selection in one moves to its sample's original reply.
  if (hasTurns) beginOutput(turns[0].id);
  const active = () => navigation === visit && store.get().version === version && store.get().replay?.status === "running";
  try {
    if (s.model.id === "qwen" && spec.swaps?.length) await ensurePieces(spec.swaps.flat());
    for (let k = 0; k < turns.length; k++) {
      if (!active()) return;
      store.set({ replay: { turn: k, status: "running" } });
      beginOutput(turns[k].id);
      const read = turns[k].normal.read;
      if (!active()) return;
      if (s.model.id === "qwen") await ensurePieces(read);
      if (!active()) return;
      patchReply(k, "changed", (r) => ({ ...r, read }));
      const completed = await writeChangedLive(k, [], undefined, Math.max(s.model.replyCap, turns[k].normal.toks.length));
      if (!active()) return;
      if (!completed) { stopReply(); return; }
    }
    if (active()) { store.set({ replay: null, busy: false, announce: "Sample comparisons updated." }); settleSelection(); }
  } catch (e) {
    if (active()) endWithError(e);
  }
}

export async function restartReplay() {
  const s = store.get();
  if (s.replay && !s.busy) await applyChips(s.chips);
}

/** Only this sample's prompt, for generation, comparison and inspection alike. */
function historyBefore(k: number, side: Side, turns = store.get().turns): number[] {
  const t = turns[k];
  return (side === "changed" ? t?.changed : t?.normal)?.read ?? [];
}

let comparisonSeq = 0;
const comparisonJobs = new Map<number, number>();

/** The changed model fed the normal reply: underlines and the change-from-original view. */
async function compareTurn(k: number, version: number) {
  const s = store.get();
  const t = s.turns[k];
  if (s.replay && (k > s.replay.turn || (k === s.replay.turn && s.replay.status !== "running"))) return;
  if (!engine || s.version !== version || !t?.changed || t.changed.stale || t.changed.comparing || !t.normal.done || !t.changed.done) return;
  const visit = navigation, job = ++comparisonSeq;
  comparisonJobs.set(k, job);
  const tokens = t.normal.toks.map((x) => x.id);
  const currentComparison = () => {
    const now = store.get(), turn = now.turns[k];
    return visit === navigation && now.version === version && comparisonJobs.get(k) === job && !!turn?.changed && !turn.changed.stale
      && turn.normal.toks.length === tokens.length && turn.normal.toks.every((x, i) => x.id === tokens[i]);
  };
  const history = historyBefore(k, "changed");
  patchReply(k, "changed", (r) => ({ ...r, comparing: true, compare: undefined, compareError: undefined }));
  // The same independent prompt, followed by the original answer's tokens.
  try {
    const forced = await engine.compare(2, t.changed.changes, history, tokens, version);
    if (!currentComparison()) return;
    if (!forced || forced.length !== tokens.length || forced.some((x, i) => x.id !== tokens[i])) {
      throw new Error("The comparison did not finish. Try again.");
    }
    patchReply(k, "changed", (r) => ({ ...r, compare: forced, comparing: false }));
  } catch (e) {
    if (currentComparison()) patchReply(k, "changed", (r) => ({ ...r, comparing: false, compareError: String((e as Error)?.message ?? e) }));
  }
}

export async function retryComparison() {
  const s = store.get();
  if (s.mode !== "live" || s.busy) return;
  await compareTurn(s.word?.turn ?? s.turns.length - 1, s.version);
}

/** Switching the view keeps the follow preference and moves the selection to the reply that view measures. */
export function setTowerView(view: "push" | "difference") {
  const s = store.get();
  if (view === "push") { store.set({ view }); settleSelection(); return; }
  // Following compares the newest original token when it has been measured, otherwise the one nearest the selection.
  const newest = s.follow ? latestWord({ ...s, view }) : null;
  const word = newest && chosen({ ...s, word: newest })?.forced ? newest : comparisonTarget(s);
  if (word) store.set({ view, word });
}

/** Resuming always returns to the newest output, and tells the 3D replay to show that token complete. */
export function setFollowing(follow: boolean) {
  if (!follow) { store.set({ follow }); return; }
  store.set((s) => ({ follow, followRevision: s.followRevision + 1 }));
  settleSelection();
}

/**
 * Ask the 3D view to replay one finished reply from its first token. Opens the 3D view if needed.
 * This is the visual replay of values already measured; nothing is generated again.
 */
let replayRequests = 0;
export function askReplay(sample: number, side: Side) {
  const s = store.get();
  if (!s.stage3d || s.busy || s.replay) return;
  store.set({ scopeView: "3d", replayRequest: { sample, side, n: ++replayRequests } });
}

/** A 3D view opened or closed. While one is open the engine leaves the GPU room to draw it. */
let stagesOpen = 0;
export function stageShown(open: boolean) {
  stagesOpen = Math.max(0, stagesOpen + (open ? 1 : -1));
  engine?.setStageOpen(stagesOpen > 0);
}

// ---------------------------------------------------------------- talking

export async function send(message: string) {
  const text = message.trim();
  if (!text || !engine || store.get().mode !== "live") return;
  const s = store.get();
  if (s.busy || s.replay) return;
  const visit = navigation;
  // Lock before tokenization, so a double submit cannot create two turns with the same history.
  store.set({ busy: true, error: null, full: false });
  try {
    if (s.model.id === "tiny") { await sendTiny(message); return; }
    const k = s.turns.length;
    const forked = !isNeutral(s.chips);
    const readN = await engine.firstTurn(text);
    await ensurePieces(readN);
    if (visit !== navigation) return;
    const fork = forked ? (s.fork >= 0 ? s.fork : k) : -1;
    const id = ++sampleSeq;
    store.set({
      turns: [...s.turns, { id, user: text, seed: s.seed, temperature: s.temperature, normal: emptyReply({}, readN, "live"), changed: forked ? emptyReply(s.chips, readN, "live") : undefined }],
      fork, busy: true,
    });
    beginOutput(id);
    await Promise.all([writeNormal(k), forked ? writeChangedLive(k) : Promise.resolve()]);
    if (visit === navigation) settleSelection();
  } catch (e) {
    if (visit === navigation) endWithError(e);
  }
}

/** A failed write: the context limit offers a fresh start; anything else is announced. */
function endWithError(e: unknown) {
  const msg = String((e as Error)?.message ?? e);
  store.set((s) => ({
    turns: s.turns.map((t) => ({ ...t, normal: { ...t.normal, done: true }, changed: t.changed && { ...t.changed, done: true } })),
    replay: s.replay ? { ...s.replay, status: "error" } : null,
    busy: false, full: msg.includes("context-full") ? true : s.full, announce: msg.includes("context-full") ? S.contextFull : msg,
    error: msg.includes("context-full") ? null : msg,
  }));
  settleSelection();
}

/** Clear the sample list while keeping the chosen guide and model changes. */
export function clearSamples() {
  navigation++;
  engine?.cancel();
  claim("normal");
  claim("changed");
  store.set((s) => ({ turns: [], removed: [], draft: "", fork: -1, ...FRESH_SELECTION, full: false, busy: false, replay: null, sheet: false, error: null, version: s.version + 1 }));
  engine?.setVersion(store.get().version);
}

export function freshStart() {
  clearSamples();
  setHash(null);
  store.set({ step: null, stepTried: false });
}

/** Editing one sample regenerates only its pair, retaining its identity and sampling settings. */
export async function editSample(id: number, message: string) {
  const s = store.get(), text = message.trim(), k = s.turns.findIndex((t) => t.id === id);
  if (!text || k < 0 || !engine || s.mode !== "live" || s.busy || s.replay || s.model.id !== "qwen") return false;
  if (text === s.turns[k].user) return true;
  const visit = ++navigation;
  store.set({ busy: true, error: null, full: false });
  try {
    const read = await engine.firstTurn(text);
    await ensurePieces(read);
    if (visit !== navigation) return false;
    const changed = !isNeutral(s.chips);
    const sample = { ...s.turns[k], user: text, normal: emptyReply({}, read, "live"),
      changed: changed ? emptyReply(s.chips, read, "live") : undefined };
    const version = s.version + 1;
    engine.setVersion(version);
    store.set({ turns: s.turns.map((t, i) => i === k ? sample : t), version, sheet: false });
    // Its old replies are gone: a paused selection in them moves to another sample.
    beginOutput(sample.id);
    await Promise.all([writeNormal(k), changed ? writeChangedLive(k) : Promise.resolve()]);
    if (visit !== navigation) return false;
    settleSelection();
    store.set({ announce: "Sample updated. Other samples are unchanged." });
    return true;
  } catch (e) {
    if (visit === navigation) endWithError(e);
    return false;
  }
}

export function removeSample(id: number) {
  const s = store.get(), index = s.turns.findIndex((t) => t.id === id);
  if (index < 0 || s.busy || s.replay) return;
  ++navigation;
  const word = s.word && s.word.turn !== index ? { ...s.word, turn: s.word.turn > index ? s.word.turn - 1 : s.word.turn } : null;
  const turns = s.turns.filter((_, i) => i !== index), version = s.version + 1;
  engine?.setVersion(version);
  store.set({ turns, removed: [...s.removed, { sample: s.turns[index], index }], version, word,
    outputSample: s.outputSample === id ? null : s.outputSample,
    fork: turns.some((t) => t.changed) ? 0 : -1, sheet: word ? s.sheet : false,
    full: false, error: null, announce: "Sample removed. Undo is available." });
  // A selection that was in the removed sample moves to the sample now beside it.
  settleSelection(Math.min(index, turns.length - 1));
}

/** Undo preserves cached originals; refresh only this sample if the model changed while it was removed. */
export async function undoRemoveSample() {
  const s = store.get(), removed = s.removed.at(-1);
  if (!removed || s.busy || s.replay || s.mode !== "live" || !engine) return;
  ++navigation;
  const index = Math.min(removed.index, s.turns.length), version = s.version + 1;
  const active = !isNeutral(s.chips), cached = removed.sample.changed;
  const refresh = active && (!cached || cached.stale || !cached.done || canonical(cached.changes) !== canonical(s.chips));
  const sample = { ...removed.sample, changed: !active ? undefined : refresh ? emptyReply(s.chips, removed.sample.normal.read, "live") : cached };
  const turns = [...s.turns]; turns.splice(index, 0, sample);
  const word = s.word ? { ...s.word, turn: s.word.turn >= index ? s.word.turn + 1 : s.word.turn } : null;
  engine.setVersion(version);
  store.set({ turns, removed: s.removed.slice(0, -1), word, version, fork: active ? 0 : -1,
    busy: refresh, full: false, error: null, announce: "Sample restored." });
  if (!refresh) { settleSelection(); return; }
  beginOutput(sample.id);
  try {
    await writeChangedLive(index, [], undefined, Math.max(s.model.replyCap, sample.normal.toks.length));
    if (store.get().version === version) settleSelection();
  } catch (e) { if (store.get().version === version) endWithError(e); }
}

export function stopReply() {
  navigation++;
  engine?.cancel();
  claim("normal"); claim("changed");
  store.set((s) => ({ busy: false, replay: s.replay ? { ...s.replay, status: "stopped" } : null, turns: s.turns.map((t) => ({ ...t,
    normal: { ...t.normal, done: true }, changed: t.changed && { ...t.changed, done: true, comparing: false,
      compareError: t.changed.comparing ? "The comparison was interrupted. Try again." : t.changed.compareError } })),
    announce: s.replay ? "Sample update stopped. Retry or restore the originals before testing another question." : "Stopped. You can continue the reply or test another question." }));
  settleSelection();
}

/** The tiny model continues the text you type (letters, no chat template). Each message starts fresh. */
async function sendTiny(message: string) {
  const s = store.get();
  const read = Array.from(encode(message));
  if (!read.length) return;
  const forked = !isNeutral(s.chips);
  claim("normal");
  claim("changed");
  const id = ++sampleSeq;
  store.set({
    turns: [{ id, user: message, seed: s.seed, temperature: s.temperature, normal: emptyReply({}, read, "live"), changed: forked ? emptyReply(s.chips, read, "live") : undefined }],
    fork: forked ? 0 : -1, busy: true,
  });
  // The previous sample was replaced, so nothing stays selected until this reply's first letter.
  beginOutput(id);
  await Promise.all([writeNormal(0, [], undefined, TINY_INFO.replyCap), forked ? writeChangedLive(0, [], undefined, TINY_INFO.replyCap) : Promise.resolve()]);
  settleSelection();
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
  const loaded = await engine.loadTiny(params.slice(), cfg);
  await engine.use("tiny");
  claim("normal");
  claim("changed");
  setDims(TINY_INFO);
  const s = store.get();
  store.set({ model: TINY_INFO, tiny: false, mode: "live", step: null, chips: {}, version: s.version + 1, turns: [], removed: [], fork: -1, ...FRESH_SELECTION,
    focus: { kind: "word" }, qwenMode: s.model.id === "qwen" ? s.mode : s.qwenMode, busy: false, replay: null, full: false, error: null, sheet: false,
    contextCaps: { ...s.contextCaps, tiny: loaded?.contextCap },
    // Replaces the "Stopped" left by the cancel above: nothing of this model was stopped.
    announce: S.tinyReady });
  engine.setVersion(store.get().version);
  setHash(null);
}

/**
 * What can be said of Qwen right now, in the device line's own words. It is called ready only when it
 * is: after a worker failure or while it is still loading, the announcement says that instead.
 */
function qwenStatus(mode: ReturnType<typeof store.get>["mode"], d: DeviceState): string {
  const mb = (n: number) => Math.round(n / 1e6);
  switch (d.kind) {
    case "ready": return mode === "live" ? S.ready : S.qwenNotLoaded;
    case "checking": return S.checking;
    case "no-webgpu": return S.noWebgpu;
    case "downloading": return S.downloading(mb(d.loaded), mb(d.total));
    case "loading": return S.loadingModel;
    case "recovering": return S.recovering;
    case "error": return `${S.loadError(d.message)} ${S.retryToLoad}`;
  }
}

export async function backToQwen(n: number | null = null) {
  stopReply();
  claim("normal");
  claim("changed");
  // A worker that stopped, or one started for the tiny model alone, cannot switch to Qwen. Qwen is
  // still shown, with its own unavailable state and Try again, so Dismantle and Teach stay reachable.
  let refused: string | null = null;
  try { await engine?.use("qwen"); } catch (e) { refused = String((e as Error)?.message ?? e); }
  setDims(QWEN_INFO);
  const s = store.get();
  // Qwen is live only if it was, and the worker took the switch. Otherwise the device line says why and offers Try again.
  const was = s.qwenMode ?? s.mode, mode = refused ? "unavailable" : was;
  const device: DeviceState = refused && s.device.kind === "ready" ? { kind: "error", message: refused } : s.device;
  // The tiny model's text is gone with it. Nothing of Qwen's was stopped and there is no reply to
  // continue, so the "Stopped" from the cancel above is replaced by what is true of Qwen now.
  store.set({ model: QWEN_INFO, mode, qwenMode: mode, device, chips: {}, version: s.version + 1, turns: [], removed: [], fork: -1, ...FRESH_SELECTION, focus: { kind: "word" }, busy: false, full: false, error: null,
    announce: qwenStatus(mode, device) });
  await openStep(n);
}

export function hasTiny() {
  return tinyParams !== null;
}

async function writeNormal(k: number, prefix: Tok[] = [], force?: number, cap = REPLY_CAP) {
  if (!engine) return;
  const s = store.get();
  const job = claim("normal");
  comparisonJobs.delete(k);
  patchReply(k, "changed", (r) => ({ ...r, compare: undefined, comparing: false, compareError: undefined }));
  patchReply(k, "normal", (r) => ({ ...r, source: "live" }));
  const history = historyBefore(k, "normal");
  const res = await engine.write({ conv: 0, changes: {}, history, prefix: prefix.map((x) => x.id), force, seed: s.turns[k]?.seed ?? s.seed, turn: 0, cap,
    temperature: s.turns[k]?.temperature ?? s.temperature, version: -1 }, (tok) => { if (current("normal", job)) pushTok(k, "normal", tok); });
  if (!current("normal", job)) return;
  patchReply(k, "normal", (r) => ({ ...r, done: true, ended: res.ended }));
  const t = store.get().turns[k];
  if (t.changed?.done && !t.changed.stale) await compareTurn(k, store.get().version);
}

async function writeChangedLive(k: number, prefix: Tok[] = [], force?: number, cap = REPLY_CAP) {
  if (!engine) return false;
  const s = store.get();
  const job = claim("changed");
  const version = s.version;
  const visit = navigation;
  const active = () => current("changed", job) && navigation === visit && store.get().version === version;
  comparisonJobs.delete(k);
  patchReply(k, "changed", (r) => ({ ...r, source: "live", compare: undefined, comparing: false, compareError: undefined }));
  const history = historyBefore(k, "changed");
  const res = await engine.write({ conv: 1, changes: s.chips, history, prefix: prefix.map((x) => x.id), force, seed: s.turns[k]?.seed ?? s.seed, turn: 0,
    cap, temperature: s.turns[k]?.temperature ?? s.temperature, version }, (tok) => { if (active()) pushTok(k, "changed", tok); });
  if (!active() || res.cancelled) return false;
  patchReply(k, "changed", (r) => ({ ...r, done: true, ended: res.ended }));
  if (store.get().turns[k].normal.done) await compareTurn(k, version);
  return active();
}

/** The tokens of prompt and reply the model on screen can hold, once it has said so. */
export function contextCap(s: Pick<ReturnType<typeof store.get>, "model" | "contextCaps">): number | undefined {
  return s.contextCaps?.[s.model.id];
}

/** Whether a reply can be written further: it stopped at a cap, is current, and its context still has room. */
function continuable(r: Reply | undefined, s: ReturnType<typeof store.get>): r is Reply {
  return !!r && !r.ended && !r.stale && !contextFull(r, contextCap(s));
}

/** Continue just the selected sample, on both sides. */
export async function continueReply(k = store.get().turns.length - 1) {
  const s = store.get(), t = s.turns[k];
  if (!t || s.mode !== "live" || s.busy || s.replay) return;
  if (!continuable(t.normal, s) && !continuable(t.changed, s)) {
    // Nothing is left to write. A reply that fills the context says so instead of doing nothing.
    if (contextFull(t.normal, contextCap(s)) || (t.changed && contextFull(t.changed, contextCap(s)))) store.set({ announce: S.contextFull });
    return;
  }
  const visit = navigation;
  try {
    beginOutput(t.id);
    await continueInner(s, k);
    if (visit === navigation) settleSelection();
  } catch (e) {
    if (visit === navigation) endWithError(e);
  }
}

async function continueInner(s: ReturnType<typeof store.get>, k: number) {
  const t = s.turns[k];
  const jobs: Promise<unknown>[] = [];
  if (continuable(t.normal, s)) {
    patchReply(k, "normal", (r) => ({ ...r, done: false }));
    jobs.push(writeNormal(k, t.normal.toks, undefined, REPLY_CAP));
  }
  if (continuable(t.changed, s)) {
    patchReply(k, "changed", (r) => ({ ...r, done: false, compare: undefined }));
    jobs.push(writeChangedLive(k, t.changed.toks, undefined, REPLY_CAP));
  }
  await Promise.all(jobs);
}

/** Forcing a word: the reply is rewritten from that word on. Not a change to the model, so no chip. */
export async function pick(w: WordRef, candId: number) {
  const visit = navigation;
  try {
    await pickInner(w, candId, visit);
    if (visit === navigation) settleSelection();
  } catch (e) { if (visit === navigation) endWithError(e); }
}

async function pickInner(w: WordRef, candId: number, visit: number) {
  const s = store.get();
  const t = s.turns[w.turn];
  const r = w.side === "normal" ? t?.normal : t?.changed;
  if (!r || !r.done || s.busy || s.replay || s.mode !== "live") return;
  const original = r.original ?? r;
  const keep = r.toks.slice(0, w.index);
  if (!engine) return;
  // Picking is a choice of this token: it stays selected, paused, and shows the picked word once written.
  store.set({ word: w, ...paused(), outputSample: t.id });
  const rev = ++writings;
  patchReply(w.turn, w.side, (x) => ({ ...x, original, toks: keep, done: false, ended: false, pickedAt: w.index, compare: undefined, rev }));
  // The reply is rewritten from the picked piece to the length it had, or to the model's usual cap
  // if that is longer. A piece late in a long or continued reply is rewritten like any other.
  const rest = Math.max(s.model.replyCap, r.toks.length) - keep.length;
  if (w.side === "normal") await writeNormal(w.turn, keep, candId, rest);
  else await writeChangedLive(w.turn, keep, candId, rest);
  if (visit !== navigation) return;
  patchReply(w.turn, w.side, (x) => ({ ...x, toks: x.toks.map((tk, i) => (i === w.index ? { ...tk, picked: true } : tk)) }));
}

export function undoPick(turn: number, side: Side) {
  if (store.get().busy || store.get().replay) return;
  claim(side);
  patchReply(turn, side, (r) => (r.original ? { ...r.original } : r));
  // A comparison measured on the picked reply describes other tokens. It is dropped and measured
  // again on the restored reply, never read by position against it.
  const t = store.get().turns[turn];
  if (t?.changed && !t.changed.stale && !comparison(t)) {
    patchReply(turn, "changed", (r) => ({ ...r, compare: undefined, compareError: undefined }));
    void compareTurn(turn, store.get().version);
  }
  settleSelection();
}

// ---------------------------------------------------------------- inspection

/** How many inspections are kept. One holds every value of every layer for one token: megabytes each for Qwen. */
const DETAILS = 12;
const details = new Map<string, Promise<FloorDetail | null>>();
let detailsOf = "";
/** Inspections describe one model under one set of changes. When either moves on, none of them can be shown again. */
function currentDetails(s: ReturnType<typeof store.get>) {
  const epoch = `${s.model.id}.${s.version}`;
  if (epoch !== detailsOf) { details.clear(); detailsOf = epoch; }
  return details;
}
store.subscribe(() => { currentDetails(store.get()); });

/**
 * Recompute the selected token with its actual context and interventions. The result is kept and
 * shown only while that exact token still exists: the same sample, reply and preceding tokens under
 * the same model and changes. Stop, Continue and work on other samples do not change that, so they
 * never turn a good measurement into "unavailable". A request that could not be answered is not
 * kept either: the next one asks the model again.
 */
export function floorDetail(w: WordRef): Promise<FloorDetail | null> {
  const s = store.get(), cache = currentDetails(s);
  const t = s.turns[w.turn];
  const r = w.side === "normal" ? t?.normal : t?.changed;
  if (!engine || s.mode !== "live" || !t || !r || r.stale || !r.toks[w.index]) return Promise.resolve(null);
  const run = engine, ids = r.toks.slice(0, w.index + 1).map((x) => x.id);
  const key = `${t.id}:${w.side}:${ids.join(".")}`;
  const kept = cache.get(key);
  if (kept) { cache.delete(key); cache.set(key, kept); return kept; }
  const reply = () => {
    const now = store.get(), at = now.turns.findIndex((x) => x.id === t.id), sample = now.turns[at];
    const nr = w.side === "normal" ? sample?.normal : sample?.changed;
    const same = now.version === s.version && now.model.id === s.model.id && !!nr && !nr.stale && ids.every((id, i) => nr.toks[i]?.id === id);
    return same ? at : -1;
  };
  const p = (async () => {
    const res = await run.inspect(w.side === "normal" ? 0 : 2, r.changes, [...r.read, ...ids.slice(0, -1)], ids[w.index]);
    const at = reply();
    if (at < 0) return null;
    patchReply(at, w.side, (x) => ({ ...x, toks: x.toks.map((tk, i) => (i === w.index && !tk.guesses ? { ...tk, guesses: res.guesses } : tk)) }));
    await ensurePieces(res.guesses.flat().map((c: Cand) => c.id));
    return res.detail;
  })();
  const drop = () => { if (details.get(key) === p) details.delete(key); };
  p.then((detail) => { if (!detail) drop(); }, drop);
  cache.set(key, p);
  while (cache.size > DETAILS) cache.delete(cache.keys().next().value!);
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
  const s = store.get();
  const view = w?.side === "normal" && comparisonTarget({ ...s, word: w }) ? s.view : "push";
  store.set({ word: w, view, ...paused(), focus: focus ?? { kind: "word" }, sheet: true, inspectView: "word" });
}

/** Choose the measured token in place, without opening the inspector. */
export function chooseWord(w: WordRef) {
  const s = store.get();
  const view = w.side === "normal" && comparisonTarget({ ...s, word: w }) ? s.view : "push";
  store.set({ word: w, view, ...paused() });
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
    store.set((now) => ({ mode: "live", qwenMode: "live", modelStored: info.stored, announce: S.ready,
      contextCaps: { ...now.contextCaps, qwen: info.contextCap } }));
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
  const b = (import.meta.env.VITE_WEIGHTS_URL as string | undefined)
    ?? `https://huggingface.co/${release.repository}/resolve/${release.revision}/`;
  return b.endsWith("/") ? b : b + "/";
}

/** An explicitly selected preset waits for the model, never substitutes a saved answer. */
async function runPendingExperiment() {
  const s = store.get(), st = stepData(s.step);
  if (!s.tiny && !s.teach && s.model.id === "qwen" && s.mode === "live" && !s.busy && !s.turns.length && st?.message && !st.guide) await send(st.message);
}

/** One reset cancels current writes; the rebuilt worker re-reads their tokens when Continue is used. */
function connectEngine(client: EngineClient) {
  let before: ReturnType<typeof store.get> | null = null;
  client.setStageOpen(stagesOpen > 0);
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
  const bench = location.hash === "#teach" ? "teach" : location.hash === "#grow" ? "grow" : null;
  if (bench) store.set({ teach: bench === "teach", tiny: bench === "grow" });
  const m = /^#step-(\d+)$/.exec(location.hash);
  const n = m ? Number(m[1]) : null;
  const exists = path?.steps.some((s) => s.n === n);
  if (m && !exists) store.set({ pathOpen: true });
  await Promise.all([openStep(exists ? n : null).then(() => {
    if (bench) { store.set({ teach: bench === "teach", tiny: bench === "grow" }); history.replaceState(null, "", `#${bench}`); }
  }), checkDevice()]);
  addEventListener("hashchange", () => {
    if (store.get().teachingBusy) return;
    if (location.hash === "#teach" || location.hash === "#grow") {
      if (store.get().busy) stopReply();
      const teach = location.hash === "#teach";
      const show = () => store.set({teach,tiny:!teach,sheet:false,pathOpen:false});
      if (teach && store.get().model.id === "tiny") void backToQwen().then(show);
      else show();
      return;
    }
    const mm = /^#step-(\d+)$/.exec(location.hash);
    if (!mm) return;
    const k = Number(mm[1]);
    if (path?.steps.some((s) => s.n === k)) void openStep(k);
    else store.set({ pathOpen: true });
  });
}
