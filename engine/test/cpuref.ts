// A CPU reference of the engine's math for unit tests: same packing, same changes, float64 math,
// half-precision keys and values. Small configurations only.
import { bitTable, type ChangeSpec } from "../src/changes.ts";
import { type ModelConfig, TENSOR_ID, TENSORS, type TensorName } from "../src/config.ts";
import { f16, fromF16 } from "../src/gpu.ts";

export const roundF16 = (x: number) => fromF16(f16(x));

/** Pack a [out, in] float matrix as 4-bit affine groups: codes then one u32 per group (scale low, offset high). */
export function packQ4(w: Float32Array, out: number, inp: number, G: number): Uint32Array {
  const words = (out * inp) / 8;
  const res = new Uint32Array(words + (out * inp) / G);
  for (let r = 0; r < out; r++) {
    for (let g = 0; g < inp / G; g++) {
      let lo = Infinity, hi = -Infinity;
      for (let i = 0; i < G; i++) {
        const v = w[r * inp + g * G + i];
        lo = Math.min(lo, v);
        hi = Math.max(hi, v);
      }
      const s16 = f16((hi - lo) / 15), o16 = f16(lo);
      const s = fromF16(s16), o = fromF16(o16);
      res[words + r * (inp / G) + g] = (s16 | (o16 << 16)) >>> 0;
      for (let i = 0; i < G; i++) {
        const col = g * G + i;
        const c = Math.max(0, Math.min(15, Math.round((w[r * inp + col] - o) / (s === 0 ? 1 : s))));
        const idx = r * inp + col;
        res[idx >>> 3] |= c << (4 * (idx & 7));
      }
    }
  }
  return res;
}

export function deqQ4(p: Uint32Array, out: number, inp: number, G: number, table = bitTable(4)): Float64Array {
  const words = (out * inp) / 8;
  const res = new Float64Array(out * inp);
  for (let r = 0; r < out; r++) {
    for (let col = 0; col < inp; col++) {
      const idx = r * inp + col;
      const c = (p[idx >>> 3] >>> (4 * (idx & 7))) & 15;
      const pw = p[words + r * (inp / G) + Math.floor(col / G)];
      const s = fromF16(pw & 0xffff), o = fromF16(pw >>> 16);
      res[idx] = Math.fround(o + Math.fround(s * Math.fround(table[c])));
    }
  }
  return res;
}

export interface CpuFloor {
  q: Uint32Array; k: Uint32Array; v: Uint32Array; o: Uint32Array; gate: Uint32Array; up: Uint32Array; down: Uint32Array;
  inNorm: Float32Array; postNorm: Float32Array; qNorm: Float32Array; kNorm: Float32Array;
}

export interface CpuModel {
  cfg: ModelConfig;
  dict: Uint32Array;
  finalNorm: Float32Array;
  meanRow: Float32Array;
  floors: CpuFloor[];
  concepts?: Map<string, Float32Array[]>;
  rho?: number[];
}

function rnd(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296 - 0.5;
  };
}

export function synthModel(cfg: ModelConfig, seed = 1): CpuModel {
  const r = rnd(seed);
  const W = cfg.width, H = cfg.queryHeads, D = cfg.headSize, KV = cfg.kvHeads, U = cfg.units, G = cfg.group;
  const mat = (o: number, i: number, scale: number) => {
    const a = new Float32Array(o * i);
    for (let j = 0; j < a.length; j++) a[j] = r() * scale;
    return packQ4(a, o, i, G);
  };
  const norm = (n: number) => Float32Array.from({ length: n }, () => 1 + r() * 0.4);
  const dictF = new Float32Array(cfg.vocabRows * W);
  for (let j = 0; j < dictF.length; j++) dictF[j] = r() * 0.8;
  const dict = packQ4(dictF, cfg.vocabRows, W, G);
  const dd = deqQ4(dict, cfg.vocabRows, W, G);
  const meanRow = new Float32Array(W);
  for (let i = 0; i < W; i++) {
    let s = 0;
    for (let t = 0; t < cfg.vocabReal; t++) s += dd[t * W + i];
    meanRow[i] = s / cfg.vocabReal;
  }
  const floors: CpuFloor[] = [];
  for (let L = 0; L < cfg.floors; L++) {
    floors.push({
      q: mat(H * D, W, 0.3), k: mat(KV * D, W, 0.3), v: mat(KV * D, W, 0.3), o: mat(W, H * D, 0.2),
      gate: mat(U, W, 0.3), up: mat(U, W, 0.3), down: mat(W, U, 0.2),
      inNorm: norm(W), postNorm: norm(W), qNorm: norm(D), kNorm: norm(D),
    });
  }
  const concepts = new Map<string, Float32Array[]>();
  const vecs: Float32Array[] = [];
  for (let L = 0; L < cfg.floors; L++) {
    const v = Float32Array.from({ length: W }, () => r());
    const n = Math.hypot(...v);
    vecs.push(v.map((x) => x / n));
  }
  concepts.set("test", vecs);
  return { cfg, dict, finalNorm: norm(W), meanRow, floors, concepts, rho: Array.from({ length: cfg.floors }, () => 2) };
}

