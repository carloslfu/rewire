// Which weights the Grow bench is holding, and what each action does to them. Scramble and Erase
// make a damaged copy of the intact weights, and the damaged copy can be trained further to watch it
// recover. Whatever happens to the copy, the intact weights it came from stay until the visitor
// starts over from noise or makes the copy the intact one themselves. Nothing else replaces them.

/** The training history the bench shows: sample texts at checkpoints of the latest run, and the loss of every step so far. */
export interface Run {
  samples: { step: number; text: string }[];
  losses: number[];
}

export const NO_RUN: Run = { samples: [], losses: [] };

/**
 * Weights with the training they stand for: the step they were reached at, the text they have seen,
 * and the history that led to them. The history comes back with the weights, so a loss or a
 * checkpoint on screen is never one that other weights produced.
 */
export interface Checkpoint {
  params: Float32Array;
  step: number;
  corpus: string;
  run: Run;
}

export interface Lineage {
  /** The weights last trained without damage. Every experiment starts from them and Restore returns to them. */
  intact: Checkpoint | null;
  /** What was done to the copy on screen; "" while the copy on screen is the intact one. */
  damage: string;
  /** Training steps run on the damaged copy since it was damaged. */
  retrained: number;
}

export const UNTRAINED: Lineage = { intact: null, damage: "", retrained: 0 };

/** Whether the weights on screen are a damaged copy, retrained or not. */
export const isDamaged = (l: Lineage) => l.damage !== "";

/**
 * A training run is starting from the weights on screen. From the intact weights there is no intact
 * copy again until the run ends and its result becomes one. From a damaged copy the intact weights
 * are not part of the run and are kept.
 */
export function whileTraining(l: Lineage): Lineage {
  return isDamaged(l) ? l : { ...l, intact: null };
}

/** A training run ended on `now` after `steps` steps. */
export function afterTraining(l: Lineage, now: Checkpoint, steps: number): Lineage {
  return isDamaged(l) ? { ...l, retrained: l.retrained + Math.max(0, steps) } : { intact: now, damage: "", retrained: 0 };
}

/** The intact weights were copied and the copy damaged. Each damage starts again from the intact weights. */
export function afterDamage(l: Lineage, label: string): Lineage {
  return l.intact ? { ...l, damage: label, retrained: 0 } : l;
}

/** The intact weights are on screen again. */
export function afterRestore(l: Lineage): Lineage {
  return { ...l, damage: "", retrained: 0 };
}

/** The visitor made the copy on screen the intact one. This is the one action that replaces the intact weights. */
export function afterAdopting(now: Checkpoint): Lineage {
  return { intact: now, damage: "", retrained: 0 };
}

/** The copy on screen in words, for the bench and its 3D view; "" for the intact weights. */
export function copyLabel(l: Lineage): string {
  if (!isDamaged(l)) return "";
  return l.retrained ? `${l.damage}, then ${l.retrained.toLocaleString("en-US")} more training ${l.retrained === 1 ? "step" : "steps"}` : l.damage;
}

/** What Keep learning will do from here, said before it is pressed. */
export function continueNote(l: Lineage): string {
  if (!isDamaged(l) || !l.intact) return "";
  return `Training continues from the damaged copy. The intact weights from step ${l.intact.step.toLocaleString("en-US")} are kept, and Restore intact model returns to them.`;
}

/**
 * Whether the history on screen ends at the weights on screen. A damaged copy that has not been
 * trained has no run of its own: what is shown is the run that trained the intact weights.
 */
export const runIsCurrent = (l: Lineage) => !isDamaged(l) || l.retrained > 0;

/** Said beside a history that is not of the weights on screen; "" when it is. */
export function runNote(l: Lineage): string {
  if (runIsCurrent(l) || !l.intact) return "";
  return `This is the run that trained the intact weights, to step ${l.intact.step.toLocaleString("en-US")}. The damaged copy on screen has not been trained since.`;
}

/** Everything the bench holds at once: the weights on screen with their step, text and history, and the lineage behind them. */
export interface Held {
  params: Float32Array | null;
  step: number;
  corpus: string;
  run: Run;
  lineage: Lineage;
}

export const NOTHING_HELD: Held = { params: null, step: 0, corpus: "", run: NO_RUN, lineage: UNTRAINED };

/**
 * What the bench holds when a training run ends, however it ends. `start` is what it held when the
 * run began. `reached` is the last weights the run delivered and the steps they took: its result
 * when it finished or was stopped, its last snapshot when it failed, or null when it delivered
 * nothing. `corpus` and `run` are the text and history as of `reached`.
 *
 * A run that delivered nothing, or trained no step on weights that already existed, leaves the bench
 * exactly as it was, with its intact weights. Otherwise the reached weights are on screen and follow
 * the usual rule: from intact weights they are the new intact copy, and from a damaged copy they are
 * that copy, trained further. So a failed run never leaves weights that cannot be trained again,
 * damaged, restored or opened.
 */
export function endRun(start: Held, reached: { params: Float32Array; steps: number } | null, corpus: string, run: Run): Held {
  if (!reached || (reached.steps <= 0 && start.params)) return start;
  const now: Checkpoint = { params: reached.params, step: start.step + reached.steps, corpus: reached.steps > 0 ? corpus : start.corpus, run };
  return { params: now.params, step: now.step, corpus: now.corpus, run, lineage: afterTraining(start.lineage, now, reached.steps) };
}

/** The history up to `steps` steps of a run that began with `before` losses: later losses and checkpoints were of weights that are gone. */
export function runUpTo(run: Run, before: number, startStep: number, steps: number): Run {
  return { samples: run.samples.filter((s) => s.step <= startStep + steps), losses: run.losses.slice(0, before + Math.max(0, steps)) };
}

/** What a failed run left behind, said after the failure itself; "" when there was nothing to keep or go back to. */
export function failureNote(start: Held, held: Held): string {
  const at = (step: number) => step.toLocaleString("en-US");
  if (held !== start) return `The last snapshot of this run, at step ${at(held.step)}, is kept and can be trained further.`;
  return start.params ? `The weights are as they were before this run, at step ${at(start.step)}.` : "";
}
