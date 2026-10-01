// The step card, change chips, composer, device line, path list and "What's real here".
import { useState } from "react";
import { applyChips, chipsWith, checkDevice, freshStart, openStep, pauseDownload, replayAlternative, send, setFocus, shippingSteps,
  startDownload, stepAction, stepData } from "../state/actions.ts";
import { store, useStore } from "../state/store.ts";
import { COPY, type StepData } from "../path/steps.ts";
import { S } from "../strings.ts";
import { chips as chipDefs, multOf, withMult } from "./describe.ts";
import { Knob } from "./Knob.tsx";

// ------------------------------------------------------------------ step card

export function StepCard() {
  const step = useStore((s) => s.step);
  const tried = useStore((s) => s.stepTried);
  const mode = useStore((s) => s.mode);
  const busy = useStore((s) => s.busy);
  const st = stepData(step);
  if (!st) return null;
  const copy = COPY[st.slug];
  if (!copy) return null;
  const steps = shippingSteps();
  const i = steps.findIndex((x) => x.n === st.n);
  const prev = steps[i - 1], next = steps[i + 1];
  return (
    <section className="step" aria-labelledby="step-title">
      <div className="count">{S.stepOf(i + 1, steps.length)}{st.core ? "" : ""}</div>
      <h2 id="step-title">{copy.title}</h2>
      <p className="q">{copy.question}</p>
      {copy.term && S.terms[copy.term] && (
        <p className="term">{S.terms[copy.term][0]}: <i>{S.terms[copy.term][1]}</i></p>
      )}
      <div className="controls"><StepControlView st={st} disabled={busy} /></div>
      {tried && <p className="why" role="status">{copy.why(st.facts ?? {})}</p>}
      <div className="nav">
        {prev && <a className="btn quiet" href={`#step-${prev.n}`} onClick={(e) => { e.preventDefault(); void openStep(prev.n); }}>{S.back}</a>}
        {tried && st.control.kind !== "tiny" && (mode === "live" ? (
          <button type="button" className="btn quiet" onClick={() => { store.set({ step: null }); document.getElementById("composer")?.focus(); }}>{S.tryOwn}</button>
        ) : st.alternatives?.length ? <span className="note">{S.tryOwnReplay}: below</span> : null)}
        <span className="spacer" />
        {next && <a className="btn primary" href={`#step-${next.n}`} onClick={(e) => { e.preventDefault(); void openStep(next.n); }}>{S.next}</a>}
      </div>
    </section>
  );
}

function StepControlView({ st, disabled }: { st: StepData; disabled: boolean }) {
  const chips = useStore((s) => s.chips);
  const c = st.control;
  const copy = COPY[st.slug];
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
              Turn off {c.random.length} random heads instead
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
                onClick={() => void stepAction(v)}>{v === 0 ? "None" : v === -c.stops[c.stops.length - 1] ? "Flip" : String(v)}{v === c.breaking ? " (breaks)" : ""}</button>
            ))}
          </div>
          <p className="note">"{c.label}" at floor {c.floor + 1}. The breaking line is at {c.breaking}.</p>
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
      return <button type="button" className="btn primary" onClick={() => store.set({ tiny: true })}>{S.tiny.open}</button>;
  }
}

// ------------------------------------------------------------------ chips

export function Chips() {
  const spec = useStore((s) => s.chips);
  const turns = useStore((s) => s.turns);
  const defs = chipDefs(spec, turns[0]?.normal.read);
  if (!defs.length) return null;
  return (
    <div className="chips" aria-label="Changes">
      {defs.map((d) => (
        <span key={d.key} className="chip">
          {d.label}
          <button type="button" aria-label={S.remove(d.label)} onClick={() => void applyChips(d.without())}>×</button>
        </span>
      ))}
      <button type="button" className="btn quiet" onClick={() => void applyChips({})}>{S.resetAll}</button>
    </div>
  );
}

// ------------------------------------------------------------------ composer

