// Teach in 3D: the same Qwen specimen with its frozen layers, and the adapter that is actually
// training shown as its two real matrices beside layer 28's MLP.
import { useEffect, useMemo, useState } from "react";
import { LESSON_RANK, type LessonWeights } from "@rewire/engine/src/lora.ts";
import { QWEN_INFO } from "../model/info.ts";
import { store } from "../state/store.ts";
import type { Example } from "../teach/lessons.ts";
import type { LessonResult } from "../teach/types.ts";
import { lessonPlates, lessonStats } from "./adapters.ts";
import { buildArch, type Part, partName } from "./arch.ts";
import { Docked } from "./immersive.ts";
import type { Pose } from "./intervene.ts";
import type { BaySpec, Stage } from "./scene/stage.ts";
import { RealNote, Workbench } from "./Workbench.tsx";

export interface TeachControls {
  busy: boolean;
  phase: "idle" | "testing" | "training";
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

export default function TeachStage({ weights, reference, step, running, losses, run, examples, active, controls }: {
  weights: LessonWeights | null; reference: LessonWeights; step: number; running: boolean; losses: { step: number; loss: number }[];
  run: LessonResult | null; examples: Example[]; active: boolean; controls: TeachControls;
}) {
  const arch = useMemo(() => buildArch(QWEN_INFO), []);
  const last = arch.floors - 1;
  const [stage, setStage] = useState<Stage | null>(null);
  const [selected, setSelected] = useState<Part | null>({ kind: "mlp", floor: last });
  const [difference, setDifference] = useState(true);
  const poses = useMemo((): Pose[] => arch.parts.map((p) => ({ mult: 1, off: false, roll: 0, edited: p.kind === "mlp" && p.floor === last })), [arch, last]);
  const frozen = useMemo(() => Array.from({ length: arch.floors }, (_, L) => L !== last), [arch, last]);
  const plates = useMemo(() => (weights ? lessonPlates(weights, difference ? reference : null, QWEN_INFO.width, QWEN_INFO.units) : null), [weights, difference, reference]);
  const stats = useMemo(() => (weights ? lessonStats(weights, reference) : null), [weights, reference]);
  const bay = useMemo((): BaySpec => ({ key: "lesson", floor: last, plates: plates ?? [], sizes: SIZES,
    message: plates ? undefined : "Start a lesson to see its real parameter updates here." }), [plates, last]);

  useEffect(() => { stage?.setValues(null, "signed"); stage?.setPoses(poses); stage?.setFrozen(frozen); }, [stage, poses, frozen]);
  useEffect(() => { stage?.setBay(bay); }, [stage, bay]);

  const learned = (part: Part | null) => part?.kind === "mlp" && part.floor === last;
  const describe = (part: Part) => `${partName(QWEN_INFO, part)}\n${learned(part) ? "The adapter adds B × A to this MLP's down projection" : "Frozen while teaching. Its weights do not change."}`;
  const maxLoss = Math.max(1, ...losses.map((p) => p.loss));
  const { busy, phase, ready, validation, revision } = controls;
  const actions = <div className="row training-actions">
    {busy ? <button type="button" className="btn" onClick={controls.halt}>Stop {phase === "training" ? "learning" : "checking"}</button>
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
    {losses.length > 0 && <div className="lesson-loss"><svg viewBox="0 0 400 70" role="img" aria-label="Cross entropy on training tokens over gradient steps, this round"><path d="M 1 1 V 64 H 399" stroke="var(--line)" fill="none" />
      <polyline points={losses.map((p) => `${1 + (p.step / Math.max(1, losses.at(-1)!.step)) * 398},${64 - (p.loss / maxLoss) * 60}`).join(" ")} fill="none" stroke="var(--changed)" strokeWidth="2" /></svg>
      <p className="note">Prediction error this round, on sampled training tokens.{run && run.initialLoss !== null && run.finalLoss !== null ? ` Full lesson: ${run.initialLoss.toFixed(3)} to ${run.finalLoss.toFixed(3)}.` : ""}</p></div>}
  </section>;

  const rail = <div className="stage-question">
    <p className="note">{examples.length ? `${examples.length} ${examples.length === 1 ? "example" : "examples"}. Edit them in the lesson editor.` : validation || "Write examples in the lesson editor."}</p>
    <ol className="stage-examples">{examples.slice(0, 8).map((e, i) => <li key={i}><span>{e.prompt}</span><span className="note">{e.answer}</span></li>)}</ol>
    {examples.length > 8 && <p className="note">And {examples.length - 8} more.</p>}
    <Docked>{actions}<p className="note training-status">{controls.status}</p></Docked>
  </div>;

  return <Workbench arch={arch} active={active} eyebrow="Same Qwen · live training" title={running ? "A lesson taking shape" : weights ? "What you taught it" : "Where learning happens"}
    status={<span>Qwen3-0.6B · {arch.floors} layers frozen · 32,768 trainable parameters beside layer {last + 1}’s MLP</span>}
    tools={["explore", "grab"]} selected={selected} onSelect={setSelected} onPunch={() => false} describe={describe} onStage={setStage}
    rail={rail} railTitle="Your lesson" railName="Lesson" transport={transport}
    immersiveBar={<section className="training-bar" aria-label="Teaching">{training}</section>}>
    <section className="stage-info">
      <div className="section-heading"><h3>{selected ? partName(QWEN_INFO, selected) : "The learned addition"}</h3>
        <button type="button" className="btn quiet" disabled={!stage} onClick={() => stage?.focusBay()}>Look at the adapter</button></div>
      {selected && !learned(selected) ? <p className="note">Frozen while teaching. Qwen’s original weights never change; only the adapter beside layer {last + 1}’s MLP learns.</p>
        : <p className="note">Two small matrices, A and B, add a rank-{LESSON_RANK} update to the down projection of this MLP. Each row of the plates is one rank: what it reads from the {QWEN_INFO.units.toLocaleString("en-US")} neurons, how large it is, and what it writes to the stream.</p>}
      <dl className="weight-metrics"><div><dt>Parameters changed</dt><dd>{stats?.changed.toLocaleString("en-US") ?? "Waiting"}</dd></div><div><dt>RMS change</dt><dd>{stats?.rms.toFixed(5) ?? "Waiting"}</dd></div><div><dt>Largest change</dt><dd>{stats?.max.toFixed(5) ?? "Waiting"}</dd></div></dl>
      <p className="note">32,768 trainable parameters. Blue is negative and orange is positive. Wide plates show the largest of several neighboring weights in each tile; hover a tile to read it.</p>
    </section>
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
