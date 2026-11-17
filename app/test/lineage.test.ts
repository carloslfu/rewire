// The weights the Grow bench holds. Retraining a damaged copy must never cost the visitor the intact
// weights behind it: those change only when a run from intact weights ends, when the visitor starts
// over, or when they make the copy the intact one themselves.
import { expect, it } from "vitest";
import { afterAdopting, afterDamage, afterRestore, afterTraining, type Checkpoint, continueNote, copyLabel, endRun, failureNote, type Held, isDamaged, NOTHING_HELD,
  type Run, runIsCurrent, runNote, runUpTo, UNTRAINED, whileTraining } from "../src/tiny/lineage.ts";

/** A history that ends at `step`: a checkpoint every 100 steps and one loss per step. */
const history = (step: number, from = 0, before: number[] = []): Run => ({
  samples: Array.from({ length: Math.floor((step - from) / 100) + 1 }, (_, i) => ({ step: from + i * 100, text: `sample at ${from + i * 100}` })),
  losses: [...before, ...Array.from({ length: step - from }, (_, i) => 3 - (from + i + 1) / 1000)],
});
const at = (step: number, value = step): Checkpoint => ({ params: new Float32Array([value]), step, corpus: `text up to ${step}`, run: history(step) });
const held = (c: Checkpoint, lineage = afterTraining(UNTRAINED, c, c.step)): Held => ({ params: c.params, step: c.step, corpus: c.corpus, run: c.run, lineage });

it("makes the result of a run from intact weights the new intact copy", () => {
  // No intact copy while the first run is under way, and none is invented if it fails.
  expect(whileTraining(UNTRAINED).intact).toBeNull();
  const first = afterTraining(whileTraining(UNTRAINED), at(1200), 1200);
  expect(first).toEqual({ intact: at(1200), damage: "", retrained: 0 });
  // Keep learning from intact weights: the old copy gives way to the new one when the run ends, not before.
  const running = whileTraining(first);
  expect(running.intact).toBeNull();
  expect(afterTraining(running, at(1506), 306).intact).toEqual(at(1506));
  expect(continueNote(first)).toBe("");
  expect(copyLabel(first)).toBe("");
});

it("keeps the intact weights through damage and through any amount of retraining of the damaged copy", () => {
  const trained = afterTraining(UNTRAINED, at(1200), 1200), intact = trained.intact!;
  const damaged = afterDamage(trained, "Layer 2: noise at 25% of each matrix’s RMS");
  expect(isDamaged(damaged)).toBe(true);
  expect(damaged.intact).toBe(intact);
  // Before continuing, the bench says what continuing will do.
  expect(continueNote(damaged)).toBe("Training continues from the damaged copy. The intact weights from step 1,200 are kept, and Restore intact model returns to them.");
  // The run starts, is stopped after 306 steps, and another follows. The intact weights are the same object throughout.
  let now = whileTraining(damaged);
  expect(now.intact).toBe(intact);
  now = afterTraining(now, at(1506, 7), 306);
  expect(now).toMatchObject({ damage: damaged.damage, retrained: 306 });
  expect(now.intact).toBe(intact);
  now = afterTraining(whileTraining(now), at(1706, 8), 200);
  expect(now.intact).toBe(intact);
  expect(now.retrained).toBe(506);
  expect(copyLabel(now)).toBe("Layer 2: noise at 25% of each matrix’s RMS, then 506 more training steps");
  // A run that completed no step changes nothing.
  expect(afterTraining(whileTraining(now), at(1706, 8), 0)).toEqual(now);
  // Restore returns to them, with the step and the text they stand for.
  const restored = afterRestore(now);
  expect(restored).toEqual({ intact, damage: "", retrained: 0 });
  expect(restored.intact!.step).toBe(1200);
  expect(restored.intact!.corpus).toBe("text up to 1200");
});

it("starts every damage from the intact weights and replaces them only when the visitor says so", () => {
  const trained = afterTraining(UNTRAINED, at(1200), 1200), intact = trained.intact!;
  const retrained = afterTraining(afterDamage(trained, "Erased approximately 25% of matrix weights"), at(1500, 3), 300);
  // A second experiment on a retrained copy discards the copy, not the intact weights, and counts its retraining from zero.
  const again = afterDamage(retrained, "Noise at 50% of each matrix’s RMS");
  expect(again).toEqual({ intact, damage: "Noise at 50% of each matrix’s RMS", retrained: 0 });
  // Making the retrained copy the intact one is the single step that lets the old weights go.
  const adopted = afterAdopting(at(1500, 3));
  expect(adopted).toEqual({ intact: at(1500, 3), damage: "", retrained: 0 });
  expect(adopted.intact).not.toBe(intact);
  // Nothing can be damaged before there are trained weights.
  expect(afterDamage(UNTRAINED, "Noise")).toBe(UNTRAINED);
  expect(copyLabel(afterTraining(afterDamage(trained, "Noise"), at(1201), 1))).toBe("Noise, then 1 more training step");
});

