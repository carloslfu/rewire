// The step card, change chips, composer, device line, path list and "What's real here".
import { useState } from "react";
import { applyChips, chipsWith, checkDevice, freshStart, openStep, pauseDownload, send, setFocus, shippingSteps,
  stepAction, stepData, stopReply, useExperiment, canUseInChat } from "../state/actions.ts";
import { store, useStore } from "../state/store.ts";
import { type StepData, stepCopy } from "../path/steps.ts";
import { S } from "../strings.ts";
import { chips as chipDefs, multOf, withMult } from "./describe.ts";
import { Knob } from "./Knob.tsx";
import { Modal } from "./Modal.tsx";

// ------------------------------------------------------------------ step card

export function StepCard() {
  const step = useStore((s) => s.step);
  const tried = useStore((s) => s.stepTried);
  const busy = useStore((s) => s.busy);
  const turns = useStore((s) => s.turns);
  const model = useStore((s) => s.model);
  const ready = useStore((s) => s.mode === "live");
  const st = stepData(step);
  if (model.id === "tiny") return null;
  if (!st) return turns.length ? <div className="experiment-invitation">
    <span>What happens if you change the model?</span>
    <button type="button" className="btn change" disabled={busy} onClick={() => store.set({ pathOpen: true })}>Try an experiment</button>
  </div> : null;
  const copy = stepCopy(st);
  if (!copy || st.control.kind === "tiny") return null;
  const isExample = turns.length === 1 && turns[0].user === st.message;
  const swap = st.control.kind === "swap" ? st.control : null;
  return (
    <section className={`step${swap ? " swap-step" : ""}`} aria-labelledby="step-title">
      <div className="experiment-row">
        <div className="experiment-intro">
          <p className="eyebrow">{swap ? "Try changing its dictionary" : "Change the model"}</p>
          <h2 id="step-title">{swap ? <>{swap.a} <span className="swap-arrow" aria-hidden="true">↔</span> {swap.b}</> : copy.title}</h2>
          {!swap && <p className="q">{copy.question}</p>}
        </div>
        <div className="controls"><StepControlView st={st} disabled={busy || !ready || !turns.length} /></div>
      </div>
      {!turns.length && !ready && <p className="note">Sample selected. It needs a working model to run.</p>}
      <div className="experiment-foot">
        {tried && <p className="why" role="status">{swap ? "Same question. Different numbers inside the model." : "Compare the replies, then look inside to see what changed."}</p>}
        <div className="experiment-links">
          <button type="button" className="linkish" disabled={busy || !ready || !turns.length} onClick={() => store.set({ sheet: true, inspectView: "explanation" })}>Look inside</button>
          {!isExample && <button type="button" className="linkish muted" onClick={() => void openStep(st.n)}>Run the sample question</button>}
        </div>
      </div>
    </section>
  );
}

