// Head output interventions, after W_o and before residual addition. CPU reference for
// experiments and independent GPU checks. These change activations, not learned weights.
import { geometryAxes, type HeadGeometry } from "./changes.ts";

export function transformHead(v: ArrayLike<number>, stream: ArrayLike<number>, g: HeadGeometry): Float64Array<ArrayBuffer> {
  const n = v.length;
  const out = new Float64Array(n);
  if (g.kind === "remove") {
    let dot = 0, ss = 0;
    for (let i = 0; i < n; i++) { dot += v[i] * stream[i]; ss += stream[i] ** 2; }
    const scale = ss > 1e-20 ? g.amount * dot / ss : 0;
    for (let i = 0; i < n; i++) out[i] = v[i] - scale * stream[i];
  } else {
    const { mask, bit, mul, add } = geometryAxes(n, g.seed);
    const a = g.kind === "rotate" ? g.angle * Math.PI / 180 : 0;
    for (let i = 0; i < n; i++) {
      out[i] = g.kind === "shuffle" ? v[(i * mul + add) % n]
        : Math.cos(a) * v[i] + Math.sin(a) * (i & bit ? 1 : -1) * v[i ^ mask];
    }
  }
  return out;
}

export function vectorStats(before: ArrayLike<number>, after: ArrayLike<number>, stream?: ArrayLike<number>) {
  let aa = 0, bb = 0, ab = 0, bs = 0, ss = 0;
  for (let i = 0; i < before.length; i++) {
    aa += before[i] ** 2; bb += after[i] ** 2; ab += before[i] * after[i];
    if (stream) { bs += after[i] * stream[i]; ss += stream[i] ** 2; }
  }
  return {
    ratio: aa > 1e-20 ? Math.sqrt(bb / aa) : null,
    angle: aa * bb > 1e-40 ? Math.acos(Math.max(-1, Math.min(1, ab / Math.sqrt(aa * bb)))) * 180 / Math.PI : null,
    streamCosine: bb * ss > 1e-40 ? bs / Math.sqrt(bb * ss) : null,
  };
}
