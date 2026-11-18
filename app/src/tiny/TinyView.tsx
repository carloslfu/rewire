import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { decode, encode, VOCAB } from "@rewire/tiny/src/data.ts";
import { layout, TINY } from "@rewire/tiny/src/config.ts";
import { mutateWeights, secretLanguage } from "@rewire/tiny/src/lab.ts";
import { openTiny } from "../state/actions.ts";
import { useStore } from "../state/store.ts";
import { S } from "../strings.ts";
import { divergingRGB, fmt, pct, onThemeChange } from "../ui/color.ts";
import { Strip } from "../ui/Strip.tsx";
import { ModelWorkspace } from "../ui/ModelWorkspace.tsx";
import type { TinyIn, TinyOut } from "./train.worker.ts";
import type { Damage } from "../stage/GrowStage.tsx";
import { afterAdopting, afterDamage, afterRestore, type Checkpoint, continueNote, copyLabel, endRun, failureNote, type Held, isDamaged, type Lineage, NOTHING_HELD, NO_RUN, type Run, runIsCurrent, runNote, runUpTo, UNTRAINED, whileTraining } from "./lineage.ts";

const GrowStage = lazy(() => import("../stage/GrowStage.tsx"));

const STEPS = 1200, BATCH = 16, LR = 3e-3;
const language = secretLanguage();
const cfg = { ...TINY, vocab: VOCAB };
type TestResult = Extract<TinyOut, { t: "tested" }>["results"];

