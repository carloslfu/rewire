// Letters for the tiny model: the 95 printable ASCII characters, the newline and one "other" piece.
export const VOCAB = 97;
export const NEWLINE = 95;
export const OTHER = 96;

export function encode(text: string): Int32Array {
  const t = text.normalize("NFKD");
  const out = new Int32Array(t.length);
  let n = 0;
  for (const ch of t) {
    const c = ch.charCodeAt(0);
    if (c >= 0x300 && c <= 0x36f) continue; // accents split off by NFKD
    out[n++] = c === 10 ? NEWLINE : c >= 32 && c < 127 ? c - 32 : c === 9 ? 0 : OTHER;
  }
  return out.slice(0, n);
}

export function letter(id: number): string {
  if (id === NEWLINE) return "\n";
  if (id === OTHER) return "·";
  return String.fromCharCode(id + 32);
}

export function decode(ids: ArrayLike<number>): string {
  let s = "";
  for (let i = 0; i < ids.length; i++) s += letter(ids[i]);
  return s;
}

/** A batch of random windows: x = window[0..T), y = window[1..T]. Deterministic for a seed. */
export function sampleBatch(ids: Int32Array, batch: number, T: number, seed: number): { x: Int32Array; y: Int32Array } {
  const x = new Int32Array(batch * T), y = new Int32Array(batch * T);
  let s = seed >>> 0;
  for (let b = 0; b < batch; b++) {
    s = (Math.imul(s ^ (s >>> 15), 2246822519) + 3266489917) >>> 0;
    const start = ids.length > T + 1 ? s % (ids.length - T - 1) : 0;
    for (let t = 0; t < T; t++) {
      x[b * T + t] = ids[(start + t) % ids.length];
      y[b * T + t] = ids[(start + t + 1) % ids.length];
    }
  }
  return { x, y };
}

/** Draw from probabilities with temperature (samples while it trains). */
export function draw(probs: Float32Array, u: number, temperature = 0.8): number {
  const w = Array.from(probs, (p) => Math.pow(Math.max(p, 1e-12), 1 / temperature));
  const tot = w.reduce((a, b) => a + b, 0);
  let acc = 0;
  for (let i = 0; i < w.length; i++) {
    acc += w[i] / tot;
    if (acc > u) return i;
  }
  return w.length - 1;
}
