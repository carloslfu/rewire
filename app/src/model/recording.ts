// Reads recordings (py/rewire/recording.py writes them; section 7.4) and featured-word detail files.
import type { Cand, ChangeSpec, FloorDetail, Forced, Tok } from "./types.ts";

let F16: Float32Array | null = null;
/** Half float to float, through a 65,536-entry table built on first use. */
export function halfTable(): Float32Array {
  if (F16) return F16;
  const t = new Float32Array(65536);
  for (let h = 0; h < 65536; h++) {
    const s = h & 0x8000 ? -1 : 1, e = (h >> 10) & 31, m = h & 1023;
    t[h] = e === 0 ? s * m * 2 ** -24 : e === 31 ? (m ? NaN : s * Infinity) : s * (1 + m / 1024) * 2 ** (e - 15);
  }
  return (F16 = t);
}

export interface RunInfo {
  id: string;
  changes: ChangeSpec;
  seed: number;
  temperature: number;
  messages: string[];
  turns: { prompt_tokens: number[]; first: number; count: number; ended: boolean }[];
  compare: { of: string; first: number; count: number } | null;
  /** A run where the visitor's pick was forced at `index` (step 9). */
  picked?: { turn: number; index: number; id: number };
}

export interface RecordingHeader {
  format_version: 1;
  manifest_hash: string;
  producer: "python" | "engine";
  layout: {
    pushes: number; floors: number; heads: number; candidates: number; guesses: number;
    gen: Record<"id" | "lp1" | "concept" | "cut" | "flags" | "cand_ids" | "cand_probs" | "pushes" | "guess_ids" | "guess_probs" | "size", number>;
    forced: Record<"id" | "lp1" | "concept" | "pushes" | "size", number>;
  };
  gen_records: number;
  forced_records: number;
  runs: RunInfo[];
  featured: { run: string; turn: number; index: number; file: string }[];
  pieces: Record<string, string>;
  [k: string]: unknown;
}

export interface RecordedTurn {
  read: number[];
  toks: Tok[];
  ended: boolean;
}

export interface RecordedRun {
  info: RunInfo;
  turns: RecordedTurn[];
  compare?: Forced[];
}

export class Recording {
  readonly runs = new Map<string, RecordedRun>();
  constructor(readonly header: RecordingHeader, readonly url: string) {}

  piece(id: number): string {
    return this.header.pieces[String(id)] ?? `[${id}]`;
  }

  /** The run whose changes equal `spec` (canonical comparison), if one was recorded. */
  find(spec: ChangeSpec, message?: string): RecordedRun | undefined {
    const key = canonical(spec);
    for (const r of this.runs.values()) {
      if (canonical(r.info.changes) === key && (message === undefined || r.info.messages[0] === message)) return r;
    }
    return undefined;
  }

  featured(run: string, turn: number, index: number): string | undefined {
    const f = this.header.featured.find((x) => x.run === run && x.turn === turn && x.index === index);
    return f && new URL(f.file, this.url).toString();
  }
}