export default function TinyView() {
  const active = useStore((s) => s.tiny);
  const [text, setText] = useState(language.text);
  const [prompt, setPrompt] = useState(language.tests[0].prompt);
  const [running, setRunning] = useState(false);
  const [working, setWorking] = useState(false);
  // The training history on screen. It belongs to the weights on screen and comes and goes with them.
  const [losses, setLosses] = useState<number[]>([]);
  const [samples, setSamples] = useState<Run["samples"]>([]);
  const run = useRef<Run>(NO_RUN);
  const showRun = (next: Run) => { run.current = next; setLosses(next.losses); setSamples(next.samples); };
  const [params, setParams] = useState<Float32Array | null>(null);
  const [reference, setReference] = useState<Float32Array | null>(null);
  // Which weights are on screen and which are kept behind them. The ref is for the worker's messages,
  // which are handled by a function made once.
  const [lineage, showLineage] = useState<Lineage>(UNTRAINED);
  const line = useRef<Lineage>(UNTRAINED);
  const setLineage = (next: Lineage) => { line.current = next; showLineage(next); };
  const intact = lineage.intact?.params ?? null, mutation = copyLabel(lineage), damaged = isDamaged(lineage);
  const [damage, setDamage] = useState<Damage | null>(null);
  const [status, setStatus] = useState("");
  const [result, setResult] = useState<{ prompt: string; text: string; model: string } | null>(null);
  const [baseline, setBaseline] = useState<{ prompt: string; text: string } | null>(null);
  const [tests, setTests] = useState<TestResult | null>(null);
  const [cases, setCases] = useState(language.tests.map((t) => t.prompt + t.answer).join("\n"));
  const [testCorpus, setTestCorpus] = useState("");
  const [step, setStep] = useState(0);
  const [strength, setStrength] = useState(0.25);
  const w = useRef<Worker | null>(null);
  const runBase = useRef(0);
  const cumulative = useRef(0);
  // The run under way: what the bench held when it began, the text it trains on, and the last weights it has delivered.
  const training = useRef(false);
  const began = useRef<Held>(NOTHING_HELD);
  const runCorpus = useRef("");
  const reached = useRef<{ params: Float32Array; steps: number } | null>(null);
  const first = useRef<Float32Array | null>(null);
  const request = useRef({ prompt: "", model: "" });
  const knownCorpus = useRef("");
  const mutationSeed = useRef(3);
  const mounted = useRef(true);
  const unavailable = !("gpu" in navigator);
  const disabled = running || working;

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; w.current?.terminate(); w.current = null; };
  }, []);
  useEffect(() => { if (!active) w.current?.postMessage({ t: "stop" } satisfies TinyIn); }, [active]);

  /** Put weights on screen with everything that belongs to them: their step, their text, their history and their lineage. */
  const hold = (h: Held) => { setParams(h.params); setStep(h.step); cumulative.current = h.step; knownCorpus.current = h.corpus; showRun(h.run); setLineage(h.lineage); };
  /** The run under way has ended: finished, stopped or failed. The bench holds what that leaves, never a half state. */
  const finish = (result: { params: Float32Array; steps: number } | null) => {
    const start = began.current, steps = result?.steps ?? 0;
    const held = endRun(start, result, runCorpus.current, runUpTo(run.current, start.run.losses.length, start.step, steps));
    training.current = false;
    hold(held);
    setRunning(false);
    return { start, held };
  };
  /** The worker reported a failure. A training run ends on the last weights it delivered, or as it began. */
  const fail = (message: string) => {
    setWorking(false);
    if (!training.current) { setRunning(false); setStatus(message); return; }
    const { start, held } = finish(reached.current);
    setStatus([/[.!?]$/.test(message) ? message : `${message}.`, failureNote(start, held)].filter(Boolean).join(" "));
  };
  const receive = (m: TinyOut) => {
    if (!mounted.current) return;
    if (m.t === "ready") setStatus("Learning on this device…");
    if (m.t === "unsupported") fail("This browser cannot train with WebGPU. Try Chrome on a supported device.");
    if (m.t === "loss") { run.current = { ...run.current, losses: [...run.current.losses, m.loss] }; setLosses(run.current.losses); setStep(runBase.current + m.step); }
    if (m.t === "snapshot") {
      if (!first.current) { first.current = m.params; setReference(m.params); }
      setParams(m.params);
      if (training.current) reached.current = { params: m.params, steps: m.step };
    }
    if (m.t === "sample") { run.current = { ...run.current, samples: [...run.current.samples, { step: runBase.current + m.step, text: m.text }] }; setSamples(run.current.samples); }
    if (m.t === "done") {
      // From the intact weights the result is the new intact copy. A damaged copy stays a copy: the intact weights behind it are kept.
      const { start } = finish({ params: m.params, steps: m.steps });
      const before = start.lineage, ran = `${m.steps} training ${m.steps === 1 ? "step" : "steps"}`;
      setStatus(isDamaged(before) && before.intact
        ? (m.steps ? `${ran} on the damaged copy in ${m.seconds.toFixed(1)} seconds. The intact weights from step ${before.intact.step.toLocaleString("en-US")} are kept.` : "No additional training steps completed. The damaged copy is unchanged.")
        : m.steps ? `${ran} in ${m.seconds.toFixed(1)} seconds. The weights are ready to test.` : "No additional training steps completed. The current weights are ready to inspect.");
    }
    if (m.t === "sampled") {
      setWorking(false); setResult({ ...request.current, text: m.text });
      if (!request.current.model) setBaseline({ prompt: request.current.prompt, text: m.text });
    }
    if (m.t === "probed") {
      setWorking(false); setResult({ ...request.current, text: m.text });
      setBaseline({ prompt: request.current.prompt, text: m.baseline });
    }
    if (m.t === "tested") { setWorking(false); setStatus("Test complete. Results below."); setTests(m.results); setTestCorpus(knownCorpus.current); }
    if (m.t === "error") fail(m.message);
  };
  const worker = () => {
    if (!w.current) {
      w.current = new Worker(new URL("./train.worker.ts", import.meta.url), { type: "module" });
      w.current.onmessage = (e: MessageEvent<TinyOut>) => receive(e.data);
      w.current.onerror = () => { fail("The training worker stopped."); w.current?.terminate(); w.current = null; };
    }
    return w.current;
  };
  const teach = (resume: boolean) => {
    if (disabled || unavailable || encode(text).length < 65) return;
    // What the run starts from. If it fails before delivering anything, this is what the bench goes back to.
    const start: Held = resume ? { params, step: cumulative.current, corpus: knownCorpus.current, run: run.current, lineage: line.current } : NOTHING_HELD;
    began.current = start; reached.current = null; training.current = true;
    if (!resume) { first.current = null; setReference(null); setParams(null); setStep(0); cumulative.current = 0; setLineage(UNTRAINED); setDamage(null); }
    else setLineage(whileTraining(start.lineage));
    // A run shows its own checkpoints, after the losses of the training that led to the weights it starts from.
    showRun({ samples: [], losses: start.run.losses });
    runBase.current = start.step;
    runCorpus.current = resume ? start.corpus + "\n" + text : text;
    setRunning(true); setStatus("Starting…"); setTests(null); setResult(null); setBaseline(null);
    worker().postMessage({ t: "start", text, params: resume ? params!.slice() : undefined, prompt, steps: STEPS, batch: BATCH, lr: LR, seed: 1 + runBase.current } satisfies TinyIn);
  };
  const test = (weights = params, label = mutation) => {
    if (!weights || disabled || !prompt.trim()) return;
    request.current = { prompt, model: label };
    setWorking(true); setStatus("");
    worker().postMessage(label && intact ? { t: "probe", params: weights.slice(), baseline: intact.slice(), prompt } satisfies TinyIn
      : { t: "sample", params: weights.slice(), prompt, length: 80, seed: 42 } satisfies TinyIn);
  };
  // The whole model, or one layer when the 3D view punches it. Either way the result starts from the intact copy.
  const mutate = (kind: "noise" | "erase", floor?: number) => {
    const from = lineage.intact;
    if (!from || disabled) return;
    const next = mutateWeights(from.params, cfg, { kind, amount: strength, seed: mutationSeed.current++, floor });
    const where = floor === undefined ? "" : `Layer ${floor + 1}: `;
    const label = where + (kind === "erase" ? `${where ? "erased" : "Erased"} approximately ${Math.round(strength * 100)}% of matrix weights` : `${where ? "noise" : "Noise"} at ${Math.round(strength * 100)}% of each matrix’s RMS`);
    setParams(next); setLineage(afterDamage(line.current, label)); setDamage({ kind, floor }); setTests(null);
    // The copy starts from the intact weights, so it stands at their step and has seen their text. It has
    // no training of its own yet: the history shown is theirs, and is said to be.
    backTo(from);
    test(next, label);
  };
  /** The step, text and history of a checkpoint, in place of whatever a retrained copy left behind. */
  const backTo = (c: Checkpoint) => { setStep(c.step); cumulative.current = c.step; knownCorpus.current = c.corpus; showRun(c.run); };
  const restore = () => {
    const back = lineage.intact;
    if (!back || disabled) return;
    setParams(back.params); setLineage(afterRestore(line.current)); setDamage(null); setTests(null);
    backTo(back);
    test(back.params, "");
  };
  // The one action that replaces the intact weights: the visitor keeps the retrained copy as the model to go on from.
  const adopt = () => {
    if (!params || disabled || !damaged) return;
    setLineage(afterAdopting({ params, step: cumulative.current, corpus: knownCorpus.current, run: run.current })); setDamage(null);
    // What was generated before compared this copy with the old intact weights. "Intact weights" now
    // means these, so the old pair is dropped and these weights answer the same prompt again.
    setResult(null); setBaseline(null);
    test(params, "");
    setStatus(`These weights are now the intact copy, at step ${cumulative.current.toLocaleString("en-US")}.`);
  };
  const keepLabel = damaged ? "Retrain the damaged copy" : "Keep learning";
  const intactStep = lineage.intact?.step ?? 0;
  const last = samples[samples.length - 1];
  // Whether the history on screen ends at the weights on screen. A run under way is always its own.
  const ownRun = running || runIsCurrent(lineage);
  const lastLoss = losses.length ? losses[losses.length - 1] : null;
  const validText = encode(text).length >= 65;
  const visualizer = <Suspense fallback={<p className="stage-state" role="status">Opening the 3D model…</p>}>
    <GrowStage params={params} reference={reference} intact={intact} step={step} running={running} active={active}
      controls={{ disabled, unavailable, validText, status, loss: ownRun ? lastLoss : null, mutation, damage, strength, setStrength,
        keepLabel, continueNote: continueNote(lineage), retrained: lineage.retrained, intactStep, adopt,
        teach, stop: () => { w.current?.postMessage({ t: "stop" } satisfies TinyIn); setStatus("Finishing the current step…"); }, mutate, restore }} /></Suspense>;
  const testCases = cases.split("\n").flatMap((line) => {
    const parts = line.split(" = ");
    return parts.length === 2 && parts[0] && parts[1] ? [{ prompt: `${parts[0]} = `, answer: parts[1] }] : [];
  }).slice(0, 12);
  return <ModelWorkspace stage={visualizer} id="training-scope" label="Live training visualizer" workLabel="Training">
    <main tabIndex={-1} className="workspace training-workspace" id="training">
      <div className="lab-heading"><p className="eyebrow">Grow a model · starts with random weights</p><h1>Give it a strange little world.</h1>
        <p>Invent a language. Feed it your writing. Watch the weights learn, then mess them up.</p></div>
      <section className="teaching-data">
        <div className="section-heading"><h2>What should it learn?</h2><button className="btn quiet" disabled={disabled} onClick={() => { setText(language.text); setPrompt(language.tests[0].prompt); setCases(language.tests.map((t) => t.prompt + t.answer).join("\n")); }}>Secret language</button></div>
        <p className="note">These invented words are editable. Six combinations are left out so you can test whether it learns the pieces.</p>
        <label className="sr-only" htmlFor="own">Training text</label><textarea id="own" rows={7} value={text} disabled={disabled} onChange={(e) => setText(e.target.value)} spellCheck={false} />
        {!validText && <p className="note">Give it at least 65 letters to learn from.</p>}
        <div className="row training-actions">
          {running ? <button className="btn primary" onClick={() => { w.current?.postMessage({ t: "stop" } satisfies TinyIn); setStatus("Finishing the current step…"); }}>Stop learning</button>
            : <><button className="btn primary" disabled={disabled || unavailable || !validText} onClick={() => teach(false)}>{params ? "Start over from noise" : "Start learning"}</button>
            {params && <button className="btn" disabled={disabled || unavailable || !validText} onClick={() => teach(true)}>{keepLabel}</button>}</>}
        </div>
        {damaged && !running && <p className="note">{continueNote(lineage)}</p>}
        <p className="note training-status" role="status">{unavailable ? "Live training needs WebGPU. Try Chrome on a supported device." : status || (params ? "Weights stay in memory for this visit." : "About 20 seconds on a fast laptop. Everything runs here.")}</p>
      </section>
      {samples.length > 0 && <section className="learning-output"><div className="section-heading"><h2>{running ? "Learning in front of you" : "What changed"}</h2><span className="num">Step {step}</span></div>
        {!ownRun && <p className="note">{runNote(lineage)}</p>}
        <p className="note">Same starting text and random seed at every checkpoint.</p>
        <div className="training-samples"><div><h3>At the start of this lesson</h3><pre className="sample">{samples[0].text}</pre></div><div><h3>{running ? "Latest checkpoint" : "Last checkpoint"} · {last?.step}</h3><pre className="sample">{last?.text}</pre></div></div>
        {lastLoss !== null && <><LossChart losses={losses} /><p className="note">Training loss {lastLoss.toFixed(3)}{ownRun ? "" : " at the end of that run, before the damage"}. Lower means better predictions on the training text.</p></>}
      </section>}
      <section className="test-bench"><h2>Ask it something it hasn’t seen.</h2><p className="note">Only this starting text goes into the model. The training examples stay out of its context.</p>
        <label htmlFor="test-prompt" className="sr-only">Test starting text</label><div className="probe-input"><input id="test-prompt" value={prompt} disabled={disabled} onChange={(e) => setPrompt(e.target.value)} /><button className="btn" disabled={!params || disabled || !prompt.trim()} onClick={() => test()}>Generate</button></div>
        {result && <div className="probe-result"><p className="eyebrow">{result.model || "Intact weights"}</p><p className="probe-prompt num">{result.prompt}</p><pre className="sample">{result.text}</pre></div>}
        {baseline && result?.model && baseline.prompt === result.prompt && <div className="intact-comparison"><p className="eyebrow">Intact weights · same input and seed</p><pre className="sample">{baseline.text}</pre></div>}
        <button className="linkish" disabled={!params || disabled || !testCases.length} onClick={() => { setWorking(true); setStatus("Testing unseen combinations…"); worker().postMessage({ t: "test", params: params!.slice(), cases: testCases } satisfies TinyIn); }}>Run the tests</button>
        <details className="training-details"><summary>Edit the tests</summary><p className="note">Up to 12 tests, one “input = expected answer” per line. The expected answers are used only for scoring. They are never fed to the model when it writes its answer.</p><label className="sr-only" htmlFor="test-cases">Test cases</label><textarea id="test-cases" value={cases} disabled={disabled} onChange={(e) => setCases(e.target.value)} rows={6} spellCheck={false} /></details>
        {tests && <div className="test-results"><p>{tests.filter((r) => r.output === r.answer).length} / {tests.length} exact answers. {tests.some((r) => testCorpus.includes(r.prompt)) ? "Some test inputs appear in your training text; those are marked seen." : "None of these exact inputs appear in the text used to train this model."}</p><table><thead><tr><th>Input</th><th>Expected</th><th>Model wrote</th></tr></thead><tbody>{tests.map((t, i) => <tr key={i}><td>{t.prompt.replace(" = ", "")}{testCorpus.includes(t.prompt) && <small> · seen</small>}</td><td>{t.answer}</td><td className={t.answer === t.output ? "test-pass" : "changed-text"}>{JSON.stringify(t.output)}</td></tr>)}</tbody></table><p className="note">Greedy decoding, capped at the expected answer’s length. A small test of this pattern, not a general capability score.</p></div>}
      </section>
      <section className="damage-bench"><h2>Now break what it learned.</h2><p className="note">These controls rewrite the actual matrix weights used to generate text. The intact copy stays available.</p>
        <label className="damage-strength" htmlFor="damage-strength">Strength <output>{Math.round(strength * 100)}%</output><input id="damage-strength" type="range" min="0.05" max="1" step="0.05" value={strength} disabled={disabled} onChange={(e) => setStrength(Number(e.target.value))} /></label>
        <div className="row"><button className="btn change" disabled={!intact || disabled} onClick={() => mutate("noise")}>Scramble weights</button><button className="btn" disabled={!intact || disabled} onClick={() => mutate("erase")}>Erase weights</button><button className="btn quiet" disabled={!mutation || disabled} onClick={restore}>Restore intact model</button></div>
        {mutation && <p className="note">{mutation}. Each experiment starts from the intact copy.</p>}
        {lineage.retrained > 0 && <p className="note"><button className="linkish" disabled={disabled} onClick={adopt}>Make this the intact copy</button> It replaces the intact weights from step {intactStep.toLocaleString("en-US")}.</p>}
      </section>
      {params && <section className="training-handoff"><button className="btn" disabled={disabled} onClick={() => { setWorking(true); void openTiny(params).catch((e) => setStatus(String(e))).finally(() => setWorking(false)); }}>Open this model in the full lab</button><p className="note">Inspect attention, disable heads, and follow each letter through all four layers.</p></section>}
      <details className="training-details"><summary>What is actually being trained?</summary><p className="note">A separate {layout(cfg).total.toLocaleString()}-parameter transformer, starting from random weights. Adam updates every trainable parameter using next-letter prediction. This does not fine-tune Qwen. Keep learning preserves the current weights and starts a new optimizer. After Scramble or Erase it trains the damaged copy and the intact weights stay available to restore. It trains on 64-letter windows and works best with short ASCII patterns.</p>{params && !disabled && <SlowMotion params={params} corpus={text} worker={worker} />}</details>
    </main>
  </ModelWorkspace>;
}
function LossChart({ losses }: { losses: number[] }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const draw = () => {
    const dpr = devicePixelRatio || 1;
    const W = cv.clientWidth, H = cv.clientHeight;
    if (!W || !H) return;
    cv.width = W * dpr; cv.height = H * dpr;
    const ctx = cv.getContext("2d")!;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, W, H);
    const top = Math.max(Math.log(VOCAB), ...losses), n = Math.max(STEPS, losses.length);
    const cs = getComputedStyle(document.documentElement);
    ctx.strokeStyle = cs.getPropertyValue("--line");
    ctx.beginPath(); ctx.moveTo(0, H - 0.5); ctx.lineTo(W, H - 0.5); ctx.stroke();
    ctx.strokeStyle = cs.getPropertyValue("--fg");
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    losses.forEach((l, i) => {
      const x = (i / n) * W, y = H - 6 - (l / top) * (H - 12);
      if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
    });
    ctx.stroke();
    };
    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(cv);
    const stopTheme = onThemeChange(draw);
    return () => { observer.disconnect(); stopTheme(); };
  }, [losses]);
  return <canvas ref={ref} role="img" aria-label={`Loss over ${losses.length} steps, now ${losses[losses.length - 1].toFixed(2)}`} />;
}

