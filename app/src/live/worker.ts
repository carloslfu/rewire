/// <reference lib="webworker" />
// The engine in a dedicated worker (section 6.2): loads the weights, runs three conversations (normal,
// changed, and the comparison pass), interleaves their steps on one GPU queue, and answers inspections.
import { type ChangeSpec, encodeTable } from "@rewire/engine/src/changes.ts";
import { type ModelConfig, QWEN3_06B, STOP_TOKENS } from "@rewire/engine/src/config.ts";
import { download, getDevice, storage } from "@rewire/engine/src/gpu.ts";
import { configOf, type FileEntry, loadWeights, type Manifest, sha256 } from "@rewire/engine/src/manifest.ts";
import { type Conversation, type InspectHost, Model, RING, type Weights } from "@rewire/engine/src/model.ts";
import { ChatTokenizer } from "@rewire/engine/src/tokenizer.ts";
import { engineConfig, engineWeights } from "@rewire/tiny/src/engine.ts";
import type { TinyConfig } from "@rewire/tiny/src/config.ts";
import { canonical } from "../model/recording.ts";
import type { Cand, Forced, Tok } from "../model/types.ts";
import type { WriteJob } from "./engine.ts";
import type { FromWorker, ToWorker } from "./protocol.ts";

declare const self: DedicatedWorkerGlobalScope;

const CACHE = "rewire-weights-v1";
const LAG = 2; // results are read this many steps behind the GPU
const STOP = new Set(STOP_TOKENS);

let dev: GPUDevice | null = null;
let model: Model | null = null;
/** The tiny model, once trained and handed over: its own model and conversations on the same device. */
let tiny: { model: Model; slots: Slot[]; host: Omit<InspectHost, "table"> } | null = null;
let which: "qwen" | "tiny" = "qwen";
let man: Manifest | null = null;
let base = "";
let phone = false;
let tok: ChatTokenizer | null = null;
let concepts = new Map<string, Float32Array[]>();
let host: Omit<InspectHost, "table"> | null = null;
let version = 0;
let paused = false;
let resume: (() => void) | null = null;

interface Slot {
  c: Conversation;
  /** Tokens whose keys and values are in the cache, in order. */
  tokens: number[];
  key: string;
  table: Uint32Array;
  /** Jobs on one conversation run one after another. */
  lock: Promise<unknown>;
}
let slots: Slot[] = [];

const post = (m: FromWorker, transfer: Transferable[] = []) => self.postMessage(m, transfer);

self.onmessage = async (e: MessageEvent<ToWorker>) => {
  const m = e.data;
  try {
    switch (m.t) {
      case "pause":
        paused = m.paused;
        if (!paused) resume?.();
        return;
      case "version":
        version = m.version;
        return;
      case "check": return done(m.id, await check());
      case "load": return done(m.id, await load(m.base, m.phone));
      case "first": return done(m.id, need(tok).firstTurn(m.message));
      case "next": return done(m.id, need(tok).nextTurn(m.reply, m.message).slice(m.reply.length));
      case "plain": return done(m.id, need(tok).plain(m.text));
      case "pieces": return done(m.id, m.ids.map((i) => need(tok).piece(i)));
      case "tiny": return done(m.id, await loadTiny(m.params, m.config));
      case "bench": return done(m.id, await bench());
      case "use": which = m.model; return done(m.id, true);
      case "write": return done(m.id, await locked(m.job.conv, () => write(m.job, m.id)));
      case "compare": return done(m.id, await locked(m.conv, () => compare(m.conv, m.changes, m.history, m.reply, m.version)));
      case "inspect": {
        const r = await locked(m.conv, () => inspect(m.conv, m.changes, m.tokens, m.target));
        const transfer = [...r.detail.values()].map((a) => a.buffer as ArrayBuffer);
        return post({ t: "done", id: m.id, result: r }, transfer);
      }
      case "dictRow": return done(m.id, await locked(2, async () => {
        setTable(2, m.changes, 0);
        return need(cur()[2]).c.dictRow(m.tokenId);
      }));
    }
  } catch (err) {
    post({ t: "error", id: m.id, message: String((err as Error)?.message ?? err) });
  }
};

function done(id: number, result: unknown) {
  post({ t: "done", id, result });
}

function need<T>(x: T | null | undefined): T {
  if (x === null || x === undefined) throw new Error("the model is not loaded");
  return x;
}

