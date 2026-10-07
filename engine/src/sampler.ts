// The sampler of section 7.3 on the CPU (tests, recordings and replay), matching WGSL and Python.

export function pcg(x: number): number {
  const s = (Math.imul(x >>> 0, 747796405) + 2891336453) >>> 0;
  const w = Math.imul(((s >>> ((s >>> 28) + 4)) ^ s) >>> 0, 277803737) >>> 0;
  return ((w >>> 22) ^ w) >>> 0;
}

export function draw(seed: number, turn: number, step: number): number {
  const h = pcg((pcg((pcg(seed >>> 0) ^ (turn >>> 0)) >>> 0) ^ (step >>> 0)) >>> 0);
  return Math.fround((h >>> 8) * 2 ** -24);
}

export interface Candidates {
  ids: number[];
  probs: number[];
  cut: number;
}

export function candidates(scores: ArrayLike<number>, vocabReal: number, temperature = 0.7, topK = 20, topP = 0.8): Candidates {
  const t = temperature <= 0 ? 1 : Math.fround(temperature);
  // top-k by score, ties by lower id
  const idx: number[] = [];
  const val: number[] = [];
  for (let i = 0; i < vocabReal; i++) {
    const v = Math.fround(scores[i] / t);
    if (idx.length < topK || v > val[val.length - 1] || (v === val[val.length - 1] && i < idx[idx.length - 1])) {
      let j = idx.length;
      while (j > 0 && (val[j - 1] < v || (val[j - 1] === v && idx[j - 1] > i))) j--;
      idx.splice(j, 0, i);
      val.splice(j, 0, v);
      if (idx.length > topK) { idx.pop(); val.pop(); }
    }
  }
  if (temperature <= 0) return { ids: idx, probs: idx.map((_, i) => i === 0 ? 1 : 0), cut: 1 };
  const m = val[0];
  const e = val.map((v) => Math.fround(Math.exp(Math.fround(v - m))));
  let total = 0;
  for (const v of e) total = Math.fround(total + v);
  const probs = e.map((v) => Math.fround(v / total));
  let acc = 0, cut = probs.length;
  for (let i = 0; i < probs.length; i++) {
    acc = Math.fround(acc + probs[i]);
    if (acc >= Math.fround(topP)) { cut = i + 1; break; }
  }
  return { ids: idx, probs, cut };
}

export function sample(scores: ArrayLike<number>, vocabReal: number, seed: number, turn: number, step: number,
  temperature = 0.7): { id: number } & Candidates {
  const c = candidates(scores, vocabReal, temperature);
  let kept = 0;
  for (let i = 0; i < c.cut; i++) kept = Math.fround(kept + c.probs[i]);
  const target = Math.fround(draw(seed, turn, step) * kept);
  let acc = 0, pick = c.cut - 1;
  for (let i = 0; i < c.cut; i++) {
    acc = Math.fround(acc + c.probs[i]);
    if (acc > target) { pick = i; break; }
  }
  return { id: c.ids[pick], ...c };
}
