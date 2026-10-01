// WGSL kernels. Math in float32; half-precision storage is packed into u32 words with
// pack2x16float / unpack2x16float, so the engine needs no shader-f16 feature.
//
// Weight tensors (section 7.4): row-major [out, in], groups along the input. A tensor buffer holds
// the codes (8 four-bit codes per u32, low nibble first; or 4 eight-bit codes per u32) followed by one
// u32 per group with the scale in the low half and the offset in the high half. A weight is
// offset + scale * t[code], where t is the bits table of the change table (identity for 4 bits).
// Float32 tensors (the tiny model) are plain row-major arrays.
//
// Step parameters (SP, read-only storage, written before each submit):
//   0 T (tokens in this pass)  1 pos0 (position of the first)  2 len (keys visible: pos0 + T)
//   3 seed  4 turn  5 step  6 temperature (f32 bits)  7 top_k  8 top_p (f32 bits)  9 row (inspected / last row)
//  10 vocab_real  11 keylimit (inspection: keys visible to the inspected row)

import { MAX_HIDDEN, MAX_SWAPS, MAX_ZEROED, type ModelConfig, type TableLayout } from "./config.ts";

export interface KernelConsts {
  cfg: ModelConfig;
  lay: TableLayout;
}

function header({ lay }: KernelConsts) {
  return /* wgsl */ `
const L_HEAD: u32 = ${lay.head}u;
const L_MEM: u32 = ${lay.mem}u;
const L_FLOOR: u32 = ${lay.floor}u;
const L_CONCEPT: u32 = ${lay.concept}u;
const L_SWAPS: u32 = ${lay.swaps}u;
const L_HIDDEN: u32 = ${lay.hidden}u;
const L_ZEROED: u32 = ${lay.zeroed}u;
const L_BITS: u32 = ${lay.bitTable}u;
fn ctf(i: u32) -> f32 { return bitcast<f32>(ct[i]); }
fn swapped(id: u32) -> u32 {
  let n = min(ct[7], ${MAX_SWAPS}u);
  for (var i = 0u; i < n; i++) {
    if (ct[L_SWAPS + 2u * i] == id) { return ct[L_SWAPS + 2u * i + 1u]; }
    if (ct[L_SWAPS + 2u * i + 1u] == id) { return ct[L_SWAPS + 2u * i]; }
  }
  return id;
}`;
}

/** Reads one dictionary row element: q4, q8 or f32. */
function dictRead(c: KernelConsts) {
  const W = c.cfg.width;
  if (c.cfg.dictBits === 32) return `fn dict_at(row: u32, i: u32) -> f32 { return bitcast<f32>(dict[row * ${W}u + i]); }`;
  if (c.cfg.dictBits === 8) {
    const words = (c.cfg.vocabRows * W) / 4;
    return `fn dict_at(row: u32, i: u32) -> f32 {
  let w = dict[row * ${W / 4}u + i / 4u];
  let code = f32((w >> (8u * (i % 4u))) & 255u);
  let p = unpack2x16float(dict[${words}u + row * ${W / c.cfg.group}u + i / ${c.cfg.group}u]);
  return p.y + p.x * code;
}`;
  }
  const words = (c.cfg.vocabRows * W) / 8;
  return `fn dict_at(row: u32, i: u32) -> f32 {
  let w = dict[row * ${W / 8}u + i / 8u];
  let code = f32((w >> (4u * (i % 8u))) & 15u);
  let p = unpack2x16float(dict[${words}u + row * ${W / c.cfg.group}u + i / ${c.cfg.group}u]);
  return p.y + p.x * code;
}`;
}

/** Embedding: x[t] = dictionary row of the (swapped) token. One workgroup per token. */
export function embedKernel(c: KernelConsts) {
  const W = c.cfg.width;
  return /* wgsl */ `
@group(0) @binding(0) var<storage, read> tokens: array<u32>;
@group(0) @binding(1) var<storage, read> dict: array<u32>;
@group(0) @binding(2) var<storage, read> ct: array<u32>;
@group(0) @binding(3) var<uniform> SP: array<vec4u, 4>;
fn sp(i: u32) -> u32 { return SP[i / 4u][i % 4u]; }
@group(0) @binding(4) var<storage, read_write> x: array<f32>;
${header(c)}
${dictRead(c)}
@compute @workgroup_size(256)
fn main(@builtin(workgroup_id) wg: vec3u, @builtin(local_invocation_index) li: u32) {
  let t = wg.x;
  if (t >= sp(0)) { return; }
  let row = swapped(tokens[t]);
  for (var i = li; i < ${W}u; i += 256u) { x[t * ${W}u + i] = dict_at(row, i); }
}`;
}

