// The engine model: weights on the GPU, pipelines, and conversations that read and write tokens.
import { type ModelConfig, type TableLayout, tableLayout, TENSOR_ID } from "./config.ts";
import { BU, bind, type Dispatch, encode, Pipelines, storage, upload } from "./gpu.ts";
import * as K from "./kernels.ts";

export interface FloorWeights {
  q: GPUBuffer; k: GPUBuffer; v: GPUBuffer; o: GPUBuffer; gate: GPUBuffer; up: GPUBuffer; down: GPUBuffer;
  inNorm: GPUBuffer; postNorm: GPUBuffer;
  /** The query normalization weights followed by the key normalization weights. */
  qkNorm: GPUBuffer;
}

export interface Weights {
  dict: GPUBuffer;
  finalNorm: GPUBuffer;
  meanRow: GPUBuffer;
  floors: FloorWeights[];
}

export const CHUNK = 64; // tokens read per pass (a slice of the re-run loop)
export const NO_ROW = 0xffffffff;
export const NO_LIMIT = 0xffffffff;

export function ropeTable(cfg: ModelConfig): Float32Array {
  // computed in 64-bit floats (JavaScript numbers), rounded once to float32
  const D = cfg.headSize, half = D / 2;
  const out = new Float32Array(cfg.maxContext * D);
  for (let p = 0; p < cfg.maxContext; p++) {
    for (let i = 0; i < half; i++) {
      const inv = 1 / cfg.ropeTheta ** ((2 * i) / D);
      const a = p * inv;
      out[p * D + i] = Math.cos(a);
      out[p * D + half + i] = Math.sin(a);
    }
  }
  return out;
}

export class Model {
  readonly lay: TableLayout;
  readonly pipes: Pipelines;
  readonly floorUniforms: GPUBuffer[] = [];
  readonly dictUniform: GPUBuffer;
  readonly rope: GPUBuffer;
  /** The mean dictionary row followed by the final normalization weights (for the pushes). */
  readonly aux: GPUBuffer;
  readonly kc: K.KernelConsts;

  constructor(readonly dev: GPUDevice, readonly cfg: ModelConfig, readonly w: Weights) {
    this.lay = tableLayout(cfg);
    this.pipes = new Pipelines(dev);
    this.kc = { cfg, lay: this.lay };
    for (let L = 0; L < cfg.floors; L++) {
      this.floorUniforms.push(this.uniform([L, 0, 0, 0]));
    }
    this.dictUniform = this.uniform([0xffffffff, 0xffffffff, 0xffffffff, 0]);
    this.rope = upload(dev, ropeTable(cfg), "rope");
    this.aux = storage(dev, 2 * cfg.width * 4, "aux");
    const enc = dev.createCommandEncoder();
    enc.copyBufferToBuffer(w.meanRow, 0, this.aux, 0, cfg.width * 4);
    enc.copyBufferToBuffer(w.finalNorm, 0, this.aux, cfg.width * 4, cfg.width * 4);
    dev.queue.submit([enc.finish()]);
  }

  uniform(words: number[]): GPUBuffer {
    const b = this.dev.createBuffer({ size: 16, usage: BU.UNIFORM | BU.COPY_DST });
    this.dev.queue.writeBuffer(b, 0, new Uint32Array(words));
    return b;
  }

  /** A uniform for a matrix multiply inside floor L on tensor(s). */
  mmUniform(L: number, t: keyof typeof TENSOR_ID, t2?: keyof typeof TENSOR_ID): GPUBuffer {
    return this.uniform([L, TENSOR_ID[t], t2 ? TENSOR_ID[t2] : 0, 0]);
  }

  pipe(name: string, code: () => string, entry = "main"): GPUComputePipeline {
    return this.pipes.get(name + ":" + entry, code(), entry);
  }

  conversation(): Conversation {
    return new Conversation(this);
  }
}

