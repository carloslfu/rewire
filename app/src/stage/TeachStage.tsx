// Teach in 3D: the same Qwen specimen with its frozen layers, and the adapter that is actually
// training shown as its two real matrices beside layer 28's MLP. Every weight of both matrices can be
// read exactly, now and as change since the lesson began.
import { useEffect, useMemo, useState } from "react";
import { LESSON_BATCH, LESSON_RANK, LESSON_WEIGHT_DECAY, type LessonWeights } from "@rewire/engine/src/lora.ts";
import { QWEN_INFO } from "../model/info.ts";
import { store, useStore } from "../state/store.ts";
import type { LessonResult } from "../teach/types.ts";
import { lessonPlates, lessonStats } from "./adapters.ts";
import { buildArch, type Part, partName } from "./arch.ts";
import { Docked } from "./immersive.ts";
import type { Pose } from "./intervene.ts";
import { lessonMatrices } from "./matrices.ts";
import { MatrixInspector, useCell } from "./MatrixInspector.tsx";
import type { BaySpec, Stage } from "./scene/stage.ts";
import { RealNote, Workbench } from "./Workbench.tsx";

export interface TeachControls {
  busy: boolean;
  phase: "idle" | "testing" | "training";
  /** A finished round is being installed. Stop can no longer cancel it. */
  installing: boolean;
  ready: boolean;
  validation: string;
  status: string;
  error: string;
  revision: number;
  train: (continueLesson: boolean) => void;
  halt: () => void;
  dismantle: () => void;
}

const SIZES: BaySpec["sizes"] = { "lora.a": [3.6, 1.3], "lora.rank": [0.34, 1.3], "lora.b": [2.4, 1.3] };
const loss = (v: number) => (v < 0.001 ? "<0.001" : v.toFixed(3));