/** Enter floor L: add the concept to the stream when it applies, then h = rmsnorm(x) * w. */
export function enterFloorKernel(c: KernelConsts) {
  const W = c.cfg.width;
  return /* wgsl */ `
struct FP { floor: u32, a: u32, b: u32, c: u32 }
@group(0) @binding(0) var<storage, read_write> x: array<f32>;
@group(0) @binding(1) var<storage, read> w: array<f32>;
@group(0) @binding(2) var<storage, read> ct: array<u32>;
@group(0) @binding(3) var<uniform> SP: array<vec4u, 4>;
fn sp(i: u32) -> u32 { return SP[i / 4u][i % 4u]; }
@group(0) @binding(4) var<storage, read_write> h: array<f32>;
@group(0) @binding(5) var<uniform> F: FP;
${header(c)}
var<workgroup> red: array<f32, 256>;
@compute @workgroup_size(256)
fn main(@builtin(workgroup_id) wg: vec3u, @builtin(local_invocation_index) li: u32) {
  let t = wg.x;
  if (t >= sp(0)) { return; }
  let pos = sp(1) + t;
  let add = ct[4] == F.floor && pos >= ct[6];
  let scale = ctf(5u);
  var ss = 0.0;
  for (var i = li; i < ${W}u; i += 256u) {
    var v = x[t * ${W}u + i];
    if (add) { v = v + scale * ctf(L_CONCEPT + i); x[t * ${W}u + i] = v; }
    ss += v * v;
  }
  red[li] = ss;
  workgroupBarrier();
  for (var s = 128u; s > 0u; s >>= 1u) {
    if (li < s) { red[li] += red[li + s]; }
    workgroupBarrier();
  }
  let r = inverseSqrt(red[0] / ${W}.0 + ${c.cfg.eps});
  for (var i = li; i < ${W}u; i += 256u) { h[t * ${W}u + i] = x[t * ${W}u + i] * r * w[i]; }
}`;
}

/** Plain rmsnorm of rows: out = x * rsqrt(mean(x^2) + eps) * w. Also writes 1/rms per row. */
export function rmsKernel(c: KernelConsts, width = c.cfg.width) {
  return /* wgsl */ `
@group(0) @binding(0) var<storage, read> x: array<f32>;
@group(0) @binding(1) var<storage, read> w: array<f32>;
@group(0) @binding(2) var<uniform> SP: array<vec4u, 4>;
fn sp(i: u32) -> u32 { return SP[i / 4u][i % 4u]; }
@group(0) @binding(3) var<storage, read_write> out: array<f32>;
@group(0) @binding(4) var<storage, read_write> rinv: array<f32>;
var<workgroup> red: array<f32, 256>;
@compute @workgroup_size(256)
fn main(@builtin(workgroup_id) wg: vec3u, @builtin(local_invocation_index) li: u32) {
  let t = wg.x;
  if (t >= sp(0)) { return; }
  var ss = 0.0;
  for (var i = li; i < ${width}u; i += 256u) { let v = x[t * ${width}u + i]; ss += v * v; }
  red[li] = ss;
  workgroupBarrier();
  for (var s = 128u; s > 0u; s >>= 1u) {
    if (li < s) { red[li] += red[li + s]; }
    workgroupBarrier();
  }
  let r = inverseSqrt(red[0] / ${width}.0 + ${c.cfg.eps});
  if (li == 0u) { rinv[t] = r; }
  for (var i = li; i < ${width}u; i += 256u) { out[t * ${width}u + i] = x[t * ${width}u + i] * r * w[i]; }
}`;
}

/**
 * Matrix multiply y[t, r] = sum_i W[r, i] x[t, i] for 4-bit (or 8-bit, or float32) weights.
 * 256 threads = 8 rows x 32 lanes; each workgroup handles TB tokens. The zeroed-weight fixups of the
 * change table are applied for this floor and tensor. `table` selects the bits table (floors) or the
 * identity (dictionary). With `gateup`, two matrices are read for the same rows and
 * y = silu(gate) * up is written (the memory block's first half).
 */