/** Per-step parameters written before each submit (see kernels.ts). */
export interface StepParams {
  T: number; pos0: number; seed?: number; turn?: number; step?: number; temperature?: number; topK?: number;
  topP?: number; row?: number; keyLimit?: number;
}

export class Conversation {
  readonly dev: GPUDevice;
  readonly cfg: ModelConfig;
  readonly ct: GPUBuffer;
  readonly SP: GPUBuffer;
  readonly kcache: GPUBuffer[] = [];
  readonly vcache: GPUBuffer[] = [];
  /** Tokens whose keys and values are in the cache. */
  length = 0;
  // activations, sized for CHUNK tokens
  readonly x: GPUBuffer; readonly h: GPUBuffer; readonly q: GPUBuffer; readonly k: GPUBuffer; readonly kout: GPUBuffer;
  readonly v: GPUBuffer; readonly att: GPUBuffer; readonly o: GPUBuffer; readonly mid: GPUBuffer; readonly h2: GPUBuffer;
  readonly act: GPUBuffer; readonly m: GPUBuffer; readonly xn: GPUBuffer; readonly rinv: GPUBuffer;
  readonly intok: GPUBuffer; readonly tok: GPUBuffer;
  // per-step outputs
  /** Per floor, each head's output and the memory block's output at the last position: [floors][heads + 1][width]. */
  readonly parts: GPUBuffer; readonly scores: GPUBuffer; readonly cand: GPUBuffer;
  readonly sampleOut: GPUBuffer; readonly pushes: GPUBuffer;
  private readonly chunkPlan: Dispatch[];
  private readonly stepPlan: Dispatch[];

  constructor(readonly model: Model) {
    const { dev, cfg } = model;
    this.dev = dev;
    this.cfg = cfg;
    const W = cfg.width, H = cfg.queryHeads, D = cfg.headSize, KV = cfg.kvHeads, U = cfg.units, T = CHUNK;
    this.ct = storage(dev, model.lay.words * 4, "changes");
    this.SP = dev.createBuffer({ size: 64, usage: BU.UNIFORM | BU.COPY_DST, label: "step" });
    for (let L = 0; L < cfg.floors; L++) {
      this.kcache.push(storage(dev, KV * cfg.maxContext * (D / 2) * 4, `k${L}`));
      this.vcache.push(storage(dev, KV * cfg.maxContext * (D / 2) * 4, `v${L}`));
    }
    const f = (n: number, label: string) => storage(dev, n * 4, label);
    this.x = f(T * W, "x"); this.h = f(T * W, "h"); this.q = f(T * H * D, "q"); this.k = f(T * KV * D, "k");
    this.kout = f(T * KV * D, "kout"); this.v = f(T * KV * D, "v"); this.att = f(T * H * D, "att");
    this.o = f(T * W, "o"); this.mid = f(T * W, "mid"); this.h2 = f(T * W, "h2"); this.act = f(T * U, "act");
    this.m = f(T * W, "m"); this.xn = f(T * W, "xn"); this.rinv = f(T, "rinv");
    this.intok = f(T, "intok"); this.tok = f(8, "tok");
    this.parts = f(cfg.floors * (H + 1) * W, "parts");
    this.scores = f(cfg.vocabRows, "scores");
    this.cand = f(K.TOPK_SLICES * K.TOPK * 2, "cand");
    this.sampleOut = f(42, "sample");
    this.pushes = f(cfg.floors * (H + 1) + 1, "pushes");
    this.setTable(new Uint32Array(model.lay.words));
    this.chunkPlan = this.forwardPlan(8, false);
    this.stepPlan = [...this.forwardPlan(1, true), ...this.headPlan()];
  }

  setTable(table: Uint32Array) {
    this.dev.queue.writeBuffer(this.ct, 0, table);
  }

