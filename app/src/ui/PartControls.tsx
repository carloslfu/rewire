// The real controls of the running model, shown beside the 3D stage: the selected part's strength,
// the taught adapter's switch, and the whole-model experiments.
import type { Focus } from "../model/types.ts";
import { chipsWith, piece, setFocus, stepData } from "../state/actions.ts";
import { useStore } from "../state/store.ts";
import { scoreLabel } from "./color.ts";
import { geometryLabel, multOf, withMult } from "./describe.ts";
import { HeadExampleHint, NeuronControl } from "./Examples.tsx";
import { Knob } from "./Knob.tsx";
import { tokenLabel } from "./token-label.ts";
import { chosen, headIndex, memIndex, towerValues } from "./word.ts";

type Part = Extract<Focus, { kind: "head" | "memory" | "floor" }>;

/** The switch for the adapter trained in Teach, once one exists. */
export function LearnedControl({ disabled }: { disabled: boolean }) {
  const chips = useStore((s) => s.chips);
  const model = useStore((s) => s.model);
  const lessonRevision = useStore((s) => s.lessonRevision);
  if (model.id !== "qwen" || lessonRevision <= 0) return null;
  return <div className="learned-control">
    <div><strong>Learned weights</strong><p>Inside layer 28’s MLP</p></div>
    <div className="seg" role="group" aria-label="Use learned weights"><button disabled={disabled} aria-pressed={!chips.lesson} onClick={() => void chipsWith(s => ({ ...s, lesson: undefined }))}>Off</button><button disabled={disabled} aria-pressed={chips.lesson === lessonRevision} onClick={() => void chipsWith(s => ({ ...s, lesson: lessonRevision }))}>On</button></div>
  </div>;
}

export function MoreExperiments({ disabled }: { disabled: boolean }) {
  const chips = useStore((s) => s.chips);
  const model = useStore((s) => s.model);
  const zero = stepData(2)?.control;
  const setLayer = (floor: number) => void chipsWith((s) => withMult(s, "floor", floor, 0, multOf(s, "floor", floor) === 0 ? 1 : 0));
  return <section className="lab-controls" aria-label="More experiments">
    <h3>More experiments</h3>
    <div className="intervention-buttons" role="group" aria-label="Model interventions">
      <button className="btn" aria-pressed={multOf(chips, "floor", 0) === 0} disabled={disabled} onClick={() => setLayer(0)}>Cut layer 1</button>
      <button className="btn" aria-pressed={multOf(chips, "floor", Math.floor(model.floors / 2)) === 0} disabled={disabled} onClick={() => setLayer(Math.floor(model.floors / 2))}>Cut layer {Math.floor(model.floors / 2) + 1}</button>
      {model.id === "qwen" && <button className="btn" disabled={disabled} aria-pressed={chips.bits === 2} onClick={() => void chipsWith((s) => ({ ...s, bits: s.bits === 2 ? 4 : 2 }))}>Crush precision</button>}
      {model.id === "qwen" && zero?.kind === "zeroed" && <button className="btn" disabled={disabled} aria-pressed={!!chips.zeroed?.length} onClick={() => void chipsWith((s) => ({ ...s, zeroed: s.zeroed?.length ? [] : zero.weights }))}>Zero {zero.weights.length} weights</button>}
      <button className="btn" disabled={disabled} onClick={() => setFocus({ kind: "head", floor: Math.min(16, model.floors - 1), head: 0 })}>Rotate an attention head</button>
      {model.id === "qwen" && <button className="btn" onClick={() => setFocus({ kind: "bits" })}>Weight precision: {chips.bits ?? 4} bits</button>}
    </div>
    <p className="note">Model changes apply to every sample. Each question is tested independently, with its original answer alongside. Restoring the model brings back the original answers.</p>
  </section>;
}

export function PartControls({ part, disabled, onClose, showReading, outputSize, replaying }: {
  part: Part; disabled: boolean; onClose: () => void; showReading: boolean; outputSize?: string; replaying?: boolean;
}) {
  const chips = useStore((s) => s.chips);
  const c = chosen(useStore((s) => s));
  const view = useStore((s) => s.view);
  const head = part.kind === "head" ? part.head : 0;
  const mult = multOf(chips, part.kind, part.floor, head);
  const name = part.kind === "head" ? `Attention head ${head + 1} · Layer ${part.floor + 1}` : part.kind === "memory" ? `MLP · Layer ${part.floor + 1}` : `Layer ${part.floor + 1}`;
  const vals = towerValues(c, view);
  const value = vals && part.kind !== "floor" ? vals[part.kind === "head" ? headIndex(part.floor, head) : memIndex(part.floor)] : undefined;
  const geometry = part.kind === "head" ? chips.geometry?.find((g) => g.floor === part.floor && g.head === part.head) : undefined;
  const hasQuestion = useStore((s) => s.turns.length > 0);
  const layerOff = part.kind !== "floor" && multOf(chips, "floor", part.floor) === 0;
  // Changes that live on a layer and have no control of their own here: they are named, so a layer that is drawn as changed says why.
  const zeroed = part.kind === "floor" ? chips.zeroed?.filter((z) => z.floor === part.floor).length ?? 0 : 0;
  const concept = part.kind === "floor" && chips.concept && chips.concept.strength !== 0 && chips.concept.floor === part.floor ? chips.concept : null;
  return <section className="scope-part" aria-label="Selected component controls">
    <div className="section-heading"><h3>{name}</h3><button className="btn quiet" onClick={onClose} aria-label="Close component controls">Close</button></div>
    {showReading && value !== undefined && c && <p className="scope-measurement"><span className="num">{scoreLabel(value)}</span> {view === "difference" ? "change in direct push" : "direct push"} for “{tokenLabel(piece(c.tok.id))}”</p>}
    {showReading && outputSize && <p className="scope-measurement">{part.kind === "floor" ? "Largest part output" : "Output size"}{view === "difference" ? " in the original run" : ""} <span className="num">{outputSize}</span></p>}
    {replaying && <p className="note">The settings below apply to the live model. Editing ends replay.</p>}
    {part.kind === "memory" && part.floor === 27 && chips.lesson && <p className="note changed-text">Includes your learned weights. Off disables the MLP and its learned addition together.</p>}
    {geometry && <p className="scope-measurement changed-text">{geometryLabel(geometry)} · Strength below applies on top.</p>}
    {zeroed > 0 && <p className="scope-measurement changed-text">{zeroed === 1 ? "One weight" : `${zeroed} weights`} in this layer set to zero.</p>}
    {concept && <p className="scope-measurement changed-text">“{concept.id}” pushed here, strength {concept.strength}.</p>}
    {part.kind === "memory" && <NeuronControl floor={part.floor} />}
    {part.kind === "head" && <HeadExampleHint floor={part.floor} head={part.head} />}
    <Knob label={`${name} signal strength`} value={mult} disabled={disabled}
      onChange={(v) => void chipsWith((s) => withMult(s, part.kind, part.floor, head, v))} />
    <p className="note">{layerOff ? "This layer is off. Restore the layer to use this part's signal." : "Scale the output signal: zero it, reverse it, or amplify it."}</p>
    <div className="scope-part-footer"><span className="note">{disabled ? "Waiting for the model" : hasQuestion ? "Updates each sample separately" : "Applies to your samples"}</span><button className="linkish" onClick={() => setFocus(part)}>{part.kind === "head" ? "Rotate & inspect" : "Inspect details"} →</button></div>
  </section>;
}
