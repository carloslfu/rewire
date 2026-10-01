import { sha256, type FileEntry } from "@rewire/engine/src/manifest.ts";

class Paused extends Error {}

/** Bounded, resumable downloads. A refused cache never prevents a session from running. */
export class ModelFiles {
  private cache: Cache | null;
  private paused = false;
  private waiters: (() => void)[] = [];
  private active = new Set<AbortController>();
  private fetcher: typeof fetch;
  private timeout: number;
  private retries: number;
  private delay: (attempt: number) => Promise<void>;
  private jsonVersion?: string;

  constructor(private base: string, cache: Cache | null, options: {
    fetch?: typeof fetch; timeout?: number; retries?: number; delay?: (attempt: number) => Promise<void>; jsonVersion?: string;
  } = {}) {
    this.cache = cache;
    this.fetcher = options.fetch ?? ((input, init) => fetch(input, init));
    this.timeout = options.timeout ?? 30_000;
    this.retries = options.retries ?? 5;
    this.delay = options.delay ?? ((n) => new Promise((r) => setTimeout(r, 1000 * n)));
    this.jsonVersion = options.jsonVersion;
  }

  get stored() { return this.cache !== null; }

  pause(paused: boolean) {
    this.paused = paused;
    if (paused) for (const c of this.active) c.abort(new Paused());
    else for (const resolve of this.waiters.splice(0)) resolve();
  }

  private async unpaused() {
    while (this.paused) await new Promise<void>((r) => this.waiters.push(r));
  }

  private async cached(url: string) {
    try { return await this.cache?.match(url); }
    catch { this.cache = null; return undefined; }
  }

  private async remove(url: string) {
    try { await this.cache?.delete(url); }
    catch { this.cache = null; }
  }

  private async keep(url: string, response: Response) {
    try { await this.cache?.put(url, response); }
    catch { this.cache = null; }
  }

  /** The timer covers response headers and each body read, including a stalled connection. */
  private async request<T>(url: string, init: RequestInit, consume: (r: Response, reset: () => void) => Promise<T>): Promise<T> {
    const controller = new AbortController();
    this.active.add(controller);
    let timer: ReturnType<typeof setTimeout>;
    const reset = () => {
      clearTimeout(timer);
      timer = setTimeout(() => controller.abort(new Error("download timed out")), this.timeout);
    };
    reset();
    try {
      const r = await this.fetcher(url, { ...init, signal: controller.signal });
      return await consume(r, reset);
    } finally {
      clearTimeout(timer!);
      this.active.delete(controller);
    }
  }

  async json(name: string): Promise<{ value: Record<string, unknown>; bytes: number }> {
    const url = this.base + name;
    const key = this.jsonVersion ? `${url}?rewire-manifest=${encodeURIComponent(this.jsonVersion)}` : url;
    const hit = await this.cached(key);
    if (hit) {
      try {
        const text = await hit.text();
        return { value: JSON.parse(text), bytes: new TextEncoder().encode(text).length };
      } catch { await this.remove(key); }
    }
    let attempts = 0;
    for (;;) {
      await this.unpaused();
      try {
        const text = await this.request(url, {}, async (r, reset) => {
          if (!r.ok) throw new Error(`${name}: ${r.status}`);
          if (!r.body) throw new Error(`${name}: empty download`);
          const reader = r.body.getReader(), decoder = new TextDecoder();
          let text = "";
          try {
            for (;;) {
              reset();
              const { done, value } = await reader.read();
              if (done) return text + decoder.decode();
              text += decoder.decode(value, { stream: true });
            }
          } finally { await reader.cancel().catch(() => undefined); }
        });
        const value = JSON.parse(text) as Record<string, unknown>;
        await this.keep(key, new Response(text, { headers: { "Content-Type": "application/json" } }));
        return { value, bytes: new TextEncoder().encode(text).length };
      } catch (e) {
        if (this.paused) continue;
        if (++attempts > this.retries) throw e;
        await this.delay(attempts);
      }
    }
  }

  async file(f: FileEntry, onBytes: (got: number) => void): Promise<ArrayBuffer> {
    const url = this.base + f.name;
    const hit = await this.cached(url);
    if (hit) {
      try {
        const data = await hit.arrayBuffer();
        if (data.byteLength === f.bytes && await sha256(data) === f.sha256) {
          onBytes(f.bytes);
          return data;
        }
      } catch { /* a cache read can fail after match succeeds */ }
      await this.remove(url);
    }
    const out = new Uint8Array(f.bytes);
    let got = 0, attempts = 0;
    while (got < f.bytes) {
      await this.unpaused();
      try {
        await this.request(url, got ? { headers: { Range: `bytes=${got}-` } } : {}, async (r, reset) => {
          if (!r.ok) throw new Error(`${f.name}: ${r.status}`);
          if (r.status === 206) {
            const range = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(r.headers.get("Content-Range") ?? "");
            if (!range || Number(range[1]) !== got || Number(range[2]) < got || Number(range[2]) >= f.bytes || Number(range[3]) !== f.bytes) {
              await r.body?.cancel();
              throw new Error(`${f.name}: invalid download range`);
            }
          } else if (got) { got = 0; onBytes(0); }
          if (!r.body) throw new Error(`${f.name}: empty download`);
          const reader = r.body.getReader();
          try {
            for (;;) {
              reset();
              const { value, done } = await reader.read();
              if (done) break;
              if (got + value.byteLength > f.bytes) throw new Error(`${f.name}: download is too large`);
              out.set(value, got);
              got += value.byteLength;
              onBytes(got);
            }
          } finally { await reader.cancel().catch(() => undefined); }
          if (got < f.bytes) throw new Error(`${f.name}: incomplete download`);
        });
      } catch (e) {
        if (this.paused) continue;
        if (++attempts > this.retries) throw e;
        await this.delay(attempts);
      }
    }
    if (await sha256(out.buffer) !== f.sha256) throw new Error(`${f.name} did not match its hash`);
    await this.keep(url, new Response(out.buffer, { headers: { "Content-Type": "application/octet-stream" } }));
    return out.buffer;
  }
}
