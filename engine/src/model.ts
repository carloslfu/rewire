// The engine model: weights on the GPU, pipelines, and conversations that read and write tokens.
import { encodeTable } from "./changes.ts";
import { type ModelConfig, type TableLayout, tableLayout, TENSOR_ID } from "./config.ts";
import { BU, bind, type Dispatch, download, encode, Pipelines, storage, upload } from "./gpu.ts";
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
  private uniforms = new Set<GPUBuffer>();
  private conversations = new Set<Conversation>();
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
    this.uniforms.add(b);
    return b;
  }

  private slots = new Map<number, GPUBuffer>();
  /** A uniform holding a slot index in its first word. */
  slotUniform(slot: number): GPUBuffer {
    let b = this.slots.get(slot);
    if (!b) { b = this.uniform([slot, 0, 0, 0]); this.slots.set(slot, b); }
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
    const c = new Conversation(this);
    this.conversations.add(c);
    return c;
  }

  /** Release a replaced model, including conversations and uniforms created by inspection plans. */
  destroy() {
    for (const c of this.conversations) c.destroy();
    this.conversations.clear();
    for (const b of this.uniforms) b.destroy();
    this.uniforms.clear();
    for (const f of this.w.floors) for (const b of Object.values(f)) (b as GPUBuffer).destroy();
    for (const b of [this.w.dict, this.w.finalNorm, this.w.meanRow, this.rope, this.aux]) b.destroy();
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
  /** A word to use instead of the drawn one (a visitor's pick, or the comparison pass). */
  readonly forced: GPUBuffer;
  /** Mappable buffers that receive each step's results, read a few steps behind. */
  readonly stage: GPUBuffer[] = [];
  private chunkPlan: Dispatch[];
  private stepPlan: Dispatch[];
  private headA: Dispatch[] = [];
  private headB: Dispatch[] = [];
  /** When set, the stream entering each floor and the final stream are copied here: [floors + 1][maxContext][width]. */
  capture?: GPUBuffer;

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
    this.sampleOut = f(48, "sample");
    this.pushes = f(cfg.floors * (H + 1) + 2, "pushes");
    this.forced = f(4, "forced");
    for (let i = 0; i < RING; i++) {
      this.stage.push(dev.createBuffer({ size: STAGE_BYTES(cfg), usage: BU.MAP_READ | BU.COPY_DST, label: `stage${i}` }));
    }
    this.setTable(encodeTable({}, cfg)); // the normal model until a change table is set
    this.chunkPlan = this.forwardPlan(8, false);
    this.stepPlan = this.forwardPlan(1, true);
    [this.headA, this.headB] = this.headPlans();
  }

  destroy() {
    for (const b of [this.ct, this.SP, this.x, this.h, this.q, this.k, this.kout, this.v, this.att, this.o,
      this.mid, this.h2, this.act, this.m, this.xn, this.rinv, this.intok, this.tok, this.parts, this.scores,
      this.cand, this.sampleOut, this.pushes, this.forced, ...this.kcache, ...this.vcache, ...this.stage, this.capture]) b?.destroy();
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
  /** Copy every stream into `buf` from now on (tests and golden traces). */
  setCapture(buf: GPUBuffer) {
    this.capture = buf;
    this.chunkPlan = this.forwardPlan(8, false);
    this.stepPlan = this.forwardPlan(1, true);
  }

  private captureAt(slot: number, rows: number): Dispatch[] {
    if (!this.capture) return [];
    const m = this.model;
    const p = m.pipe("capture", () => K.captureKernel(m.kc));
    return [{ pipeline: p, group: bind(this.dev, p, [this.x, this.SP, m.slotUniform(slot), this.capture]), x: rows }];
  }

  /** Where the chunk plan splits after floor L's rotation (the attention map keeps queries there). */
  private ropeAt: number[] = [];

  private forwardPlan(TB: number, single: boolean): Dispatch[] {
    const m = this.model, cfg = this.cfg, dev = this.dev, kc = m.kc;
    const W = cfg.width, H = cfg.queryHeads, D = cfg.headSize, KV = cfg.kvHeads, U = cfg.units;
    const rows = single ? 1 : CHUNK;
    const plan: Dispatch[] = [];
    if (!single) this.ropeAt = [];
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
      plan.push(...this.captureAt(L, rows));
      plan.push(this.mm("q", W, H * D, TB, rows, fw.q, this.h, this.q, m.mmUniform(L, "q")));
      plan.push(this.mm("k", W, KV * D, TB, rows, fw.k, this.h, this.k, m.mmUniform(L, "k")));
      plan.push(this.mm("v", W, KV * D, TB, rows, fw.v, this.h, this.v, m.mmUniform(L, "v")));
      plan.push({ pipeline: rope, group: bind(dev, rope, [this.q, this.k, this.v, fw.qkNorm, m.rope, this.SP,
        this.kcache[L], this.vcache[L], this.kout]), x: rows });
      if (!single) this.ropeAt[L] = plan.length;
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
    plan.push(...this.captureAt(cfg.floors, rows));
    return plan;
  }

  /**
   * After a one-token forward. A: final norm, scores, top-k and the draw. B: the log-probability of the
   * word and the pushes toward it. Between them a forced word can replace the drawn one.
   */
  private headPlans(): [Dispatch[], Dispatch[]] {
    const m = this.model, cfg = this.cfg, dev = this.dev, kc = m.kc;
    const a: Dispatch[] = [];
    const rms = m.pipe("rms", () => K.rmsKernel(kc));
    a.push({ pipeline: rms, group: bind(dev, rms, [this.x, m.w.finalNorm, this.SP, this.xn, this.rinv]), x: 1 });
    a.push(this.mm("dict", cfg.width, cfg.vocabRows, 1, 1, m.w.dict, this.xn, this.scores, m.dictUniform, { dict: true }));
    const tk = m.pipe("topk", () => K.topkPartialKernel(kc));
    a.push({ pipeline: tk, group: bind(dev, tk, [this.scores, this.SP, this.cand]), x: K.TOPK_SLICES, y: 1 });
    const sm = m.pipe("sample", () => K.sampleKernel(kc));
    a.push({ pipeline: sm, group: bind(dev, sm, [this.cand, this.SP, this.tok, this.sampleOut]), x: 1 });
    const b: Dispatch[] = [];
    const lse = m.pipe("lse", () => K.lseKernel(kc));
    b.push({ pipeline: lse, group: bind(dev, lse, [this.scores, this.tok, this.SP, this.sampleOut]), x: 1 });
    const pk = m.pipe("push", () => K.pushKernel(kc));
    b.push({ pipeline: pk, group: bind(dev, pk, [this.tok, this.intok, m.w.dict, m.aux, this.rinv,
      this.parts, this.ct, this.SP, this.pushes]), x: cfg.floors * (cfg.queryHeads + 1) + 2 });
    return [a, b];
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

  // ------------------------------------------------------------------ inspection (section 6.2, "Reads")

  private insp?: { prog: (Dispatch | Copy)[]; buf: GPUBuffer; rows: GPUBuffer; per: number; off: Record<string, number> };

  /** Everything one floor computes, for every floor, at one position: built once, then reused. */
  private inspectProgram() {
    if (this.insp) return this.insp;
    const m = this.model, cfg = this.cfg, dev = this.dev, kc = m.kc;
    const W = cfg.width, H = cfg.queryHeads, D = cfg.headSize, KV = cfg.kvHeads, U = cfg.units, F = cfg.floors;
    const sizes: [string, number][] = [["x", W], ["h", W], ["q_raw", H * D], ["k_raw", KV * D], ["v", KV * D], ["q", H * D],
      ["k", KV * D], ["att", H * D], ["o", W], ["mid", W], ["h2", W], ["gate", U], ["up", U], ["act", U], ["mem", W]];
    const off: Record<string, number> = {};
    let per = 0;
    for (const [k, n] of sizes) { off[k] = per; per += n; }
    const buf = storage(dev, (per * F + 2 * W) * 4, "inspect");
    const rows = storage(dev, F * 2 * H * cfg.maxContext * 4, "attention rows");
    const g = storage(dev, U * 4, "gate only"), u = storage(dev, U * 4, "up only");
    const prog: (Dispatch | Copy)[] = [];
    const cp = (src: GPUBuffer, L: number, key: string, n: number) =>
      prog.push({ copy: true, src, dst: buf, srcOffset: 0, dstOffset: (L * per + off[key]) * 4, size: n * 4 });
    const embed = m.pipe("embed", () => K.embedKernel(kc));
    prog.push({ pipeline: embed, group: bind(dev, embed, [this.intok, m.w.dict, this.ct, this.SP, this.x]), x: 1 });
    const enter = m.pipe("enter", () => K.enterFloorKernel(kc));
    const rope = m.pipe("rope", () => K.qkRopeKernel(kc));
    const attn = m.pipe("attn-cap", () => K.attentionKernel(kc, true));
    const ares = m.pipe("ares", () => K.attnResidualKernel(kc));
    const mres = m.pipe("mres", () => K.memResidualKernel(kc));
    const oh = m.pipe("oheads", () => K.oHeadsKernel(kc));
    for (let L = 0; L < F; L++) {
      const fw = m.w.floors[L];
      const uni = m.floorUniforms[L];
      prog.push({ pipeline: enter, group: bind(dev, enter, [this.x, fw.inNorm, this.ct, this.SP, this.h, uni]), x: 1 });
      cp(this.x, L, "x", W); cp(this.h, L, "h", W);
      prog.push(this.mm("q", W, H * D, 1, 1, fw.q, this.h, this.q, m.mmUniform(L, "q")));
      prog.push(this.mm("k", W, KV * D, 1, 1, fw.k, this.h, this.k, m.mmUniform(L, "k")));
      prog.push(this.mm("v", W, KV * D, 1, 1, fw.v, this.h, this.v, m.mmUniform(L, "v")));
      cp(this.q, L, "q_raw", H * D); cp(this.k, L, "k_raw", KV * D); cp(this.v, L, "v", KV * D);
      prog.push({ pipeline: rope, group: bind(dev, rope, [this.q, this.k, this.v, fw.qkNorm, m.rope, this.SP,
        this.kcache[L], this.vcache[L], this.kout]), x: 1 });
      cp(this.q, L, "q", H * D); cp(this.kout, L, "k", KV * D);
      prog.push({ pipeline: attn, group: bind(dev, attn, [this.q, this.kcache[L], this.vcache[L], this.ct, this.SP, uni, this.att, rows]), x: 1, y: H });
      cp(this.att, L, "att", H * D);
      prog.push({ pipeline: oh, group: bind(dev, oh, [fw.o, this.att, this.o, this.ct, this.SP, m.mmUniform(L, "o"),
        { buffer: this.parts, offset: L * (H + 1) * W * 4, size: H * W * 4 }]), x: Math.ceil(W / Math.floor(256 / H)) });
      cp(this.o, L, "o", W);
      prog.push({ pipeline: ares, group: bind(dev, ares, [this.x, this.o, fw.postNorm, this.ct, this.SP, uni, this.mid, this.h2]), x: 1 });
      cp(this.mid, L, "mid", W); cp(this.h2, L, "h2", W);
      prog.push(this.mm("g1", W, U, 1, 1, fw.gate, this.h2, g, m.mmUniform(L, "gate")));
      prog.push(this.mm("u1", W, U, 1, 1, fw.up, this.h2, u, m.mmUniform(L, "up")));
      cp(g, L, "gate", U); cp(u, L, "up", U);
      prog.push(this.mm("gu", W, U, 1, 1, fw.gate, this.h2, this.act, m.mmUniform(L, "gate", "up"), { gateup: fw.up }));
      cp(this.act, L, "act", U);
      prog.push(this.mm("down", U, W, 1, 1, fw.down, this.act, this.m, m.mmUniform(L, "down")));
      prog.push({ pipeline: mres, group: bind(dev, mres, [this.mid, this.m, this.ct, this.SP, uni, this.x, this.parts]), x: 1 });
      cp(this.m, L, "mem", W);
    }
    prog.push({ copy: true, src: this.x, dst: buf, srcOffset: 0, dstOffset: per * F * 4, size: W * 4 });
    const [a] = this.headPlans();
    prog.push(a[0], a[1]);
    prog.push({ copy: true, src: this.xn, dst: buf, srcOffset: 0, dstOffset: (per * F + W) * 4, size: W * 4 });
    this.insp = { prog, buf, rows, per, off };
    return this.insp;
  }

  /**
   * One pass at `position` reading `input`, with the cache holding everything before it: every value each
   * floor computes, the attention rows, the final scores and the floor guesses. `target` is the word
   * written there (for the unit pushes). The cache is unchanged afterwards.
   */
  async inspect(position: number, input: number, target: number, host: InspectHost): Promise<Inspection> {
    const cfg = this.cfg, dev = this.dev, m = this.model;
    const W = cfg.width, H = cfg.queryHeads, D = cfg.headSize, KV = cfg.kvHeads, U = cfg.units, F = cfg.floors;
    const { prog, buf, rows, per, off } = this.inspectProgram();
    const t0 = performance.now();
    const keep = this.length;
    dev.queue.writeBuffer(this.intok, 0, new Uint32Array([input]));
    this.writeParams({ T: 1, pos0: position, row: 0 });
    const enc = dev.createCommandEncoder();
    run(enc, prog);
    dev.queue.submit([enc.finish()]);
    this.length = keep;
    const [raw, rowsRaw, scoresRaw, rinvRaw] = await Promise.all([download(dev, buf), download(dev, rows), download(dev, this.scores),
      download(dev, this.rinv, 16)]);
    const tRead = performance.now();
    const all = new Float32Array(raw);
    const detail = new Map<string, Float32Array>();
    const n = position + 1;
    const rowsF = new Float32Array(rowsRaw);
    const qk = host.qkNorm;
    const table = host.table;
    const fl = (i: number) => new Float32Array(table.buffer, table.byteOffset + i * 4, 1)[0];
    for (let L = 0; L < F; L++) {
      const g = (k: string, len: number) => all.slice(L * per + off[k], L * per + off[k] + len);
      for (const [k, len] of [["x", W], ["h", W], ["q_raw", H * D], ["k_raw", KV * D], ["v", KV * D], ["q", H * D], ["k", KV * D],
        ["att", H * D], ["o", W], ["mid", W], ["h2", W], ["gate", U], ["up", U], ["act", U], ["mem", W]] as [string, number][]) {
        detail.set(`f${L}.${k}`, g(k, len));
      }
      detail.set(`f${L}.q_n`, headNorm(detail.get(`f${L}.q_raw`)!, qk[L].subarray(0, D), H, D, cfg.eps));
      detail.set(`f${L}.k_n`, headNorm(detail.get(`f${L}.k_raw`)!, qk[L].subarray(D, 2 * D), KV, D, cfg.eps));
      const probs = new Float32Array(H * n), sc = new Float32Array(H * n);
      for (let h = 0; h < H; h++) {
        for (let j = 0; j < n; j++) {
          probs[h * n + j] = rowsF[((L * 2) * H + h) * cfg.maxContext + j];
          const s = rowsF[((L * 2 + 1) * H + h) * cfg.maxContext + j];
          sc[h * n + j] = s < -1e38 ? -Infinity : s;
        }
      }
      detail.set(`f${L}.probs`, probs);
      detail.set(`f${L}.scores`, sc);
    }
    detail.set("final.x", all.slice(per * F, per * F + W));
    detail.set("final.xn", all.slice(per * F + W, per * F + 2 * W));
    const scores = new Float32Array(scoresRaw);
    const top = topK(scores, cfg.vocabReal, 64);
    detail.set("final.top_scores", Float32Array.from(top.map((i) => scores[i])));
    detail.set("final.top_ids", Float32Array.from(top));
    const tUnpack = performance.now();
    // unit pushes: u = (dict[target] - mean row) * w_final * rinv, then each floor's down columns dotted with u
    const rinv = new Float32Array(rinvRaw)[0];
    const row = await this.dictRow(target);
    const uv = new Float32Array(W);
    for (let i = 0; i < W; i++) uv[i] = (row[i] - host.meanRow[i]) * host.finalNorm[i] * rinv;
    const dots = await this.columnDots(uv);
    for (let L = 0; L < F; L++) {
      const act = detail.get(`f${L}.act`)!;
      const a = fl(m.lay.floor + L), mm = fl(m.lay.mem + L);
      const up = new Float32Array(U);
      for (let j = 0; j < U; j++) up[j] = act[j] * dots[L * U + j] * mm * a;
      detail.set(`f${L}.unit_push`, up);
    }
    const tUnits = performance.now();
    const guesses = await this.floorGuesses(detail, 5);
    const tEnd = performance.now();
    return { detail, guesses, timing: { pass: tRead - t0, unpack: tUnpack - tRead, units: tUnits - tUnpack, guesses: tEnd - tUnits,
      guess_read: this.lastGuessReadMs } };
  }

  private dictRowPipe?: { ids: GPUBuffer; out: GPUBuffer; group: GPUBindGroup; pipeline: GPUComputePipeline };
  /** One dictionary row, through this conversation's swap map. */
  async dictRow(id: number): Promise<Float32Array> {
    const m = this.model, dev = this.dev;
    if (!this.dictRowPipe) {
      const pipeline = m.pipe("dictrow", () => K.dictRowKernel(m.kc));
      const ids = storage(dev, 16, "row id"), out = storage(dev, this.cfg.width * 4, "row");
      this.dictRowPipe = { ids, out, pipeline, group: bind(dev, pipeline, [m.w.dict, this.ct, ids, out]) };
    }
    const p = this.dictRowPipe;
    dev.queue.writeBuffer(p.ids, 0, new Uint32Array([id]));
    const enc = dev.createCommandEncoder();
    encode(enc, [{ pipeline: p.pipeline, group: p.group, x: 1 }]);
    dev.queue.submit([enc.finish()]);
    return new Float32Array(await download(dev, p.out));
  }

  private colPipe?: { u: GPUBuffer; out: GPUBuffer; list: Dispatch[] };
  private async columnDots(u: Float32Array): Promise<Float32Array> {
    const m = this.model, dev = this.dev, cfg = this.cfg, U = cfg.units;
    if (!this.colPipe) {
      const pipeline = m.pipe("coldot", () => K.colDotKernel(m.kc));
      const ub = storage(dev, cfg.width * 4, "u"), out = storage(dev, cfg.floors * U * 4, "unit dots");
      const list = m.w.floors.map((fw, L) => ({ pipeline, group: bind(dev, pipeline, [fw.down, ub, this.ct,
        { buffer: out, offset: L * U * 4, size: U * 4 }]), x: Math.ceil(U / 64) }));
      this.colPipe = { u: ub, out, list };
    }
    dev.queue.writeBuffer(this.colPipe.u, 0, u);
    const enc = dev.createCommandEncoder();
    encode(enc, this.colPipe.list);
    dev.queue.submit([enc.finish()]);
    return new Float32Array(await download(dev, this.colPipe.out));
  }

  private guessPipe?: { inp: GPUBuffer; xn: GPUBuffer; rinv: GPUBuffer; scores: GPUBuffer; list: Dispatch[] };
  /** What each floor's output would say: the final normalization and the dictionary, top k per floor. */
  /** How long the last floor-guess readback took (bench detail). */
  lastGuessReadMs = 0;

  private async floorGuesses(detail: Map<string, Float32Array>, k: number): Promise<{ id: number; p: number }[][]> {
    const m = this.model, dev = this.dev, cfg = this.cfg, W = cfg.width, F = cfg.floors, V = cfg.vocabRows;
    if (!this.guessPipe) {
      const inp = storage(dev, F * W * 4, "guess in"), xn = storage(dev, F * W * 4, "guess xn"), rinv = storage(dev, F * 4, "guess rinv");
      const scores = storage(dev, F * V * 4, "guess scores");
      const rms = m.pipe("rms", () => K.rmsKernel(m.kc));
      const list: Dispatch[] = [{ pipeline: rms, group: bind(dev, rms, [inp, m.w.finalNorm, this.SP, xn, rinv]), x: F },
        this.mm("dict", W, V, 8, F, m.w.dict, xn, scores, m.dictUniform, { dict: true })];
      this.guessPipe = { inp, xn, rinv, scores, list };
    }
    const g = this.guessPipe;
    const streams = new Float32Array(F * W);
    for (let L = 0; L < F; L++) streams.set(L < F - 1 ? detail.get(`f${L + 1}.x`)! : detail.get("final.x")!, L * W);
    dev.queue.writeBuffer(g.inp, 0, streams);
    this.writeParams({ T: F, pos0: 0 });
    const enc = dev.createCommandEncoder();
    encode(enc, g.list);
    dev.queue.submit([enc.finish()]);
    const tg = performance.now();
    const sc = new Float32Array(await download(dev, g.scores));
    this.lastGuessReadMs = performance.now() - tg;
    const out: { id: number; p: number }[][] = [];
    for (let L = 0; L < F; L++) {
      const row = sc.subarray(L * V, L * V + V);
      let mx = -Infinity;
      for (let i = 0; i < cfg.vocabReal; i++) if (row[i] > mx) mx = row[i];
      let sum = 0;
      for (let i = 0; i < cfg.vocabReal; i++) sum += Math.exp(row[i] - mx);
      out.push(topK(row, cfg.vocabReal, k).map((id) => ({ id, p: Math.exp(row[id] - mx) / sum })));
    }
    return out;
  }

  /**
   * A head's full attention map over `tokens` (section 4.2: one tap further than the attention lines).
   * Re-reads the conversation once, keeping every position's rotated queries on `floor`, then computes the
   * map on the CPU from those queries and the cached keys, with the conversation's hidden words applied.
   * Returns n x n probabilities (row = query position). The cache ends up holding `tokens`.
   */
  async attentionMap(tokens: number[], floor: number, head: number, hidden: { key: number; from: number }[] = []): Promise<Float32Array> {
    const cfg = this.cfg, dev = this.dev, H = cfg.queryHeads, D = cfg.headSize, KV = cfg.kvHeads, n = tokens.length;
    const qAll = storage(dev, n * H * D * 4, "map queries");
    const split = this.ropeAt[floor];
    this.length = 0;
    for (let i = 0; i < n; i += CHUNK) {
      const part = tokens.slice(i, i + CHUNK);
      dev.queue.writeBuffer(this.intok, 0, new Uint32Array(part));
      this.writeParams({ T: part.length, pos0: this.length });
      const enc = dev.createCommandEncoder();
      encode(enc, this.chunkPlan.slice(0, split));
      enc.copyBufferToBuffer(this.q, 0, qAll, i * H * D * 4, part.length * H * D * 4);
      encode(enc, this.chunkPlan.slice(split));
      dev.queue.submit([enc.finish()]);
      this.length += part.length;
    }
    const [qRaw, kRaw] = await Promise.all([download(dev, qAll), download(dev, this.kcache[floor])]);
    qAll.destroy();
    const q = new Float32Array(qRaw), kc = new Uint32Array(kRaw);
    const kvh = Math.floor(head / (H / KV)), HALF = D / 2, maxCtx = cfg.maxContext;
    const half = (b: number) => {
      const s = b & 0x8000 ? -1 : 1, e = (b >> 10) & 31, m = b & 1023;
      return e === 0 ? s * m * 2 ** -24 : e === 31 ? (m ? NaN : s * Infinity) : s * (1 + m / 1024) * 2 ** (e - 15);
    };
    const keys = new Float32Array(n * D);
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < HALF; i++) {
        const w = kc[(kvh * maxCtx + j) * HALF + i];
        keys[j * D + 2 * i] = half(w & 0xffff);
        keys[j * D + 2 * i + 1] = half(w >>> 16);
      }
    }
    const out = new Float32Array(n * n);
    const sc = new Float64Array(n);
    for (let t = 0; t < n; t++) {
      let mx = -Infinity;
      for (let j = 0; j <= t; j++) {
        if (hidden.some((h) => h.key === j && t >= h.from)) { sc[j] = -Infinity; continue; }
        let d = 0;
        for (let i = 0; i < D; i++) d += q[(t * H + head) * D + i] * keys[j * D + i];
        sc[j] = d / Math.sqrt(D);
        if (sc[j] > mx) mx = sc[j];
      }
      if (mx === -Infinity) continue;
      let sum = 0;
      for (let j = 0; j <= t; j++) { const e = sc[j] === -Infinity ? 0 : Math.exp(sc[j] - mx); sc[j] = e; sum += e; }
      for (let j = 0; j <= t; j++) out[t * n + j] = sc[j] / sum;
    }
    return out;
  }

  /** Forget everything from position n on (the cache keeps its bytes; later reads overwrite them). */
  rewind(n: number) {
    this.length = Math.min(this.length, n);
  }

  /**
   * One step: read `input` (or, when undefined, the word the GPU drew last) at the next position, then
   * score, draw and push. With `force`, that word is used instead of the drawn one (the candidates still
   * show the real distribution). With `slot`, the results are copied to that staging buffer for `result`.
   */
  step(input: number | undefined, p: { seed: number; turn: number; step: number; temperature?: number; force?: number; slot?: number },
    after?: (enc: GPUCommandEncoder) => void) {
    const enc = this.dev.createCommandEncoder();
    if (input === undefined) enc.copyBufferToBuffer(this.tok, 0, this.intok, 0, 4);
    else this.dev.queue.writeBuffer(this.intok, 0, new Uint32Array([input]));
    this.writeParams({ T: 1, pos0: this.length, row: 0, seed: p.seed, turn: p.turn, step: p.step, temperature: p.temperature });
    encode(enc, [...this.stepPlan, ...this.headA]);
    if (p.force !== undefined) {
      this.dev.queue.writeBuffer(this.forced, 0, new Uint32Array([p.force]));
      enc.copyBufferToBuffer(this.forced, 0, this.tok, 0, 4);
    }
    encode(enc, this.headB);
    if (p.slot !== undefined) this.copyResults(enc, p.slot);
    after?.(enc);
    this.dev.queue.submit([enc.finish()]);
    this.length += 1;
  }

  /** Comparison: read `input`, then the log-probability of `target` and the pushes toward it (no draw). */
  compareStep(input: number, target: number, slot: number) {
    const enc = this.dev.createCommandEncoder();
    this.dev.queue.writeBuffer(this.intok, 0, new Uint32Array([input]));
    this.dev.queue.writeBuffer(this.forced, 0, new Uint32Array([target]));
    this.writeParams({ T: 1, pos0: this.length, row: 0 });
    encode(enc, [...this.stepPlan, ...this.headA.slice(0, 2)]);
    enc.copyBufferToBuffer(this.forced, 0, this.tok, 0, 4);
    encode(enc, this.headB);
    this.copyResults(enc, slot);
    this.dev.queue.submit([enc.finish()]);
    this.length += 1;
  }

  private copyResults(enc: GPUCommandEncoder, slot: number) {
    const st = this.stage[slot % RING];
    enc.copyBufferToBuffer(this.sampleOut, 0, st, 0, 48 * 4);
    enc.copyBufferToBuffer(this.tok, 0, st, 48 * 4, 16);
    enc.copyBufferToBuffer(this.pushes, 0, st, 52 * 4, (this.cfg.floors * (this.cfg.queryHeads + 1) + 2) * 4);
  }

  /** Results of the step copied to `slot`. Call in submission order; at most RING steps behind. */
  async result(slot: number): Promise<StepResult> {
    const st = this.stage[slot % RING];
    await st.mapAsync(1);
    const u = new Uint32Array(st.getMappedRange().slice(0));
    st.unmap();
    const f = new Float32Array(u.buffer);
    const P = this.cfg.floors * (this.cfg.queryHeads + 1) + 1;
    return {
      drawn: u[0], token: u[48], cut: u[1], ids: u.slice(2, 22), probs: f.slice(22, 42), lp1: f[42],
      pushes: f.slice(52, 52 + P), concept: f[52 + P],
    };
  }
}

