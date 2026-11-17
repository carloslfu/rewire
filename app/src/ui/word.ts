// Resolving the chosen word: its record, its reply, the piece it read, and its push comparisons.
import type { Forced, Reply, Tok, Turn, WordRef } from "../model/types.ts";
import type { State } from "../state/store.ts";

import type { ModelInfo } from "../model/info.ts";

// Dimensions of the model on screen (live bindings, updated when the model changes).
export let HEADS = 16;
export let FLOORS = 28;
export let P_PER_FLOOR = HEADS + 1;
export function setDims(m: ModelInfo) {
  HEADS = m.heads;
  FLOORS = m.floors;
  P_PER_FLOOR = m.heads + 1;
}

export const headIndex = (floor: number, head: number) => 1 + floor * P_PER_FLOOR + head;
export const memIndex = (floor: number) => 1 + floor * P_PER_FLOOR + HEADS;

export interface Chosen {
  ref: WordRef;
  turn: Turn;
  reply: Reply;
  tok: Tok;
  /** The piece read at this position (the previous word, or the last prompt piece). */
  input: number;
  /** Position of that read piece within this sample. */
  position: number;
  /** For a normal-reply word with a changed reply: the changed model on this same word. */
  forced?: Forced;
}

export function chosen(s: Pick<State, "turns" | "word" | "fork">): Chosen | null {
  const w = s.word;
  if (!w) return null;
  const turn = s.turns[w.turn];
  if (!turn) return null;
  const reply = w.side === "normal" ? turn.normal : turn.changed;
  const tok = reply?.toks[w.index];
  if (!reply || !tok) return null;
  const input = w.index > 0 ? reply.toks[w.index - 1].id : reply.read[reply.read.length - 1];
  const position = reply.read.length + w.index - 1;
  const comparison = turn.changed?.compare;
  const sameReply = comparison?.length === turn.normal.toks.length && comparison?.every((x, i) => x.id === turn.normal.toks[i].id);
  const compared = w.side === "normal" && !turn.changed?.stale && sameReply ? comparison?.[w.index] : undefined;
  const forced = compared?.id === tok.id && compared.pushes.length === tok.pushes.length ? compared : undefined;
  return { ref: w, turn, reply, tok, input, position, forced };
}

const STOPS = [151643, 151645];
/** End-of-reply markers are written by the model but are never shown or selected. */
export const isStop = (id: number) => STOPS.includes(id);

/** Positions of the tokens that can be selected in a reply. A stale reply has none. */
export function visibleTokens(reply: Reply | undefined): number[] {
  if (!reply || reply.stale) return [];
  return reply.toks.map((t, i) => (isStop(t.id) ? -1 : i)).filter((i) => i >= 0);
}

/** The visible token at or after a position, or the last one before it. -1 when there is none. */
function nearestVisible(reply: Reply | undefined, index: number): number {
  const visible = visibleTokens(reply);
  return visible.find((i) => i >= index) ?? visible[visible.length - 1] ?? -1;
}

/** Use an explicitly identified original token, never subtract unrelated generated tokens. */
export function originalWord(s: Pick<State, "turns" | "word">): WordRef | null {
  const turn = s.word?.turn ?? s.turns.length - 1;
  const index = nearestVisible(s.turns[turn]?.normal, s.word?.index ?? Infinity);
  return index < 0 ? null : { turn, side: "normal", index };
}

/** A comparison can be opened while following either reply. Its reference is always original. */
export function comparisonTarget(s: Pick<State, "turns" | "word" | "fork">): WordRef | null {
  const word = originalWord(s);
  return word && chosen({ ...s, word })?.forced ? word : null;
}

// ---------------------------------------------------------------- following and paused selection
//
// Following selects the newest visible token of the sample whose output was written most recently.
// Paused keeps the visitor's own token, and moves it only when that token no longer exists.

type Output = Pick<State, "turns" | "view"> & Partial<Pick<State, "outputSample">>;
type Selection = Output & Pick<State, "word" | "follow">;

/** The sample that following tracks: the one written most recently, or the last one. */
function outputIndex(s: Output): number {
  const at = s.outputSample == null ? -1 : s.turns.findIndex((t) => t.id === s.outputSample);
  return at >= 0 ? at : s.turns.length - 1;
}

/**
 * The newest visible token of one sample. Push prefers the current changed reply and falls back to
 * the original while the changed reply is empty. A comparison is always anchored to an original token.
 */