export function matmulKernel(c: KernelConsts, o: { inDim: number; outDim: number; TB: number; bits: 4 | 8 | 32;
  table: boolean; gateup?: boolean; group?: number; swapOut?: boolean }) {
  const { inDim: IN, outDim: OUT, TB } = o;
  const G = o.group ?? c.cfg.group;
  const second = o.gateup ? "@group(0) @binding(6) var<storage, read> W2: array<u32>;" : "";
  const perWord = o.bits === 4 ? 8 : o.bits === 8 ? 4 : 1;
  const words = IN / perWord;
  const codeWords = (OUT * IN) / perWord;
  const accDecl = Array.from({ length: TB }, (_, i) => `var a${i} = 0.0;${o.gateup ? ` var b${i} = 0.0;` : ""}`).join(" ");
  // per-word body
  let body: string;
  if (o.bits === 32) {
    body = Array.from({ length: TB }, (_, i) => `
      if (t0 + ${i}u < T) { let xv = x[(t0 + ${i}u) * ${IN}u + k];
        a${i} += bitcast<f32>(W[row * ${IN}u + k]) * xv;${o.gateup ? ` b${i} += bitcast<f32>(W2[row * ${IN}u + k]) * xv;` : ""} }`).join("");
  } else {
    const deq = (wv: string, pv: string, pfx: string) => `
      let ${pfx}p = unpack2x16float(${pv});
      ${Array.from({ length: perWord }, (_, j) => `let ${pfx}c${j} = cv((${wv} >> ${(32 / perWord) * j}u) & ${o.bits === 4 ? 15 : 255}u);`).join(" ")}`;
    const tblExpr = o.bits === 8 ? "" : "";
    void tblExpr;
    body = `
      let wv = W[row * ${words}u + k];
      let pv = W[${codeWords}u + row * ${IN / G}u + (k * ${perWord}u) / ${G}u];
      ${deq("wv", "pv", "w")}
      ${o.gateup ? `let wv2 = W2[row * ${words}u + k]; let pv2 = W2[${codeWords}u + row * ${IN / G}u + (k * ${perWord}u) / ${G}u]; ${deq("wv2", "pv2", "v")}` : ""}
      ${Array.from({ length: TB }, (_, i) => `
      if (t0 + ${i}u < T) {
        let base = (t0 + ${i}u) * ${IN}u + k * ${perWord}u;
        ${Array.from({ length: perWord }, (_, j) => `let x${j} = x[base + ${j}u];`).join(" ")}
        let sx = ${Array.from({ length: perWord }, (_, j) => `x${j}`).join(" + ")};
        a${i} += wp.y * sx + wp.x * (${Array.from({ length: perWord }, (_, j) => `wc${j} * x${j}`).join(" + ")});
        ${o.gateup ? `b${i} += vp.y * sx + vp.x * (${Array.from({ length: perWord }, (_, j) => `vc${j} * x${j}`).join(" + ")});` : ""}
      }`).join("")}`;
  }
  const useTable = o.bits === 4 && o.table;
  const tblInit = useTable ? `for (var i = 0u; i < 16u; i++) { tbl[i] = ctf(L_BITS + i); }` : "";
  const cvFn = useTable ? "var<private> tbl: array<f32, 16>;\nfn cv(c: u32) -> f32 { return tbl[c]; }" : "fn cv(c: u32) -> f32 { return f32(c); }";
  const weightAt = o.bits === 32
    ? `fn weight_at(r: u32, col: u32, second: bool) -> f32 { ${o.gateup ? "if (second) { return bitcast<f32>(W2[r * " + IN + "u + col]); }" : ""} return bitcast<f32>(W[r * ${IN}u + col]); }`
    : `fn weight_at(r: u32, col: u32, second: bool) -> f32 {
  var w = W[r * ${words}u + col / ${perWord}u]; var p = W[${codeWords}u + r * ${IN / G}u + col / ${G}u];
  ${o.gateup ? `if (second) { w = W2[r * ${words}u + col / ${perWord}u]; p = W2[${codeWords}u + r * ${IN / G}u + col / ${G}u]; }` : ""}
  let code = (w >> (${32 / perWord}u * (col % ${perWord}u))) & ${o.bits === 4 ? 15 : 255}u;
  let pp = unpack2x16float(p);
  ${o.bits === 4 && o.table ? "return pp.y + pp.x * ctf(L_BITS + code);" : "return pp.y + pp.x * f32(code);"}
}`;
  const reduceStore = Array.from({ length: TB }, (_, i) => `red[li * ${TB}u + ${i}u] = a${i};${o.gateup ? ` red2[li * ${TB}u + ${i}u] = b${i};` : ""}`).join(" ");
  return /* wgsl */ `
struct FP { floor: u32, tensor: u32, tensor2: u32, c: u32 }
@group(0) @binding(0) var<storage, read> W: array<u32>;
@group(0) @binding(1) var<storage, read> x: array<f32>;
@group(0) @binding(2) var<storage, read_write> y: array<f32>;
@group(0) @binding(3) var<storage, read> ct: array<u32>;
@group(0) @binding(4) var<uniform> SP: array<vec4u, 4>;
fn sp(i: u32) -> u32 { return SP[i / 4u][i % 4u]; }
@group(0) @binding(5) var<uniform> F: FP;
${second}
${header(c)}
${o.bits === 32 ? "" : cvFn}
${weightAt}
var<workgroup> red: array<f32, ${256 * TB}>;
${o.gateup ? `var<workgroup> red2: array<f32, ${256 * TB}>;` : ""}
fn fix(t: u32, r: u32, v: f32, tensor: u32, second: bool) -> f32 {
  var out = v;
  let n = min(ct[9], ${MAX_ZEROED}u);
  for (var i = 0u; i < n; i++) {
    let z = L_ZEROED + 4u * i;
    if (ct[z] == F.floor && ct[z + 1u] == tensor && ct[z + 2u] == r) {
      let col = ct[z + 3u];
      out = out - weight_at(r, col, second) * x[t * ${IN}u + col];
    }
  }
  return out;
}
@compute @workgroup_size(256)
fn main(@builtin(workgroup_id) wg: vec3u, @builtin(local_invocation_index) li: u32) {
  _ = F.floor;
  let T = sp(0);
  if (wg.y * ${TB}u >= T) { return; }
  let lane = li % 32u;
  let rloc = li / 32u;
  let row = wg.x * 8u + rloc;
  let t0 = wg.y * ${TB}u;
  ${tblInit}
  ${accDecl}
  if (row < ${OUT}u) {
    for (var k = lane; k < ${o.bits === 32 ? IN : words}u; k += 32u) {${body}
    }
  }
  ${reduceStore}
  workgroupBarrier();
  if (lane < ${TB}u && row < ${OUT}u) {
    let t = t0 + lane;
    if (t < T) {
      var s = 0.0;
      ${o.gateup ? "var s2 = 0.0;" : ""}
      for (var j = 0u; j < 32u; j++) {
        s += red[(rloc * 32u + j) * ${TB}u + lane];
        ${o.gateup ? `s2 += red2[(rloc * 32u + j) * ${TB}u + lane];` : ""}
      }
      ${o.gateup
        ? `let g = fix(t, row, s, F.tensor, false); let u = fix(t, row, s2, F.tensor2, true);
      y[t * ${OUT}u + row] = g / (1.0 + exp(-g)) * u;`
        : o.swapOut ? `y[t * ${OUT}u + swapped(row)] = s;` : `y[t * ${OUT}u + row] = fix(t, row, s, F.tensor, false);`}
    }
  }
}`;
}