export const RING = 4;
const STAGE_BYTES = (cfg: ModelConfig) => (52 + cfg.floors * (cfg.queryHeads + 1) + 2) * 4;

export interface StepResult {
  /** The word the draw picked. */
  drawn: number;
  /** The word used (the drawn one, or the forced one). */
  token: number;
  cut: number;
  ids: Uint32Array;
  probs: Float32Array;
  lp1: number;
  pushes: Float32Array;
  concept: number;
}

export interface Copy { copy: true; src: GPUBuffer; dst: GPUBuffer; srcOffset: number; dstOffset: number; size: number }

/** Dispatches in compute passes, with buffer copies between passes. */
export function run(enc: GPUCommandEncoder, prog: (Dispatch | Copy)[]) {
  let batch: Dispatch[] = [];
  for (const p of prog) {
    if ("copy" in p) {
      if (batch.length) { encode(enc, batch); batch = []; }
      enc.copyBufferToBuffer(p.src, p.srcOffset, p.dst, p.dstOffset, p.size);
    } else batch.push(p);
  }
  if (batch.length) encode(enc, batch);
}

export interface InspectHost {
  /** Per floor: the query normalization weights then the key normalization weights. */
  qkNorm: Float32Array[];
  meanRow: Float32Array;
  finalNorm: Float32Array;
  /** The encoded change table this conversation runs under. */
  table: Uint32Array;
}

