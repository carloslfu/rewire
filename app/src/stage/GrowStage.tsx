// Grow in 3D: the tiny transformer built from its real configuration. Each part is colored by its
// own slice of the parameter array, and Punch rewrites a layer's actual weights.
import { useEffect, useId, useMemo, useState } from "react";
import { layout, TINY } from "@rewire/tiny/src/config.ts";
import { VOCAB } from "@rewire/tiny/src/data.ts";
import { TINY_INFO } from "../model/info.ts";
import { store } from "../state/store.ts";
import { tinyDictPlate, tinyLayerPlates, tinyValues } from "./adapters.ts";
import { buildArch, type Part, partIndex, partName } from "./arch.ts";
import type { Pose } from "./intervene.ts";
import type { BaySpec, Stage, Tool } from "./scene/stage.ts";
import { RealNote, Workbench } from "./Workbench.tsx";

const cfg = { ...TINY, vocab: VOCAB };

export interface Damage { kind: "noise" | "erase"; floor?: number }

export interface GrowControls {
  /** A reply or training step is in flight. */
  disabled: boolean;
  unavailable: boolean;
  validText: boolean;
  status: string;
  loss: number | null;
  mutation: string;
  damage: Damage | null;
  strength: number;
  setStrength: (v: number) => void;
  teach: (resume: boolean) => void;
  stop: () => void;
  mutate: (kind: Damage["kind"], floor?: number) => void;
  restore: () => void;
  /** What the continue button is called: it trains the damaged copy while one is on screen. */
  keepLabel: string;
  /** What continuing will do to the damaged copy and the intact weights; "" when nothing is damaged. */
  continueNote: string;
  /** Training steps run on the damaged copy. */
  retrained: number;
  /** The step the intact weights were trained to. */
  intactStep: number;
  /** Make the retrained copy the intact one. */
  adopt: () => void;
  prompt: string;
  setPrompt: (v: string) => void;
  test: () => void;
  result: { prompt: string; text: string; model: string } | null;
  baseline: { prompt: string; text: string } | null;
}

