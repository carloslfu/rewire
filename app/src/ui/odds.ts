// What the draw really did with one token's candidates. The engine lists the top 20 with a softmax
// at the sampling temperature over those 20, then keeps only the first `cut` of them (top-p) and
// draws among those. A kept candidate's real chance is its share of the kept ones; a candidate past
// the cut had none. The model's own probability, at temperature 1 over the whole vocabulary, is a
// different measure and is kept beside these, never mixed into them.
import type { Tok } from "../model/types.ts";

type Listed = Pick<Tok, "cands" | "cut">;

/** How many of the listed candidates the draw kept. */
export function keptCount(tok: Listed): number {
  const n = tok.cands.length;
  return Number.isInteger(tok.cut) && tok.cut >= 1 ? Math.min(tok.cut, n) : n;
}

/**
 * The chance each listed candidate had in the draw, in list order: its share among the kept
 * candidates, and exactly 0 past the cut. NaN where the listed odds are not numbers.
 */
export function drawOdds(tok: Listed): number[] {
  const kept = keptCount(tok);
  let total = 0;
  for (let k = 0; k < kept; k++) total += tok.cands[k].p;
  const usable = Number.isFinite(total) && total > 0;
  return tok.cands.map((c, k) => (k >= kept ? 0 : usable && c.p >= 0 ? c.p / total : Number.NaN));
}

/** How the written piece came to be written, and the chance the draw gave it. */
export type Written =
  | { by: "draw"; chance: number }
  /** Picked by the visitor in place of the draw. `place` says where the draw had it. */
  | { by: "visitor"; chance: number; place: "kept" | "cut" | "unlisted" };

export function written(tok: Pick<Tok, "id" | "cands" | "cut" | "picked">): Written {
  const at = tok.cands.findIndex((c) => c.id === tok.id), odds = drawOdds(tok);
  if (!tok.picked) return { by: "draw", chance: at < 0 ? Number.NaN : odds[at] };
  if (at < 0) return { by: "visitor", chance: 0, place: "unlisted" };
  return { by: "visitor", chance: odds[at], place: at < keptCount(tok) ? "kept" : "cut" };
}
