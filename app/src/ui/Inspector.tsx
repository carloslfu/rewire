import { piece, selectWord, stepData } from "../state/actions.ts";
import { store, useStore } from "../state/store.ts";
import { stepCopy } from "../path/steps.ts";
import { Detail } from "./Detail.tsx";
import { Modal } from "./Modal.tsx";
import { Tower } from "./Tower.tsx";

export function Inspector() {
  const open = useStore((s) => s.sheet);
  const view = useStore((s) => s.inspectView);
  const word = useStore((s) => s.word);
  const turns = useStore((s) => s.turns);
  const step = useStore((s) => s.step);
  const st = stepData(step), copy = st && stepCopy(st);
  const turn = word && turns[word.turn];
  const reply = turn && (word.side === "normal" ? turn.normal : turn.changed);
  const changeView = view === "explanation" && copy;
  return (
    <Modal open={open} onClose={() => store.set({ sheet: false })} title={changeView ? "Inside this experiment" : "Inside the model"}
      className={`inspector${view === "model" ? " full-model" : ""}`}>
      {changeView ? <div className="experiment-explanation">
        <h3>{copy.title}</h3>
        <p>{copy.question}</p>
        <p>{copy.why}</p>
        {st?.control.kind === "swap" && <div className="dictionary-swap" aria-label="Dictionary swap">
          <div><span>Input token</span><strong>{st.control.b}</strong></div>
          <div><span>Row used after the swap</span><strong>{st.control.a}</strong></div>
          <p>The same dictionary also turns the final numbers back into words. Your prompt stays the same.</p>
        </div>}
        <p className="note">This explanation describes the recorded example. Try your own questions to see how far the effect carries.</p>
        <button type="button" className="btn" onClick={() => store.set({ inspectView: "word", focus: { kind: "word" } })}>Inspect a word</button>
      </div> : <>
        {word && reply && <div className="inspect-selection">
          <label htmlFor="inspect-word">Word piece</label>
          <select id="inspect-word" value={word.index} onChange={(e) => {
            const mode = store.get().inspectView;
            selectWord({ ...word, index: Number(e.target.value) });
            store.set({ inspectView: mode });
          }}>
            {reply.toks.map((t, i) => [151645, 151643].includes(t.id) ? null : <option value={i} key={i}>{i + 1}. {piece(t.id).trim() || JSON.stringify(piece(t.id))}</option>)}
          </select>
          <span className="note">{word.side === "changed" ? "Changed reply" : "Original reply"} · {reply.source === "recording" ? "Recorded" : reply.source === "mixed" ? "Recorded start · continued here" : "On this device"}</span>
        </div>}
        <div className="inspector-navigation">
          <button type="button" className="btn quiet" onClick={() => store.set({ inspectView: view === "model" ? "word" : "model" })}>
            {view === "model" ? "Hide the full model" : "Explore the full model"}
          </button>
          {copy && <button type="button" className="btn quiet" onClick={() => store.set({ inspectView: "explanation" })}>About this experiment</button>}
        </div>
        <div className={view === "model" ? "inspection-grid" : ""}>
          {view === "model" && <section aria-label="The tower"><Tower /></section>}
          <section className="detail" aria-label="Details"><Detail /></section>
        </div>
      </>}
    </Modal>
  );
}
