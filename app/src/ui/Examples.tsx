import { chipsWith, openStep, setFocus, stepData } from "../state/actions.ts";
import { store, useStore } from "../state/store.ts";
import { guideAddress, guideTarget, stepCopy, type StepData } from "../path/steps.ts";
import { signed } from "./color.ts";

export function ExampleSelector() {
  const step = useStore((s) => s.step);
  const busy = useStore((s) => s.busy);
  const model = useStore((s) => s.model);
  if (model.id !== "qwen") return null;
  const examples = [14, 12, 13].map(stepData).filter((s): s is StepData => !!s?.guide);
  return <div className="example-selector">
    <label htmlFor="example-select">Try an example</label>
    <span className="example-select-field"><select id="example-select" value={stepData(step)?.guide ? step! : ""} disabled={busy}
      onChange={(e) => void openStep(e.target.value ? Number(e.target.value) : null)}>
      <option value="">Your own experiment</option>
      {examples.map((s) => <option key={s.n} value={s.n}>{s.guide!.label}</option>)}
    </select></span>
    <span className="note">Selecting an example clears samples and restores the model.</span>
  </div>;
}

export function GuidedStep({ st }: { st: StepData }) {
  const turns = useStore((s) => s.turns);
  const guide = st.guide!, target = guideTarget(st)!, copy = stepCopy(st)!;
  return <section className="step guided-step" aria-labelledby="step-title">
    <p className="eyebrow">Try it yourself</p>
    <h2 id="step-title">{copy.title}</h2>
    {turns.length > 0 && <p className="guide-next">{guideAddress(st)}. {guide.action}</p>}
    <details className="guide-help" open={!turns.length}>
    <summary>Instructions and test notes</summary>
    <ol className="guide-instructions">
      <li><strong>Test a question.</strong> Use a suggested question, edit it, or write your own.</li>
      <li><strong>Find {guideAddress(st)}.</strong> It has a dotted marker in the model. {guide.action}</li>
      <li><strong>Compare the replies.</strong> Try another question, then restore the original to check the effect.</li>
    </ol>
    <details className="example-evidence"><summary>What happened in our tests?</summary>
      <p>{guide.observed} We used three sampling seeds and one greedy run with this same model. Your reply is generated here.</p>
      <p>{copy.why}</p>
    </details>
    </details>
    <button className="btn" onClick={() => setFocus(target)}>Find marked part</button>
    {!turns.length && <p className="note guide-pending">Test your question first. You make the change yourself.</p>}
  </section>;
}

/** Suggestions stay next to the composer after the first sample, without sending automatically. */
export function SuggestedQuestions() {
  const st = stepData(useStore((s) => s.step));
  const draft = useStore((s) => s.draft), busy = useStore((s) => s.busy);
  const model = useStore((s) => s.model);
  if (model.id !== "qwen" || !st?.guide) return null;
  return <div className="suggested-questions">
    <p className="note">Suggested questions</p>
    <div className="sample-questions" role="group" aria-label="Suggested questions">
      {st.guide.samples.map((q) => <button className="btn" key={q} disabled={busy} aria-pressed={draft === q}
        onClick={() => { store.set({ draft: q }); document.getElementById("composer")?.focus(); }}>{q}</button>)}
    </div>
  </div>;
}

/** The intervention lives at its actual MLP, reached by clicking the marked cell. */
export function NeuronControl({ floor }: { floor: number }) {
  const st = stepData(useStore((s) => s.step));
  const chips = useStore((s) => s.chips);
  const busy = useStore((s) => s.busy);
  const ready = useStore((s) => s.mode === "live");
  const model = useStore((s) => s.model);
  if (model.id !== "qwen" || !st?.guide || st.control.kind !== "neurons") return null;
  const c = st.control, n = c.units.find((n) => n.floor === floor);
  if (!n) return null;
  const delta = chips.neurons?.find((v) => v.floor === floor && v.unit === n.unit)?.delta ?? 0;
  const dose = delta / n.deltaPerDose;
  return <section className="example-neuron" aria-label="Marked neuron controls">
    <p className="eyebrow">Example target · {c.label} candidate</p>
    <h3>Neuron {n.unit + 1} · Layer {floor + 1}</h3>
    <p className="note">{st.guide.action}</p>
    <div className="seg change" role="group" aria-label={`${c.label} added activation`}>
      {c.stops.map((v) => <button key={v} type="button" data-v={v === 0 ? 1 : v}
        aria-pressed={Math.abs(dose - v) < 1e-6} disabled={busy || !ready}
        onClick={() => void chipsWith((spec) => ({ ...spec, neurons: [
          ...(spec.neurons ?? []).filter((x) => x.floor !== floor || x.unit !== n.unit),
          ...(v ? [{ floor, unit: n.unit, delta: v * n.deltaPerDose }] : []),
        ] })).then(() => store.set({ stepTried: true }))}>{v === 0 ? "Original" : v}</button>)}
    </div>
    <p className="note num">Added activation: {signed(delta)} · Research address: L{floor}N{n.unit}</p>
    <p className="note">Changes this neuron after the MLP gate at every token. Higher strength can disrupt the reply.</p>
  </section>;
}

export function HeadExampleHint({ floor, head }: { floor: number; head: number }) {
  const st = stepData(useStore((s) => s.step));
  const model = useStore((s) => s.model);
  if (model.id !== "qwen" || !st?.guide || st.control.kind !== "head" || st.control.floor !== floor || st.control.head !== head) return null;
  return <p className="example-part-hint">Example target · {st.guide.action} Restore with Normal. Research address: L{floor}H{head}.</p>;
}