/** The conversations of the model in use. */
function cur(): Slot[] {
  return which === "tiny" ? need(tiny).slots : slots;
}
function curModel(): Model {
  return which === "tiny" ? need(tiny).model : need(model);
}

function locked<T>(ci: number, f: () => Promise<T>): Promise<T> {
  const s = need(cur()[ci]);
  const p = s.lock.then(f, f);
  s.lock = p.catch(() => undefined);
  return p;
}

// ------------------------------------------------------------------ device check (Phase 0B)

/**
 * Times reading 300 tokens and writing 40 with changes and lighting on, on synthetic 4-bit weights with
 * the model's shapes, at 2 and 4 floors, and extrapolates to 28 floors.
 */
async function check(): Promise<{ webgpu: boolean; seconds: number; adapter?: string; reason?: string }> {
  if (!("gpu" in navigator)) return { webgpu: false, seconds: Infinity, reason: "no navigator.gpu" };
  let d: GPUDevice;
  try {
    d = await getDevice(navigator.gpu);
  } catch (e) {
    return { webgpu: false, seconds: Infinity, reason: String(e) };
  }
  const time = async (floors: number) => {
    const cfg: ModelConfig = { ...QWEN3_06B, floors, group: 64, dictBits: 4, maxContext: 512 };
    const w = syntheticWeights(d, cfg);
    const m = new Model(d, cfg, w);
    const c = m.conversation();
    c.setTable(encodeTable({ heads: [{ floor: 0, head: 1, mult: 2 }] }, cfg));
    const read = Array.from({ length: 299 }, (_, i) => 1000 + i);
    // warm up pipelines
    c.read(read.slice(0, 64));
    c.step(5, { seed: 1, turn: 0, step: 0, slot: 0 });
    await c.result(0);
    c.rewind(0);
    const t0 = performance.now();
    c.read(read);
    for (let i = 0; i < 40; i++) {
      c.step(i === 0 ? 7 : undefined, { seed: 1, turn: 0, step: i, slot: i });
      if (i >= LAG) await c.result(i - LAG);
    }
    for (let i = 40 - LAG; i < 40; i++) await c.result(i);
    const ms = performance.now() - t0;
    for (const f of w.floors) for (const b of Object.values(f)) b.destroy();
    w.dict.destroy();
    return ms;
  };
  try {
    const t2 = await time(2), t4 = await time(4);
    const perFloor = Math.max(0, (t4 - t2) / 2);
    const head = Math.max(0, t2 - 2 * perFloor);
    const seconds = (head + QWEN3_06B.floors * perFloor) / 1000;
    const info = (d as unknown as { adapterInfo?: GPUAdapterInfo }).adapterInfo;
    d.destroy();
    return { webgpu: true, seconds, adapter: info ? `${info.vendor} ${info.architecture}` : undefined };
  } catch (e) {
    d.destroy();
    return { webgpu: false, seconds: Infinity, reason: String(e) };
  }
}

function syntheticWeights(d: GPUDevice, cfg: ModelConfig): Weights {
  const q4 = (out: number, inp: number) => storage(d, (out * inp) / 2 + (out * inp / cfg.group) * 4, "synthetic");
  const f32 = (n: number, v = 1) => {
    const b = storage(d, n * 4, "synthetic");
    d.queue.writeBuffer(b, 0, new Float32Array(n).fill(v));
    return b;
  };
  const W = cfg.width, H = cfg.queryHeads, D = cfg.headSize, KV = cfg.kvHeads, U = cfg.units;
  const floors = Array.from({ length: cfg.floors }, () => ({
    q: q4(H * D, W), k: q4(KV * D, W), v: q4(KV * D, W), o: q4(W, H * D), gate: q4(U, W), up: q4(U, W), down: q4(W, U),
    inNorm: f32(W), postNorm: f32(W), qkNorm: f32(2 * D),
  }));
  return { dict: q4(cfg.vocabRows, W), finalNorm: f32(W), meanRow: f32(W, 0), floors };
}

// ------------------------------------------------------------------ loading (section 6.2, "Download and storage")

