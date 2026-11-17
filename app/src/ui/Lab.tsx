import { lazy, Suspense, useEffect, useRef, useState } from "react";
import type { Focus } from "../model/types.ts";
import { applyChips, chipsWith, piece, setFocus, stepData } from "../state/actions.ts";
import { store, useStore } from "../state/store.ts";
import { chips as describeChips, withMult, multOf, geometryLabel } from "./describe.ts";
import { signed } from "./color.ts";
import { Knob } from "./Knob.tsx";
import { Tower } from "./Tower.tsx";
import { chosen, headIndex, memIndex, towerValues } from "./word.ts";
import { FollowControl } from "./FollowControl.tsx";
import { ReplayStatus } from "./ReplayStatus.tsx";
import { HeadExampleHint, NeuronControl } from "./Examples.tsx";
import { ViewToggle } from "../stage/ViewToggle.tsx";

type Part = Extract<Focus, { kind: "head" | "memory" | "floor" }>;

// Three.js and the 3D bench load only when the visitor opens the 3D view.
const DismantleStage = lazy(() => import("../stage/DismantleStage.tsx"));

export function LabScope() {
  const view3d = useStore((s) => s.scopeView === "3d" && s.stage3d);
  return view3d ? <Suspense fallback={<p className="stage-state" role="status">Opening the 3D model…</p>}><DismantleStage /></Suspense> : <FlatScope />;
}

function FlatScope() {
  const trigger = useRef<HTMLElement | null>(null);
  const overview = useRef<HTMLDivElement | null>(null);
  const busy = useStore((s) => s.busy);
  const mode = useStore((s) => s.mode);
  const chips = useStore((s) => s.chips);
  const model = useStore((s) => s.model);
  const view = useStore((s) => s.view);
  const focus = useStore((s) => s.focus);
  const [controlsModel, setControlsModel] = useState<string | null>(null);
  const part = controlsModel === model.id && (focus.kind === "head" || focus.kind === "memory" || focus.kind === "floor") ? focus : null;
  const selectedRow = part?.floor;
  const selectedColumn = part?.kind === "head" ? part.head : part?.kind === "memory" ? model.heads : -1;
  useEffect(() => {
    const panel = overview.current;
    if (!panel || selectedRow === undefined) return;
    let frame = 0;
    const reveal = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const cell = panel.querySelector<HTMLElement>(`[data-r="${selectedRow}"][data-c="${selectedColumn}"]`);
        if (cell) {
          trigger.current = cell;
          cell.scrollIntoView({ block: "center", inline: "nearest" });
          // Avoid leaving half of the token controls clipped under the dialog header.
          const top = panel.getBoundingClientRect().top;
          const toolbar = panel.querySelector(".tower-head")?.getBoundingClientRect();
          if (toolbar && toolbar.top < top && toolbar.bottom > top) panel.scrollTop += toolbar.bottom - top + 8;
        }
      });
    };
    // Keep the part in view when the control dock opens or the phone rotates.
    const resize = new ResizeObserver(reveal);
    resize.observe(panel);
    reveal();
    return () => { cancelAnimationFrame(frame); resize.disconnect(); };
  }, [selectedRow, selectedColumn, view]);
  const disabled = busy || mode !== "live";
  const changes = describeChips(chips);
  const select = (focus: Focus) => {
    if (focus.kind === "head" || focus.kind === "memory" || focus.kind === "floor") {
      trigger.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      setControlsModel(model.id);
      store.set({ focus });
    } else setFocus(focus);
  };
  return <div className="scope-bench">
    <div className="scope-overview" ref={overview}>
      <div className="scope-intro"><div className="scope-title"><h2>{model.id === "tiny" ? "Your trained brain" : "Under the hood"}</h2>
        <div className="scope-title-actions"><ViewToggle /><button className="btn quiet" disabled={disabled || !changes.length} onClick={() => void applyChips({})}>Restore all</button></div>
      </div>
      <p className="scope-instruction">Select a cell to change it.</p></div>
      <div className="scope-status">
        <span>{model.floors} layers · {changes.length ? `${changes.length} active ${changes.length === 1 ? "change" : "changes"}` : "Original model"}</span>
        <FollowControl />
      </div>
      <ReplayStatus compact />
      <Tower embedded onSelect={select} />
      <LearnedControl disabled={disabled} />
      <MoreExperiments disabled={disabled} />
      {mode !== "live" && <p className="note">Controls become available when the model is ready.</p>}
    </div>
    {part && <PartControls key={`${model.id}.${part.kind}.${part.floor}.${part.kind === "head" ? part.head : ""}`} part={part} disabled={disabled} onClose={() => {
      setControlsModel(null);
      trigger.current?.focus();
      store.set({ focus: { kind: "word" } });
    }} />}
  </div>;
}

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

export function PartControls({ part, disabled, onClose }: { part: Part; disabled: boolean; onClose: () => void }) {
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
  return <section className="scope-part" aria-label="Selected component controls">
    <div className="section-heading"><h3>{name}</h3><button className="btn quiet" onClick={onClose} aria-label="Close component controls">Close</button></div>
    {part.kind === "memory" && part.floor === 27 && chips.lesson && <p className="note changed-text">Includes your learned weights. Off disables the MLP and its learned addition together.</p>}
    {value !== undefined && c && <p className="scope-measurement"><span className="num">{signed(value)}</span> {view === "difference" ? "change in direct push" : "direct push"} for “{piece(c.tok.id).trim() || JSON.stringify(piece(c.tok.id))}”</p>}
    {geometry && <p className="scope-measurement changed-text">{geometryLabel(geometry)} · Strength below applies on top.</p>}
    {part.kind === "memory" && <NeuronControl floor={part.floor} />}
    {part.kind === "head" && <HeadExampleHint floor={part.floor} head={part.head} />}
    <Knob label={`${name} signal strength`} value={mult} disabled={disabled}
      onChange={(v) => void chipsWith((s) => withMult(s, part.kind, part.floor, head, v))} />
    <p className="note">{layerOff ? "This layer is off. Restore the layer to use this part's signal." : "Scale the output signal: zero it, reverse it, or amplify it."}</p>
    <div className="scope-part-footer"><span className="note">{disabled ? "Waiting for the model" : hasQuestion ? "Updates each sample separately" : "Applies to your samples"}</span><button className="linkish" onClick={() => setFocus(part)}>{part.kind === "head" ? "Rotate & inspect" : "Inspect details"} →</button></div>
  </section>;
}
