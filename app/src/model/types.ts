// What the page shows about a conversation. Recordings and the live engine produce the same shapes.
import type { ChangeSpec } from "@rewire/engine/src/changes.ts";

export type { ChangeSpec };

export interface Cand {
  id: number;
  p: number;
}

/** One written word piece and everything the page shows about it. */
export interface Tok {
  id: number;
  /** Log-probability of this piece at temperature 1 without cuts, under the model that wrote it. */
  lp1: number;
  /** The concept's own direct push (0 without a concept). */
  concept: number;
  /** How many candidates the top-p cut kept. */
  cut: number;
  /** The top 20 candidates at the sampling temperature, in the order the draw used. */
  cands: Cand[];
  /** Direct pushes toward this piece: the dictionary row, then per floor its 16 heads and its memory block. */
  pushes: Float32Array;
  /** Top five floor guesses per floor (recordings, or after the word is inspected live). */
  guesses?: Cand[][];
  /** The visitor picked this piece from the candidates. */
  picked?: boolean;
}

/** The changed model fed the normal reply: one entry per normal word. */
export interface Forced {
  id: number;
  lp1: number;
  concept: number;
  pushes: Float32Array;
}

export interface Reply {
  /** Tokens this side read before the reply (turn 1: the whole rendered prompt; later turns: what was appended). */
  read: number[];
  toks: Tok[];
  /** Ended with the end-of-turn marker (rather than the 64-piece cap). */
  ended: boolean;
  /** Finished writing. */
  done: boolean;
  /** The changes it was written under ({} for the normal model). */
  changes: ChangeSpec;
  /** For a changed reply: the changed model fed the normal reply of the same turn. */
  compare?: Forced[];
  /** Written under chips that are no longer on screen: shown as plain text, not inspectable. */
  stale?: boolean;
  /** Where it came from. */
  source: "recording" | "live";
  /** The reply before the visitor picked a word (Undo). */
  original?: Reply;
  /** Index of the picked word. */
  pickedAt?: number;
  /** A replay-only device asked for a change that was not recorded. */
  missing?: boolean;
  /** Recorded words with full floor detail (replay). */
  featured?: number[];
}

export interface Turn {
  user: string;
  /** The seed both sides draw with (a recording's own, or the page's). */
  seed?: number;
  normal: Reply;
  changed?: Reply;
}

export type Side = "normal" | "changed";

/** The word whose numbers the tower and panels show. */
export interface WordRef {
  turn: number;
  side: Side;
  index: number;
}

/** What the detail panel shows. Floors and heads are zero-based here and shown from 1. */
export type Focus =
  | { kind: "word" }
  | { kind: "head"; floor: number; head: number }
  | { kind: "memory"; floor: number }
  | { kind: "floor"; floor: number }
  | { kind: "dictionary" }
  | { kind: "words-in"; position?: number }
  | { kind: "words-out" }
  | { kind: "bits" }
  | { kind: "reads" };

/** Full detail of one word on every floor (featured recordings, or the live inspection pass). */
export type FloorDetail = Map<string, Float32Array>;