export interface Inspection {
  detail: Map<string, Float32Array>;
  guesses: { id: number; p: number }[][];
  /** Milliseconds per phase: the capture pass and its readback, unpacking, unit pushes, floor guesses. */
  timing?: { pass: number; unpack: number; units: number; guesses: number; guess_read: number };
}

function headNorm(x: Float32Array, w: Float32Array, heads: number, D: number, eps: number): Float32Array {
  const out = new Float32Array(x.length);
  for (let h = 0; h < heads; h++) {
    let ss = 0;
    for (let i = 0; i < D; i++) ss += x[h * D + i] ** 2;
    const r = 1 / Math.sqrt(ss / D + eps);
    for (let i = 0; i < D; i++) out[h * D + i] = x[h * D + i] * r * w[i];
  }
  return out;
}

/** Indices of the k largest values among the first n, ties by lower index. */
export function topK(v: Float32Array, n: number, k: number): number[] {
  const best: number[] = [];
  for (let i = 0; i < n; i++) {
    if (best.length < k || v[i] > v[best[best.length - 1]]) {
      let j = best.length < k ? best.length : k - 1;
      if (best.length < k) best.push(i); else best[j] = i;
      while (j > 0 && v[best[j]] > v[best[j - 1]]) { [best[j], best[j - 1]] = [best[j - 1], best[j]]; j--; }
    }
  }
  return best;
}

export { download };
