// Compare frozen question protocols with the production engine, without editing prompts or weights.
// Run: node engine/node_modules/tsx/dist/cli.mjs engine/scripts/evil-prompts.ts <protocol.json> <output.json>
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { create, globals } from "webgpu";
import { getDevice } from "../src/gpu.ts";
import { configOf, loadWeights, type Manifest, sha256 } from "../src/manifest.ts";
import { Model } from "../src/model.ts";
import { ChatTokenizer } from "../src/tokenizer.ts";
import { encodeTable, type ChangeSpec } from "../src/changes.ts";

type Protocol = {
  purpose: string; prompts: string[]; cap: number;
  decoding: { seed: number; temperature: number }[];
  conditions: { name: string; spec: ChangeSpec }[];
};
if (!process.argv[2] || !process.argv[3]) throw new Error("Provide protocol and output paths");
const protocolBytes = await readFile(process.argv[2]);
const protocol = JSON.parse(protocolBytes.toString()) as Protocol;
const output = resolve(process.argv[3]);
const base = resolve("artifacts/weights/gptqclip-g32-d4clip");
const bytes = async (name: string) => {
  const b = await readFile(resolve(base, name));
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
};
Object.assign(globalThis, globals);
const raw = await bytes("manifest.json"), man = JSON.parse(new TextDecoder().decode(raw)) as Manifest;
const dev = await getDevice(create([])), gpuErrors: string[] = [];
dev.addEventListener("uncapturederror", (e: GPUUncapturedErrorEvent) => gpuErrors.push(e.error.message));
const loaded = await loadWeights(dev, man, (f) => bytes(f.name));
const cfg = configOf(man, 512), model = new Model(dev, cfg, loaded.weights), conv = model.conversation();
const tok = new ChatTokenizer(JSON.parse(new TextDecoder().decode(await bytes("tokenizer.json"))),
  JSON.parse(new TextDecoder().decode(await bytes("tokenizer_config.json"))), man.tokens, man.chat.system_prompt);
const rows: unknown[] = [];
const metadata = {
  command: ["node", "engine/node_modules/tsx/dist/cli.mjs", "engine/scripts/evil-prompts.ts", ...process.argv.slice(2)],
  manifestHash: await sha256(raw), protocol, protocolHash: await sha256(protocolBytes),
};
async function generate(prompt: string, spec: ChangeSpec, seed: number, temperature: number) {
  conv.setTable(encodeTable(spec, cfg));
  const inputIds = tok.firstTurn(prompt);
  conv.length = 0; conv.read(inputIds.slice(0, -1));
  let input = inputIds.at(-1)!;
  const ids: number[] = [];
  for (let step = 0; step < protocol.cap; step++) {
    conv.step(input, { seed, turn: 0, step, temperature, slot: 0 });
    input = (await conv.result(0)).token; ids.push(input);
    if (man.tokens.stop.includes(input)) break;
  }
  return { ids, text: tok.decode(ids.filter((n) => !man.tokens.stop.includes(n))), ended: man.tokens.stop.includes(ids.at(-1)!) };
}
await mkdir(dirname(output), { recursive: true });
try {
  for (const prompt of protocol.prompts) for (const d of protocol.decoding) {
    const normal = await generate(prompt, {}, d.seed, d.temperature);
    const conditions = [];
    for (const c of protocol.conditions) conditions.push({ ...c, reply: await generate(prompt, c.spec, d.seed, d.temperature) });
    const restored = await generate(prompt, {}, d.seed, d.temperature);
    const restoredExactly = JSON.stringify(restored) === JSON.stringify(normal);
    rows.push({ prompt, ...d, normal, conditions, restoredExactly });
    console.log(JSON.stringify({ prompt, ...d, original: normal.text,
      conditions: conditions.map((c) => ({ name: c.name, text: c.reply.text })), restoredExactly }));
    await writeFile(output, JSON.stringify({ ...metadata, rows, gpuErrors }, null, 1) + "\n");
    if (!restoredExactly) throw new Error("Restoration mismatch");
  }
  if (gpuErrors.length) throw new Error(gpuErrors.join("\n"));
} finally { model.destroy(); dev.destroy(); }
