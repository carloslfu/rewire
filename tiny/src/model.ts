// The tiny model (section 6.3): Qwen3's design at about 1/750 of the size, reading letters.
// Written in jax-js. The parameters live in one flat array, so Adam stays a few elementwise operations
// outside the compiled step, and the dictionary lookup is a multiply by a one-hot matrix (gradients
// through a lookup fail under compilation).
import { grad, jit, nn, numpy as np, valueAndGrad } from "@jax-js/jax";

export interface TinyConfig {
  floors: number;
  width: number;
  heads: number;
  kvHeads: number;
  headSize: number;
  units: number;
  vocab: number;
  context: number;
  eps: number;
  theta: number;
}

export const TINY: Omit<TinyConfig, "vocab"> = {
  floors: 4, width: 128, heads: 4, kvHeads: 2, headSize: 32, units: 384, context: 64, eps: 1e-6, theta: 10000,
};

export interface Tensor {
  name: string;
  offset: number;
  shape: number[];
  size: number;
}

/** Where each tensor sits in the flat parameter array (engine names: dict, final_norm, f{L}.*). */
export function layout(c: TinyConfig): { tensors: Tensor[]; total: number } {
  const tensors: Tensor[] = [];
  let off = 0;
  const add = (name: string, shape: number[]) => {
    const size = shape.reduce((a, b) => a * b, 1);
    tensors.push({ name, offset: off, shape, size });
    off += size;
  };
  const W = c.width, H = c.heads, KV = c.kvHeads, D = c.headSize, U = c.units;
  add("dict", [c.vocab, W]);
  add("final_norm", [W]);
  for (let L = 0; L < c.floors; L++) {
    add(`f${L}.in_norm`, [W]);
    add(`f${L}.post_norm`, [W]);
    add(`f${L}.q_norm`, [D]);
    add(`f${L}.k_norm`, [D]);
    add(`f${L}.q`, [H * D, W]);
    add(`f${L}.k`, [KV * D, W]);
    add(`f${L}.v`, [KV * D, W]);
    add(`f${L}.o`, [W, H * D]);
    add(`f${L}.gate`, [U, W]);
    add(`f${L}.up`, [U, W]);
    add(`f${L}.down`, [W, U]);
  }
  return { tensors, total: off };
}

/** Deterministic initial parameters: norms at 1, matrices normal with standard deviation 0.02 (Box-Muller on a PCG stream). */
export function initParams(c: TinyConfig, seed = 1): Float32Array {
  const { tensors, total } = layout(c);
  const p = new Float32Array(total);
  let s = seed >>> 0;
  const rnd = () => {
    s = (Math.imul(s, 747796405) + 2891336453) >>> 0;
    const w = Math.imul(((s >>> ((s >>> 28) + 4)) ^ s) >>> 0, 277803737) >>> 0;
    return (((w >>> 22) ^ w) >>> 0) / 4294967296;
  };
  for (const t of tensors) {
    const norm = t.name.endsWith("norm");
    for (let i = 0; i < t.size; i++) {
      if (norm) p[t.offset + i] = 1;
      else {
        const u1 = Math.max(rnd(), 1e-12), u2 = rnd();
        p[t.offset + i] = 0.02 * Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
      }
    }
  }
  return p;
}

/** Rotation tables [context, headSize] (cos then sin), computed in 64-bit floats. */
export function ropeTables(c: TinyConfig): { cos: Float32Array; sin: Float32Array } {
  const D = c.headSize, half = D / 2;
  const cos = new Float32Array(c.context * D), sin = new Float32Array(c.context * D);
  for (let p = 0; p < c.context; p++) {
    for (let i = 0; i < half; i++) {
      const a = p / c.theta ** ((2 * i) / D);
      cos[p * D + i] = cos[p * D + half + i] = Math.cos(a);
      sin[p * D + i] = sin[p * D + half + i] = Math.sin(a);
    }
  }
  return { cos, sin };
}

type A = np.Array;
/** Typed arrays as jax-js expects them (backed by a plain ArrayBuffer). */
const f32 = (a: ArrayLike<number>): Float32Array<ArrayBuffer> => new Float32Array(a);
const i32 = (a: ArrayLike<number>) => Int32Array.from(a) as Int32Array<ArrayBuffer>;

function rms(x: A, w: A, eps: number): A {
  const ms = x.ref.mul(x.ref).mean(-1, { keepdims: true });
  return x.mul(np.reciprocal(np.sqrt(ms.add(eps)))).mul(w);
}

function rotHalf(x: A, D: number): A {
  const a = x.ref.slice([], [], [], [0, D / 2]);
  const b = x.slice([], [], [], [D / 2, D]);
  return np.concatenate([b.neg(), a], -1);
}

/**
 * Logits [B, T, vocab] for letter ids x [B, T] (int32). P is the flat parameter array; cos and sin are
 * [T, headSize]. Takes ownership of its arguments, like every jax-js function.
 */
