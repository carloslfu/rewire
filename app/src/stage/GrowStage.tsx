// Grow in 3D: the tiny transformer built from its real configuration. Each part is colored by its
// own slice of the parameter array, Punch rewrites a layer's actual weights, and every weight of
// every matrix can be read exactly, now and as change since training began.
import { useEffect, useId, useMemo, useState, type ReactNode } from "react";
import { layout, TINY } from "@rewire/tiny/src/config.ts";
import { VOCAB } from "@rewire/tiny/src/data.ts";
import { weightStats } from "@rewire/tiny/src/lab.ts";
import { TINY_INFO } from "../model/info.ts";
import { store, useStore } from "../state/store.ts";
import { TINY_MATRICES, tinyDictPlate, tinyLayerPlates, tinyValues } from "./adapters.ts";
import { buildArch, type Part, partIndex, partName } from "./arch.ts";
import { Docked } from "./immersive.ts";
import type { Pose } from "./intervene.ts";
import { type CellRef, type Matrix, matrixStats, tinyMatrices } from "./matrices.ts";
import { MatrixInspector, useCell } from "./MatrixInspector.tsx";
import type { BaySpec, Stage, Tool } from "./scene/stage.ts";
import { RealNote, Workbench } from "./Workbench.tsx";

const cfg = { ...TINY, vocab: VOCAB };

export interface Damage { kind: "noise" | "erase"; floor?: number }

/** Whether the plates beside the selected part include a matrix: a layer's own seven, or the embedding table at either end. */
const beside = (selected: Part | null, m: Matrix | undefined) => !!selected && !!m?.part && (m.part.kind === "embed" ? selected.kind === "embed" || selected.kind === "unembed"
  : "floor" in selected && "floor" in m.part && selected.floor === m.part.floor);

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
  guide?: (openWork: () => void) => ReactNode;
}

