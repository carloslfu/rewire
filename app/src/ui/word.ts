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
  /** Position of that read piece in the side's whole conversation. */
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
  let position = 0;
  for (let i = 0; i < w.turn; i++) {
    const t = s.turns[i];
    const r = w.side === "changed" && s.fork >= 0 && i >= s.fork && t.changed ? t.changed : t.normal;
    position += r.read.length + r.toks.length;
  }
  position += reply.read.length + w.index - 1;
  const comparison = turn.changed?.compare;
  const sameReply = comparison?.length === turn.normal.toks.length && comparison?.every((x, i) => x.id === turn.normal.toks[i].id);
  const compared = w.side === "normal" && !turn.changed?.stale && sameReply ? comparison?.[w.index] : undefined;
  const forced = compared?.id === tok.id && compared.pushes.length === tok.pushes.length ? compared : undefined;
  return { ref: w, turn, reply, tok, input, position, forced };
}

/** Use an explicitly identified original token, never subtract unrelated generated tokens. */
export function originalWord(s: Pick<State, "turns" | "word">): WordRef | null {
  const turn = s.word?.turn ?? s.turns.length - 1;
  const toks = s.turns[turn]?.normal.toks;
  if (!toks?.length) return null;
  const visible = toks.map((t, i) => [151643, 151645].includes(t.id) ? -1 : i).filter((i) => i >= 0);
  if (!visible.length) return null;
  const wanted = s.word?.index ?? visible[visible.length - 1];
  const index = visible.find((i) => i >= wanted) ?? visible[visible.length - 1];
  return { turn, side: "normal", index };
}

/** A comparison can be opened while following either reply. Its reference is always original. */
export function comparisonTarget(s: Pick<State, "turns" | "word" | "fork">): WordRef | null {
  const word = originalWord(s);
  return word && chosen({ ...s, word })?.forced ? word : null;
}

/** Resume at the newest visible output, retaining the original reference in comparison view. */
export function latestWord(s: Pick<State, "turns" | "view">): WordRef | null {
  const turn = s.turns.length - 1;
  const t = s.turns[turn];
  if (!t) return null;
  const sides = s.view === "difference" || t.changed?.stale ? ["normal"] as const : ["changed", "normal"] as const;
  for (const side of sides) {
    const toks = (side === "normal" ? t.normal : t.changed)?.toks ?? [];
    for (let index = toks.length - 1; index >= 0; index--) {
      if (![151643, 151645].includes(toks[index].id)) return { turn, side, index };
    }
  }
  return null;
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