export function forward(c: TinyConfig, P: A, x: A, cos: A, sin: A): A {
  const { tensors } = layout(c);
  const H = c.heads, KV = c.kvHeads, D = c.headSize;
  const [B, T] = x.shape;
  const get = (name: string) => {
    const t = tensors.find((u) => u.name === name)!;
    return P.ref.slice([t.offset, t.offset + t.size]).reshape(t.shape);
  };
  const dict = get("dict");
  let h = np.matmul(nn.oneHot(x, c.vocab), dict.ref); // [B, T, W]
  const mask = np.tril(np.ones([T, T])).reshape([1, 1, T, T]);
  const cosB = cos.reshape([1, T, 1, D]), sinB = sin.reshape([1, T, 1, D]);
  for (let L = 0; L < c.floors; L++) {
    const hn = rms(h.ref, get(`f${L}.in_norm`), c.eps);
    let q = np.matmul(hn.ref, get(`f${L}.q`).transpose()).reshape([B, T, H, D]);
    let k = np.matmul(hn.ref, get(`f${L}.k`).transpose()).reshape([B, T, KV, D]);
    const v = np.matmul(hn, get(`f${L}.v`).transpose()).reshape([B, T, KV, D]);
    q = rms(q, get(`f${L}.q_norm`), c.eps);
    k = rms(k, get(`f${L}.k_norm`), c.eps);
    q = q.ref.mul(cosB.ref).add(rotHalf(q, D).mul(sinB.ref));
    k = k.ref.mul(cosB.ref).add(rotHalf(k, D).mul(sinB.ref));
    const kx = np.repeat(k, H / KV, 2), vx = np.repeat(v, H / KV, 2);
    const s = np.matmul(q.transpose([0, 2, 1, 3]), kx.transpose([0, 2, 3, 1])).mul(1 / Math.sqrt(D)); // [B, H, T, T]
    const sm = np.where(mask.ref.greater(0), s, -1e9);
    const pr = nn.softmax(sm, -1);
    const att = np.matmul(pr, vx.transpose([0, 2, 1, 3])).transpose([0, 2, 1, 3]).reshape([B, T, H * D]);
    h = h.add(np.matmul(att, get(`f${L}.o`).transpose()));
    const h2 = rms(h.ref, get(`f${L}.post_norm`), c.eps);
    const act = nn.silu(np.matmul(h2.ref, get(`f${L}.gate`).transpose())).mul(np.matmul(h2, get(`f${L}.up`).transpose()));
    h = h.add(np.matmul(act, get(`f${L}.down`).transpose()));
  }
  mask.dispose();
  cosB.dispose();
  sinB.dispose();
  const out = np.matmul(rms(h, get("final_norm"), c.eps), dict.transpose());
  P.dispose();
  return out;
}

/** Mean cross-entropy of the next letter. y: [B, T] int32 targets. */
export function loss(c: TinyConfig, P: A, x: A, y: A, cos: A, sin: A): A {
  const logits = forward(c, P, x, cos, sin);
  const lp = nn.logSoftmax(logits, -1);
  const pick = lp.mul(nn.oneHot(y, c.vocab)).sum(-1);
  return pick.mean().neg();
}

export interface Trainer {
  /** One step: returns the loss before the step. */
  step(x: Int32Array, y: Int32Array, batch: number): Promise<number>;
  params(): Promise<Float32Array>;
  dispose(): void;
}

/** Adam outside the compiled gradient step, over the one flat array. */
export function adamTrainer(c: TinyConfig, init: Float32Array, opts = { lr: 3e-3, b1: 0.9, b2: 0.99, eps: 1e-8 }): Trainer {
  let P = np.array(f32(init));
  let m = np.zeros([init.length]);
  let v = np.zeros([init.length]);
  let t = 0;
  const rope = ropeTables(c);
  const T = c.context;
  const cos = np.array(rope.cos.slice(0, T * c.headSize)).reshape([T, c.headSize]);
  const sin = np.array(rope.sin.slice(0, T * c.headSize)).reshape([T, c.headSize]);
  const vg = jit(valueAndGrad((p: A, x: A, y: A, cs: A, sn: A) => loss(c, p, x, y, cs, sn)));
  const update = jit((p: A, mm: A, vv: A, g: A, lrT: A) => {
    const m2 = mm.mul(opts.b1).add(g.ref.mul(1 - opts.b1));
    const v2 = vv.mul(opts.b2).add(g.ref.mul(g).mul(1 - opts.b2));
    const p2 = p.sub(lrT.mul(m2.ref).div(np.sqrt(v2.ref).add(opts.eps)));
    return [p2, m2, v2];
  });
  return {
    async step(x, y, batch) {
      t++;
      const xa = np.array(i32(x), { dtype: np.int32 }).reshape([batch, T]);
      const ya = np.array(i32(y), { dtype: np.int32 }).reshape([batch, T]);
      const [l, g] = vg(P.ref, xa, ya, cos.ref, sin.ref) as unknown as [A, A];
      const lrT = opts.lr * Math.sqrt(1 - opts.b2 ** t) / (1 - opts.b1 ** t);
      const [p2, m2, v2] = update(P, m, v, g, np.array([lrT])) as unknown as [A, A, A];
      P = p2; m = m2; v = v2;
      return (await l.data())[0] as number;
    },
    async params() {
      return new Float32Array((await P.ref.data()) as Float32Array);
    },
    dispose() {
      P.dispose(); m.dispose(); v.dispose(); cos.dispose(); sin.dispose();
      vg.dispose(); update.dispose();
    },
  };
}

