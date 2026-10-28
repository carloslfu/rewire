// Recheck the three guided examples with the production WebGPU engine.
// Run from the repo root: node engine/node_modules/tsx/dist/cli.mjs engine/scripts/guided-examples.ts
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { create, globals } from "webgpu";
import { getDevice } from "../src/gpu.ts";
import { configOf, loadWeights, type Manifest, sha256 } from "../src/manifest.ts";
import { Model } from "../src/model.ts";
import { ChatTokenizer } from "../src/tokenizer.ts";
import { encodeTable, type ChangeSpec } from "../src/changes.ts";

Object.assign(globalThis, globals);
const base = resolve(process.argv[2] ?? "artifacts/weights/gptqclip-g32-d4clip");
const output = resolve(process.argv[3] ?? "artifacts/qa/guided-examples.json");
const bytes = async (name: string) => { const b = await readFile(resolve(base, name)); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer; };
const raw = await bytes("manifest.json"), man = JSON.parse(new TextDecoder().decode(raw)) as Manifest;
const dev = await getDevice(create([])), gpuErrors: string[] = [];
dev.addEventListener("uncapturederror", (e: GPUUncapturedErrorEvent) => gpuErrors.push(e.error.message));
const loaded = await loadWeights(dev, man, (f) => bytes(f.name));
const cfg = configOf(man, 512), model = new Model(dev, cfg, loaded.weights), conv = model.conversation();
const tok = new ChatTokenizer(JSON.parse(new TextDecoder().decode(await bytes("tokenizer.json"))),
  JSON.parse(new TextDecoder().decode(await bytes("tokenizer_config.json"))), man.tokens, man.chat.system_prompt);
const love: ChangeSpec = { neurons: [{ floor: 9, unit: 2753, delta: .6 * 38.87262116728949 }] };
const evil: ChangeSpec = { neurons: [{ floor: 12, unit: 2473, delta: .4 * -53.898759300498085 }] };
const france: ChangeSpec = { heads: [{ floor: 20, head: 13, mult: -1 }] };
const scenarios = [
  { name: "love-garden", prompts: ["Describe a garden at sunrise."], spec: love },
  { name: "love-moon", prompts: ["Tell me a fun fact about the moon."], spec: love },
  { name: "evil-leader", prompts: ["What makes a good leader?"], spec: evil },
  { name: "evil-friend", prompts: ["A friend lost a game. What could I say to them?"], spec: evil },
  { name: "france-alone", prompts: ["what is the capital of france?"], spec: france },
  { name: "france-screenshot", prompts: ["what is paris?", "what is the capital of france?"], spec: france },
  { name: "france-control", prompts: ["What is the capital of Japan?"], spec: france },
];
const decoding = [{ seed: 11, temperature: .7 }, { seed: 7, temperature: .7 }, { seed: 42, temperature: .7 }, { seed: 11, temperature: 0 }];
const rows: unknown[] = [], restoration: unknown[] = [];
async function generate(prompts: string[], spec: ChangeSpec, seed: number, temperature: number) {
  const turns: { prompt: string; ids: number[]; text: string; ended: boolean }[] = [];
  let history: number[] = [];
  conv.setTable(encodeTable(spec, cfg));
  for (const [turn, prompt] of prompts.entries()) {
    history.push(...(turn ? tok.nextTurn(turns.at(-1)!.ids, prompt) : tok.firstTurn(prompt)));
    conv.length = 0; conv.read(history.slice(0, -1));
    let input = history.at(-1)!;
    const ids: number[] = [];
    for (let step = 0; step < 64; step++) {
      conv.step(input, { seed, turn, step, temperature, slot: 0 });
      input = (await conv.result(0)).token; ids.push(input);
      if (man.tokens.stop.includes(input)) break;
    }
    turns.push({ prompt, ids, text: tok.decode(ids.filter((n) => !man.tokens.stop.includes(n))), ended: man.tokens.stop.includes(ids.at(-1)!) });
  }
  return turns;
}
await mkdir(dirname(output), { recursive: true });
for (const s of scenarios) for (const d of decoding) {
  const normal = await generate(s.prompts, {}, d.seed, d.temperature);
  const changed = await generate(s.prompts, s.spec, d.seed, d.temperature);
  rows.push({ scenario: s.name, ...d, spec: s.spec, normal, changed });
  if (s.name.startsWith("france")) rows.push({ scenario: s.name, ...d, condition: "same-layer comparison head", spec: { heads: [{ floor: 20, head: 2, mult: -1 }] },
    turns: await generate(s.prompts, { heads: [{ floor: 20, head: 2, mult: -1 }] }, d.seed, d.temperature) });
  const restored = await generate(s.prompts, {}, d.seed, d.temperature);
  const exact = JSON.stringify(restored) === JSON.stringify(normal);
  restoration.push({ scenario: s.name, ...d, exact });
  console.log(JSON.stringify({ scenario: s.name, ...d, original: normal.map((t) => t.text), changed: changed.map((t) => t.text), restoredExactly: exact }));
  await writeFile(output, JSON.stringify({ manifestHash: await sha256(raw), command: process.argv, cap: 64, rows, restoration, gpuErrors }, null, 1) + "\n");
  if (!exact) throw new Error("Restoration mismatch");
}
model.destroy(); dev.destroy();
if (gpuErrors.length) throw new Error(gpuErrors.join("\n"));
