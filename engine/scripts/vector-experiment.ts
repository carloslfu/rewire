// Local, deterministic probes of the same WebGPU engine used in the browser.
// From engine/: pnpm exec tsx scripts/vector-experiment.ts [weights-dir] [output.json]
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { create, globals } from "webgpu";
import { getDevice, download } from "../src/gpu.ts";
import { configOf, loadWeights, type Manifest, sha256 } from "../src/manifest.ts";
import { Model } from "../src/model.ts";
import { ChatTokenizer } from "../src/tokenizer.ts";
import { encodeTable, type ChangeSpec } from "../src/changes.ts";

Object.assign(globalThis, globals);
const base = resolve(process.argv[2] ?? "../artifacts/weights/gptqclip-g32-d4clip");
const output = resolve(process.argv[3] ?? "../artifacts/qa/vector-experiment.json");
const bytes = async (name: string) => { const b = await readFile(resolve(base, name)); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer; };
const manifestBytes = await bytes("manifest.json");
const man = JSON.parse(new TextDecoder().decode(manifestBytes)) as Manifest;
const dev = await getDevice(create([]));
const gpuErrors: string[] = [];
dev.addEventListener("uncapturederror", (e: GPUUncapturedErrorEvent) => gpuErrors.push(e.error.message));
const loaded = await loadWeights(dev, man, (f) => bytes(f.name));
const cfg = configOf(man, 512), model = new Model(dev, cfg, loaded.weights);
const tok = new ChatTokenizer(JSON.parse(new TextDecoder().decode(await bytes("tokenizer.json"))),
  JSON.parse(new TextDecoder().decode(await bytes("tokenizer_config.json"))), man.tokens, man.chat.system_prompt);
const conv = model.conversation();
const prompts = ["The secret word is marmalade. Repeat only the secret word.", "What is 7 + 5?", "Write one sentence about a robot who discovers rain.", "Name the capital of France."];
const allHeads = process.argv.includes("--layer");
const targets = [[3, 10], [12, 0], [16, 14], [23, 13]];
const variants = (floor: number, head: number): [string, ChangeSpec][] => ([
  ["rotate45", { geometry: [{ floor, head, kind: "rotate", angle: 45, seed: 1 }] }],
  ["rotate90", { geometry: [{ floor, head, kind: "rotate", angle: 90, seed: 1 }] }],
  ["rotate180", { geometry: [{ floor, head, kind: "rotate", angle: 180, seed: 1 }] }],
  ["remove", { geometry: [{ floor, head, kind: "remove", amount: 1 }] }],
  ["shuffle", { geometry: [{ floor, head, kind: "shuffle", seed: 1 }] }],
] as [string, ChangeSpec][]).map(([name, spec]) => [name, allHeads
  ? { geometry: Array.from({ length: cfg.queryHeads }, (_, h) => ({ ...spec.geometry![0], head: h })) } : spec]);
async function first(prompt: string, spec: ChangeSpec) {
  conv.setTable(encodeTable(spec, cfg)); conv.length = 0;
  const input = tok.firstTurn(prompt);
  conv.read(input.slice(0, -1));
  conv.step(input.at(-1), { seed: 7, turn: 0, step: 0, slot: 0 });
  const result = await conv.result(0);
  const scores = new Float32Array(await download(dev, conv.scores)).slice(0, cfg.vocabReal);
  return { result, scores };
}
function distribution(scores: Float32Array) {
  let mx = -Infinity; for (const s of scores) mx = Math.max(mx, s);
  const p = Float64Array.from(scores, (s) => Math.exp(s - mx));
  let sum = 0; for (const x of p) sum += x;
  return p.map((x) => x / sum);
}
async function generate(prompt: string, spec: ChangeSpec) {
  const t = performance.now();
  const { result } = await first(prompt, spec);
  const ids = [result.token];
  for (let i = 1; i < 40 && !man.tokens.stop.includes(ids.at(-1)!); i++) {
    conv.step(ids.at(-1), { seed: 7, turn: 0, step: i, slot: 0 });
    ids.push((await conv.result(0)).token);
  }
  return { text: tok.decode(ids), ids, ms: performance.now() - t };
}
const probes: any[] = [], generations: any[] = [];
for (const prompt of prompts) {
  const baseRun = await first(prompt, {}), bp = distribution(baseRun.scores);
  let best = { kl: -1, floor: 0, head: 0 };
  for (const [floor, head] of targets) {
    for (const [name, spec] of variants(floor, head)) {
      const run = await first(prompt, spec), p = distribution(run.scores);
      let kl = 0, delta = 0;
      for (let i = 0; i < bp.length; i++) { if (bp[i]) kl += bp[i] * Math.log(bp[i] / Math.max(p[i], 1e-300)); delta = Math.max(delta, Math.abs(run.scores[i] - baseRun.scores[i])); }
      const row = { prompt, floor, head, name, kl, maxLogitDelta: delta, firstToken: tok.piece(run.result.token), baselineFirst: tok.piece(baseRun.result.token) };
      probes.push(row);
      if (name === "rotate90" && kl > best.kl) best = { kl, floor, head };
    }
  }
  generations.push({ prompt, name: "normal", changes: {}, ...await generate(prompt, {}) });
  for (const [name, spec] of variants(best.floor, best.head)) {
    const row = { prompt, name, changes: spec, ...await generate(prompt, spec) };
    generations.push(row); console.log(JSON.stringify({ prompt, name, floor: best.floor, head: best.head, text: row.text }));
  }
  const restored = await generate(prompt, {});
  const original = generations.find((g) => g.prompt === prompt && g.name === "normal");
  if (JSON.stringify(restored.ids) !== JSON.stringify(original.ids)) throw new Error("Restoring changes did not restore baseline tokens");
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, JSON.stringify({ manifestHash: await sha256(manifestBytes), cfg, seed: 7, cap: 40, allHeads, prompts, targets, probes, generations, gpuErrors, restoredExactly: true }, null, 2));
}
console.log(`Saved ${probes.length} first-token probes and ${generations.length} generations to ${output}`);
model.destroy(); dev.destroy();
if (gpuErrors.length) throw new Error(gpuErrors.join("\n"));