it("brings a checkpoint's own history back with it, and never shows a retrained copy's loss under restored weights", () => {
  const intact = at(1200), trained = held(intact);
  // Scramble: the copy has no training of its own. The history shown is the intact run's, and is said to be.
  const damaged = afterDamage(trained.lineage, "Noise at 25% of each matrix’s RMS");
  expect(runIsCurrent(trained.lineage)).toBe(true);
  expect(runIsCurrent(damaged)).toBe(false);
  expect(runNote(damaged)).toBe("This is the run that trained the intact weights, to step 1,200. The damaged copy on screen has not been trained since.");
  // Retrain the damaged copy for 306 steps: its history is its own now, with its own last checkpoint and loss.
  const start: Held = { params: new Float32Array([9]), step: 1200, corpus: intact.corpus, run: intact.run, lineage: damaged };
  const retraining = history(1506, 1200, intact.run.losses);
  const after = endRun(start, { params: new Float32Array([10]), steps: 306 }, "text up to 1506", retraining);
  expect(after).toMatchObject({ step: 1506, corpus: "text up to 1506", run: retraining });
  expect(after.lineage.retrained).toBe(306);
  expect(runIsCurrent(after.lineage)).toBe(true);
  expect(runNote(after.lineage)).toBe("");
  expect(after.run.samples.at(-1)!.step).toBe(1500);
  // Restore: the intact checkpoint still carries the history that ends at step 1,200, not the copy's at 1,506.
  const back = after.lineage.intact!;
  expect(back).toBe(intact);
  expect(back.run.samples.at(-1)!.step).toBe(1200);
  expect(back.run.losses).toHaveLength(1200);
  expect(back.run.losses.at(-1)).not.toBe(after.run.losses.at(-1));
  // A new damage experiment after retraining starts from the same checkpoint and so from the same history.
  const again = afterDamage(after.lineage, "Erased approximately 25% of matrix weights");
  expect(again.intact!.run).toBe(intact.run);
  expect(runIsCurrent(again)).toBe(false);
  // Making the retrained copy the intact one keeps the copy's history with it.
  const adopted = afterAdopting({ params: after.params!, step: after.step, corpus: after.corpus, run: after.run });
  expect(adopted.intact!.run).toBe(retraining);
  expect(runIsCurrent(adopted)).toBe(true);
});

it("ends a failed run on the last weights it delivered, or as it began, and never without usable weights", () => {
  const intact = at(1200), trained = held(intact);
  const corpus = "text up to 1200\nmore", run = history(1437, 1200, intact.run.losses);
  // Keep learning from intact weights fails at step 237 of the run. The last snapshot was at 200.
  const snapshot = { params: new Float32Array([5]), steps: 200 };
  const kept = endRun(trained, snapshot, corpus, runUpTo(run, 1200, 1200, 200));
  expect(kept).toMatchObject({ params: snapshot.params, step: 1400, corpus });
  expect(kept.lineage).toEqual({ intact: { params: snapshot.params, step: 1400, corpus, run: kept.run }, damage: "", retrained: 0 });
  // The history stops where the weights do: nothing of the 37 steps whose weights are gone.
  expect(kept.run.losses).toHaveLength(1400);
  expect(kept.run.samples.map((s) => s.step)).toEqual([1200, 1300, 1400]);
  expect(failureNote(trained, kept)).toBe("The last snapshot of this run, at step 1,400, is kept and can be trained further.");
  // It fails before any step was delivered, or before anything arrived at all: the bench is exactly as it was, intact weights included.
  for (const reached of [{ params: new Float32Array([1200]), steps: 0 }, null]) {
    const same = endRun(trained, reached, corpus, runUpTo(run, 1200, 1200, 0));
    expect(same).toBe(trained);
    expect(same.lineage.intact).toBe(intact);
    expect(failureNote(trained, same)).toBe("The weights are as they were before this run, at step 1,200.");
  }
  // The same while a damaged copy is retrained: the copy keeps what the run delivered, and the intact weights are untouched.
  const copy: Held = { ...trained, params: new Float32Array([9]), lineage: afterDamage(trained.lineage, "Noise") };
  const partly = endRun(copy, snapshot, corpus, runUpTo(run, 1200, 1200, 200));
  expect(partly.lineage).toMatchObject({ damage: "Noise", retrained: 200 });
  expect(partly.lineage.intact).toBe(intact);
  expect(endRun(copy, null, corpus, run)).toBe(copy);
  // A first run from noise that fails after its first snapshot keeps that snapshot as weights to go on from.
  const first = endRun(NOTHING_HELD, { params: new Float32Array([2]), steps: 100 }, "text", history(100));
  expect(first.lineage.intact).toMatchObject({ step: 100, corpus: "text" });
  // One that delivered nothing leaves nothing, which is the state Start learning begins from.
  const none = endRun(NOTHING_HELD, null, "text", history(0));
  expect(none).toBe(NOTHING_HELD);
  expect(failureNote(NOTHING_HELD, none)).toBe("");
  // A run stopped before its first step has not seen the new text.
  expect(endRun(NOTHING_HELD, { params: new Float32Array([2]), steps: 0 }, "text", history(0)).corpus).toBe("");
});