  writeParams(p: StepParams) {
    const u = new Uint32Array(16);
    const f = new Float32Array(u.buffer);
    u[0] = p.T; u[1] = p.pos0; u[2] = p.pos0 + p.T; u[3] = p.seed ?? 0; u[4] = p.turn ?? 0; u[5] = p.step ?? 0;
    f[6] = p.temperature ?? 0.7; u[7] = p.topK ?? 20; f[8] = p.topP ?? 0.8; u[9] = p.row ?? NO_ROW;
    u[10] = this.cfg.vocabReal; u[11] = p.keyLimit ?? NO_LIMIT;
    this.dev.queue.writeBuffer(this.SP, 0, u);
  }

  private mm(name: string, inDim: number, outDim: number, TB: number, rows: number, W: GPUBuffer, x: GPUBuffer, y: GPUBuffer,
    uni: GPUBuffer, opts: { gateup?: GPUBuffer; dict?: boolean } = {}): Dispatch {
    const m = this.model, cfg = this.cfg;
    const bits = (opts.dict ? cfg.dictBits : cfg.floorBits) as 4 | 8 | 32;
    const p = m.pipe(`mm-${name}-${inDim}-${outDim}-${TB}-${bits}`, () => K.matmulKernel(m.kc, {
      inDim, outDim, TB, bits, table: !opts.dict, gateup: !!opts.gateup, swapOut: !!opts.dict,
    }));
    const bufs = [W, x, y, this.ct, this.SP, uni, ...(opts.gateup ? [opts.gateup] : [])];
    return { pipeline: p, group: bind(this.dev, p, bufs), x: Math.ceil(outDim / 8), y: Math.ceil(rows / TB) };
  }

  /** The forward pass over SP.T tokens. `single` uses the one-token kernels and keeps each head's output. */
  private forwardPlan(TB: number, single: boolean): Dispatch[] {
    const m = this.model, cfg = this.cfg, dev = this.dev, kc = m.kc;
    const W = cfg.width, H = cfg.queryHeads, D = cfg.headSize, KV = cfg.kvHeads, U = cfg.units;
    const rows = single ? 1 : CHUNK;
    const plan: Dispatch[] = [];
    const embed = m.pipe("embed", () => K.embedKernel(kc));
    plan.push({ pipeline: embed, group: bind(dev, embed, [this.intok, m.w.dict, this.ct, this.SP, this.x]), x: rows });
    const enter = m.pipe("enter", () => K.enterFloorKernel(kc));
    const rope = m.pipe("rope", () => K.qkRopeKernel(kc));
    const attn = m.pipe("attn", () => K.attentionKernel(kc));
    const ares = m.pipe("ares", () => K.attnResidualKernel(kc));
    const mres = m.pipe("mres", () => K.memResidualKernel(kc));
    const oh = m.pipe("oheads", () => K.oHeadsKernel(kc));
    for (let L = 0; L < cfg.floors; L++) {
      const fw = m.w.floors[L];
      const uni = m.floorUniforms[L];
      plan.push({ pipeline: enter, group: bind(dev, enter, [this.x, fw.inNorm, this.ct, this.SP, this.h, uni]), x: rows });
      plan.push(this.mm("q", W, H * D, TB, rows, fw.q, this.h, this.q, m.mmUniform(L, "q")));
      plan.push(this.mm("k", W, KV * D, TB, rows, fw.k, this.h, this.k, m.mmUniform(L, "k")));
      plan.push(this.mm("v", W, KV * D, TB, rows, fw.v, this.h, this.v, m.mmUniform(L, "v")));
      plan.push({ pipeline: rope, group: bind(dev, rope, [this.q, this.k, this.v, fw.qkNorm, m.rope, this.SP,
        this.kcache[L], this.vcache[L], this.kout]), x: rows });
      plan.push({ pipeline: attn, group: bind(dev, attn, [this.q, this.kcache[L], this.vcache[L], this.ct, this.SP, uni, this.att]), x: rows, y: H });
      if (single) {
        plan.push({ pipeline: oh, group: bind(dev, oh, [fw.o, this.att, this.o, this.ct, this.SP, m.mmUniform(L, "o"),
          { buffer: this.parts, offset: L * (H + 1) * W * 4, size: H * W * 4 }]), x: Math.ceil(W / Math.floor(256 / H)) });
      } else {
        plan.push(this.mm("o", H * D, W, TB, rows, fw.o, this.att, this.o, m.mmUniform(L, "o")));
      }
      plan.push({ pipeline: ares, group: bind(dev, ares, [this.x, this.o, fw.postNorm, this.ct, this.SP, uni, this.mid, this.h2]), x: rows });
      plan.push(this.mm("gu", W, U, TB, rows, fw.gate, this.h2, this.act, m.mmUniform(L, "gate", "up"), { gateup: fw.up }));
      plan.push(this.mm("down", U, W, TB, rows, fw.down, this.act, this.m, m.mmUniform(L, "down")));
      plan.push({ pipeline: mres, group: bind(dev, mres, [this.mid, this.m, this.ct, this.SP, uni, this.x, this.parts]), x: rows });
    }
    return plan;
  }