/**
 * Output projection for one token, keeping each head's contribution: part[h, r] = sum over the
 * head's 128 inputs; o[r] = sum over heads. 256 threads = 16 rows x 16 heads.
 */
export function oHeadsKernel(c: KernelConsts) {
  const H = c.cfg.queryHeads, D = c.cfg.headSize, W = c.cfg.width, IN = H * D;
  const f32w = c.cfg.floorBits === 32;
  const G = c.cfg.group;
  const words = IN / 8, codeWords = (W * IN) / 8;
  const wgRows = Math.floor(256 / H);
  const inner = f32w
    ? `for (var i = 0u; i < ${D}u; i++) { let col = h * ${D}u + i; acc += bitcast<f32>(W[row * ${IN}u + col]) * att[t * ${IN}u + col]; }`
    : `for (var k = h * ${D / 8}u; k < (h + 1u) * ${D / 8}u; k++) {
        let wv = W[row * ${words}u + k];
        let p = unpack2x16float(W[${codeWords}u + row * ${IN / G}u + (k * 8u) / ${G}u]);
        var d = 0.0; var sx = 0.0;
        for (var j = 0u; j < 8u; j++) { let xv = att[t * ${IN}u + k * 8u + j]; sx += xv; d += tbl[(wv >> (4u * j)) & 15u] * xv; }
        acc += p.y * sx + p.x * d;
      }`;
  return /* wgsl */ `
struct FP { floor: u32, tensor: u32, tensor2: u32, c: u32 }
@group(0) @binding(0) var<storage, read> W: array<u32>;
@group(0) @binding(1) var<storage, read> att: array<f32>;
@group(0) @binding(2) var<storage, read_write> o: array<f32>;
@group(0) @binding(3) var<storage, read> ct: array<u32>;
@group(0) @binding(4) var<uniform> SP: array<vec4u, 4>;
fn sp(i: u32) -> u32 { return SP[i / 4u][i % 4u]; }
@group(0) @binding(5) var<uniform> F: FP;
@group(0) @binding(6) var<storage, read_write> part: array<f32>;
${header(c)}
var<workgroup> red: array<f32, 256>;
fn weight_at(r: u32, col: u32) -> f32 {
  ${f32w ? `return bitcast<f32>(W[r * ${IN}u + col]);` : `let w = W[r * ${words}u + col / 8u];
  let pp = unpack2x16float(W[${codeWords}u + r * ${IN / G}u + col / ${G}u]);
  return pp.y + pp.x * ctf(L_BITS + ((w >> (4u * (col % 8u))) & 15u));`}
}
@compute @workgroup_size(256)
fn main(@builtin(workgroup_id) wg: vec3u, @builtin(local_invocation_index) li: u32) {
  let t = sp(9);
  let h = li % ${H}u;
  let rl = li / ${H}u;
  let row = wg.x * ${wgRows}u + rl;
  ${f32w ? "" : "var tbl: array<f32, 16>; for (var i = 0u; i < 16u; i++) { tbl[i] = ctf(L_BITS + i); }"}
  var acc = 0.0;
  if (row < ${W}u && rl < ${wgRows}u) {
    ${inner}
    let n = min(ct[9], ${MAX_ZEROED}u);
    for (var i = 0u; i < n; i++) {
      let z = L_ZEROED + 4u * i;
      if (ct[z] == F.floor && ct[z + 1u] == 3u && ct[z + 2u] == row && ct[z + 3u] / ${D}u == h) {
        acc -= weight_at(row, ct[z + 3u]) * att[t * ${IN}u + ct[z + 3u]];
      }
    }
    part[h * ${W}u + row] = acc;
  }
  red[li] = acc;
  workgroupBarrier();
  if (h == 0u && row < ${W}u && rl < ${wgRows}u) {
    var s = 0.0;
    for (var j = 0u; j < ${H}u; j++) { s += red[rl * ${H}u + j]; }
    o[t * ${W}u + row] = s;
  }
}`;
}

/**
 * Query and key normalization, position rotation, and the cache write (keys and values as halves).
 * One workgroup per token; 128 threads, one per dimension of a head.
 */