async function load(b: string, isPhone: boolean) {
  base = b.endsWith("/") ? b : b + "/";
  phone = isPhone;
  const manifest = (await (await fetch(base + "manifest.json", { cache: "no-cache" })).json()) as Manifest;
  man = manifest;
  const cache = await openCache();
  const [tj, tc] = await Promise.all([cachedJson(cache, "tokenizer.json"), cachedJson(cache, "tokenizer_config.json")]);
  tok = new ChatTokenizer(tj, tc, manifest.tokens, manifest.chat.system_prompt);
  await build(cache);
  return { manifestHash: (manifest as unknown as { hash?: string }).hash ?? "", contextCap: need(model).cfg.maxContext, persisted: false };
}

async function build(cache: Cache | null) {
  const m = need(man);
  dev = await getDevice(navigator.gpu);
  dev.lost.then((info) => {
    if (info.reason === "destroyed") return;
    post({ t: "lost" });
    // recreate the device, reload from storage, and re-read conversations on the next job
    void build(cache).catch(() => undefined);
  });
  const cfg = configOf(m, phone ? m.chat.context_cap_phone : m.chat.context_cap_desktop);
  const total = m.total_bytes;
  let before = 0;
  const loaded = await loadWeights(dev, m, async (f) => {
    const data = await getFile(cache, f, (got) => post({ t: "progress", loaded: before + got, total }));
    before += f.bytes;
    return data;
  }, (d) => post({ t: "progress", loaded: d, total }));
  concepts = loaded.concepts;
  model = new Model(dev, cfg, loaded.weights);
  const qkNorm = await Promise.all(loaded.weights.floors.map(async (f) => new Float32Array(await download(dev!, f.qkNorm))));
  host = {
    qkNorm,
    meanRow: new Float32Array(await download(dev, loaded.weights.meanRow)),
    finalNorm: new Float32Array(await download(dev, loaded.weights.finalNorm)),
  };
  slots = [0, 1, 2].map(() => {
    const c = need(model).conversation();
    return { c, tokens: [], key: "{}", table: encodeTable({}, cfg), lock: Promise.resolve() };
  });
}

async function openCache(): Promise<Cache | null> {
  try {
    return await caches.open(CACHE);
  } catch {
    return null; // storage refused (private window): run for this session only
  }
}