function StepControlView({ st, disabled }: { st: StepData; disabled: boolean }) {
  const chips = useStore((s) => s.chips);
  const c = st.control;
  const copy = stepCopy(st);
  if (!copy) return null;
  switch (c.kind) {
    case "swap": {
      const on = (chips.swaps ?? []).some(([a, b]) => (a === c.ids[0] && b === c.ids[1]) || (a === c.ids[1] && b === c.ids[0]));
      return (
        <button type="button" className={`btn change${on ? " on" : ""}`} aria-pressed={on} disabled={disabled}
          onClick={() => (on ? void applyChips({}) : void stepAction())}>
          {on ? `${S.undo}: ${copy.action}` : copy.action}
        </button>
      );
    }
    case "zeroed":
    case "hide":
    case "heads": {
      const on = !!(chips.zeroed?.length || chips.hidden?.length || chips.heads?.length);
      return (
        <>
          <button type="button" className={`btn change${on ? " on" : ""}`} aria-pressed={on} disabled={disabled}
            onClick={() => (on ? void applyChips({}) : void stepAction())}>{on ? `${S.undo}: ${copy.action}` : copy.action}</button>
          {c.kind === "heads" && (
            <button type="button" className="btn" disabled={disabled}
              onClick={() => void applyChips({ heads: c.random.map(([floor, head]) => ({ floor, head, mult: 0 })) })}>
              Turn off {c.random.length} comparison heads instead
            </button>
          )}
          {c.kind === "heads" && <button type="button" className="btn quiet" onClick={() => setFocus({ kind: "head", floor: c.heads[0][0], head: c.heads[0][1] })}>Show the heads</button>}
        </>
      );
    }
    case "floors":
      return (
        <div style={{ display: "grid", gap: 8 }}>
          {c.floors.map((f) => (
            <div key={f} style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <button type="button" className="linkish" onClick={() => setFocus({ kind: "floor", floor: f })}>{S.floorN(f + 1)}</button>
              <Knob label={S.floorN(f + 1)} value={multOf(chips, "floor", f)} disabled={disabled}
                onChange={(v) => { void chipsWith((s) => withMult({ ...s, floors: [] }, "floor", f, 0, v)).then(() => store.set({ stepTried: true })); }} />
            </div>
          ))}
        </div>
      );
    case "concept": {
      const cur = chips.concept?.strength ?? 0;
      return (
        <div style={{ display: "grid", gap: 6, width: "100%" }}>
          <div className="seg change" role="radiogroup" aria-label={`${c.label} strength`}>
            {c.stops.map((v) => (
              <button key={v} type="button" role="radio" data-v={v === 0 ? 1 : v} aria-checked={cur === v} disabled={disabled}
                onClick={() => void stepAction(v)}>{v === 0 ? "None" : v < 0 ? "Flip" : String(v)}</button>
            ))}
          </div>
          <p className="note">"{c.label}" at floor {c.floor + 1}. Strong settings can disrupt the reply; the effect depends on your question.</p>
        </div>
      );
    }
    case "bits": {
      const b = chips.bits ?? 4;
      return (
        <div className="seg change" role="radiogroup" aria-label="Bits per weight">
          {([4, 3, 2] as const).map((x) => (
            <button key={x} type="button" role="radio" data-v={x === 4 ? 1 : x} aria-checked={b === x} disabled={disabled}
              onClick={() => void stepAction(x)}>{2 ** x} levels</button>
          ))}
        </div>
      );
    }
    case "pick":
    case "guesses":
    case "madeup":
      return <button type="button" className="btn change" disabled={disabled} onClick={() => void stepAction()}>{copy.action}</button>;
    case "tiny":
      return <button type="button" className="btn primary" onClick={() => store.set({ tiny: true })}>{copy.action}</button>;
  }
}

// ------------------------------------------------------------------ chips

export function Chips() {
  const spec = useStore((s) => s.chips);
  const turns = useStore((s) => s.turns);
  const busy = useStore((s) => s.busy);
  const defs = chipDefs(spec, turns[0]?.normal.read);
  if (!defs.length) return null;
  return (
    <div className="chips" aria-label="Changes">
      {defs.map((d) => (
        <span key={d.key} className="chip">
          {d.label}
          <button type="button" disabled={busy} aria-label={S.remove(d.label)} onClick={() => void applyChips(d.without())}>×</button>
        </span>
      ))}
      {defs.length > 1 && <button type="button" className="btn quiet" disabled={busy} onClick={() => void applyChips({})}>{S.resetAll}</button>}
    </div>
  );
}

// ------------------------------------------------------------------ composer

export function Composer() {
  const mode = useStore((s) => s.mode);
  const busy = useStore((s) => s.busy);
  const model = useStore((s) => s.model);
  const full = useStore((s) => s.full);
  const [text, setText] = useState("");
  const submit = () => {
    if (mode !== "live" || busy || !text.trim()) return;
    const message = text;
    setText("");
    void send(message);
  };
  if (full) return <div className="context-full" role="status">
    <p>{S.contextFull} Start fresh to keep chatting with the current changes.</p>
    <button type="button" className="btn primary" onClick={freshStart}>{S.freshStart}</button>
  </div>;
  return (
    <div>
      <label className="composer-label" htmlFor="composer">{model.id === "tiny" ? "Start a sentence" : "Try your own question"}</label>
      <form className="composer main-composer" onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <textarea id="composer" rows={2} value={text} onChange={(e) => setText(e.target.value)}
          placeholder={model.id === "tiny" ? S.placeholderTiny : S.placeholderLive} aria-label="Message" autoComplete="off"
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); submit(); } }} />
        {busy ? <button type="button" className="btn stop" onClick={stopReply}>Stop</button>
          : <button type="submit" className="btn primary" disabled={mode !== "live" || !text.trim()}>{S.send}</button>}
      </form>
      {model.id === "qwen" && <DeviceBar />}
      {mode === "live" && <p className="composer-note">{model.id === "tiny" ? "Your trained model · continues text one letter at a time" : "Runs on your device · your messages stay here"}</p>}
    </div>
  );
}