export function qkRopeKernel(c: KernelConsts) {
  const H = c.cfg.queryHeads, KV = c.cfg.kvHeads, D = c.cfg.headSize, HALF = D / 2;
  const maxCtx = c.cfg.maxContext;
  return /* wgsl */ `
@group(0) @binding(0) var<storage, read_write> q: array<f32>;
@group(0) @binding(1) var<storage, read> k: array<f32>;
@group(0) @binding(2) var<storage, read> v: array<f32>;
@group(0) @binding(3) var<storage, read> qkn: array<f32>;
@group(0) @binding(4) var<storage, read> rope: array<f32>;
@group(0) @binding(5) var<uniform> SP: array<vec4u, 4>;
fn sp(i: u32) -> u32 { return SP[i / 4u][i % 4u]; }
@group(0) @binding(6) var<storage, read_write> kc: array<u32>;
@group(0) @binding(7) var<storage, read_write> vc: array<u32>;
@group(0) @binding(8) var<storage, read_write> kout: array<f32>;
var<workgroup> buf: array<f32, ${D}>;
var<workgroup> red: array<f32, ${D}>;
fn norm_rot(val: f32, w: f32, d: u32, pos: u32) -> f32 {
  red[d] = val * val;
  workgroupBarrier();
  for (var s = ${D / 2}u; s > 0u; s >>= 1u) {
    if (d < s) { red[d] += red[d + s]; }
    workgroupBarrier();
  }
  let r = inverseSqrt(red[0] / ${D}.0 + ${c.cfg.eps});
  let nv = val * r * w;
  buf[d] = nv;
  workgroupBarrier();
  let i = d % ${HALF}u;
  let cs = rope[pos * ${D}u + i];
  let sn = rope[pos * ${D}u + ${HALF}u + i];
  var out: f32;
  if (d < ${HALF}u) { out = nv * cs - buf[d + ${HALF}u] * sn; } else { out = nv * cs + buf[d - ${HALF}u] * sn; }
  workgroupBarrier();
  return out;
}
@compute @workgroup_size(${D})
fn main(@builtin(workgroup_id) wg: vec3u, @builtin(local_invocation_index) d: u32) {
  let t = wg.x;
  if (t >= sp(0)) { return; }
  let pos = sp(1) + t;
  for (var h = 0u; h < ${H}u; h++) {
    let idx = t * ${H * D}u + h * ${D}u + d;
    let r = norm_rot(q[idx], qkn[d], d, pos);
    q[idx] = r;
  }
  for (var h = 0u; h < ${KV}u; h++) {
    let idx = t * ${KV * D}u + h * ${D}u + d;
    let r = norm_rot(k[idx], qkn[${D}u + d], d, pos);
    kout[idx] = r;
    buf[d] = r;
    workgroupBarrier();
    if (d < ${HALF}u) {
      let base = (h * ${maxCtx}u + pos) * ${HALF}u + d;
      kc[base] = pack2x16float(vec2f(buf[2u * d], buf[2u * d + 1u]));
      vc[base] = pack2x16float(vec2f(v[t * ${KV * D}u + h * ${D}u + 2u * d], v[t * ${KV * D}u + h * ${D}u + 2u * d + 1u]));
    }
    workgroupBarrier();
  }
}`;
}

/**
 * Attention for T queries (one workgroup per query and head), over the half-precision cache.
 * Hidden words are skipped; a query left with nothing to look at outputs zero. The head multiplier
 * scales the output. With `capture`, the attention row is also written out (inspection).
 */
export function attentionKernel(c: KernelConsts, capture = false) {
  const H = c.cfg.queryHeads, KV = c.cfg.kvHeads, D = c.cfg.headSize, HALF = D / 2;
  const maxCtx = c.cfg.maxContext;
  const group = H / KV;
  return /* wgsl */ `
struct FP { floor: u32, a: u32, b: u32, c: u32 }
@group(0) @binding(0) var<storage, read> q: array<f32>;
@group(0) @binding(1) var<storage, read> kc: array<u32>;
@group(0) @binding(2) var<storage, read> vc: array<u32>;
@group(0) @binding(3) var<storage, read> ct: array<u32>;
@group(0) @binding(4) var<uniform> SP: array<vec4u, 4>;
fn sp(i: u32) -> u32 { return SP[i / 4u][i % 4u]; }
@group(0) @binding(5) var<uniform> F: FP;
@group(0) @binding(6) var<storage, read_write> att: array<f32>;
${capture ? "@group(0) @binding(7) var<storage, read_write> rows: array<f32>;" : ""}
${header(c)}
var<workgroup> sc: array<f32, ${maxCtx}>;
var<workgroup> qv: array<f32, ${D}>;
var<workgroup> red: array<f32, 256>;
fn hidden(key: u32, qpos: u32) -> bool {
  let n = min(ct[8], ${MAX_HIDDEN}u);
  for (var i = 0u; i < n; i++) {
    if (ct[L_HIDDEN + 2u * i] == key && qpos >= ct[L_HIDDEN + 2u * i + 1u]) { return true; }
  }
  return false;
}
@compute @workgroup_size(256)
fn main(@builtin(workgroup_id) wg: vec3u, @builtin(local_invocation_index) li: u32) {
  let t = wg.x;
  let h = wg.y;
  if (t >= sp(0)) { return; }
  let qpos = sp(1) + t;
  let n = min(qpos + 1u, sp(11));
  let kvh = h / ${group}u;
  if (li < ${D}u) { qv[li] = q[t * ${H * D}u + h * ${D}u + li]; }
  workgroupBarrier();
  var mx = -3.0e38;
  for (var j = li; j < n; j += 256u) {
    var s = -3.0e38;
    if (!hidden(j, qpos)) {
      let base = (kvh * ${maxCtx}u + j) * ${HALF}u;
      var d = 0.0;
      for (var i = 0u; i < ${HALF}u; i++) {
        let kk = unpack2x16float(kc[base + i]);
        d += qv[2u * i] * kk.x + qv[2u * i + 1u] * kk.y;
      }
      s = d * ${1 / Math.sqrt(D)};
    }
    sc[j] = s;
    mx = max(mx, s);
  }
  red[li] = mx;
  workgroupBarrier();
  for (var s = 128u; s > 0u; s >>= 1u) {
    if (li < s) { red[li] = max(red[li], red[li + s]); }
    workgroupBarrier();
  }
  let m = red[0];
  workgroupBarrier();
  var sum = 0.0;
  for (var j = li; j < n; j += 256u) {
    var p = 0.0;
    if (sc[j] > -1.0e38) { p = exp(sc[j] - m); }
    sc[j] = p;
    sum += p;
  }
  red[li] = sum;
  workgroupBarrier();
  for (var s = 128u; s > 0u; s >>= 1u) {
    if (li < s) { red[li] += red[li + s]; }
    workgroupBarrier();
  }
  let total = red[0];
  workgroupBarrier();
  let inv = select(0.0, 1.0 / total, total > 0.0);
  ${capture ? `for (var j = li; j < n; j += 256u) { rows[h * ${maxCtx}u + j] = sc[j] * inv; }` : ""}
  // value mix: 256 threads = 2 halves x 128 dims... dims as pairs: thread covers one pair for one half of the keys
  let pair = li % ${HALF}u;
  let part = li / ${HALF}u;
  let parts = 256u / ${HALF}u;
  var a0 = 0.0; var a1 = 0.0;
  for (var j = part; j < n; j += parts) {
    let p = sc[j];
    if (p != 0.0) {
      let vv = unpack2x16float(vc[(kvh * ${maxCtx}u + j) * ${HALF}u + pair]);
      a0 += p * vv.x; a1 += p * vv.y;
    }
  }
  workgroupBarrier();
  red[li] = a0;
  workgroupBarrier();
  var s0 = 0.0;
  if (part == 0u) { for (var k = 0u; k < parts; k++) { s0 += red[k * ${HALF}u + pair]; } }
  workgroupBarrier();
  red[li] = a1;
  workgroupBarrier();
  if (part == 0u) {
    var s1 = 0.0;
    for (var k = 0u; k < parts; k++) { s1 += red[k * ${HALF}u + pair]; }
    let mult = ctf(L_HEAD + F.floor * ${H}u + h);
    att[t * ${H * D}u + h * ${D}u + 2u * pair] = s0 * inv * mult;
    att[t * ${H * D}u + h * ${D}u + 2u * pair + 1u] = s1 * inv * mult;
  }
}`;
}