interface Run {
  scores: Float64Array;
  pushes: Float64Array;
  final: Float64Array;
}

/** Forward over the whole token list; returns the last position's scores and its parts' pushes toward `toward`. */
export function cpuForward(m: CpuModel, tokens: number[], spec: ChangeSpec = {}, toward?: number, conceptFirst = 0) {
  const cfg = m.cfg, W = cfg.width, H = cfg.queryHeads, D = cfg.headSize, KV = cfg.kvHeads, U = cfg.units, G = cfg.group;
  const table = bitTable(spec.bits ?? 4);
  const swap = new Map<number, number>();
  for (const [a, b] of spec.swaps ?? []) { swap.set(a, b); swap.set(b, a); }
  const sw = (t: number) => swap.get(t) ?? t;
  const headMult = (L: number, h: number) => spec.heads?.find((x) => x.floor === L && x.head === h)?.mult ?? 1;
  const memMult = (L: number) => spec.memory?.find((x) => x.floor === L)?.mult ?? 1;
  const floorMult = (L: number) => spec.floors?.find((x) => x.floor === L)?.mult ?? 1;
  const dict = deqQ4(m.dict, cfg.vocabRows, W, G);
  const mats = m.floors.map((f) => ({
    q: deqQ4(f.q, H * D, W, G, table), k: deqQ4(f.k, KV * D, W, G, table), v: deqQ4(f.v, KV * D, W, G, table),
    o: deqQ4(f.o, W, H * D, G, table), gate: deqQ4(f.gate, U, W, G, table), up: deqQ4(f.up, U, W, G, table),
    down: deqQ4(f.down, W, U, G, table),
  }));
  for (const z of spec.zeroed ?? []) {
    const dims: Record<TensorName, number> = { q: W, k: W, v: W, o: H * D, gate: W, up: W, down: U };
    mats[z.floor][z.tensor][z.row * dims[z.tensor] + z.col] = 0;
  }
  void TENSORS; void TENSOR_ID;
  const rms = (x: Float64Array, w: Float32Array) => {
    let s = 0;
    for (const v of x) s += v * v;
    const r = 1 / Math.sqrt(s / x.length + cfg.eps);
    return { y: x.map((v, i) => v * r * w[i]), r };
  };
  const mv = (A: Float64Array, x: Float64Array, out: number) => {
    const inp = x.length, y = new Float64Array(out);
    for (let r = 0; r < out; r++) { let s = 0; for (let i = 0; i < inp; i++) s += A[r * inp + i] * x[i]; y[r] = s; }
    return y;
  };
  // rope table (float32)
  const rope = (pos: number, i: number) => {
    const inv = 1 / cfg.ropeTheta ** ((2 * i) / D);
    return [Math.fround(Math.cos(pos * inv)), Math.fround(Math.sin(pos * inv))];
  };
  const T = tokens.length;
  const kc: Float64Array[][] = [], vc: Float64Array[][] = [];
  let xs: Float64Array[] = tokens.map((t) => dict.slice(sw(t) * W, sw(t) * W + W));
  const lastParts: { heads: Float64Array[]; mem: Float64Array; a: number }[] = [];
  for (let L = 0; L < cfg.floors; L++) {
    const f = m.floors[L], M = mats[L];
    kc.push([]); vc.push([]);
    const a = floorMult(L);
    const out: Float64Array[] = [];
    // keys and values for all positions first
    const qs: Float64Array[] = [];
    for (let p = 0; p < T; p++) {
      if (spec.concept && spec.concept.floor === L && p >= conceptFirst) {
        const v = m.concepts!.get(spec.concept.id)![L];
        const sc = Math.fround(spec.concept.strength * m.rho![L]);
        xs[p] = xs[p].map((x, i) => x + sc * v[i]);
      }
      const h = rms(xs[p], f.inNorm).y;
      const q = mv(M.q, h, H * D), k = mv(M.k, h, KV * D), v = mv(M.v, h, KV * D);
      const nr = (vec: Float64Array, w: Float32Array) => {
        const n = rms(vec, w).y;
        const o = new Float64Array(D);
        for (let d = 0; d < D; d++) {
          const i = d % (D / 2);
          const [c, s] = rope(p, i);
          o[d] = d < D / 2 ? n[d] * c - n[d + D / 2] * s : n[d] * c + n[d - D / 2] * s;
        }
        return o;
      };
      const qh = new Float64Array(H * D);
      for (let hh = 0; hh < H; hh++) qh.set(nr(q.slice(hh * D, hh * D + D), f.qNorm), hh * D);
      const kh = new Float64Array(KV * D);
      for (let hh = 0; hh < KV; hh++) kh.set(nr(k.slice(hh * D, hh * D + D), f.kNorm), hh * D);
      kc[L].push(kh.map(roundF16));
      vc[L].push(v.map(roundF16));
      qs.push(qh);
    }
    for (let p = 0; p < T; p++) {
      const att = new Float64Array(H * D);
      for (let hh = 0; hh < H; hh++) {
        const kv = Math.floor(hh / (H / KV));
        const sc: number[] = [];
        for (let j = 0; j <= p; j++) {
          const hidden = (spec.hidden ?? []).some((r) => r.key === j && p >= r.from);
          if (hidden) { sc.push(-Infinity); continue; }
          let s = 0;
          for (let d = 0; d < D; d++) s += qs[p][hh * D + d] * kc[L][j][kv * D + d];
          sc.push(s / Math.sqrt(D));
        }
        const mx = Math.max(...sc);
        if (mx === -Infinity) continue;
        const e = sc.map((s) => (s === -Infinity ? 0 : Math.exp(s - mx)));
        const tot = e.reduce((x, y) => x + y, 0);
        for (let d = 0; d < D; d++) {
          let s = 0;
          for (let j = 0; j <= p; j++) s += (e[j] / tot) * vc[L][j][kv * D + d];
          att[hh * D + d] = s * headMult(L, hh);
        }
      }
      const o = mv(M.o, att, W);
      const mid = xs[p].map((x, i) => x + a * o[i]);
      const h2 = rms(mid, f.postNorm).y;
      const g = mv(M.gate, h2, U), u = mv(M.up, h2, U);
      const act = g.map((gv, i) => (gv / (1 + Math.exp(-gv))) * u[i]);
      const mm = mv(M.down, act, W).map((v) => v * memMult(L));
      out.push(mid.map((x, i) => x + a * mm[i]));
      if (p === T - 1) {
        const heads: Float64Array[] = [];
        for (let hh = 0; hh < H; hh++) {
          const ph = new Float64Array(W);
          for (let r = 0; r < W; r++) { let s = 0; for (let d = 0; d < D; d++) s += M.o[r * H * D + hh * D + d] * att[hh * D + d]; ph[r] = s; }
          heads.push(ph);
        }
        lastParts.push({ heads, mem: mm, a });
      }
    }
    xs = out;
  }
  const final = xs[T - 1];
  const { y: xn, r: rinv } = rms(final, m.finalNorm);
  const raw = new Float64Array(cfg.vocabRows);
  for (let t = 0; t < cfg.vocabRows; t++) { let s = 0; for (let i = 0; i < W; i++) s += dict[t * W + i] * xn[i]; raw[t] = s; }
  const scores = raw.map((_, t) => raw[sw(t)]);
  for (let t = cfg.vocabReal; t < cfg.vocabRows; t++) scores[t] = -Infinity;
  let pushes = new Float64Array(0);
  if (toward !== undefined) {
    const tr = sw(toward);
    const u = new Float64Array(W).map((_, i) => (dict[tr * W + i] - m.meanRow[i]) * m.finalNorm[i] * rinv);
    const dot = (a: Float64Array) => a.reduce((s, v, i) => s + v * u[i], 0);
    const inT = sw(tokens[T - 1]);
    const res = [dot(dict.slice(inT * W, inT * W + W))];
    for (const lp of lastParts) {
      for (const hp of lp.heads) res.push(lp.a * dot(hp));
      res.push(lp.a * dot(lp.mem));
    }
    pushes = Float64Array.from(res);
  }
  return { scores, pushes, final } as Run;
}
