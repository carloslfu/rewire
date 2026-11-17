// The candidates of one step, as the page keeps them: the draw's odds and the model's own probability.
import { NO_CANDIDATE } from "@rewire/engine/src/kernels.ts";
import type { Cand } from "../model/types.ts";

/**
 * `probs` are the draw's odds: a softmax at the sampling temperature over the listed top 20 only,
 * before the top-p cut (the cut is a count kept beside them). A greedy draw gives 1 to the first and 0 to the rest.
 * `candLp` are log-probabilities at temperature 1 over the whole vocabulary. A slot the engine
 * marked as holding no word, or any value that is not a log-probability, gets no model probability.
 */
export function candidates(ids: ArrayLike<number>, probs: ArrayLike<number>, candLp?: ArrayLike<number>): Cand[] {
  return Array.from(ids, (id, k) => {
    const lp = candLp?.[k];
    const real = lp !== undefined && lp !== NO_CANDIDATE && lp <= 0 && !Number.isNaN(lp);
    return real ? { id, p: probs[k], modelP: Math.exp(lp) } : { id, p: probs[k] };
  });
}