/** mid = x + a * o; h2 = rmsnorm(mid) * w_post. One workgroup per token. */
export function attnResidualKernel(c: KernelConsts) {
  const W = c.cfg.width;
  return /* wgsl */ `
struct FP { floor: u32, a: u32, b: u32, c: u32 }
@group(0) @binding(0) var<storage, read> x: array<f32>;
@group(0) @binding(1) var<storage, read> o: array<f32>;
@group(0) @binding(2) var<storage, read> w: array<f32>;
@group(0) @binding(3) var<storage, read> ct: array<u32>;
@group(0) @binding(4) var<uniform> SP: array<vec4u, 4>;
fn sp(i: u32) -> u32 { return SP[i / 4u][i % 4u]; }
@group(0) @binding(5) var<uniform> F: FP;
@group(0) @binding(6) var<storage, read_write> mid: array<f32>;
@group(0) @binding(7) var<storage, read_write> h2: array<f32>;
${header(c)}
var<workgroup> red: array<f32, 256>;
@compute @workgroup_size(256)
fn main(@builtin(workgroup_id) wg: vec3u, @builtin(local_invocation_index) li: u32) {
  let t = wg.x;
  if (t >= sp(0)) { return; }
  let a = ctf(L_FLOOR + F.floor);
  var ss = 0.0;
  for (var i = li; i < ${W}u; i += 256u) {
    let v = x[t * ${W}u + i] + a * o[t * ${W}u + i];
    mid[t * ${W}u + i] = v;
    ss += v * v;
  }
  red[li] = ss;
  workgroupBarrier();
  for (var s = 128u; s > 0u; s >>= 1u) {
    if (li < s) { red[li] += red[li + s]; }
    workgroupBarrier();
  }
  let r = inverseSqrt(red[0] / ${W}.0 + ${c.cfg.eps});
  for (var i = li; i < ${W}u; i += 256u) { h2[t * ${W}u + i] = mid[t * ${W}u + i] * r * w[i]; }
}`;
}

/** m = mem_mult * m; x = mid + a * m. Keeps the scaled memory output for the pushes. */
export function memResidualKernel(c: KernelConsts) {
  const W = c.cfg.width;
  return /* wgsl */ `
struct FP { floor: u32, a: u32, b: u32, c: u32 }
@group(0) @binding(0) var<storage, read> mid: array<f32>;
@group(0) @binding(1) var<storage, read_write> m: array<f32>;
@group(0) @binding(2) var<storage, read> ct: array<u32>;
@group(0) @binding(3) var<uniform> SP: array<vec4u, 4>;
fn sp(i: u32) -> u32 { return SP[i / 4u][i % 4u]; }
@group(0) @binding(4) var<uniform> F: FP;
@group(0) @binding(5) var<storage, read_write> x: array<f32>;
@group(0) @binding(6) var<storage, read_write> keep: array<f32>;
${header(c)}
@compute @workgroup_size(256)
fn main(@builtin(workgroup_id) wg: vec3u, @builtin(local_invocation_index) li: u32) {
  let t = wg.x;
  if (t >= sp(0)) { return; }
  let a = ctf(L_FLOOR + F.floor);
  let mm = ctf(L_MEM + F.floor);
  let last = t == sp(9);
  for (var i = li; i < ${W}u; i += 256u) {
    let v = m[t * ${W}u + i] * mm;
    m[t * ${W}u + i] = v;
    x[t * ${W}u + i] = mid[t * ${W}u + i] + a * v;
    if (last) { keep[(F.floor * ${c.cfg.queryHeads + 1}u + ${c.cfg.queryHeads}u) * ${W}u + i] = v; }
  }
}`;
}

