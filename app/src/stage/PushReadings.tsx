// What the lit windows of the model mean, in words and numbers beside the stage: the two colors and
// the scale they are on for the selected token, and one layer's contributions added up. These are the
// same measured pushes the stage lights its windows with.
import type { ModelInfo } from "../model/info.ts";
import { S } from "../strings.ts";
import { scoreLabel } from "../ui/color.ts";
import { hardestFloors } from "../ui/word.ts";
import { pushIndex } from "./arch.ts";

type View = "push" | "difference";

/** The color key of the stage. `scale` is the largest magnitude lit for this token, or null when nothing is lit. */
export function PushLegend({ view, scale, token, word, values, model }: {
  view: View; scale: number | null; token: boolean; word: string; values: Float32Array | null; model: ModelInfo;
}) {
  const hardest = values && view === "push" ? hardestFloors(values) : values ? hardestFloors(values.map(Math.abs)) : null;
  return <div className="stage-legend" role="group" aria-label="Color scale of the lit windows">
    <div className="legend-directions">
      <span className="legend-negative">Blue: {view === "push" ? "against the token" : "decreased"}</span>
      <span className="legend-positive">Orange: {view === "push" ? "toward the token" : "increased"}</span>
    </div>
    {scale !== null && <>
      <div className="legend-tracks" aria-hidden="true"><span /><span /><span /></div>
      <div className="legend-values num" aria-label="Readings of a full blue, empty, and full orange meter"><span>{scoreLabel(-scale)}</span><span>0</span><span>{scoreLabel(scale)}</span></div>
    </>}
    <p className="legend-note">{scale !== null ? "More lit segments mean a larger reading. An empty track means zero. Dark glass means the reading is unavailable or its replay step is ahead."
      : !token ? "Select a token to light the model with its scores."
      : view === "difference" ? "No comparison has been measured for this token yet, so nothing is lit." : "No scores were measured for this token, so nothing is lit."}</p>
    <details className="legend-help">
      <summary>How to read these colors</summary>
      <p>{model.heads} attention heads and one MLP (feed-forward network) in each of {model.floors} layers. The model computes upward, from Words in to Words out.</p>
      {hardest && <p>{view === "push" ? S.summary(hardest[0] + 1, hardest[1] + 1, word) : `The biggest differences are on layers ${hardest[0] + 1} to ${hardest[1] + 1}.`}</p>}
      {view === "push" ? <>
        <p>Each window shows one part’s direct contribution to the selected token’s score relative to the average across the vocabulary. Orange raises that score and blue lowers it.</p>
        <p>Blue does not mean an opposite word. A token is a word, part of a word, a character or punctuation.</p>
      </> : <>
        <p>Each window compares the same part in both models, forcing the original token after this sample’s prompt and original preceding tokens. Blue means its contribution decreased; orange means it increased.</p>
        <p>Each sample is compared on its own prompt. Other samples are never part of it, so a difference comes from the model changes alone.</p>
        <p>An increase can still leave a contribution negative. These colors show the change, not whether the part now supports the token.</p>
      </>}
      <p>The numbers are in logits, the model’s score units. Meter fill uses a compressed scale so small signals stay visible. Use the numbers to compare different tokens.</p>
      <p>Direct contributions use the final normalization scale from this run. To test a part’s total effect, including what it changes in later layers, knock it out and compare the token’s probability.</p>
    </details>
  </div>;
}

/** One layer's pushes added up: its attention heads together, its MLP, and both. Null where a push is not a number. */
export function layerSums(model: Pick<ModelInfo, "heads" | "floors">, values: ArrayLike<number> | null, floor: number): { attention: number | null; mlp: number | null; total: number | null } | null {
  if (!values || floor < 0 || floor >= model.floors) return null;
  let attention: number | null = 0;
  for (let h = 0; h < model.heads; h++) {
    const v = values[pushIndex(model, { kind: "head", floor, head: h })];
    attention = attention === null || !Number.isFinite(v) ? null : attention + v;
  }
  const m = values[pushIndex(model, { kind: "mlp", floor })], mlp = Number.isFinite(m) ? m : null;
  return { attention, mlp, total: attention === null || mlp === null ? null : attention + mlp };
}

/** A layer's attention, MLP and summed contribution for the selected token, as numbers. */
export function LayerReadings({ model, values, floor, view, word }: { model: ModelInfo; values: Float32Array | null; floor: number; view: View; word: string }) {
  const sums = layerSums(model, values, floor);
  if (!sums) return null;
  // A sum of only some of its parts would mislead, so a part without a number leaves its sum unstated.
  const say = (v: number | null) => (v === null ? "unavailable" : scoreLabel(v));
  return <section className="layer-readings" aria-label={`Layer ${floor + 1}: ${view === "difference" ? "changes in direct push" : "direct pushes"} for “${word}”`}>
    <h4>Layer {floor + 1} · {view === "difference" ? "change in direct push" : "direct push"} for “{word}”</h4>
    <dl className="kv">
      <dt>{model.heads} attention heads, summed</dt><dd className="num">{say(sums.attention)}</dd>
      <dt>MLP</dt><dd className="num">{say(sums.mlp)}</dd>
      <dt>Layer total</dt><dd className="num">{say(sums.total)}</dd>
    </dl>
  </section>;
}