async function cachedJson(cache: Cache | null, name: string) {
  const url = base + name;
  const hit = await cache?.match(url);
  if (hit) return hit.json();
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${name}: ${r.status}`);
  const text = await r.text();
  await cache?.put(url, new Response(text, { headers: { "Content-Type": "application/json" } })).catch(() => undefined);
  return JSON.parse(text);
}

/** A weight file: from storage, or fetched with resume and checked against its hash before it is kept. */
async function getFile(cache: Cache | null, f: FileEntry, onBytes: (got: number) => void): Promise<ArrayBuffer> {
  const url = base + f.name;
  const hit = await cache?.match(url);
  if (hit) {
    const data = await hit.arrayBuffer();
    if (data.byteLength === f.bytes) { onBytes(f.bytes); return data; }
  }
  const out = new Uint8Array(f.bytes);
  let got = 0, tries = 0;
  while (got < f.bytes) {
    if (paused) await new Promise<void>((r) => (resume = r));
    try {
      const r = await fetch(url, got ? { headers: { Range: `bytes=${got}-` } } : {});
      if (!r.ok) throw new Error(`${f.name}: ${r.status}`);
      if (got && r.status !== 206) got = 0; // the server ignored the range: start over
      const reader = r.body!.getReader();
      for (;;) {
        if (paused) { await reader.cancel(); break; }
        const { value, done: end } = await reader.read();
        if (end) break;
        out.set(value, got);
        got += value.byteLength;
        onBytes(got);
      }
      tries = 0;
    } catch (e) {
      if (++tries > 5) throw e;
      await new Promise((r) => setTimeout(r, 1000 * tries));
    }
  }
  const h = await sha256(out.buffer);
  if (h !== f.sha256) throw new Error(`${f.name} did not match its hash`);
  await cache?.put(url, new Response(out.buffer, { headers: { "Content-Type": "application/octet-stream" } })).catch(() => undefined);
  return out.buffer;
}

// ------------------------------------------------------------------ the speed bench (Phase 0B, Phases 1 and 2)

/** Medians of five runs on the loaded model: the device rule's workload, latency after a change, inspection. */
async function bench() {
  const mdl = need(model), s = slots[0], c = s.c;
  const read = Array.from({ length: 299 }, (_, i) => 1000 + ((i * 7919) % 20000));
  const median = (xs: number[]) => xs.slice().sort((a, b) => a - b)[Math.floor(xs.length / 2)];
  const runWrite = async (changes: ChangeSpec, n: number) => {
    setTable(0, changes, 0);
    s.tokens = [];
    c.rewind(0);
    const t0 = performance.now();
    c.read(read);
    let first = 0;
    for (let i = 0; i < n; i++) {
      c.step(i === 0 ? 7 : undefined, { seed: 1, turn: 0, step: i, slot: i });
      if (i >= LAG) { await c.result(i - LAG); if (i - LAG === 0) first = performance.now() - t0; }
    }
    for (let i = Math.max(0, n - LAG); i < n; i++) { await c.result(i); if (i === 0) first = performance.now() - t0; }
    const total = performance.now() - t0;
    return { total, first };
  };
  // warm up every pipeline once
  await runWrite({}, 8);
  const normal: number[] = [], changed: number[] = [], firstChanged: number[] = [], writeOnly: number[] = [];
  for (let r = 0; r < 5; r++) {
    const a = await runWrite({}, 40);
    normal.push(a.total);
    const b = await runWrite({ heads: [{ floor: 3, head: 2, mult: 0 }], memory: [{ floor: 7, mult: 2 }] }, 40);
    changed.push(b.total);
    firstChanged.push(b.first);
    // writing speed alone: 40 tokens after the 300 already read
    setTable(0, {}, 0);
    const t0 = performance.now();
    for (let i = 0; i < 40; i++) {
      c.step(i === 0 ? 7 : undefined, { seed: 2, turn: 0, step: i, slot: i });
      if (i >= LAG) await c.result(i - LAG);
    }
    for (let i = 40 - LAG; i < 40; i++) await c.result(i);
    writeOnly.push(performance.now() - t0);
    c.rewind(0);
  }
  // inspection of one word at position 300
  setTable(0, {}, 0);
  c.rewind(0);
  c.read(read);
  const insp: number[] = [];
  for (let r = 0; r < 3; r++) {
    const t0 = performance.now();
    await c.inspect(299, 7, 9, { ...need(host), table: s.table });
    insp.push(performance.now() - t0);
  }
  s.tokens = [];
  c.rewind(0);
  const cfg = mdl.cfg;
  const weights = need(man).total_bytes;
  const kvPerConv = cfg.floors * 2 * cfg.kvHeads * cfg.maxContext * cfg.headSize * 2;
  return {
    read300write40_ms: median(normal), read300write40_changed_ms: median(changed), first_changed_word_ms: median(firstChanged),
    write40_tokens_per_s: 40000 / median(writeOnly), inspect_ms: median(insp),
    gpu_bytes_estimate: weights + 3 * kvPerConv + 17 * 1024 * 1024 * 2, max_context: cfg.maxContext,
  };
}

// ------------------------------------------------------------------ the tiny model

async function loadTiny(params: Float32Array, config: TinyConfig) {
  dev ??= await getDevice(navigator.gpu);
  if (tiny) for (const f of tiny.model.w.floors) for (const b of Object.values(f)) (b as GPUBuffer).destroy();
  const cfg = engineConfig(config, 512);
  const w = engineWeights(dev, config, params);
  const m = new Model(dev, cfg, w);
  const qkNorm = await Promise.all(w.floors.map(async (f) => new Float32Array(await download(dev!, f.qkNorm))));
  tiny = {
    model: m,
    slots: [0, 1, 2].map(() => ({ c: m.conversation(), tokens: [], key: "{}", table: encodeTable({}, cfg), lock: Promise.resolve() })),
    host: { qkNorm, meanRow: new Float32Array(await download(dev, w.meanRow)), finalNorm: new Float32Array(await download(dev, w.finalNorm)) },
  };
  return { floors: cfg.floors, heads: cfg.queryHeads };
}

// ------------------------------------------------------------------ conversations

/** Points conversation ci at `changes`; a different table empties its cache. */
function setTable(ci: number, changes: ChangeSpec, conceptFirst: number) {
  const s = cur()[ci];
  const key = canonical(changes) + `@${conceptFirst}`;
  if (s.key === key) return;
  const cfg = curModel().cfg;
  s.table = which === "tiny" ? encodeTable({ ...changes, concept: null }, cfg)
    : encodeTable(changes, cfg, { vector: (id, L) => need(concepts.get(id))[L], rho: need(man).rho }, conceptFirst);
  s.c.setTable(s.table);
  s.key = key;
  s.tokens = [];
  s.c.rewind(0);
}

/** Makes conversation ci's cache hold exactly `tokens`, reading only what differs. */
function ensure(ci: number, changes: ChangeSpec, tokens: number[], conceptFirst: number) {
  setTable(ci, changes, conceptFirst);
  const s = cur()[ci];
  let k = 0;
  while (k < s.tokens.length && k < tokens.length && s.tokens[k] === tokens[k]) k++;
  s.c.rewind(k);
  s.tokens.length = k;
  const rest = tokens.slice(k);
  if (rest.length) s.c.read(rest);
  s.tokens.push(...rest);
}

function conceptFrom(tokens: number[]) {
  return which === "tiny" ? 0 : need(tok).systemEnd(tokens);
}

function contextCheck(n: number) {
  if (n > curModel().cfg.maxContext) throw new Error("context-full");
}

async function write(job: WriteJob, id: number): Promise<{ ended: boolean; cancelled: boolean }> {
  const all = [...job.history, ...job.prefix];
  const room = curModel().cfg.maxContext - all.length;
  const cap = Math.min(job.cap, room);
  contextCheck(all.length);
  const s = cur()[job.conv];
  ensure(job.conv, job.changes, all.slice(0, -1), conceptFrom(all));
  const c = s.c;
  const start = job.prefix.length;
  const toks: number[] = [];
  let submitted = 0, received = 0, ended = false, cancelled = false;
  const stale = () => job.version >= 0 && version > job.version;
  const take = async () => {
    const r = await c.result(received);
    received++;
    const t: Tok = {
      id: r.token, lp1: r.lp1, concept: r.concept, cut: r.cut, pushes: r.pushes,
      cands: Array.from(r.ids, (cid, i) => ({ id: cid, p: r.probs[i] })) as Cand[],
    };
    if (received === 1 && job.force !== undefined) t.picked = true;
    toks.push(t.id);
    post({ t: "tok", id, tok: t }, [t.pushes.buffer as ArrayBuffer]);
    if (which === "qwen" && STOP.has(t.id)) ended = true;
  };
  for (let i = 0; i < cap && !ended; i++) {
    if (stale()) { cancelled = true; break; }
    c.step(i === 0 ? all[all.length - 1] : undefined, {
      seed: job.seed, turn: job.turn, step: start + i, temperature: job.temperature,
      force: i === 0 ? job.force : undefined, slot: submitted,
    });
    submitted++;
    if (submitted - received > LAG) await take();
    if (submitted - received >= RING) await take();
  }
  while (received < submitted && !ended) await take();
  // drain results of steps submitted after the stop, then keep the cache consistent
  while (received < submitted) { await c.result(received); received++; }
  const read = [all[all.length - 1], ...toks.slice(0, Math.max(0, toks.length - 1))];
  s.tokens.push(...read);
  const keep = all.length - 1 + read.length;
  c.rewind(keep);
  s.tokens.length = keep;
  return { ended, cancelled };
}

async function compare(ci: number, changes: ChangeSpec, history: number[], reply: number[], v: number): Promise<Forced[] | null> {
  if (!reply.length) return [];
  contextCheck(history.length + reply.length);
  ensure(ci, changes, history.slice(0, -1), conceptFrom(history));
  const s = cur()[ci], c = s.c;
  const out: Forced[] = [];
  const inputs = [history[history.length - 1], ...reply.slice(0, -1)];
  let submitted = 0, received = 0;
  const take = async () => {
    const r = await c.result(received++);
    out.push({ id: r.token, lp1: r.lp1, concept: r.concept, pushes: r.pushes });
  };
  for (let i = 0; i < reply.length; i++) {
    if (v >= 0 && version > v) break;
    c.compareStep(inputs[i], reply[i], submitted++);
    if (submitted - received > LAG) await take();
  }
  while (received < submitted) await take();
  s.tokens.push(...inputs.slice(0, submitted));
  return v >= 0 && version > v ? null : out;
}

async function inspect(ci: number, changes: ChangeSpec, tokens: number[], target: number) {
  contextCheck(tokens.length);
  ensure(ci, changes, tokens.slice(0, -1), conceptFrom(tokens));
  const s = cur()[ci];
  const h = which === "tiny" ? need(tiny).host : need(host);
  return s.c.inspect(tokens.length - 1, tokens[tokens.length - 1], target, { ...h, table: s.table });
}