/** Copy a row of a [T, W] buffer into slot `floor` of a [floors, W] buffer (stream captures). */
export function keepRowKernel(c: KernelConsts) {
  const W = c.cfg.width;
  return /* wgsl */ `
struct FP { floor: u32, a: u32, b: u32, c: u32 }
@group(0) @binding(0) var<storage, read> x: array<f32>;
@group(0) @binding(1) var<uniform> SP: array<vec4u, 4>;
fn sp(i: u32) -> u32 { return SP[i / 4u][i % 4u]; }
@group(0) @binding(2) var<uniform> F: FP;
@group(0) @binding(3) var<storage, read_write> keep: array<f32>;
@compute @workgroup_size(256)
fn main(@builtin(local_invocation_index) li: u32) {
  let t = sp(9);
  for (var i = li; i < ${W}u; i += 256u) { keep[F.floor * ${W}u + i] = x[t * ${W}u + i]; }
}`;
}

/** PCG hash and the sampler of section 7.3, as WGSL helpers. */
const PCG = /* wgsl */ `
fn pcg(x: u32) -> u32 {
  let s = x * 747796405u + 2891336453u;
  let w = ((s >> ((s >> 28u) + 4u)) ^ s) * 277803737u;
  return (w >> 22u) ^ w;
}
fn draw(seed: u32, turn: u32, step: u32) -> f32 {
  let h = pcg(pcg(pcg(seed) ^ turn) ^ step);
  return f32(h >> 8u) * (1.0 / 16777216.0);
}`;

export const TOPK_SLICES = 256;
export const TOPK = 20;

/** Stage 1 of top-k: each workgroup keeps the top 20 (score, id) of its slice of the vocabulary. */
export function topkPartialKernel(c: KernelConsts) {
  const V = c.cfg.vocabReal;
  const slice = Math.ceil(V / TOPK_SLICES);
  return /* wgsl */ `
@group(0) @binding(0) var<storage, read> s: array<f32>;
@group(0) @binding(1) var<uniform> SP: array<vec4u, 4>;
fn sp(i: u32) -> u32 { return SP[i / 4u][i % 4u]; }
@group(0) @binding(2) var<storage, read_write> cand: array<u32>;
var<workgroup> rv: array<f32, 256>;
var<workgroup> ri: array<u32, 256>;
var<workgroup> taken: array<u32, ${slice}>;
@compute @workgroup_size(256)
fn main(@builtin(workgroup_id) wg: vec3u, @builtin(local_invocation_index) li: u32) {
  _ = sp(0u);
  let row = wg.y;
  let base = row * ${c.cfg.vocabRows}u;
  let start = wg.x * ${slice}u;
  let end = min(start + ${slice}u, ${V}u);
  for (var j = li; j < ${slice}u; j += 256u) { taken[j] = 0u; }
  workgroupBarrier();
  for (var k = 0u; k < ${TOPK}u; k++) {
    var bv = -3.4e38; var bi = 0xffffffffu;
    for (var j = start + li; j < end; j += 256u) {
      if (taken[j - start] == 0u) {
        let v = s[base + j];
        if (v > bv || (v == bv && j < bi)) { bv = v; bi = j; }
      }
    }
    rv[li] = bv; ri[li] = bi;
    workgroupBarrier();
    for (var st = 128u; st > 0u; st >>= 1u) {
      if (li < st) {
        let ov = rv[li + st]; let oi = ri[li + st];
        if (ov > rv[li] || (ov == rv[li] && oi < ri[li])) { rv[li] = ov; ri[li] = oi; }
      }
      workgroupBarrier();
    }
    if (li == 0u) {
      let o = ((row * ${TOPK_SLICES}u + wg.x) * ${TOPK}u + k) * 2u;
      cand[o] = bitcast<u32>(rv[0]);
      cand[o + 1u] = ri[0];
      if (ri[0] != 0xffffffffu) { taken[ri[0] - start] = 1u; }
    }
    workgroupBarrier();
  }
}`;
}

/**
 * Stage 2: global top 20, softmax at the temperature, top-p cut, PCG draw. Writes the token to
 * `tok` (it stays on the GPU) and the candidates to `out`: [token, cut, 20 ids, 20 probs].
 */