/** Plain gradient descent for the slow-motion view: one step, returning the gradient too. */
export async function sgdStep(c: TinyConfig, init: Float32Array, x: Int32Array, y: Int32Array, lr: number):
  Promise<{ params: Float32Array; grad: Float32Array; loss: number }> {
  const T = x.length;
  const rope = ropeTables(c);
  const cos = np.array(rope.cos.slice(0, T * c.headSize)).reshape([T, c.headSize]);
  const sin = np.array(rope.sin.slice(0, T * c.headSize)).reshape([T, c.headSize]);
  const P = np.array(f32(init));
  const xa = np.array(i32(x), { dtype: np.int32 }).reshape([1, T]);
  const ya = np.array(i32(y), { dtype: np.int32 }).reshape([1, T]);
  const [l, g] = valueAndGrad((p: A, xx: A, yy: A, cs: A, sn: A) => loss(c, p, xx, yy, cs, sn))(P, xa, ya, cos, sin) as unknown as [A, A];
  const gd = new Float32Array((await g.data()) as Float32Array);
  const lv = (await l.data())[0] as number;
  const params = new Float32Array(init.length);
  for (let i = 0; i < init.length; i++) params[i] = init[i] - lr * gd[i];
  return { params, grad: gd, loss: lv };
}

/** Next-letter probabilities after `ids` (the last position), for samples during training. */
export async function nextProbs(c: TinyConfig, params: Float32Array, ids: number[]): Promise<Float32Array> {
  const T = ids.length;
  const rope = ropeTables(c);
  const cos = np.array(rope.cos.slice(0, T * c.headSize)).reshape([T, c.headSize]);
  const sin = np.array(rope.sin.slice(0, T * c.headSize)).reshape([T, c.headSize]);
  const logits = forward(c, np.array(f32(params)), np.array(i32(ids), { dtype: np.int32 }).reshape([1, T]), cos, sin);
  const last = nn.softmax(logits.slice(0, T - 1), -1);
  return new Float32Array((await last.data()) as Float32Array);
}

export { grad };

/** Next-letter probabilities at every position [T, vocab] (the slow-motion view). */
export async function allProbs(c: TinyConfig, params: Float32Array, ids: ArrayLike<number>): Promise<Float32Array> {
  const T = ids.length;
  const rope = ropeTables({ ...c, context: Math.max(T, 1) });
  const cos = np.array(rope.cos.slice(0, T * c.headSize)).reshape([T, c.headSize]);
  const sin = np.array(rope.sin.slice(0, T * c.headSize)).reshape([T, c.headSize]);
  const logits = forward(c, np.array(f32(params)), np.array(i32(ids), { dtype: np.int32 }).reshape([1, T]), cos, sin);
  const p = nn.softmax(logits.reshape([T, c.vocab]), -1);
  return new Float32Array((await p.data()) as Float32Array);
}

/**
 * Next-letter probabilities from one compiled forward pass over a fixed window. Shorter inputs are padded
 * on the right, which is exact: attention is causal, so a position never sees the padding after it.
 */
export function sampler(c: TinyConfig) {
  const T = c.context, D = c.headSize;
  const rope = ropeTables(c);
  const cos = np.array(rope.cos.slice(0, T * D)).reshape([T, D]);
  const sin = np.array(rope.sin.slice(0, T * D)).reshape([T, D]);
  const fwd = jit((P: A, x: A, cs: A, sn: A) => nn.softmax(forward(c, P, x, cs, sn), -1));
  return {
    /** Probabilities at every position of `ids` (at most T of them), [n, vocab]. P is not consumed. */
    async all(P: A, ids: ArrayLike<number>): Promise<Float32Array> {
      const n = Math.min(ids.length, T);
      const x = new Int32Array(T);
      x.set(Array.from(ids).slice(-n));
      const out = fwd(P.ref, np.array(x, { dtype: np.int32 }).reshape([1, T]), cos.ref, sin.ref) as A;
      const rows = out.slice(0, [0, n]);
      return new Float32Array((await rows.data()) as Float32Array);
    },
    /** Probabilities of the letter after `ids`. */
    async next(P: A, ids: ArrayLike<number>): Promise<Float32Array> {
      const all = await this.all(P, Array.from(ids).slice(-T));
      const n = Math.min(ids.length, T);
      return all.slice((n - 1) * c.vocab, n * c.vocab);
    },
    dispose() {
      cos.dispose();
      sin.dispose();
      fwd.dispose();
    },
  };
}

export function deviceParams(p: ArrayLike<number>): A {
  return np.array(f32(p));
}