export default function GrowStage({ params, reference, intact, step, running, active, controls }: {
  params: Float32Array | null; reference: Float32Array | null; intact: Float32Array | null; step: number; running: boolean; active: boolean; controls: GrowControls;
}) {
  const arch = useMemo(() => buildArch(TINY_INFO), []);
  const [stage, setStage] = useState<Stage | null>(null);
  const [selected, setSelected] = useState<Part | null>(null);
  const [difference, setDifference] = useState(true);
  const strengthId = useId();
  const { damage, disabled, strength } = controls;
  const values = useMemo(() => (difference && !reference ? null : tinyValues(arch, cfg, params, difference ? reference : null)), [arch, params, reference, difference]);
  const hit = (floor: number) => !!damage && (damage.floor === undefined || damage.floor === floor);
  const poses = useMemo((): Pose[] => arch.parts.map((p) => ({ mult: 1, off: false, roll: 0,
    edited: "floor" in p && p.kind !== "kv" && !!damage && (damage.floor === undefined || damage.floor === p.floor) })), [arch, damage]);
  const floor = selected && "floor" in selected ? selected.floor : -1;
  const dictionary = selected?.kind === "embed" || selected?.kind === "unembed";
  const bay = useMemo((): BaySpec | null => {
    if (floor < 0 && !dictionary) return null;
    // The embedding table opens above the dictionary block, or below the output block that reuses it.
    const at = floor >= 0 ? floor : selected?.kind === "embed" ? -1 : arch.floors - 1, key = floor >= 0 ? `tiny.layer.${floor}` : `tiny.dict.${at}`;
    if (!params) return { key, floor: at, plates: [], message: "The weights appear when you start learning." };
    const base = difference ? reference : null;
    return { key, floor: at, plates: floor >= 0 ? tinyLayerPlates(cfg, params, base, floor) : [tinyDictPlate(cfg, params, base)] };
  }, [arch, floor, dictionary, selected?.kind, params, reference, difference]);

  useEffect(() => { stage?.setValues(values?.scaled ?? null, "size"); }, [stage, values]);
  useEffect(() => { stage?.setPoses(poses); }, [stage, poses]);
  useEffect(() => { stage?.setBay(bay); }, [stage, bay]);

  const say = (announce: string) => store.set({ announce });
  const measure = difference ? "RMS change since the start" : "RMS weight size";
  const punch = (part: Part): boolean => {
    if (!("floor" in part)) { say("Punch works on layers here."); return false; }
    if (!intact) { say("Train the model first. Punch needs learned weights to scramble."); return false; }
    if (disabled) { say("Wait for the current step to finish."); return false; }
    if (damage && damage.floor === part.floor) { controls.restore(); say(`Layer ${part.floor + 1} restored from the intact copy.`); }
    else { controls.mutate("noise", part.floor); say(`Layer ${part.floor + 1} scrambled at ${Math.round(strength * 100)}%. Generating with the damaged weights.`); }
    return true;
  };
  const describe = (part: Part, tool: Tool) => {
    const v = values?.raw[partIndex(TINY_INFO, part)];
    return [partName(TINY_INFO, part), v !== undefined && !Number.isNaN(v) ? `${measure}: ${v.toFixed(5)}` : "Waiting for weights",
      tool === "punch" ? ("floor" in part ? (hit(part.floor) && damage?.floor === part.floor ? "Click to restore this layer" : "Click to scramble this layer's weights") : "Punch works on layers here") : "",
      tool === "grab" && (part.kind === "head" || part.kind === "mlp" || part.kind === "layer") ? "Drag to move it. The model does not change." : ""].filter(Boolean).join("\n");
  };

  const actions = <div className="row training-actions">
    {running ? <button type="button" className="btn primary" onClick={controls.stop}>Stop learning</button>
      : <><button type="button" className="btn primary" disabled={disabled || controls.unavailable || !controls.validText} onClick={() => controls.teach(false)}>{params ? "Start over from noise" : "Start learning"}</button>
        {params && <button type="button" className="btn" disabled={disabled || controls.unavailable || !controls.validText} onClick={() => controls.teach(true)}>{controls.keepLabel}</button>}</>}
    <span className="num">{step.toLocaleString("en-US")} steps{controls.loss !== null ? ` · loss ${controls.loss.toFixed(3)}` : ""}</span>
  </div>;

  const transport = <section className="stage-transport" aria-label="Training">
    {actions}
    <p className="note training-status" role="status">{controls.unavailable ? "Live training needs WebGPU. Try Chrome on a supported device." : controls.status || (params ? "Colors refresh from the real weights every 100 steps." : "Start learning to watch every part's weights move.")}</p>
    {controls.continueNote && !running && <p className="note">{controls.continueNote}</p>}
    <div className="seg" role="group" aria-label="Colors show"><button type="button" aria-pressed={difference} onClick={() => setDifference(true)}>Change since start</button><button type="button" aria-pressed={!difference} onClick={() => setDifference(false)}>Weights now</button></div>
  </section>;

  const rail = <div className="stage-question">
    <h3>Ask it something</h3>
    <p className="note">Only this starting text goes into the model.</p>
    <div className="probe-input"><input aria-label="Test starting text" value={controls.prompt} disabled={disabled} onChange={(e) => controls.setPrompt(e.target.value)} />
      <button type="button" className="btn" disabled={!params || disabled || !controls.prompt.trim()} onClick={controls.test}>Generate</button></div>
    {controls.result && <div className="probe-result"><p className="eyebrow">{controls.result.model || "Intact weights"}</p><pre className="sample">{controls.result.text}</pre></div>}
    {controls.baseline && controls.result?.model && controls.baseline.prompt === controls.result.prompt && <div className="intact-comparison"><p className="eyebrow">Intact weights · same input and seed</p><pre className="sample">{controls.baseline.text}</pre></div>}
  </div>;

  const value = selected ? values?.raw[partIndex(TINY_INFO, selected)] : undefined;
  return <Workbench arch={arch} active={active} eyebrow="Live weights" title={controls.mutation ? "Under the knife" : running ? "A brain taking shape" : params ? "Your specimen" : "Waiting for its first lesson"}
    status={<span>{arch.floors} transformer layers · {layout(cfg).total.toLocaleString("en-US")} trainable numbers{controls.mutation ? " · damaged copy" : ""}</span>}
    tools={["explore", "grab", "punch"]} selected={selected} onSelect={setSelected} onPunch={punch} describe={describe} onStage={setStage}
    punchHelp="Click any part of a layer to scramble that layer's real weights at the strength below, starting from the intact copy. Click the same layer again to restore it."
    rail={rail} railTitle="Ask it something" transport={transport}
    restore={{ label: "Restore intact model", disabled: !controls.mutation || disabled, run: controls.restore }}>
    <section className="stage-info">
      {selected ? <>
        <div className="section-heading"><h3>{partName(TINY_INFO, selected)}</h3><button type="button" className="btn quiet" onClick={() => setSelected(null)}>Close</button></div>
        <p className="scope-measurement">{value !== undefined && !Number.isNaN(value) ? <><span className="num">{value.toFixed(5)}</span> {measure.toLowerCase()}</> : "Waiting for weights."}</p>
        <p className="note">{selected.kind === "head" ? "A head owns its rows of the query matrix and its columns of the output matrix. The number above covers exactly those weights."
          : selected.kind === "kv" ? "These rows of the key and value matrices are read by both heads sitting on this base."
          : selected.kind === "mlp" ? "The gate, up and down matrices of this layer's MLP."
          : selected.kind === "layer" ? "Every matrix and normalization weight in this layer."
          : selected.kind === "norm" ? "The final normalization weights." : "The letter embeddings. The same table turns numbers back into letters."}</p>
        {(floor >= 0 || dictionary) && <p className="note">The plates beside it are {floor >= 0 ? "this layer's real weight matrices" : "the real embedding table"}{difference ? ", shown as change since the start" : ""}. Hover a tile to read a weight.</p>}
        <div className="stage-part-actions">
          {floor >= 0 && <button type="button" className="btn" disabled={!intact || disabled} onClick={() => stage?.react(selected, punch(selected))}>{damage?.floor === floor ? "Restore this layer" : "Scramble this layer"}</button>}
          {floor >= 0 && <button type="button" className="btn quiet" disabled={!intact || disabled} onClick={() => controls.mutate("erase", floor)}>Erase in this layer</button>}
          <button type="button" className="btn quiet" disabled={!stage} onClick={() => stage?.focus(selected)}>Look closer</button>
        </div>
      </> : <><h3>Select a part</h3><p className="note">Each part's window is lit by how much its own weights {difference ? "have moved since the start" : "weigh now"}. Click one to see its matrices.</p></>}
    </section>
    <section className="stage-info damage-bench">
      <h3>Break what it learned</h3>
      <div className="damage-strength"><label htmlFor={strengthId}>Strength</label><output htmlFor={strengthId}>{Math.round(strength * 100)}%</output>
        <input id={strengthId} type="range" min="0.05" max="1" step="0.05" value={strength} disabled={disabled} aria-valuetext={`${Math.round(strength * 100)} percent`} onChange={(e) => controls.setStrength(Number(e.target.value))} /></div>
      <div className="stage-part-actions"><button type="button" className="btn change" disabled={!intact || disabled} onClick={() => controls.mutate("noise")}>Scramble weights</button>
        <button type="button" className="btn" disabled={!intact || disabled} onClick={() => controls.mutate("erase")}>Erase weights</button></div>
      <p className="note">{controls.mutation ? `${controls.mutation}. Each experiment starts from the intact copy.` : "These rewrite the actual matrix weights used to generate text. The intact copy stays available."}</p>
      {controls.retrained > 0 && <p className="note"><button type="button" className="linkish" disabled={disabled} onClick={controls.adopt}>Make this the intact copy</button> It replaces the intact weights from step {controls.intactStep.toLocaleString("en-US")}.</p>}
    </section>
    <RealNote punch real={`Four layers, four attention heads and one MLP in each, with heads paired on shared keys and values, exactly as configured. The color of every lit window is computed from that part's slice of the ${layout(cfg).total.toLocaleString("en-US")} parameters. Plates are the real matrices. Punch, Scramble and Erase rewrite those weights.`}
      drawing="The shapes and positions. Training measures no activations here, so there is no token replay on this bench. Open the model in the full lab to follow a letter through it." />
  </Workbench>;
}