export function sampleKernel(_c: KernelConsts) {
  return /* wgsl */ `
@group(0) @binding(0) var<storage, read> cand: array<u32>;
@group(0) @binding(1) var<uniform> SP: array<vec4u, 4>;
fn sp(i: u32) -> u32 { return SP[i / 4u][i % 4u]; }
@group(0) @binding(2) var<storage, read_write> tok: array<u32>;
@group(0) @binding(3) var<storage, read_write> out: array<u32>;
${PCG}
var<workgroup> rv: array<f32, 256>;
var<workgroup> ri: array<u32, 256>;
var<workgroup> rk: array<u32, 256>;
var<workgroup> taken: array<u32, ${TOPK_SLICES * TOPK}>;
var<workgroup> topv: array<f32, ${TOPK}>;
var<workgroup> topi: array<u32, ${TOPK}>;
@compute @workgroup_size(256)
fn main(@builtin(workgroup_id) wg: vec3u, @builtin(local_invocation_index) li: u32) {
  let row = wg.x;
  let N = ${TOPK_SLICES * TOPK}u;
  let cbase = row * N * 2u;
  for (var j = li; j < N; j += 256u) { taken[j] = 0u; }
  workgroupBarrier();
  for (var k = 0u; k < ${TOPK}u; k++) {
    var bv = -3.4e38; var bi = 0xffffffffu; var bk = 0u;
    for (var j = li; j < N; j += 256u) {
      let id = cand[cbase + 2u * j + 1u];
      if (taken[j] == 0u && id != 0xffffffffu) {
        let v = bitcast<f32>(cand[cbase + 2u * j]);
        if (v > bv || (v == bv && id < bi)) { bv = v; bi = id; bk = j; }
      }
    }
    rv[li] = bv; ri[li] = bi; rk[li] = bk;
    workgroupBarrier();
    for (var st = 128u; st > 0u; st >>= 1u) {
      if (li < st) {
        let ov = rv[li + st]; let oi = ri[li + st];
        if (ov > rv[li] || (ov == rv[li] && oi < ri[li])) { rv[li] = ov; ri[li] = oi; rk[li] = rk[li + st]; }
      }
      workgroupBarrier();
    }
    if (li == 0u) { topv[k] = rv[0]; topi[k] = ri[0]; taken[rk[0]] = 1u; }
    workgroupBarrier();
  }
  if (li == 0u) {
    let temp = bitcast<f32>(sp(6));
    let topp = bitcast<f32>(sp(8));
    var e: array<f32, ${TOPK}>;
    let m = topv[0] / temp;
    var total = 0.0;
    for (var k = 0u; k < ${TOPK}u; k++) { e[k] = exp(topv[k] / temp - m); total += e[k]; }
    var acc = 0.0;
    var cut = ${TOPK}u;
    for (var k = 0u; k < ${TOPK}u; k++) {
      e[k] = e[k] / total;
      acc += e[k];
      if (acc >= topp && cut == ${TOPK}u) { cut = k + 1u; }
    }
    var kept = 0.0;
    for (var k = 0u; k < cut; k++) { kept += e[k]; }
    let tgt = draw(sp(3), sp(4), sp(5) + row) * kept;
    var pick = cut - 1u;
    var c2 = 0.0;
    for (var k = 0u; k < cut; k++) { c2 += e[k]; if (c2 > tgt) { pick = k; break; } }
    tok[row] = topi[pick];
    let o = row * 42u;
    out[o] = topi[pick];
    out[o + 1u] = cut;
    for (var k = 0u; k < ${TOPK}u; k++) { out[o + 2u + k] = topi[k]; out[o + 22u + k] = bitcast<u32>(e[k]); }
  }
}`;
}

/**
 * Direct pushes toward the sampled word: u = (dict[t] - mean row) * w_final / rms(x_final);
 * push 0 is the input word's dictionary row, then per floor the 16 heads and the memory block.
 * One workgroup per push.
 */
export function pushKernel(c: KernelConsts) {
  const W = c.cfg.width, H = c.cfg.queryHeads, F = c.cfg.floors;
  return /* wgsl */ `
@group(0) @binding(0) var<storage, read> tok: array<u32>;
@group(0) @binding(1) var<storage, read> intok: array<u32>;
@group(0) @binding(2) var<storage, read> dict: array<u32>;
@group(0) @binding(3) var<storage, read> aux: array<f32>;
@group(0) @binding(4) var<storage, read> rinv: array<f32>;
@group(0) @binding(5) var<storage, read> parts: array<f32>;
@group(0) @binding(6) var<storage, read> ct: array<u32>;
@group(0) @binding(7) var<uniform> SP: array<vec4u, 4>;
fn sp(i: u32) -> u32 { return SP[i / 4u][i % 4u]; }
@group(0) @binding(8) var<storage, read_write> out: array<f32>;
${header(c)}
${dictRead(c)}
var<workgroup> red: array<f32, 256>;
@compute @workgroup_size(256)
fn main(@builtin(workgroup_id) wg: vec3u, @builtin(local_invocation_index) li: u32) {
  let p = wg.x;
  let t = swapped(tok[0]);
  let r = rinv[sp(9)];
  var acc = 0.0;
  if (p == 0u) {
    let it = swapped(intok[sp(9)]);
    for (var i = li; i < ${W}u; i += 256u) { acc += dict_at(it, i) * (dict_at(t, i) - aux[i]) * aux[${W}u + i] * r; }
  } else {
    let L = (p - 1u) / ${H + 1}u;
    let k = (p - 1u) % ${H + 1}u;
    let a = ctf(L_FLOOR + L);
    for (var i = li; i < ${W}u; i += 256u) {
      let u = (dict_at(t, i) - aux[i]) * aux[${W}u + i] * r;
      acc += a * parts[(L * ${H + 1}u + k) * ${W}u + i] * u;
    }
  }
  red[li] = acc;
  workgroupBarrier();
  for (var s = 128u; s > 0u; s >>= 1u) {
    if (li < s) { red[li] += red[li + s]; }
    workgroupBarrier();
  }
  if (li == 0u) { out[p] = red[0]; }
}
// ${F} floors`;
}
