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
  private w!: Worker;
  private seq = 1;
  private pending = new Map<number, Pending>();
  private loaded: { base: string; phone: boolean; expectedHash?: string } | null = null;
  private trained: { params: Float32Array; config: TinyConfig } | null = null;
  private model: "qwen" | "tiny" = "qwen";
  private version = 0;
  private recovery: Promise<void> | null = null;
  private failed = false;
  onProgress?: (loaded: number, total: number) => void;
  /** Texts of word pieces that arrive with written words. */
  onPieces?: (pieces: [number, string][]) => void;
  onLost?: () => void;
  onRecovered?: () => void;
  onFailure?: (message: string) => void;

  constructor() {
    this.startWorker();
  }

  cancel() {
    this.w.postMessage({ t: "cancel", id: 0 } satisfies ToWorker);
  }

  private startWorker() {
    this.w = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
    this.w.onmessage = (e: MessageEvent<FromWorker>) => this.receive(e.data);
    this.w.onerror = (e) => {
      const message = e.message || "worker error";
      this.failed = true;
      this.rejectPending(message);
      this.onFailure?.(message);
    };
  }

  private rejectPending(message: string) {
    for (const p of this.pending.values()) p.reject(new Error(message));
    this.pending.clear();
  }

  private async recover() {
    this.rejectPending("The GPU was reset; the model is reloading.");
    this.onLost?.();
    this.w.terminate();
    this.startWorker();
    if (this.loaded) await this.call({ t: "load", ...this.loaded });
    if (this.trained) await this.call({ t: "tiny", ...this.trained });
    await this.call({ t: "use", model: this.model });
    this.setVersion(this.version);
    this.onRecovered?.();
  }

  private receive(m: FromWorker) {
    if (m.t === "progress") return this.onProgress?.(m.loaded, m.total);
    if (m.t === "lost") {
      if (this.recovery) {
        this.rejectPending("The GPU could not recover.");
        return;
      }
      this.recovery = this.recover().catch((e) => {
        this.failed = true;
        this.onFailure?.(String(e.message ?? e));
      })
        .finally(() => { this.recovery = null; });
      return;
    }
    const p = this.pending.get(m.id);
    if (!p) return;
    if (m.t === "tok") {
      if (m.pieces) this.onPieces?.(m.pieces);
      return p.onTok?.(m.tok);
    }
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

  private async ready<T>(msg: DistOmit<ToWorker, "id">, onTok?: (t: Tok) => void): Promise<T> {
    await this.recovery;
    if (this.failed) throw new Error("The model could not recover. Retry loading the model.");
    return this.call(msg, onTok);
  }

  async check(): Promise<CheckResult> {
    await this.recovery;
    // Recheck on a working worker; load() still owns restoring models after failure.
    if (this.failed) { this.w.terminate(); this.startWorker(); }
    return this.call({ t: "check" });
  }
  async load(base: string, phone: boolean, expectedHash?: string): Promise<{ manifestHash: string; contextCap: number; stored: boolean }> {
    await this.recovery;
    const replaced = this.failed;
    if (replaced) { this.w.terminate(); this.startWorker(); this.failed = false; }
    this.loaded = { base, phone, expectedHash };
    const info = await this.call<{ manifestHash: string; contextCap: number; stored: boolean }>({ t: "load", ...this.loaded });
    if (replaced && this.trained) await this.call({ t: "tiny", ...this.trained });
    if (replaced && this.model === "tiny") await this.call({ t: "use", model: "tiny" });
    this.setVersion(this.version);
    return info;
  }
  pause(paused: boolean) {
    this.w.postMessage({ t: "pause", id: 0, paused } as ToWorker);
  }
  setVersion(v: number) {
    this.version = v;
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
    return this.ready({ t: "write", job }, onTok);
  }
  compare(conv: ConvId, changes: ChangeSpec, history: number[], reply: number[], version: number): Promise<Forced[] | null> {
    return this.ready({ t: "compare", conv, changes, history, reply, version });
  }
  inspect(conv: ConvId, changes: ChangeSpec, tokens: number[], target: number): Promise<{ detail: FloorDetail; guesses: Cand[][] }> {
    return this.ready({ t: "inspect", conv, changes, tokens, target });
  }
  /** Hands the trained tiny model to the engine (its 32-bit path). */
  async loadTiny(params: Float32Array, config: TinyConfig): Promise<{ floors: number; heads: number }> {
    await this.recovery;
    this.trained = { params: params.slice(), config };
    return this.call({ t: "tiny", params, config });
  }
  /** A head's full attention map over the conversation (n x n, row = query position). */
  attentionMap(conv: ConvId, changes: ChangeSpec, tokens: number[], floor: number, head: number): Promise<Float32Array> {
    return this.ready({ t: "map", conv, changes, tokens, floor, head });
  }
  /** Speed bench on the loaded model (medians of five runs). */
  bench(): Promise<Record<string, number>> {
    return this.ready({ t: "bench" });
  }
  /** Which model the following jobs use. */
  use(model: "qwen" | "tiny"): Promise<boolean> {
    this.model = model;
    return this.ready({ t: "use", model });
  }
  /** Average dictionary row and a token's row (the words-in panel). */
  dictRow(id: number, changes: ChangeSpec): Promise<Float32Array> {
    return this.ready({ t: "dictRow", tokenId: id, changes });
  }
}