// ------------------------------------------------------------------ device line

export function DeviceBar() {
  const d = useStore((s) => s.device);
  const stored = useStore((s) => s.modelStored);
  const bench = useStore((s) => s.bench);
  if (bench) return <pre className="devicebar" id="bench" style={{ whiteSpace: "pre-wrap" }}>{JSON.stringify(bench, null, 1)}</pre>;
  const mb = (n: number) => Math.round(n / 1e6);
  switch (d.kind) {
    case "checking": return <div className="devicebar" role="status">{S.checking}</div>;
    case "no-webgpu": return <div className="devicebar" role="status">{S.noWebgpu}</div>;
    case "downloading":
      return (
        <div className="devicebar" role="status">
          <span>{S.downloading(mb(d.loaded), mb(d.total))}</span>
          <span className="bar" role="progressbar" aria-label="Model download" aria-valuemin={0} aria-valuemax={d.total || undefined} aria-valuenow={d.total ? d.loaded : undefined}><i style={{ width: `${d.total ? (100 * d.loaded) / d.total : 0}%` }} /></span>
          <button type="button" className="btn quiet" onClick={() => pauseDownload(!d.paused)}>{d.paused ? S.resume : S.pause}</button>
        </div>
      );
    case "loading": return <div className="devicebar" role="status">{S.loadingModel}</div>;
    case "recovering": return <div className="devicebar" role="status">{S.recovering}</div>;
    case "ready": return stored === false ? <div className="devicebar" role="status">{S.storageRefused}</div> : null;
    case "error": return <div className="devicebar" role="status">{S.loadError(d.message)} <button type="button" className="btn" onClick={() => void checkDevice()}>{S.retry}</button></div>;
  }
}

// ------------------------------------------------------------------ path list

const featuredExperiments = [1, 3, 6];

export function PathList() {
  const open = useStore((s) => s.pathOpen);
  const busy = useStore((s) => s.busy);
  const mode = useStore((s) => s.mode);
  const model = useStore((s) => s.model);
  const turns = useStore((s) => s.turns);
  const hasOwnChat = mode === "live" && model.id === "qwen" && turns.length > 0;
  const steps = open ? shippingSteps().filter((s) => s.control.kind !== "tiny") : [];
  const row = (s: StepData) => {
    const copy = stepCopy(s);
    const canApply = hasOwnChat && canUseInChat(s);
    return <li key={s.n}>
      <div><h3>{copy?.title ?? s.slug}</h3><p>{copy?.question}</p></div>
      <div className="experiment-choices">
        {canApply && <button type="button" className="btn change" disabled={busy} onClick={() => void useExperiment(s.n)}>Use in this chat</button>}
        <button type="button" className={`btn${canApply ? " quiet" : ""}`} onClick={() => void openStep(s.n)}>Run sample question</button>
      </div>
    </li>;
  };
  return <Modal open={open} onClose={() => store.set({ pathOpen: false })} title="Experiments" className="experiment-browser">
    <p className="modal-intro">Change one thing and see what happens. Each sample question runs on your device, just like your own chat.</p>
    <ul className="experiment-list">{featuredExperiments.flatMap((n) => steps.filter((s) => s.n === n)).map(row)}</ul>
    <details className="more-experiments"><summary>More to explore</summary>
      <ul className="experiment-list">{steps.filter((s) => !featuredExperiments.includes(s.n)).map(row)}</ul>
    </details>
    <div className="training-invitation"><div><h3>Teach a tiny model</h3><p>Watch a separate, smaller model learn from text.</p></div>
      <button type="button" className="btn" onClick={() => { stopReply(); store.set({ tiny: true, pathOpen: false, sheet: false }); }}>Open training</button>
    </div>
  </Modal>;
}

export function WhatsReal({ expanded = false }: { expanded?: boolean }) {
  const [open, setOpen] = useState(expanded);
  return <div className="whats-real">
    {!expanded && <button type="button" className="linkish small" aria-expanded={open} onClick={() => setOpen(!open)}>{S.whatsReal}</button>}
    {open && <ul className="whatsreal note">{S.whatsRealBody.map((x) => <li key={x}>{x}</li>)}</ul>}
  </div>;
}
