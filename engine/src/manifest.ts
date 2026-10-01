// Load converted weights (section 7.4) into GPU buffers, file by file, verifying each file's hash.
import type { ModelConfig } from "./config.ts";
import { storage } from "./gpu.ts";
import type { FloorWeights, Weights } from "./model.ts";

export interface TensorEntry {
  name: string;
  shape: number[];
  kind: "q4" | "q8" | "f16" | "f32";
  group?: number;
  offset: number;
  bytes: number;
}

export interface FileEntry {
  name: string;
  sha256: string;
  bytes: number;
}

export interface ConceptEntry {
  id: string;
  label: string;
  best_floor: number;
  working: number[];
  breaking: number;
}

export interface Manifest {
  format_version: 1;
  model: string;
  commit: string;
  license: string;
  notice: string;
  config: {
    floors: number; width: number; query_heads: number; kv_heads: number; head_size: number; units: number;
    vocab_rows: number; vocab_real: number; rope_theta: number; eps: number; group: number; dict_bits: number;
    floor_bits: number;
  };
  quantization: { method: string; group: number; dictionary_bits: number; metrics: Record<string, unknown> };
  tensors: TensorEntry[];
  files: FileEntry[];
  total_bytes: number;
  chat: { system_prompt: string; reply_cap: number; continue_cap: number; context_cap_desktop: number; context_cap_phone: number };
  tokens: { endoftext: number; im_start: number; im_end: number; think: number; end_think: number; stop: number[] };
  sampling: { temperature: number; top_k: number; top_p: number; compare_temperature: number };
  rho: number[];
  atlas: Record<string, unknown>;
  concepts: ConceptEntry[];
}

export function configOf(m: Manifest, maxContext: number): ModelConfig {
  const c = m.config;
  return {
    name: m.model, floors: c.floors, width: c.width, queryHeads: c.query_heads, kvHeads: c.kv_heads, headSize: c.head_size,
    units: c.units, vocabRows: c.vocab_rows, vocabReal: c.vocab_real, ropeTheta: c.rope_theta, eps: c.eps,
    maxContext, group: c.group, dictBits: c.dict_bits, floorBits: c.floor_bits,
  };
}

export async function sha256(data: ArrayBuffer): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, "0")).join("");
}

export interface Loaded {
  weights: Weights;
  /** Built-in concept vectors, per floor. */
  concepts: Map<string, Float32Array[]>;
}

/**
 * Stream the files into GPU buffers. `getFile` returns a file's bytes (from the network, a cache or disk).
 * Tensors that span files are written piece by piece; the model is never held in one JavaScript array.
 */
export async function loadWeights(dev: GPUDevice, m: Manifest, getFile: (f: FileEntry) => Promise<ArrayBuffer>,
  onProgress?: (done: number, total: number) => void, verify = true): Promise<Loaded> {
  const bufs = new Map<string, GPUBuffer>();
  const host = new Map<string, Uint8Array>(); // small tensors read back on the CPU (concepts)
  for (const t of m.tensors) {
    if (t.name.startsWith("concept.")) host.set(t.name, new Uint8Array(t.bytes));
    else bufs.set(t.name, storage(dev, t.bytes, t.name));
  }
  let pos = 0, done = 0;
  for (const f of m.files) {
    const data = await getFile(f);
    if (verify) {
      const h = await sha256(data);
      if (h !== f.sha256) throw new Error(`hash mismatch for ${f.name}`);
    }
    const start = pos, end = pos + data.byteLength;
    for (const t of m.tensors) {
      const a = Math.max(start, t.offset), b = Math.min(end, t.offset + t.bytes);
      if (a >= b) continue;
      const hb = host.get(t.name);
      if (hb) hb.set(new Uint8Array(data, a - start, b - a), a - t.offset);
      else {
        // writeBuffer needs 4-byte aligned sizes and offsets; tensors start on 256-byte boundaries
        const len = b - a;
        dev.queue.writeBuffer(bufs.get(t.name)!, a - t.offset, data, a - start, len - (len % 4));
      }
    }
    pos = end;
    done += data.byteLength;
    onProgress?.(done, m.total_bytes);
  }
  const g = (n: string) => {
    const b = bufs.get(n);
    if (!b) throw new Error(`missing tensor ${n}`);
    return b;
  };
  const floors: FloorWeights[] = [];
  for (let L = 0; L < m.config.floors; L++) {
    floors.push({
      q: g(`f${L}.q`), k: g(`f${L}.k`), v: g(`f${L}.v`), o: g(`f${L}.o`), gate: g(`f${L}.gate`), up: g(`f${L}.up`),
      down: g(`f${L}.down`), inNorm: g(`f${L}.in_norm`), postNorm: g(`f${L}.post_norm`), qkNorm: g(`f${L}.qk_norm`),
    });
  }
  const concepts = new Map<string, Float32Array[]>();
  for (const c of m.concepts ?? []) {
    const raw = host.get(`concept.${c.id}`);
    if (!raw) continue;
    const all = new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4);
    concepts.set(c.id, Array.from({ length: m.config.floors }, (_, L) => all.slice(L * m.config.width, (L + 1) * m.config.width)));
  }
  return { weights: { dict: g("dict"), finalNorm: g("final_norm"), meanRow: g("mean_row"), floors }, concepts };
}