function SlowMotion({ params, corpus, worker }: { params: Float32Array; corpus: string; worker: () => Worker }) {
  const example = useMemo(() => {
    const i = Math.max(0, corpus.indexOf(" ", Math.floor(corpus.length / 3)));
    return corpus.slice(i + 1, i + 1 + 48);
  }, [corpus]);
  const [res, setRes] = useState<Extract<TinyOut, { t: "slow" }> | null>(null);
  const [math, setMath] = useState(false);
  const [working, setWorking] = useState(false);
  const run = () => {
    setWorking(true);
    const wk = worker();
    const prev = wk.onmessage;
    wk.onmessage = (e: MessageEvent<TinyOut>) => {
      if (e.data.t === "slow") { setRes(e.data); setWorking(false); wk.onmessage = prev; }
      else { if (e.data.t === "error") { setWorking(false); wk.onmessage = prev; } prev?.call(wk, e); }
    };
    wk.postMessage({ t: "slow", params: params.slice(), example } satisfies TinyIn);
  };
  const ids = encode(example);
  const tensors = useMemo(() => layout({ ...TINY, vocab: VOCAB }).tensors, []);
  const dictT = tensors.find((t) => t.name === "dict")!;
  const downT = tensors.find((t) => t.name === "f3.down")!;
  return (
    <section style={{ marginTop: 18 }}>
      <h3>{S.tiny.slowMotion}</h3>
      <p className="note">{S.tiny.slowIntro} This view uses plain gradient descent, because Adam moves nearly every weight by the same amount on its first step and hides the pattern. The step size is the largest of a few tries that lowers this example's loss and raises the right letters' average probability.</p>
      <div className="row"><button type="button" className="btn" disabled={working} onClick={run}>{working ? "Computing the learning step…" : "Run one step on this example"}</button></div>
      <p className="sample">{example}</p>
      {res && (
        <>
          <h3>{S.tiny.before}: loss <span className="num">{res.loss.toFixed(3)}</span></h3>
          <Letters ids={ids.slice(1)} probs={res.before} />
          <h3>{S.tiny.after}: loss <span className="num">{res.lossAfter.toFixed(3)}</span></h3>
          <Letters ids={ids.slice(1)} probs={res.after} compare={res.before} />
          <button type="button" className="linkish small" aria-expanded={math} onClick={() => setMath(!math)}>{S.tiny.showMath}</button>
          {math && (
            <div style={{ marginTop: 8 }}>
              <p className="note">The loss is minus the logarithm of the probability of each right letter, averaged: <span className="num">{res.loss.toFixed(3)}</span>. Each weight then moves by its gradient times the step size, <span className="num">{res.lr}</span>, against the gradient.</p>
              <h3 style={{ marginTop: 8 }}>The error at the output, last letter</h3>
              <p className="note">Probabilities minus the right answer (1 for "{decode([res.target])}", 0 elsewhere). Training pushes the scores against this error.</p>
              <table className="cands"><tbody>
                {res.probs.map((p, i) => ({ p, i })).sort((a, b) => b.p - a.p).slice(0, 6).map(({ p, i }) => (
                  <tr key={i} className={i === res.target ? "chosen" : ""}>
                    <td>{JSON.stringify(decode([i]))}</td><td className="p num">{pct(p)}</td>
                    <td className="num">{fmt(p - (i === res.target ? 1 : 0), 3)}</td>
                  </tr>
                ))}
              </tbody></table>
              <h3 style={{ marginTop: 8 }}>The update to the dictionary ({VOCAB} letters × 128 numbers)</h3>
              <Strip values={res.grad.slice(dictT.offset, dictT.offset + dictT.size).map((g) => -res.lr * g)} rows={VOCAB} label="update to the dictionary" height={160} />
              <h3 style={{ marginTop: 8 }}>The update to layer 4's MLP (down projection)</h3>
              <Strip values={res.grad.slice(downT.offset, downT.offset + downT.size).map((g) => -res.lr * g)} rows={128} label="update to the down projection" height={160} />
            </div>
          )}
        </>
      )}
    </section>
  );
}

function Letters({ ids, probs, compare }: { ids: Int32Array; probs: number[]; compare?: number[] }) {
  return (
    <div className="letters" role="img" aria-label={`Average probability of the right letter: ${pct(probs.reduce((a, b) => a + b, 0) / probs.length)}`}>
      {Array.from(ids).map((id, i) => {
        const p = probs[i] ?? 0;
        const [r, g, b] = divergingRGB(p * 2 - 1);
        const up = compare ? p - compare[i] : 0;
        return (
          <span key={i} title={`${pct(p)}${compare ? ` (${up >= 0 ? "+" : "−"}${Math.abs(up * 100).toFixed(1)} points)` : ""}`}
            style={{ background: `rgb(${r},${g},${b})`, color: Math.abs(p * 2 - 1) > 0.55 ? "#fff" : undefined }}>
            {decode([id]).replace(" ", " ").replace("\n", "↵")}
          </span>
        );
      })}
    </div>
  );
}
