// The tiny model's shape (section 6.3), without jax-js so the page can import it cheaply.
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