function newestIn(t: Turn, view: State["view"]): Pick<WordRef, "side" | "index"> | null {
  for (const side of view === "difference" ? ["normal"] as const : ["changed", "normal"] as const) {
    const index = visibleTokens(side === "normal" ? t.normal : t.changed).at(-1);
    if (index !== undefined) return { side, index };
  }
  return null;
}

/** The newest token of the sample closest to a position in the list, or null when nothing is visible. */
function nearestSample(s: Output, from: number, skip = -1): WordRef | null {
  const order = s.turns.map((_, i) => i).filter((i) => i !== skip).sort((a, b) => Math.abs(a - from) - Math.abs(b - from) || a - b);
  for (const turn of order) {
    const found = newestIn(s.turns[turn], s.view);
    if (found) return { turn, ...found };
  }
  return null;
}

/** The newest visible output. Null while the followed sample is still waiting for its first token. */
export function latestWord(s: Output): WordRef | null {
  const turn = outputIndex(s), t = s.turns[turn];
  if (!t) return null;
  const found = newestIn(t, s.view);
  if (found) return { turn, ...found };
  const writing = !t.normal.done || (s.view === "push" && !!t.changed && !t.changed.stale && !t.changed.done);
  return writing ? null : nearestSample(s, turn, turn);
}

/**
 * The paused selection, kept while its token exists. Otherwise the nearest token of the same reply,
 * then of the same sample's original reply, then the newest token of the nearest remaining sample.
 */
function keptWord(s: Selection, near?: number): WordRef | null {
  const w = s.word, t = w ? s.turns[w.turn] : undefined;
  if (w && t) {
    const sides = s.view === "difference" || w.side === "normal" ? ["normal"] as const : ["changed", "normal"] as const;
    for (const side of sides) {
      const index = nearestVisible(side === "normal" ? t.normal : t.changed, w.index);
      if (index >= 0) return side === w.side && index === w.index ? w : { turn: w.turn, side, index };
    }
  }
  return nearestSample(s, near ?? w?.turn ?? outputIndex(s));
}

/**
 * The selection and view after output was added, replaced or removed. `near` is the list position a
 * deleted selection was at. The comparison view is kept only for a sample that has a current changed reply.
 */
export function settledSelection(s: Selection, near?: number): Pick<State, "word" | "view"> {
  const select = (view: State["view"]) => (s.follow ? latestWord({ ...s, view }) : keptWord({ ...s, view }, near));
  let view = s.view, word = select(view);
  if (view === "difference") {
    const changed = s.turns[word?.turn ?? outputIndex(s)]?.changed;
    if (!changed || changed.stale) { view = "push"; word = select(view); }
  }
  const same = !!word && !!s.word && word.turn === s.word.turn && word.side === s.word.side && word.index === s.word.index;
  return { word: same ? s.word : word, view };
}

/** Pushes the tower shows: each part's push, or changed minus normal on the same word. */
export function towerValues(c: Chosen | null, view: "push" | "difference"): Float32Array | null {
  if (!c) return null;
  if (view === "push") return c.tok.pushes;
  if (!c.forced) return null;
  const out = new Float32Array(c.tok.pushes.length);
  for (let i = 0; i < out.length; i++) out[i] = c.forced.pushes[i] - c.tok.pushes[i];
  return out;
}

export function maxAbs(v: Float32Array): number {
  let m = 0;
  for (const x of v) m = Math.max(m, Math.abs(x));
  return m || 1;
}

/** The run of up to six floors with the largest total push (screen-reader summary). */
export function hardestFloors(v: Float32Array): [number, number] {
  const per = Array.from({ length: FLOORS }, (_, L) => {
    let s = 0;
    for (let j = 0; j < P_PER_FLOOR; j++) s += v[1 + L * P_PER_FLOOR + j];
    return s;
  });
  let best = 0, at = 0;
  const W = Math.min(6, Math.max(1, Math.round(FLOORS / 4)));
  for (let a = 0; a + W <= FLOORS; a++) {
    const s = per.slice(a, a + W).reduce((x, y) => x + y, 0);
    if (s > best) { best = s; at = a; }
  }
  // trim weak ends
  let lo = at, hi = at + W - 1;
  const peak = Math.max(...per.slice(lo, hi + 1));
  while (lo < hi && per[lo] < peak * 0.2) lo++;
  while (hi > lo && per[hi] < peak * 0.2) hi--;
  return [lo, hi];
}
