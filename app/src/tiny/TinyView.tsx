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
import { GrowAnswers, GrowGuide } from "./GrowChecks.tsx";
import { parseChecks, summarizeChecks, updateScorecard, type CheckStage, type Scorecard } from "./checks.ts";
import { afterAdopting, afterDamage, afterRestore, type Checkpoint, continueNote, copyLabel, endRun, failureNote, type Held, isDamaged, type Lineage, NOTHING_HELD, NO_RUN, type Run, runIsCurrent, runNote, runUpTo, UNTRAINED, whileTraining } from "./lineage.ts";

const GrowStage = lazy(() => import("../stage/GrowStage.tsx"));

const START_SEED = 1, STEPS = 1200, BATCH = 16, LR = 3e-3;
const language = secretLanguage();
const cfg = { ...TINY, vocab: VOCAB };
type Preview = { params: Float32Array; baseline?: Float32Array; prompt: string; label: string };
type PendingCheck = { stage: CheckStage; corpus: string; baseline?: Checkpoint; preview?: Preview };

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
  const [cases, setCases] = useState(language.tests.map((t) => t.prompt + t.answer).join("\n"));
  const testCases = useMemo(() => parseChecks(cases), [cases]);
  const example = testCases[0];
  const defaultExample = text === language.text && example?.prompt === language.tests[0].prompt && example.answer === language.tests[0].answer;
  const selectedTests = useRef(testCases);
  selectedTests.current = testCases;
  const [scores, setScores] = useState<Scorecard>({});
  const scorecard = useRef<Scorecard>({});
  const showScores = (next: Scorecard) => { scorecard.current = next; setScores(next); };
  const [checkStage, setCheckStage] = useState<CheckStage>("untrained");
  const [checking, setChecking] = useState(false);
  const pendingCheck = useRef<PendingCheck | null>(null);
  const resultsHeading = useRef<HTMLHeadingElement>(null);
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
  const disabled = running || working || checking;
  const drawn = useStore(s => s.stage3d);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      w.current?.terminate();
      w.current = null;
      pendingCheck.current = null;
    };
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
    if (pendingCheck.current) {
      const stage = pendingCheck.current.stage;
      pendingCheck.current = null;
      setChecking(false);
      setStatus(stage === "untrained" ? `Could not test the starting model. ${message}` : `Tests could not finish. ${message}`);
      return;
    }
    setWorking(false);
    if (!training.current) { setRunning(false); setStatus(message); return; }
    const { start, held } = finish(reached.current);
    setStatus([/[.!?]$/.test(message) ? message : `${message}.`, failureNote(start, held)].filter(Boolean).join(" "));
    if (held.step > start.step) checkTrainingResult(held);
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
      const { start, held } = finish({ params: m.params, steps: m.steps });
      const before = start.lineage, ran = `${m.steps} training ${m.steps === 1 ? "step" : "steps"}`;
      setStatus(isDamaged(before) && before.intact
        ? (m.steps ? `${ran} on the damaged copy in ${m.seconds.toFixed(1)} seconds. The intact weights from step ${before.intact.step.toLocaleString("en-US")} are kept.` : "No additional training steps completed. The damaged copy is unchanged.")
        : m.steps ? `${ran} in ${m.seconds.toFixed(1)} seconds.` : "No additional training steps completed. The current weights are ready to inspect.");
      if (m.steps > 0) checkTrainingResult(held);
    }
    if (m.t === "sampled") {
      setWorking(false); setResult({ ...request.current, text: m.text });
      if (!request.current.model) setBaseline({ prompt: request.current.prompt, text: m.text });
    }
    if (m.t === "probed") {
      setWorking(false); setResult({ ...request.current, text: m.text });
      setBaseline({ prompt: request.current.prompt, text: m.baseline });
    }
    if (m.t === "tested" && pendingCheck.current) {
      const { stage, corpus, baseline: source, preview } = pendingCheck.current;
      pendingCheck.current = null;
      const next = summarizeChecks(m.results, corpus);
      const against = m.baseline && source ? summarizeChecks(m.baseline, source.corpus) : undefined;
      const previous = m.untrained ? { ...scorecard.current, untrained: summarizeChecks(m.untrained, "") } : scorecard.current;
      showScores(updateScorecard(previous, stage, next, against));
      setChecking(false);
      if (preview) generate(preview);
    }
    if (m.t === "error") fail(m.message);
  };
  const worker = () => {
    if (!w.current) {
      w.current = new Worker(new URL("./train.worker.ts", import.meta.url), { type: "module" });
      w.current.onmessage = (e: MessageEvent<TinyOut>) => receive(e.data);
      w.current.onerror = () => { w.current?.terminate(); w.current = null; fail("The training worker stopped."); };
    }
    return w.current;
  };
  useEffect(() => {
    if (active && !unavailable && !params && !training.current && !scorecard.current.untrained) {
      runChecks({ seed: START_SEED }, "untrained", "", null);
    }
    // Prepare the starting model when the visitor opens Grow, without interrupting test edits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);
  const teach = (resume: boolean) => {
    if (disabled || training.current || pendingCheck.current || unavailable || !validText) return;
    // What the run starts from. If it fails before delivering anything, this is what the bench goes back to.
    const start: Held = resume ? { params, step: cumulative.current, corpus: knownCorpus.current, run: run.current, lineage: line.current } : NOTHING_HELD;
    began.current = start; reached.current = null; training.current = true;
    if (!resume) { first.current = null; setReference(null); setParams(null); setStep(0); cumulative.current = 0; setLineage(UNTRAINED); setDamage(null); showScores({ untrained: scorecard.current.untrained }); setCheckStage("untrained"); }
    else setLineage(whileTraining(start.lineage));
    // A run shows its own checkpoints, after the losses of the training that led to the weights it starts from.
    showRun({ samples: [], losses: start.run.losses });
    runBase.current = start.step;
    runCorpus.current = resume ? start.corpus + "\n" + text : text;
    setRunning(true); setStatus("Starting…"); setResult(null); setBaseline(null);
    worker().postMessage({ t: "start", text, params: resume ? params!.slice() : undefined, prompt, steps: STEPS, batch: BATCH, lr: LR, seed: START_SEED + runBase.current } satisfies TinyIn);
  };
  function generate({ params, prompt, label, baseline }: Preview) {
    if (!prompt.trim()) return;
    request.current = { prompt, model: label };
    setWorking(true);
    worker().postMessage(label && baseline ? { t: "probe", params, baseline, prompt } satisfies TinyIn
      : { t: "sample", params, prompt, length: 80, seed: 42 } satisfies TinyIn);
  }

  function runChecks(params: Float32Array | { seed: number }, stage: CheckStage, corpus: string, source: Checkpoint | null, preview?: Preview) {
    if (pendingCheck.current) return;
    setCheckStage(stage);
    if (!selectedTests.current.length) { if (preview) generate(preview); return; }
    const baseline = !scorecard.current.trained && stage !== "trained" && stage !== "untrained" && source && source.params !== params ? source : undefined;
    const untrainedSeed = stage !== "untrained" && !scorecard.current.untrained ? START_SEED : undefined;
    pendingCheck.current = { stage, corpus, baseline, preview };
    setChecking(true);
    worker().postMessage({ t: "test", params, cases: selectedTests.current, baseline: baseline?.params, untrainedSeed } satisfies TinyIn);
  }

  function checkTrainingResult(held: Held) {
    if (!held.params) return;
    const retraining = isDamaged(held.lineage);
    const { untrained, trained, damaged } = scorecard.current;
    showScores(retraining ? { untrained, trained, damaged } : { untrained });
    runChecks(held.params, retraining ? "retrained" : "trained", held.corpus, held.lineage.intact);
  }

  const changeCases = (next: string) => {
    if (JSON.stringify(parseChecks(next)) !== JSON.stringify(selectedTests.current)) showScores({});
    setCases(next);
  };
  // The whole model, or one layer when the 3D view punches it. Either way the result starts from the intact copy.
  const mutate = (kind: "noise" | "erase", floor?: number, guided = false) => {
    const from = lineage.intact;
    if (!from || disabled || pendingCheck.current) return;
    // The guided erase uses the same mask each visit. Free-form experiments use a new mask each time.
    const amount = guided ? 0.25 : strength, seed = guided ? 5 : mutationSeed.current++;
    const next = mutateWeights(from.params, cfg, { kind, amount, seed, floor });
    const percent = Math.round(amount * 100);
    const label = (kind === "erase" ? `Erased about ${percent}% of matrix weights` : `Noise at ${percent}% of each matrix’s RMS`) + (floor === undefined ? "" : ` in layer ${floor + 1}`);
    setParams(next); setLineage(afterDamage(line.current, label)); setDamage({ kind, floor });
    // The copy starts from the intact weights, so it stands at their step and has seen their text. It has
    // no training of its own yet: the history shown is theirs, and is said to be.
    backTo(from);
    showScores({ untrained: scorecard.current.untrained, trained: scorecard.current.trained });
    setStatus(label + "."); setResult(null); setBaseline(null);
    runChecks(next, "damaged", from.corpus, from, { params: next, baseline: from.params, prompt, label });
  };
  /** The step, text and history of a checkpoint, in place of whatever a retrained copy left behind. */
  const backTo = (c: Checkpoint) => { setStep(c.step); cumulative.current = c.step; knownCorpus.current = c.corpus; showRun(c.run); };
  const restore = () => {
    const back = lineage.intact;
    if (!back || disabled || pendingCheck.current) return;
    setParams(back.params); setLineage(afterRestore(line.current)); setDamage(null);
    backTo(back);
    setStatus(`Restored the intact checkpoint at step ${back.step.toLocaleString("en-US")}.`);
    setResult(null); setBaseline(null);
    runChecks(back.params, "restored", back.corpus, back, { params: back.params, prompt, label: "" });
  };
  // The one action that replaces the intact weights: the visitor keeps the retrained copy as the model to go on from.
  const adopt = () => {
    if (!params || disabled || !damaged || pendingCheck.current) return;
    setLineage(afterAdopting({ params, step: cumulative.current, corpus: knownCorpus.current, run: run.current })); setDamage(null);
    // What was generated before compared this copy with the old intact weights. "Intact weights" now
    // means these, so the old pair is dropped and these weights answer the same prompt again.
    setResult(null); setBaseline(null);
    showScores({ untrained: scorecard.current.untrained });
    runChecks(params, "trained", knownCorpus.current, null, { params, prompt, label: "" });
    setStatus(`These weights are now the intact copy, at step ${cumulative.current.toLocaleString("en-US")}.`);
  };
  const keepLabel = damaged ? "Retrain the damaged copy" : "Keep learning";
  const visibleScores = running && damaged ? { ...scores, retrained: undefined } : scores;
  const pendingStage = running ? damaged ? "retrained" : "trained" : checking ? checkStage : undefined;
  const intactStep = lineage.intact?.step ?? 0;
  const last = samples[samples.length - 1];
  // Whether the history on screen ends at the weights on screen. A run under way is always its own.
  const ownRun = running || runIsCurrent(lineage);
  const lastLoss = losses.length ? losses[losses.length - 1] : null;
  const validText = encode(text).length >= 65;
  const stop = () => { w.current?.postMessage({ t: "stop" } satisfies TinyIn); setStatus("Finishing the current step…"); };
  const openLab = async (replay: boolean) => {
    if (!params || disabled) return;
    setWorking(true);
    try {
      const input = example?.prompt ?? (prompt.trim() ? prompt : language.tests[0].prompt);
      await openTiny(params, replay ? decode(encode(input).slice(-cfg.context)) : undefined);
    } catch (error) { setStatus(error instanceof Error ? error.message : String(error)); }
    finally { setWorking(false); }
  };
  const guide = (openWork: () => void) => {
    const action = running ? { text: "Stop learning", run: stop }
      : !params || step === 0 ? { text: "Train from scratch", run: () => teach(false) }
      : damaged ? { text: "Restore intact weights", run: restore }
      : checkStage === "restored" && drawn ? { text: "Replay one letter", run: () => void openLab(true) }
      : checkStage === "restored" ? { text: "Open trained model", run: () => void openLab(false) }
      : { text: "Erase 25% of weights", run: () => mutate("erase", undefined, true) };
    const note = unavailable ? "Training needs WebGPU."
      : running ? (status === "Finishing the current step…" ? status : `${(step - runBase.current).toLocaleString("en-US")} / ${STEPS.toLocaleString("en-US")} training steps`)
      : status ? status
      : validText ? "About 20 seconds on a fast laptop." : "Add at least 65 characters to train.";
    return <GrowGuide example={example} scores={visibleScores} stage={checkStage} running={running} pending={pendingStage}
      steps={{ done: step - runBase.current, total: STEPS }} status={note}
      action={<button type="button" className="btn primary" disabled={!running && (disabled || unavailable || (!validText && (!params || step === 0)))} onClick={action.run}>{action.text}</button>}
      onAnswers={() => {
        openWork();
        requestAnimationFrame(() => {
          resultsHeading.current?.focus({ preventScroll: true });
          resultsHeading.current?.scrollIntoView({ block: "start" });
        });
      }} />;
  };
  const visualizer = <Suspense fallback={<p className="stage-state" role="status">Opening the 3D model…</p>}>
    <GrowStage params={params} reference={reference} intact={intact} step={step} running={running} active={active}
      controls={{ disabled, unavailable, validText, status, loss: ownRun ? lastLoss : null, mutation, damage, strength, setStrength,
        keepLabel, continueNote: continueNote(lineage), retrained: lineage.retrained, intactStep, adopt, guide,
        teach, stop, mutate, restore }} /></Suspense>;
  return <ModelWorkspace stage={visualizer} id="training-scope" label="Live training visualizer" workLabel="Training">
    <main tabIndex={-1} className="workspace training-workspace" id="training">
      <div className="lab-heading"><h1>Grow a model from scratch.</h1>
        <p>{defaultExample ? "The tiny model will practice red and circle in other combinations. Can it learn to translate red circle?" : "Train a tiny transformer on your text and follow the same example as its weights change."}</p></div>
      <section className="test-bench grow-results" aria-labelledby="grow-results-heading">
        <h2 id="grow-results-heading" ref={resultsHeading} tabIndex={-1}>What did it learn?</h2>
        {example ? <GrowAnswers example={example} scores={visibleScores} stage={running ? undefined : checkStage} pending={pendingStage} running={running} />
          : <p className="note">Add a test below to compare checkpoints.</p>}
        {damaged && !running && <div className="grow-retrain"><button type="button" className="btn" disabled={disabled || !validText} onClick={() => teach(true)}>Retrain the damaged copy</button>
          <p className="note">See how much it can recover. You can still restore the intact checkpoint.</p></div>}
        {checkStage === "restored" && !running && <div className="grow-retrain"><button type="button" className="btn" disabled={disabled} onClick={() => mutate("erase", undefined, true)}>Erase 25% again</button>
          <p className="note">Start a fresh comparison from the intact weights.</p></div>}
        <details className="training-details"><summary>Edit or rerun the tests</summary><p className="note">Use up to 12 lines in the format “input = expected answer”. Changing the tests starts a new comparison using the current weights and the saved intact checkpoint.</p>
          <label className="sr-only" htmlFor="test-cases">Test cases</label><textarea id="test-cases" value={cases} disabled={disabled} onChange={(e) => changeCases(e.target.value)} rows={6} spellCheck={false} />
          <button type="button" className="btn quiet" disabled={unavailable || disabled || !example} onClick={() => {
            if (params && step > 0) runChecks(params, checkStage, knownCorpus.current, lineage.intact);
            else runChecks({ seed: START_SEED }, "untrained", "", null);
          }}>Run the tests</button>
        </details>
      </section>
      {samples.length > 0 && <section className="learning-output"><div className="section-heading"><h2>{running ? "Learning in front of you" : "What changed"}</h2><span className="num">Step {step}</span></div>
        {!ownRun && <p className="note">{runNote(lineage)}</p>}
        <p className="note">Same starting text and random seed at every checkpoint.</p>
        <div className="training-samples"><div><h3>At the start of this lesson</h3><pre className="sample">{samples[0].text}</pre></div><div><h3>{running ? "Latest checkpoint" : "Last checkpoint"} · {last?.step}</h3><pre className="sample">{last?.text}</pre></div></div>
        {lastLoss !== null && <><LossChart losses={losses} /><p className="note">Training loss {lastLoss.toFixed(3)}{ownRun ? "" : " at the end of that run, before the damage"}. Lower means better predictions on the training text.</p></>}
      </section>}
      <section className="test-bench"><h2>Try your own starting text</h2>
        <label htmlFor="test-prompt" className="sr-only">Test starting text</label><div className="probe-input"><input id="test-prompt" value={prompt} disabled={disabled} onChange={(e) => setPrompt(e.target.value)} /><button className="btn" disabled={!params || disabled || !prompt.trim()} onClick={() => params && generate({ params, prompt, label: mutation, baseline: intact ?? undefined })}>Generate</button></div>
        {result && <div className="probe-result"><p className="eyebrow">{result.model || "Intact weights"}</p><p className="probe-prompt num">{result.prompt}</p><pre className="sample">{result.text}</pre></div>}
        {baseline && result?.model && baseline.prompt === result.prompt && <div className="intact-comparison"><p className="eyebrow">Intact weights · same input and seed</p><pre className="sample">{baseline.text}</pre></div>}
      </section>
      <section className="teaching-data"><details className="training-details"><summary>Change the training text or keep learning</summary>
        <div className="section-heading"><h2>Training text</h2><button className="btn quiet" disabled={disabled} onClick={() => { setText(language.text); setPrompt(language.tests[0].prompt); changeCases(language.tests.map(t => t.prompt + t.answer).join("\n")); }}>Secret language</button></div>
        <label className="sr-only" htmlFor="own">Training text</label><textarea id="own" rows={7} value={text} disabled={disabled} onChange={(e) => setText(e.target.value)} spellCheck={false} />
        {!validText && <p className="note">Give it at least 65 characters to learn from.</p>}
        {params && <div className="row training-actions"><button className="btn" disabled={disabled || unavailable || !validText} onClick={() => teach(false)}>Start over from noise</button>
          <button className="btn" disabled={disabled || unavailable || !validText} onClick={() => teach(true)}>{keepLabel}</button></div>}
        {damaged && !running && <p className="note">{continueNote(lineage)}</p>}
      </details></section>
      <section className="damage-bench"><h2>Now break what it learned.</h2><p className="note">These controls rewrite the actual matrix weights used to generate text. The intact copy stays available.</p>
        <label className="damage-strength" htmlFor="damage-strength">Strength <output>{Math.round(strength * 100)}%</output><input id="damage-strength" type="range" min="0.05" max="1" step="0.05" value={strength} disabled={disabled} onChange={(e) => setStrength(Number(e.target.value))} /></label>
        <div className="row"><button className="btn change" disabled={!intact || disabled} onClick={() => mutate("noise")}>Scramble weights</button><button className="btn" disabled={!intact || disabled} onClick={() => mutate("erase")}>Erase weights</button><button className="btn quiet" disabled={!mutation || disabled} onClick={restore}>Restore intact model</button></div>
        {mutation && <p className="note">{mutation}. Each experiment starts from the intact copy.</p>}
        {lineage.retrained > 0 && <p className="note"><button className="linkish" disabled={disabled} onClick={adopt}>Make this the intact copy</button> It replaces the intact weights from step {intactStep.toLocaleString("en-US")}.</p>}
      </section>
      {params && <section className="training-handoff"><div className="row training-actions">
        {drawn && <button className="btn" disabled={disabled} onClick={() => void openLab(true)}>Replay one letter in Dismantle</button>}
        <button className="btn quiet" disabled={disabled} onClick={() => void openLab(false)}>Open this model in the full lab</button>
      </div><p className="note">Inspect attention, disable heads, and follow each letter through all four layers.</p></section>}
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
