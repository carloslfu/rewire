/// <reference lib="webworker" />
// Trains the tiny model with jax-js on WebGPU, off the page's thread (section 4.5).
import { defaultDevice, init } from "@jax-js/jax";
import { decode, draw, encode, sampleBatch, VOCAB } from "@rewire/tiny/src/data.ts";
import { adamTrainer, deviceParams, initParams, sampler, slowStep, TINY, type TinyConfig, type Trainer } from "@rewire/tiny/src/model.ts";

declare const self: DedicatedWorkerGlobalScope;

export type TinyIn =
  | { t: "start"; text: string; steps: number; batch: number; lr: number; seed: number; params?: Float32Array; prompt?: string }
  | { t: "test"; params: Float32Array; cases: { prompt: string; answer: string }[] }
  | { t: "stop" }
  | { t: "sample"; params: Float32Array; prompt: string; length: number; seed: number }
  | { t: "probe"; params: Float32Array; baseline: Float32Array; prompt: string }
  | { t: "slow"; params: Float32Array; example: string };

export type TinyOut =
  | { t: "ready"; device: string }
  | { t: "unsupported"; reason: string }
  | { t: "loss"; step: number; loss: number; ms: number }
  | { t: "sample"; step: number; text: string }
  | { t: "snapshot"; step: number; params: Float32Array }
  | { t: "done"; params: Float32Array; steps: number; seconds: number }
  | { t: "sampled"; text: string }
  | { t: "probed"; text: string; baseline: string }
  | { t: "tested"; results: { prompt: string; answer: string; output: string }[] }
  | { t: "slow"; before: number[]; after: number[]; loss: number; lossAfter: number; lr: number; params: Float32Array; grad: Float32Array;
      probs: number[]; target: number; position: number }
  | { t: "error"; message: string };

const cfg: TinyConfig = { ...TINY, vocab: VOCAB };
let stopped = false;
let ready: Promise<string | null> | null = null;

const post = (m: TinyOut, transfer: Transferable[] = []) => self.postMessage(m, transfer);

function start(): Promise<string | null> {
  ready ??= (async () => {
    const devs = await init();
    if (!devs.includes("webgpu")) return null;
    defaultDevice("webgpu");
    return "webgpu";
  })();
  return ready;
}

let S: ReturnType<typeof sampler> | null = null;

async function sample(params: Float32Array, prompt: string, length: number, seed: number, greedy = false): Promise<string> {
  S ??= sampler(cfg);
  const P = deviceParams(params);
  const ids = Array.from(encode(prompt || "T"));
  let s = seed >>> 0;
  let out = "";
  try { for (let i = 0; i < length; i++) {
    const p = await S.next(P, ids);
    s = (Math.imul(s ^ (s >>> 15), 2246822519) + 3266489917) >>> 0;
    const id = greedy ? p.reduce((best, value, index) => value > p[best] ? index : best, 0) : draw(p, s / 4294967296);
    ids.push(id);
    out += decode([id]);
  } } finally { P.dispose(); }
  return out;
}

let queue = Promise.resolve();
self.onmessage = (e: MessageEvent<TinyIn>) => {
  if (e.data.t === "stop") { stopped = true; return; }
  if (e.data.t === "start") stopped = false;
  queue = queue.then(() => handle(e.data));
};

async function handle(m: TinyIn) {
  let trainer: Trainer | null = null;
  try {
    if (m.t === "stop") { stopped = true; return; }

    const dev = await start();
    if (!dev) { post({ t: "unsupported", reason: "WebGPU is not available" }); return; }
    if (m.t === "start") {
      post({ t: "ready", device: dev });
      const ids = encode(m.text);
      if (ids.length < 2) throw new Error("Training needs at least two letters.");
      const initial = m.params ?? initParams(cfg, m.seed);
      const prompt = m.prompt || m.text.slice(0, 12);
      trainer = adamTrainer(cfg, initial, { lr: m.lr, b1: 0.9, b2: 0.99, eps: 1e-8 });
      post({ t: "snapshot", step: 0, params: initial.slice() });
      post({ t: "sample", step: 0, text: await sample(initial, prompt, 80, 42) });
      const t0 = performance.now();
      let step = 0;
      for (; step < m.steps && !stopped; step++) {
        const { x, y } = sampleBatch(ids, m.batch, cfg.context, m.seed * 7919 + step);
        const a = performance.now();
        const loss = await trainer.step(x, y, m.batch);
        post({ t: "loss", step: step + 1, loss, ms: performance.now() - a });
        if ((step + 1) % 100 === 0) {
          const p = await trainer.params();
          post({ t: "snapshot", step: step + 1, params: p.slice() });
          post({ t: "sample", step: step + 1, text: await sample(p, prompt, 80, 42) });
        }
      }
      const params = await trainer.params();
      trainer.dispose();
      trainer = null;
      if (step > 0 && step % 100 !== 0) post({ t: "sample", step, text: await sample(params, prompt, 80, 42) });
      post({ t: "done", params, steps: step, seconds: (performance.now() - t0) / 1000 }, [params.buffer]);
    } else if (m.t === "test") {
      const results = [];
      for (const test of m.cases.slice(0, 12)) {
        // Only the prompt enters inference. The target determines the generation cap and later UI scoring.
        results.push({ ...test, output: await sample(m.params, test.prompt, Math.min(64, encode(test.answer).length), 42, true) });
      }
      post({ t: "tested", results });
    } else if (m.t === "probe") {
      const baseline = await sample(m.baseline, m.prompt, 80, 42);
      const text = await sample(m.params, m.prompt, 80, 42);
      post({ t: "probed", text, baseline });
    } else if (m.t === "sample") {
      post({ t: "sampled", text: await sample(m.params, m.prompt, m.length, m.seed) });
    } else if (m.t === "slow") {
      // one step of plain gradient descent on one example, and the probability of each right next letter before and after
      const ids = encode(m.example).slice(0, cfg.context + 1);
      const x = ids.slice(0, -1), y = ids.slice(1);
      const res = await slowStep({ ...cfg, context: x.length }, m.params, x, y);
      const V = cfg.vocab;
      S ??= sampler(cfg);
      const P0 = deviceParams(m.params), P1 = deviceParams(res.params);
      const pb = await S.all(P0, x), pa = await S.all(P1, x);
      P0.dispose(); P1.dispose();
      const before = Array.from(y, (t, i) => pb[i * V + t]), after = Array.from(y, (t, i) => pa[i * V + t]);
      const position = x.length - 1;
      const last = pb.slice(position * V, position * V + V);
      post({ t: "slow", before, after, loss: res.loss, lossAfter: res.lossAfter, lr: res.lr, params: res.params, grad: res.grad,
        probs: Array.from(last), target: y[position], position }, [res.params.buffer, res.grad.buffer]);
    }
  } catch (err) {
    post({ t: "error", message: String((err as Error)?.message ?? err) });
  } finally { trainer?.dispose(); }
}