export function parseRecording(buf: ArrayBuffer, url: string): Recording {
  const dv = new DataView(buf);
  const magic = String.fromCharCode(...new Uint8Array(buf, 0, 4));
  if (magic !== "RWRC") throw new Error("not a recording");
  const n = dv.getUint32(4, true);
  const header = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 8, n))) as RecordingHeader;
  if (header.format_version !== 1) throw new Error(`recording format ${header.format_version} is not supported`);
  const h = halfTable();
  const lay = header.layout;
  const g = lay.gen, f = lay.forced, P = lay.pushes, C = lay.candidates, G = lay.guesses, F = lay.floors;
  let off = (8 + n + 3) & ~3;
  const genBase = off;
  const forcedBase = genBase + header.gen_records * g.size;
  const half = (o: number) => h[dv.getUint16(o, true)];
  const readGen = (i: number): Tok => {
    const b = genBase + i * g.size;
    const cut = dv.getUint16(b + g.cut, true), flags = dv.getUint16(b + g.flags, true);
    const cands: Cand[] = [];
    for (let k = 0; k < C; k++) cands.push({ id: dv.getUint32(b + g.cand_ids + 4 * k, true), p: half(b + g.cand_probs + 2 * k) });
    const pushes = new Float32Array(P);
    for (let k = 0; k < P; k++) pushes[k] = half(b + g.pushes + 2 * k);
    const tok: Tok = {
      id: dv.getUint32(b + g.id, true), lp1: dv.getFloat32(b + g.lp1, true), concept: dv.getFloat32(b + g.concept, true),
      cut, cands, pushes,
    };
    if (flags & 1) {
      tok.guesses = [];
      for (let L = 0; L < F; L++) {
        const row: Cand[] = [];
        for (let k = 0; k < G; k++) {
          const j = L * G + k;
          row.push({ id: dv.getUint32(b + g.guess_ids + 4 * j, true), p: half(b + g.guess_probs + 2 * j) });
        }
        tok.guesses.push(row);
      }
    }
    return tok;
  };
  const readForced = (i: number): Forced => {
    const b = forcedBase + i * f.size;
    const pushes = new Float32Array(P);
    for (let k = 0; k < P; k++) pushes[k] = half(b + f.pushes + 2 * k);
    return { id: dv.getUint32(b + f.id, true), lp1: dv.getFloat32(b + f.lp1, true), concept: dv.getFloat32(b + f.concept, true), pushes };
  };
  const rec = new Recording(header, url);
  for (const info of header.runs) {
    const turns = info.turns.map((t) => ({
      read: t.prompt_tokens, ended: t.ended, toks: Array.from({ length: t.count }, (_, i) => readGen(t.first + i)),
    }));
    const compare = info.compare ? Array.from({ length: info.compare.count }, (_, i) => readForced(info.compare!.first + i)) : undefined;
    rec.runs.set(info.id, { info, turns, compare });
  }
  off = forcedBase + header.forced_records * f.size;
  if (off > buf.byteLength) throw new Error("recording is truncated");
  return rec;
}

/** A canonical string for a change spec: neutral entries dropped, lists sorted. */
export function canonical(spec: ChangeSpec | undefined | null): string {
  if (!spec) return "{}";
  const o: Record<string, unknown> = {};
  const heads = (spec.heads ?? []).filter((x) => x.mult !== 1).map((x) => [x.floor, x.head, x.mult]).sort(cmp);
  const memory = (spec.memory ?? []).filter((x) => x.mult !== 1).map((x) => [x.floor, x.mult]).sort(cmp);
  const floors = (spec.floors ?? []).filter((x) => x.mult !== 1).map((x) => [x.floor, x.mult]).sort(cmp);
  const swaps = (spec.swaps ?? []).map(([a, b]) => (a < b ? [a, b] : [b, a])).sort(cmp);
  const hidden = (spec.hidden ?? []).map((x) => [x.key, x.from]).sort(cmp);
  const zeroed = (spec.zeroed ?? []).map((x) => [x.floor, x.tensor, x.row, x.col]).sort(cmp);
  if (heads.length) o.heads = heads;
  if (memory.length) o.memory = memory;
  if (floors.length) o.floors = floors;
  if (spec.concept && spec.concept.strength !== 0) o.concept = [spec.concept.id, spec.concept.floor, spec.concept.strength];
  if (swaps.length) o.swaps = swaps;
  if (hidden.length) o.hidden = hidden;
  if (zeroed.length) o.zeroed = zeroed;
  if (spec.bits && spec.bits !== 4) o.bits = spec.bits;
  return JSON.stringify(o);
}

function cmp(a: unknown[], b: unknown[]): number {
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    if (a[i] === b[i]) continue;
    return (a[i] as number) < (b[i] as number) ? -1 : 1;
  }
  return a.length - b.length;
}

/** Featured-word detail: a safetensors file of half floats (ids in float32). */
export function parseFeatured(buf: ArrayBuffer): FloorDetail {
  const dv = new DataView(buf);
  const n = Number(dv.getBigUint64(0, true));
  const head = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 8, n))) as Record<string, { dtype: string; shape: number[]; data_offsets: [number, number] }>;
  const base = 8 + n;
  const h = halfTable();
  const out: FloorDetail = new Map();
  for (const [k, v] of Object.entries(head)) {
    if (k === "__metadata__") continue;
    const [a, b] = v.data_offsets;
    if (v.dtype === "F16") {
      const m = (b - a) / 2, arr = new Float32Array(m);
      for (let i = 0; i < m; i++) arr[i] = h[dv.getUint16(base + a + 2 * i, true)];
      out.set(k, arr);
    } else if (v.dtype === "F32") {
      out.set(k, new Float32Array(buf.slice(base + a, base + b)));
    }
  }
  return out;
}

export async function loadRecording(url: string, signal?: AbortSignal): Promise<Recording> {
  const r = await fetch(url, { signal });
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  return parseRecording(await r.arrayBuffer(), new URL(url, location.href).toString());
}
