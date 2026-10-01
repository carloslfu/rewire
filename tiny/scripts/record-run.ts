// A recorded training run for devices without WebGPU (section 4.5): the loss at every step and samples
// every 100 steps, from the same settings the page uses, on the built-in Alice text.
//   npx tsx scripts/record-run.ts
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { init } from "@jax-js/jax";
import { decode, draw, encode, sampleBatch, VOCAB } from "../src/data.ts";
import { adamTrainer, deviceParams, initParams, sampler, TINY, type TinyConfig } from "../src/model.ts";

const STEPS = 1200, BATCH = 16, LR = 3e-3, SEED = 1;
const cfg: TinyConfig = { ...TINY, vocab: VOCAB };
const app = join(import.meta.dirname, "..", "..", "app", "public");

async function main() {
  await init("wasm");
  const text = readFileSync(join(app, "texts", "alice.txt"), "utf8");
  const ids = encode(text);
  const tr = adamTrainer(cfg, initParams(cfg, SEED), { lr: LR, b1: 0.9, b2: 0.99, eps: 1e-8 });
  const S = sampler(cfg);
  const steps: { step: number; loss: number }[] = [];
  const samples: { step: number; text: string }[] = [];
  const t0 = performance.now();
  for (let step = 0; step < STEPS; step++) {
    const { x, y } = sampleBatch(ids, BATCH, cfg.context, SEED * 7919 + step);
    const loss = await tr.step(x, y, BATCH);
    steps.push({ step: step + 1, loss: Math.round(loss * 1e4) / 1e4 });
    if ((step + 1) % 100 === 0 || step === 0) {
      const P = deviceParams(await tr.params());
      const seq = Array.from(encode(text.slice(0, 12)));
      let s = step >>> 0, out = "";
      for (let i = 0; i < 80; i++) {
        const p = await S.next(P, seq);
        s = (Math.imul(s ^ (s >>> 15), 2246822519) + 3266489917) >>> 0;
        const id = draw(p, s / 4294967296);
        seq.push(id);
        out += decode([id]);
      }
      P.dispose();
      samples.push({ step: step + 1, text: out });
      console.log(step + 1, loss.toFixed(3), JSON.stringify(out.slice(0, 60)));
    }
  }
  const ms = (performance.now() - t0) / STEPS;
  writeFileSync(join(app, "recordings", "tiny-run.json"), JSON.stringify({ text: "alice", steps, samples, ms, device: "recorded" }));
  console.log("wrote tiny-run.json", ms.toFixed(1), "ms per step (CPU, recording machine)");
}

void main();