  /** After a one-token forward: final norm, scores, top-k, sample, pushes. */
  private headPlan(): Dispatch[] {
    const m = this.model, cfg = this.cfg, dev = this.dev, kc = m.kc;
    const plan: Dispatch[] = [];
    const rms = m.pipe("rms", () => K.rmsKernel(kc));
    plan.push({ pipeline: rms, group: bind(dev, rms, [this.x, m.w.finalNorm, this.SP, this.xn, this.rinv]), x: 1 });
    plan.push(this.mm("dict", cfg.width, cfg.vocabRows, 1, 1, m.w.dict, this.xn, this.scores, m.dictUniform, { dict: true }));
    const tk = m.pipe("topk", () => K.topkPartialKernel(kc));
    plan.push({ pipeline: tk, group: bind(dev, tk, [this.scores, this.SP, this.cand]), x: K.TOPK_SLICES, y: 1 });
    const sm = m.pipe("sample", () => K.sampleKernel(kc));
    plan.push({ pipeline: sm, group: bind(dev, sm, [this.cand, this.SP, this.tok, this.sampleOut]), x: 1 });
    const pk = m.pipe("push", () => K.pushKernel(kc));
    plan.push({ pipeline: pk, group: bind(dev, pk, [this.tok, this.intok, m.w.dict, m.aux, this.rinv,
      this.parts, this.ct, this.SP, this.pushes]), x: cfg.floors * (cfg.queryHeads + 1) + 1 });
    return plan;
  }

  /** Read tokens into the cache (all but the last, which `step` reads). */
  read(tokens: number[]) {
    for (let i = 0; i < tokens.length; i += CHUNK) {
      const part = tokens.slice(i, i + CHUNK);
      this.dev.queue.writeBuffer(this.intok, 0, new Uint32Array(part));
      this.writeParams({ T: part.length, pos0: this.length });
      const enc = this.dev.createCommandEncoder();
      encode(enc, this.chunkPlan);
      this.dev.queue.submit([enc.finish()]);
      this.length += part.length;
    }
  }

  /**
   * One step: read `input` (or, when undefined, the token the GPU sampled last) at the next position,
   * then score, sample and push. Returns the encoder work submitted; results land in sampleOut/pushes.
   */
  step(input: number | undefined, p: { seed: number; turn: number; step: number; temperature?: number }, after?: (enc: GPUCommandEncoder) => void) {
    const enc = this.dev.createCommandEncoder();
    if (input === undefined) enc.copyBufferToBuffer(this.tok, 0, this.intok, 0, 4);
    else this.dev.queue.writeBuffer(this.intok, 0, new Uint32Array([input]));
    this.writeParams({ T: 1, pos0: this.length, row: 0, seed: p.seed, turn: p.turn, step: p.step, temperature: p.temperature });
    encode(enc, this.stepPlan);
    after?.(enc);
    this.dev.queue.submit([enc.finish()]);
    this.length += 1;
  }
}
