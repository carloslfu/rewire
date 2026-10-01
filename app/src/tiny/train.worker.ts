/// <reference lib="webworker" />
// Trains the tiny model with jax-js on WebGPU, off the page's thread (section 4.5).
import { defaultDevice, init } from "@jax-js/jax";
import { decode, draw, encode, sampleBatch, VOCAB } from "@rewire/tiny/src/data.ts";
import { adamTrainer, deviceParams, initParams, sampler, slowStep, TINY, type TinyConfig, type Trainer } from "@rewire/tiny/src/model.ts";

declare const self: DedicatedWorkerGlobalScope;

export type TinyIn =
  | { t: "start"; text: string; steps: number; batch: number; lr: number; seed: number }
  | { t: "stop" }
  | { t: "sample"; params: Float32Array; prompt: string; length: number; seed: number }
  | { t: "slow"; params: Float32Array; example: string };

export type TinyOut =
  | { t: "ready"; device: string }
  | { t: "unsupported"; reason: string }
  | { t: "loss"; step: number; loss: number; ms: number }
  | { t: "sample"; step: number; text: string }
  | { t: "done"; params: Float32Array; steps: number; seconds: number }
  | { t: "sampled"; text: string }
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

async function sample(params: Float32Array, prompt: string, length: number, seed: number): Promise<string> {
  S ??= sampler(cfg);
  const P = deviceParams(params);
  const ids = Array.from(encode(prompt || "T"));
  let s = seed >>> 0;
  let out = "";
  for (let i = 0; i < length; i++) {
    const p = await S.next(P, ids);
    s = (Math.imul(s ^ (s >>> 15), 2246822519) + 3266489917) >>> 0;
    const id = draw(p, s / 4294967296);
    ids.push(id);
    out += decode([id]);
  }
  P.dispose();
  return out;
}

self.onmessage = async (e: MessageEvent<TinyIn>) => {
  const m = e.data;
  try {
    if (m.t === "stop") { stopped = true; return; }
    if (m.t === "start") stopped = false;
    const dev = await start();
    if (!dev) { post({ t: "unsupported", reason: "WebGPU is not available" }); return; }
    if (m.t === "start") {
      post({ t: "ready", device: dev });
      const ids = encode(m.text);
      let tr: Trainer | null = adamTrainer(cfg, initParams(cfg, m.seed), { lr: m.lr, b1: 0.9, b2: 0.99, eps: 1e-8 });
      const t0 = performance.now();
      let step = 0;
      for (; step < m.steps && !stopped; step++) {
        const { x, y } = sampleBatch(ids, m.batch, cfg.context, m.seed * 7919 + step);
        const a = performance.now();
        const loss = await tr.step(x, y, m.batch);
        post({ t: "loss", step: step + 1, loss, ms: performance.now() - a });
        if ((step + 1) % 100 === 0 || step === 0) {
          const p = await tr.params();
          post({ t: "sample", step: step + 1, text: await sample(p, m.text.slice(0, 12), 80, step) });
        }
      }
      const params = await tr.params();
      tr.dispose();
      tr = null;
      post({ t: "done", params, steps: step, seconds: (performance.now() - t0) / 1000 }, [params.buffer]);
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
  }
};