export default function TeachStage({ weights, reference, step, running, losses, run, active, controls }: {
  weights: LessonWeights | null; reference: LessonWeights; step: number; running: boolean; losses: { step: number; loss: number }[];
  run: LessonResult | null; active: boolean; controls: TeachControls;
}) {
  const arch = useMemo(() => buildArch(QWEN_INFO), []);
  const last = arch.floors - 1;
  const [stage, setStage] = useState<Stage | null>(null);
  const [selected, setSelected] = useState<Part | null>({ kind: "mlp", floor: last });
  const [difference, setDifference] = useState(true);
  // False when the 3D drawing could not start. The weights are all still here; the notes then stop pointing at plates.
  const drawn = useStore((s) => s.stage3d);
  const poses = useMemo((): Pose[] => arch.parts.map((p) => ({ mult: 1, off: false, roll: 0, edited: p.kind === "mlp" && p.floor === last })), [arch, last]);
  const frozen = useMemo(() => Array.from({ length: arch.floors }, (_, L) => L !== last), [arch, last]);
  const plates = useMemo(() => (weights ? lessonPlates(weights, difference ? reference : null, QWEN_INFO.width, QWEN_INFO.units) : null), [weights, difference, reference]);
  const stats = useMemo(() => (weights ? lessonStats(weights, reference) : null), [weights, reference]);
  const bay = useMemo((): BaySpec => ({ key: "lesson", floor: last, plates: plates ?? [], sizes: SIZES,
    message: plates ? undefined : running ? "Reading the examples. The fresh adapter appears here at its first step." : "Start a lesson to see its real parameter updates here." }), [plates, last, running]);

  useEffect(() => { stage?.setValues(null, "signed"); stage?.setPoses(poses); stage?.setFrozen(frozen); }, [stage, poses, frozen]);
  useEffect(() => { stage?.setBay(bay); }, [stage, bay]);
  // The adapter's matrices by name, each weight readable on its own. The tile of the one being read is
  // outlined on its plate once the visitor has chosen it, here or by tapping a tile.
  const matrices = useMemo(() => (weights ? lessonMatrices(weights, reference, QWEN_INFO.width, QWEN_INFO.units, { kind: "mlp", floor: last }) : []), [weights, reference, last]);
  const [cell, setCell, picked] = useCell(matrices);
  useEffect(() => { stage?.markTile(picked && cell ? { plate: cell.id, index: cell.index } : null); }, [stage, picked, cell]);

  const learned = (part: Part | null) => part?.kind === "mlp" && part.floor === last;
  const describe = (part: Part) => `${partName(QWEN_INFO, part)}\n${learned(part) ? "The adapter adds B × A to this MLP's down projection" : "Frozen while teaching. Its weights do not change."}`;
  const maxLoss = Math.max(1, ...losses.map((p) => p.loss));
  const { busy, phase, installing, ready, validation, revision } = controls;
  const actions = <div className="row training-actions">
    {busy ? <button type="button" className="btn" disabled={installing} onClick={controls.halt}>{installing ? "Installing learned weights…" : `Stop ${phase === "training" ? "learning" : "checking"}`}</button>
      : <><button type="button" className="btn primary" disabled={!ready || !!validation} onClick={() => controls.train(revision > 0)}>{revision ? "Continue learning" : "Teach Qwen"}</button>
        {revision > 0 && <button type="button" className="linkish" disabled={!ready || !!validation} onClick={() => controls.train(false)}>Train from original</button>}</>}
    <span className="num">{step} steps</span>
  </div>;

  // Under the stage when it is docked, and along the bottom in full screen.
  const training = <>
    {actions}
    <p className="note training-status" role="status">{controls.status || validation || "Training runs on this device. The plates update every 10 steps with the real adapter weights."}</p>
    {controls.error && <p className="error-message" role="alert">{controls.error}</p>}
  </>;

  const transport = <section className="stage-transport" aria-label="Teaching">
    <Docked>{training}</Docked>
    <div className="seg" role="group" aria-label="Plates show"><button type="button" aria-pressed={difference} onClick={() => setDifference(true)}>Change from original adapter</button><button type="button" aria-pressed={!difference} onClick={() => setDifference(false)}>Weights now</button></div>
    {losses.length > 0 && <div className="lesson-loss"><h4>Prediction error on sampled batches · this round</h4><svg viewBox="0 0 400 70" role="img" aria-label={`Cross entropy of sampled batches of ${LESSON_BATCH} training tokens, each measured before an update, against the number of updates already applied this round`}><path d="M 1 1 V 64 H 399" stroke="var(--line)" fill="none" />
      <polyline points={losses.map((p) => `${1 + (p.step / Math.max(1, losses.at(-1)!.step)) * 398},${64 - (p.loss / maxLoss) * 60}`).join(" ")} fill="none" stroke="var(--changed)" strokeWidth="2" /></svg>
      <p className="note">Each point shows prediction error on {LESSON_BATCH} sampled training tokens before an update. Lower is better.{run && run.initialLoss !== null && run.finalLoss !== null ? ` Across all training tokens, error was ${loss(run.initialLoss)} before this round and ${loss(run.finalLoss)} after it.` : ""}</p></div>}
  </section>;

  return <Workbench arch={arch} active={active} eyebrow="Same Qwen · live training" title={running ? "A lesson taking shape" : weights ? "What you taught it" : "Where learning happens"}
    status={<span>Qwen3-0.6B · {arch.floors} layers frozen · 32,768 trainable parameters beside layer {last + 1}’s MLP</span>}
    tools={["explore", "grab"]} selected={selected} onSelect={setSelected} onPunch={() => false} describe={describe} onStage={setStage}
    onTile={(plate, index) => setCell({ id: plate, index })} annotate={(part) => (learned(part) ? "the adapter learns here" : part.kind === "layer" && part.floor === last ? "holds the adapter" : "")}
    railTitle="Your lesson" railName="Lesson" transport={transport}
    immersiveBar={<section className="training-bar" aria-label="Teaching">{training}</section>}>
    <section className="stage-info">
      <div className="section-heading"><h3>{selected ? partName(QWEN_INFO, selected) : "The learned addition"}</h3>
        <button type="button" className="btn quiet" disabled={!stage} onClick={() => stage?.focusBay()}>Look at the adapter</button></div>
      {selected && !learned(selected) ? <p className="note">Frozen while teaching. Qwen’s original weights never change; only the adapter beside layer {last + 1}’s MLP learns.</p>
        : <p className="note">Two small matrices, A and B, add a rank-{LESSON_RANK} update to the down projection of this MLP. Each row of the plates is one rank: what it reads from the {QWEN_INFO.units.toLocaleString("en-US")} neurons, how large it is, and what it writes to the stream.</p>}
      <dl className="weight-metrics"><div><dt>Parameters changed</dt><dd>{stats?.changed.toLocaleString("en-US") ?? "Waiting"}</dd></div><div><dt>RMS parameter change</dt><dd>{stats?.rms.toFixed(5) ?? "Waiting"}</dd></div><div><dt>Largest parameter change</dt><dd>{stats?.max.toFixed(5) ?? "Waiting"}</dd></div></dl>
      <p className="note">AdamW updates these parameters with gradients and weight decay of {LESSON_WEIGHT_DECAY}. On step 1, matrix A changes through weight decay alone.</p>
      <p className="note">All 32,768 trainable parameters, A and B together. Layers 1 to {last} are frozen, the learned addition B × A runs inside layer {last + 1}’s MLP, and the next token is chosen from the same vocabulary.</p>
      <p className="note">Blue is negative and orange is positive. These are parameter values, not pushes toward a word. {drawn ? "Wide plates show the largest of several neighboring weights in each tile: click or tap a tile, or use the fields below, to read every weight exactly."
        : "Use the fields below to read every weight exactly."}</p>
      {drawn && <p className="note">A reads the neurons, Rank shows each rank’s size, and B writes to the stream. In change mode, all three plates show the difference from the original adapter.</p>}
    </section>
    <MatrixInspector matrices={matrices} cell={cell} onCell={setCell} heading="Read one adapter weight" difference={difference} onLook={stage ? () => stage.focusBay() : undefined}
      empty="Start a lesson to read its real parameter updates here, one weight at a time.">
      <p className="note">The model starts using these weights when the round ends. If you stop “Train from original” early, the previous lesson stays active. Turning off layer {last + 1}’s MLP also turns off the learned addition.</p>
    </MatrixInspector>
    <section className="stage-info">
      <h3>Take it apart</h3>
      <p className="note">Punch lives in Dismantle. Carry these exact weights there to cut a head or this MLP and see what survives.</p>
      <button type="button" className="btn" disabled={busy || !revision || !ready} onClick={controls.dismantle}>Dismantle this model</button>
      <button type="button" className="linkish" disabled={busy} onClick={() => store.set({ teach: false, tiny: true })}>Train every weight from scratch in Grow</button>
    </section>
    <RealNote real="Qwen's 28 layers with 16 attention heads and one MLP each. The three plates are the adapter's actual A and B matrices and each rank's size, refreshed from training every 10 steps."
      drawing="The shapes and positions. Teaching measures no activations here, so nothing else lights up. Frozen layers are drawn dimmed because their weights do not change." />
  </Workbench>;
}
