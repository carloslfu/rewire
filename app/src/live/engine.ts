// The page's side of the engine worker (section 6.2): one worker, three conversations (normal,
// changed, and the underline pass), versioned jobs so newer changes skip older work.
import type { Cand, ChangeSpec, FloorDetail, Forced, Tok } from "../model/types.ts";
import type { TinyConfig } from "@rewire/tiny/src/config.ts";
import type { FromWorker, ToWorker } from "./protocol.ts";

export type ConvId = 0 | 1 | 2;

export interface WriteJob {
  conv: ConvId;
  changes: ChangeSpec;
  /** Everything read before the reply. */
  history: number[];
  /** Reply pieces already written (Continue, or up to a picked word). */
  prefix: number[];
  /** A piece to use at the first new step instead of drawing one. */
  force?: number;
  seed: number;
  turn: number;
  cap: number;
  temperature: number;
  version: number;
}

export interface CheckResult {
  webgpu: boolean;
  /** Predicted seconds to read 300 tokens and write 40 with changes and lighting on. */
  seconds: number;
  adapter?: string;
  reason?: string;
}

type DistOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
type Pending = { resolve: (v: any) => void; reject: (e: Error) => void; onTok?: (t: Tok) => void };

export class EngineClient {
  private w: Worker;
  private seq = 1;
  private pending = new Map<number, Pending>();
  onProgress?: (loaded: number, total: number) => void;
  onLost?: () => void;

  constructor() {
    this.w = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
    this.w.onmessage = (e: MessageEvent<FromWorker>) => this.receive(e.data);
    this.w.onerror = (e) => {
      for (const p of this.pending.values()) p.reject(new Error(e.message || "worker error"));
      this.pending.clear();
    };
  }

  private receive(m: FromWorker) {
    if (m.t === "progress") return this.onProgress?.(m.loaded, m.total);
    if (m.t === "lost") return this.onLost?.();
    const p = this.pending.get(m.id);
    if (!p) return;
    if (m.t === "tok") return p.onTok?.(m.tok);
    this.pending.delete(m.id);
    if (m.t === "error") p.reject(new Error(m.message));
    else p.resolve(m.result);
  }

  private call<T>(msg: DistOmit<ToWorker, "id">, onTok?: (t: Tok) => void, transfer: Transferable[] = []): Promise<T> {
    const id = this.seq++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve, reject, onTok });
      this.w.postMessage({ ...msg, id } as ToWorker, transfer);
    });
  }

  check(): Promise<CheckResult> {
    return this.call({ t: "check" });
  }
  load(base: string, phone: boolean): Promise<{ manifestHash: string; contextCap: number; persisted: boolean }> {
    return this.call({ t: "load", base, phone });
  }
  pause(paused: boolean) {
    this.w.postMessage({ t: "pause", id: 0, paused } as ToWorker);
  }
  setVersion(v: number) {
    this.w.postMessage({ t: "version", id: 0, version: v } as ToWorker);
  }
  firstTurn(message: string): Promise<number[]> {
    return this.call({ t: "first", message });
  }
  /** Tokens appended after `reply` for the next user message (without the reply itself). */
  nextTurn(reply: number[], message: string): Promise<number[]> {
    return this.call({ t: "next", reply, message });
  }
  plain(text: string): Promise<number[]> {
    return this.call({ t: "plain", text });
  }
  pieces(ids: number[]): Promise<string[]> {
    return this.call({ t: "pieces", ids });
  }
  write(job: WriteJob, onTok: (t: Tok) => void): Promise<{ ended: boolean; cancelled: boolean }> {
    return this.call({ t: "write", job }, onTok);
  }
  compare(conv: ConvId, changes: ChangeSpec, history: number[], reply: number[], version: number): Promise<Forced[] | null> {
    return this.call({ t: "compare", conv, changes, history, reply, version });
  }
  inspect(conv: ConvId, changes: ChangeSpec, tokens: number[], target: number): Promise<{ detail: FloorDetail; guesses: Cand[][] }> {
    return this.call({ t: "inspect", conv, changes, tokens, target });
  }
  /** Hands the trained tiny model to the engine (its 32-bit path). */
  loadTiny(params: Float32Array, config: TinyConfig): Promise<{ floors: number; heads: number }> {
    return this.call({ t: "tiny", params, config });
  }
  /** A head's full attention map over the conversation (n x n, row = query position). */
  attentionMap(conv: ConvId, changes: ChangeSpec, tokens: number[], floor: number, head: number): Promise<Float32Array> {
    return this.call({ t: "map", conv, changes, tokens, floor, head });
  }
  /** Speed bench on the loaded model (medians of five runs). */
  bench(): Promise<Record<string, number>> {
    return this.call({ t: "bench" });
  }
  /** Which model the following jobs use. */
  use(model: "qwen" | "tiny"): Promise<boolean> {
    return this.call({ t: "use", model });
  }
  /** Average dictionary row and a token's row (the words-in panel). */
  dictRow(id: number, changes: ChangeSpec): Promise<Float32Array> {
    return this.call({ t: "dictRow", tokenId: id, changes });
  }
}