export function Composer() {
  const mode = useStore((s) => s.mode);
  const busy = useStore((s) => s.busy);
  const step = useStore((s) => s.step);
  const model = useStore((s) => s.model);
  const full = useStore((s) => s.full);
  const [text, setText] = useState("");
  const st = stepData(step);
  if (mode !== "live") {
    const alts = st?.alternatives ?? [];
    if (!alts.length) return null;
    return (
      <div>
        <p className="note">{S.placeholderReplay}</p>
        <div className="suggest">
          {alts.map((a) => <button key={a} type="button" className="btn" onClick={() => void playAlternative(a)}>{a}</button>)}
        </div>
      </div>
    );
  }
  const suggest = model.id === "qwen" && st ? COPY[st.slug]?.suggestions ?? [] : [];
  if (full) return (
    <div className="composer" role="status">
      <span className="note" style={{ flex: 1 }}>{S.contextFull}</span>
      <button type="button" className="btn primary" onClick={freshStart}>{S.freshStart}</button>
    </div>
  );
  return (
    <div>
      <form className="composer" onSubmit={(e) => { e.preventDefault(); const t = text; setText(""); void send(t); }}>
        <input id="composer" value={text} onChange={(e) => setText(e.target.value)} placeholder={model.id === "tiny" ? S.placeholderTiny : S.placeholderLive} aria-label="Message" disabled={busy} autoComplete="off" />
        <button type="submit" className="btn primary" disabled={busy || !text.trim()}>{S.send}</button>
      </form>
      {suggest.length > 0 && (
        <div className="suggest">
          {suggest.map((q) => <button key={q} type="button" className="btn" disabled={busy} onClick={() => void send(q)}>{q}</button>)}
        </div>
      )}
    </div>
  );
}

async function playAlternative(message: string) {
  const st = stepData(store.get().step);
  if (st) await replayAlternative(st, message);
}

// ------------------------------------------------------------------ device line

export function DeviceBar() {
  const d = useStore((s) => s.device);
  const bench = useStore((s) => s.bench);
  if (bench) return <pre className="devicebar" id="bench" style={{ whiteSpace: "pre-wrap" }}>{JSON.stringify(bench, null, 1)}</pre>;
  const mb = (n: number) => Math.round(n / 1e6);
  switch (d.kind) {
    case "checking": return <div className="devicebar" role="status">{S.checking}</div>;
    case "no-webgpu": return <div className="devicebar" role="status">{S.noWebgpu}</div>;
    case "slow": return <div className="devicebar" role="status">{S.slow} <button type="button" className="linkish" onClick={() => void checkDevice(true)}>{S.tryAnyway}</button></div>;
    case "crashed": return <div className="devicebar" role="status">{S.crashed} <button type="button" className="linkish" onClick={() => void checkDevice(true)}>{S.tryAnyway}</button></div>;
    case "offer": return <div className="devicebar" role="status">{S.offer(350)} <button type="button" className="btn" onClick={() => void startDownload(d.seconds)}>{S.download}</button></div>;
    case "downloading":
      return (
        <div className="devicebar" role="status">
          <span>{S.downloading(mb(d.loaded), mb(d.total) || 350)}</span>
          <span className="bar" aria-hidden="true"><i style={{ width: `${d.total ? (100 * d.loaded) / d.total : 0}%` }} /></span>
          <button type="button" className="btn quiet" onClick={() => pauseDownload(!d.paused)}>{d.paused ? S.resume : S.pause}</button>
        </div>
      );
    case "loading": return <div className="devicebar" role="status">{S.loadingModel}</div>;
    case "ready": return null;
    case "error": return <div className="devicebar" role="status">{S.loadError(d.message)}</div>;
  }
}

// ------------------------------------------------------------------ path list

export function PathList() {
  const open = useStore((s) => s.pathOpen);
  const step = useStore((s) => s.step);
  if (!open) return null;
  const steps = shippingSteps();
  return (
    <div className="overlay" onClick={() => store.set({ pathOpen: false })}>
      <nav className="drawer" aria-label={S.pathTitle} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h2>{S.pathTitle}</h2>
          <button type="button" className="btn quiet" onClick={() => store.set({ pathOpen: false })}>{S.close}</button>
        </div>
        <p className="note" style={{ marginTop: 4 }}>{S.pathIntro}</p>
        <ol>
          {steps.map((s, i) => (
            <li key={s.n}>
              <a href={`#step-${s.n}`} aria-current={s.n === step ? "step" : undefined}
                onClick={(e) => { e.preventDefault(); void openStep(s.n); }}>
                <span className="n">{i + 1}</span>
                <span>{COPY[s.slug]?.title ?? s.slug}</span>
              </a>
            </li>
          ))}
        </ol>
        <WhatsReal />
      </nav>
    </div>
  );
}

export function WhatsReal() {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ marginTop: 18 }}>
      <button type="button" className="linkish small" aria-expanded={open} onClick={() => setOpen(!open)}>{S.whatsReal}</button>
      {open && <ul className="whatsreal note">{S.whatsRealBody.map((x) => <li key={x}>{x}</li>)}</ul>}
    </div>
  );
}
