// Measurements produced by the running model.
import type { ChangeSpec } from "@rewire/engine/src/changes.ts";

export type { ChangeSpec };

export interface Cand {
  id: number;
  /**
   * The draw's odds: a softmax at the sampling temperature over the listed top 20 only, before the
   * top-p cut (`Tok.cut` says how many the draw kept). The inspector's candidate table shows these.
   */
  p: number;
  /**
   * The model's own probability of this piece: temperature 1, over the whole vocabulary, the same
   * measure as exp(lp1). Absent where the engine did not report one.
   */
  modelP?: number;
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
  /** RMS of each part’s residual vector in the same order. Older measurements can lack it. */
  activity?: Float32Array;
  /** Top five floor guesses per floor (after the word is inspected). */
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
  /** This sample's complete rendered prompt. Other samples are never included. */
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
  /** A live pass measuring the changed model on the original reply's tokens. */
  comparing?: boolean;
  compareError?: string;
  /** Written under chips that are no longer on screen: shown as plain text, not inspectable. */
  stale?: boolean;
  /** Where it came from. */
  source: "live";
  /** The reply before the visitor picked a word (Undo). */
  original?: Reply;
  /** Index of the picked word. */
  pickedAt?: number;
  /**
   * Which writing of this reply this is: a number no other writing has had. A pick replaces tokens
   * already written and so gets a new one. Continue only adds tokens and keeps it, and Undo brings
   * back the reply it restores with the number that reply had. Anything measured for a token is
   * keyed on it, so it is never shown for the same token after other preceding tokens.
   */
  rev?: number;

}

export interface Turn {
  /** Stable identity, independent of the sample's position in the list. */
  id: number;
  user: string;
  /** Sampling settings shared by both sides, retained across interventions. */
  seed?: number;
  temperature?: number;
  normal: Reply;
  changed?: Reply;
}

export type Side = "normal" | "changed";

/** The word whose numbers the model and the panels show. */
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
  | { kind: "words-in"; position?: number; side?: Side }
  | { kind: "words-out" }
  | { kind: "bits" }
  | { kind: "reads" };

/** Full detail of one word on every floor (the live inspection pass). */
export type FloorDetail = Map<string, Float32Array>;