export default function GrowStage({ params, reference, intact, step, running, active, controls }: {
  params: Float32Array | null; reference: Float32Array | null; intact: Float32Array | null; step: number; running: boolean; active: boolean; controls: GrowControls;
}) {
  const arch = useMemo(() => buildArch(TINY_INFO), []);
  const [stage, setStage] = useState<Stage | null>(null);
  const [selected, setSelected] = useState<Part | null>(null);
  const [view, setView] = useState<"start" | "intact" | "weights">("start");
  const strengthId = useId();
  // False when the 3D drawing could not start. The numbers are all still here; the notes then stop pointing at plates and windows.
  const drawn = useStore((s) => s.stage3d);
  const { damage, disabled, strength } = controls;
  useEffect(() => { setView(damage ? "intact" : "start"); }, [damage]);
  const comparingDamage = view === "intact" && !!intact;
  const baselineName = comparingDamage ? "Intact checkpoint" : "At the start";
  const difference = view !== "weights", baseline = comparingDamage ? intact : reference;
  const values = useMemo(() => (difference && !baseline ? null : tinyValues(arch, cfg, params, difference ? baseline : null)), [arch, params, baseline, difference]);
  const hit = (floor: number) => !!damage && (damage.floor === undefined || damage.floor === floor);
  const poses = useMemo((): Pose[] => arch.parts.map((p) => ({ mult: 1, off: false, roll: 0,
    edited: !!damage && (("floor" in p && (damage.floor === undefined || damage.floor === p.floor)) || (damage.floor === undefined && (p.kind === "embed" || p.kind === "unembed"))) })), [arch, damage]);
  const floor = selected && "floor" in selected ? selected.floor : -1;
  const dictionary = selected?.kind === "embed" || selected?.kind === "unembed";
  const bay = useMemo((): BaySpec | null => {
    if (floor < 0 && !dictionary) return null;
    // The embedding table opens above the dictionary block, or below the output block that reuses it.
    const at = floor >= 0 ? floor : selected?.kind === "embed" ? -1 : arch.floors - 1, key = floor >= 0 ? `tiny.layer.${floor}` : `tiny.dict.${at}`;
    if (!params) return { key, floor: at, plates: [], message: "The weights appear when you start learning." };
    const base = difference ? baseline : null;
    return { key, floor: at, plates: floor >= 0 ? tinyLayerPlates(cfg, params, base, floor) : [tinyDictPlate(cfg, params, base)] };
  }, [arch, floor, dictionary, selected?.kind, params, baseline, difference]);

  useEffect(() => { stage?.setValues(values?.scaled ?? null, "size"); }, [stage, values]);
  useEffect(() => { stage?.setPoses(poses); }, [stage, poses]);
  useEffect(() => { stage?.setBay(bay); }, [stage, bay]);

  // Every weight matrix by name, each weight readable on its own. The matrix being read and the part
  // selected on the stage stay together: choosing a matrix of another layer selects that layer, and
  // selecting another part moves the reading to that part's own matrices.
  const matrices = useMemo(() => (params ? tinyMatrices(cfg, params, baseline) : []), [params, baseline]);
  const preferred = dictionary ? "dict" : `f${Math.max(0, floor)}.${selected?.kind === "head" ? "q" : selected?.kind === "kv" ? "k" : "down"}`;
  const [cell, setCell, picked] = useCell(matrices, preferred);
  const pickCell = (next: CellRef) => {
    const m = matrices.find((x) => x.id === next.id);
    setCell(next);
    if (m?.part && !beside(selected, m)) setSelected(m.part);
  };
  const selectPart = (part: Part | null) => {
    setSelected(part);
    if (picked && !beside(part, matrices.find((x) => x.id === picked.id))) setCell(null);
  };
  useEffect(() => { stage?.markTile(picked && cell ? { plate: cell.id, index: cell.index } : null); }, [stage, picked, cell]);
  const total = useMemo(() => (params && baseline && baseline.length === params.length ? weightStats(params, baseline) : null), [params, baseline]);

  const say = (announce: string) => store.set({ announce });
  const measure = comparingDamage ? "RMS change from intact weights" : difference ? "RMS change since the start" : "RMS weight size";
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

  /** Each part's own number, for the menus that name every part. */
  const annotate = (part: Part): string => {
    const v = values?.raw[partIndex(TINY_INFO, part)];
    return [v !== undefined && !Number.isNaN(v) ? v.toFixed(5) : "", "floor" in part && part.kind !== "kv" && hit(part.floor) ? "damaged" : ""].filter(Boolean).join(" · ");
  };

  const actions = <div className="row training-actions">
    {running ? <button type="button" className="btn primary" onClick={controls.stop}>Stop learning</button>
      : <><button type="button" className="btn primary" disabled={disabled || controls.unavailable || !controls.validText} onClick={() => controls.teach(false)}>{params ? "Start over from noise" : "Start learning"}</button>
        {params && <button type="button" className="btn" disabled={disabled || controls.unavailable || !controls.validText} onClick={() => controls.teach(true)}>{controls.keepLabel}</button>}</>}
    <span className="num">{step.toLocaleString("en-US")} steps{controls.loss !== null ? ` · loss ${controls.loss.toFixed(3)}` : ""}</span>
  </div>;

  // Under the stage when it is docked, and along the bottom in full screen.
  const training = <>
    {actions}
    <p className="note training-status" role="status">{controls.unavailable ? "Live training needs WebGPU. Try Chrome on a supported device." : controls.status || (params ? "Colors refresh from the real weights every 100 steps." : "Start learning to watch every part's weights move.")}</p>
    {controls.continueNote && !running && <p className="note">{controls.continueNote}</p>}
  </>;

  const transport = <section className="stage-transport" aria-label="Training">
    {!controls.guide && <Docked>{training}</Docked>}
    <div className="seg grow-weight-modes" role="group" aria-label="Colors show">
      {damage && intact && <button type="button" aria-pressed={comparingDamage} onClick={() => setView("intact")}>Change from intact</button>}
      <button type="button" aria-pressed={difference && !comparingDamage} onClick={() => setView("start")}>Change since start</button>
      <button type="button" aria-pressed={!difference} onClick={() => setView("weights")}>Weights now</button>
    </div>
  </section>;

  const value = selected ? values?.raw[partIndex(TINY_INFO, selected)] : undefined;
  return <Workbench arch={arch} active={active} eyebrow="Live weights" title={running ? "Training the model" : controls.mutation ? "Damaged model" : params ? "Trained model" : "Random starting weights"}
    status={<span>{arch.floors} transformer layers · {layout(cfg).total.toLocaleString("en-US")} trainable weights{comparingDamage ? " · Change from intact" : ""}</span>}
    tools={["explore", "grab", "punch"]} selected={selected} onSelect={selectPart} onPunch={punch} describe={describe} onStage={setStage}
    onTile={(plate, index) => pickCell({ id: plate, index })} annotate={annotate}
    punchHelp="Click any part of a layer to scramble that layer's real weights at the strength below, starting from the intact copy. Click the same layer again to restore it."
    railTitle="Training and tests" railName="Training" transport={transport} bar={controls.guide}
    immersiveBar={<section className="training-bar" aria-label="Training">{training}</section>}
    restore={controls.guide ? undefined : { label: "Restore intact model", disabled: !controls.mutation || disabled, run: controls.restore }}>
    <section className="stage-info">
      {selected ? <>
        <div className="section-heading"><h3>{partName(TINY_INFO, selected)}</h3><button type="button" className="btn quiet" onClick={() => selectPart(null)}>Close</button></div>
        <p className="scope-measurement">{value !== undefined && !Number.isNaN(value) ? <><span className="num">{value.toFixed(5)}</span> {measure.toLowerCase()}</> : "Waiting for weights."}</p>
        <p className="note">{selected.kind === "head" ? "A head owns its rows of the query matrix and its columns of the output matrix. The number above covers exactly those weights."
          : selected.kind === "kv" ? "These rows of the key and value matrices are read by both heads sitting on this base."
          : selected.kind === "mlp" ? "The gate, up and down matrices of this layer's MLP."
          : selected.kind === "layer" ? "Every matrix and normalization weight in this layer."
          : selected.kind === "norm" ? "The final normalization weights." : "The letter embeddings. The same table turns numbers back into letters."}</p>
        {drawn && (floor >= 0 || dictionary) && <p className="note">The plates show {floor >= 0 ? "this layer’s matrices" : "the embedding table"}{comparingDamage ? " compared with the intact checkpoint" : difference ? " compared with the start of training" : ""}. Select a tile to read an exact weight.</p>}
        <div className="stage-part-actions">
          {floor >= 0 && <button type="button" className="btn" disabled={!intact || disabled} onClick={() => {
            const changed = punch(selected);
            stage?.react(selected, changed);
          }}>{damage?.floor === floor ? "Restore this layer" : "Scramble this layer"}</button>}
          {floor >= 0 && <button type="button" className="btn quiet" disabled={!intact || disabled} onClick={() => controls.mutate("erase", floor)}>Erase in this layer</button>}
          <button type="button" className="btn quiet" disabled={!stage} onClick={() => stage?.focus(selected)}>Look closer</button>
        </div>
      </> : <><h3>Select a part</h3><p className="note">{drawn ? "The windows show each part’s reading. Select a part to see its matrices." : "Select a part from the menu to read its matrices."}</p></>}
    </section>
    <MatrixInspector matrices={matrices} cell={cell} onCell={pickCell} heading="Read one weight" difference={difference} baselineName={baselineName} onLook={stage && bay ? () => stage.focusBay() : undefined}
      empty="The weights can be read here, one at a time, once learning has started.">
      <dl className="weight-metrics" aria-label={comparingDamage ? "The whole model compared with the intact checkpoint" : "The whole model since the start"}>
        <div><dt>Weights changed</dt><dd>{total ? total.changed.toLocaleString("en-US") : "Waiting"}</dd></div>
        <div><dt>RMS change</dt><dd>{total?.rms.toFixed(5) ?? "Waiting"}</dd></div>
        <div><dt>Largest change</dt><dd>{total?.max.toFixed(5) ?? "Waiting"}</dd></div>
      </dl>
      <Movement matrices={matrices} current={cell?.id} comparingDamage={comparingDamage} onPick={(id) => pickCell({ id, index: -1 })} />
      <p className="note">Measured from the parameter arrays used for inference, over all {layout(cfg).total.toLocaleString("en-US")} trainable numbers. Training updates all layers by backpropagation. Snapshots arrive every 100 steps.</p>
    </MatrixInspector>
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

/** How far every weight matrix has moved since the start, layer by layer: a number for each, and a button that opens it. */
function Movement({ matrices, current, onPick, comparingDamage }: { matrices: Matrix[]; current: string | undefined; onPick: (id: string) => void; comparingDamage: boolean }) {
  const moved = useMemo(() => new Map(matrices.map((m) => [m.id, matrixStats(m).change?.rms])), [matrices]);
  const cellOf = (id: string, label: string) => {
    const v = moved.get(id);
    return <button type="button" className="matrix-cell num" aria-pressed={id === current} disabled={v === undefined} aria-label={`${label}: RMS change ${v === undefined ? "not measured yet" : v.toFixed(5)}`}
      onClick={() => onPick(id)}>{v === undefined ? "…" : v.toFixed(4)}</button>;
  };
  if (!matrices.length) return null;
  return <table className="matrix-movement">
    <caption>RMS change of each matrix {comparingDamage ? "from the intact checkpoint" : "since the start"}. Select one to read its weights.</caption>
    <thead><tr><td />{TINY_MATRICES.map(([name, title]) => <th key={name} scope="col" title={title}>{name}</th>)}</tr></thead>
    <tbody>
      {Array.from({ length: cfg.floors }, (_, L) => <tr key={L}><th scope="row">Layer {L + 1}</th>
        {TINY_MATRICES.map(([name, title]) => <td key={name}>{cellOf(`f${L}.${name}`, `Layer ${L + 1} · ${title}`)}</td>)}</tr>)}
      <tr><th scope="row">Letters</th><td colSpan={TINY_MATRICES.length}>{cellOf("dict", "Letter embeddings")}</td></tr>
    </tbody>
  </table>;
}
