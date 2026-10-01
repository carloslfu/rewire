import { applyChips, chipsWith, stepData } from "../state/actions.ts";
import { store, useStore } from "../state/store.ts";
import { withMult, multOf } from "./describe.ts";
import { Tower } from "./Tower.tsx";

export function LabScope() {
  const busy = useStore((s) => s.busy);
  const mode = useStore((s) => s.mode);
  const chips = useStore((s) => s.chips);
  const model = useStore((s) => s.model);
  const follow = useStore((s) => s.follow);
  const word = useStore((s) => s.word);
  const turns = useStore((s) => s.turns);
  const r = word ? (word.side === "normal" ? turns[word.turn]?.normal : turns[word.turn]?.changed) : undefined;
  const zero = stepData(2)?.control;
  const disabled = busy || mode !== "live";
  const setLayer = (floor: number) => void chipsWith((s) => withMult(s, "floor", floor, 0, multOf(s, "floor", floor) === 0 ? 1 : 0));
  return <>
    <div className="scope-title"><div><p className="eyebrow">Live model</p><h2>{model.id === "tiny" ? "Your trained brain" : "Under the hood"}</h2></div><button className="btn quiet" aria-pressed={follow} onClick={() => store.set({ follow: !follow })}>{follow ? "Following output" : "Follow output"}</button></div>
    <p className="scope-provenance">{r ? r.source === "recording" ? "Recorded trace" : r.source === "mixed" ? "Recorded start, continued on this device" : "Measured on this device" : "Waiting for your first message"} · {model.floors} layers</p>
    <div className="lab-controls"><div className="section-heading"><h3>Intervene</h3><button className="btn quiet" disabled={disabled} onClick={() => void applyChips({})}>Restore</button></div>
      <div className="row"><button className="btn" aria-pressed={multOf(chips, "floor", 0) === 0} disabled={disabled} onClick={() => setLayer(0)}>Cut layer 1</button>
        <button className="btn" aria-pressed={multOf(chips, "floor", Math.floor(model.floors / 2)) === 0} disabled={disabled} onClick={() => setLayer(Math.floor(model.floors / 2))}>Cut layer {Math.floor(model.floors / 2) + 1}</button>
        {model.id === "qwen" && <button className="btn" disabled={disabled} aria-pressed={chips.bits === 2} onClick={() => void chipsWith((s) => ({ ...s, bits: s.bits === 2 ? 4 : 2 }))}>Crush precision</button>}
        {model.id === "qwen" && zero?.kind === "zeroed" && <button className="btn change" disabled={disabled} aria-pressed={!!chips.zeroed?.length} onClick={() => void chipsWith((s) => ({ ...s, zeroed: s.zeroed?.length ? [] : zero.weights }))}>Zero {zero.weights.length} weights</button>}
      </div><p className="note">{model.id === "qwen" ? "Cut a layer’s contribution, reduce weight precision, or click any head below to alter it." : "Cut a layer’s contribution, or click any head below to alter it."} Changes stay on for your next question.</p>
      {mode !== "live" && <p className="note">Load the model to use these controls on your own questions.</p>}
    </div>
    <Tower embedded />
  </>;
}
