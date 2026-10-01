// Teach a tiny model your writing (section 4.5): it trains in front of you, its samples turn from noise
// into your kind of words, and slow motion shows one training step with its real numbers.
import { decode, encode, VOCAB } from "@rewire/tiny/src/data.ts";
import { layout, TINY } from "@rewire/tiny/src/config.ts";
import { useEffect, useMemo, useRef, useState } from "react";
import { openTiny } from "../state/actions.ts";
import { store } from "../state/store.ts";
import { S } from "../strings.ts";
import { divergingRGB, fmt, pct } from "../ui/color.ts";
import { Strip } from "../ui/Strip.tsx";
import type { TinyIn, TinyOut } from "./train.worker.ts";

interface Text { id: string; title: string; author: string; source: string; chars: number }
interface Recorded { steps: { step: number; loss: number }[]; samples: { step: number; text: string }[]; ms: number; text: string }

const STEPS = 1200, BATCH = 16, LR = 3e-3;

export default function TinyView() {
  const [texts, setTexts] = useState<Text[]>([]);
  const [chosen, setChosen] = useState<string>("alice");
  const [own, setOwn] = useState("");
  const [running, setRunning] = useState(false);
  const [losses, setLosses] = useState<number[]>([]);
  const [samples, setSamples] = useState<{ step: number; text: string }[]>([]);
  const [ms, setMs] = useState<number | null>(null);
  const [params, setParams] = useState<Float32Array | null>(null);
  const [status, setStatus] = useState<string>("");
  const [recorded, setRecorded] = useState<boolean>(false);
  const [corpus, setCorpus] = useState("");
  const w = useRef<Worker | null>(null);

  useEffect(() => {
    fetch(`${import.meta.env.BASE_URL}texts/index.json`).then((r) => r.json()).then(setTexts).catch(() => setTexts([]));
    return () => w.current?.terminate();
  }, []);

  const worker = () => {
    if (!w.current) {
      w.current = new Worker(new URL("./train.worker.ts", import.meta.url), { type: "module" });
      w.current.onmessage = (e: MessageEvent<TinyOut>) => receive(e.data);
    }
    return w.current;
  };

  const receive = (m: TinyOut) => {
    switch (m.t) {
      case "unsupported": void playRecorded(); break;
      case "ready": setStatus(""); break;
      case "loss": setLosses((l) => [...l, m.loss]); setMs((x) => (x === null ? m.ms : x * 0.9 + m.ms * 0.1)); break;
      case "sample": setSamples((s) => [...s, { step: m.step, text: m.text }]); break;
      case "done": setRunning(false); setParams(m.params); setStatus(`Trained ${m.steps} steps in ${m.seconds.toFixed(0)} seconds.`); break;
      case "error": setRunning(false); setStatus(m.message); break;
      default: break;
    }
  };

  const playRecorded = async () => {
    setRecorded(true);
    try {
      const r = (await (await fetch(`${import.meta.env.BASE_URL}recordings/tiny-run.json`)).json()) as Recorded;
      setLosses([]); setSamples([]);
      const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
      for (let i = 0; i < r.steps.length; i++) {
        if (!reduce && i % 5 === 0) await new Promise((res) => setTimeout(res, 16));
        setLosses((l) => [...l, r.steps[i].loss]);
        const s = r.samples.find((x) => x.step === r.steps[i].step);
        if (s) setSamples((x) => [...x, s]);
      }
      setMs(r.ms);
    } catch {
      setStatus("This device can't train it live, and the recorded run could not load.");
    }
    setRunning(false);
  };

  const teach = async () => {
    const text = own.trim().length >= 200 ? own : await (await fetch(`${import.meta.env.BASE_URL}texts/${chosen}.txt`)).text();
    setCorpus(text);
    setLosses([]); setSamples([]); setParams(null); setMs(null); setStatus("Starting…"); setRunning(true);
    if (!("gpu" in navigator)) return void playRecorded();
    worker().postMessage({ t: "start", text, steps: STEPS, batch: BATCH, lr: LR, seed: 1 } satisfies TinyIn);
  };

  const stop = () => w.current?.postMessage({ t: "stop" } satisfies TinyIn);
  const last = samples[samples.length - 1];

  return (
    <main className="col tiny" style={{ maxWidth: 980, margin: "0 auto" }}>
      <button type="button" className="btn quiet" onClick={() => store.set({ tiny: false })}>← {S.tiny.back}</button>
      <h2 style={{ fontSize: 22, margin: "8px 0 4px" }}>{S.tiny.title}</h2>
      <p className="note" style={{ maxWidth: 720 }}>{S.tiny.intro}</p>

      <section style={{ marginTop: 14 }}>
        <h3>{S.tiny.builtIn}</h3>
        <div className="row" role="radiogroup" aria-label={S.tiny.builtIn}>
          {texts.map((t) => (
            <button key={t.id} type="button" role="radio" aria-checked={chosen === t.id && !own.trim()} className={`btn${chosen === t.id && !own.trim() ? " primary" : ""}`}
              onClick={() => { setChosen(t.id); setOwn(""); }}>
              {t.title} <span className="faint small">{t.author}</span>
            </button>
          ))}
        </div>
        <label className="small muted" htmlFor="own">{S.tiny.paste}</label>
        <textarea id="own" value={own} onChange={(e) => setOwn(e.target.value)} placeholder="At least a few paragraphs work best." />
        {own.trim() && own.trim().length < 200 && <p className="note">A little more text, please: at least 200 characters.</p>}
        <div className="row">
          {!running ? <button type="button" className="btn primary" onClick={() => void teach()}>{S.tiny.teach}</button>
            : <button type="button" className="btn" onClick={stop}>{S.tiny.stop}</button>}
          <span className="note" role="status">{status}{ms !== null ? ` One step takes about ${ms.toFixed(0)} ms here.` : ""}{recorded ? ` ${S.tiny.recorded}` : ""}</span>
        </div>
      </section>

      {losses.length > 0 && (
        <section style={{ marginTop: 10 }}>
          <h3>{S.tiny.loss}: <span className="num">{losses[losses.length - 1].toFixed(3)}</span> <span className="faint small">{S.tiny.step(losses.length)}</span></h3>
          <LossChart losses={losses} />
          <p className="note">The loss is how surprised it is by the next letter, on average: minus the logarithm of the probability it gave the right one. Guessing evenly among {VOCAB} letters gives {Math.log(VOCAB).toFixed(2)}.</p>
          <h3 style={{ marginTop: 12 }}>{S.tiny.sample} {last && <span className="faint small">({S.tiny.step(last.step)})</span>}</h3>
          <div className="sample" aria-live="off">{last ? last.text : "…"}</div>
          {samples.length > 1 && (
            <details style={{ marginTop: 6 }}>
              <summary className="small">Earlier samples</summary>
              {samples.slice(0, -1).map((s) => <div key={s.step} className="sample" style={{ marginTop: 4 }}><span className="faint">{s.step}: </span>{s.text}</div>)}
            </details>
          )}
        </section>
      )}

      {params && (
        <section style={{ marginTop: 14 }}>
          <button type="button" className="btn primary" onClick={() => void openTiny(params)}>{S.tiny.open}</button>
          <p className="note" style={{ marginTop: 4 }}>It opens in the same screen as Qwen3-0.6B, with every view and change: type the start of a sentence and it continues it, letter by letter.</p>
        </section>
      )}
      {params && <SlowMotion params={params} corpus={corpus} worker={worker} />}

      <section style={{ marginTop: 18 }}>
        <p className="note" style={{ maxWidth: 720 }}>{S.tiny.why}</p>
      </section>
    </main>
  );
}

function LossChart({ losses }: { losses: number[] }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const dpr = devicePixelRatio || 1;
    const W = cv.clientWidth, H = cv.clientHeight;
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
  const run = () => {
    const wk = worker();
    const prev = wk.onmessage;
    wk.onmessage = (e: MessageEvent<TinyOut>) => {
      if (e.data.t === "slow") { setRes(e.data); wk.onmessage = prev; } else prev?.call(wk, e);
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
      <div className="row"><button type="button" className="btn" onClick={run}>Run one step on this example</button></div>
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
              <h3 style={{ marginTop: 8 }}>The update to floor 4's memory block (down projection)</h3>
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
