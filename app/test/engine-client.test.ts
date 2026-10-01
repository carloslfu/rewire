import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { EngineClient, type WriteJob } from "../src/live/engine.ts";
import type { FromWorker, ToWorker } from "../src/live/protocol.ts";
import { TINY } from "@rewire/tiny/src/config.ts";

class MockWorker {
  static workers: MockWorker[] = [];
  onmessage?: (e: { data: FromWorker }) => void;
  onerror?: (e: { message: string }) => void;
  messages: ToWorker[] = [];
  terminate = vi.fn();
  constructor() { MockWorker.workers.push(this); }
  postMessage(m: ToWorker) { this.messages.push(m); }
  emit(m: FromWorker) { this.onmessage?.({ data: m }); }
  finish(t: ToWorker["t"], result: unknown = true) {
    const m = [...this.messages].reverse().find((m) => m.t === t)!;
    this.emit({ t: "done", id: m.id, result });
  }
}
const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };
beforeEach(() => { MockWorker.workers = []; vi.stubGlobal("Worker", MockWorker); });
afterEach(() => vi.unstubAllGlobals());

it("cancels old writes, reloads the model and holds inspections until recovery finishes", async () => {
  const client = new EngineClient(), lost = vi.fn(), recovered = vi.fn();
  client.onLost = lost; client.onRecovered = recovered;
  const first = MockWorker.workers[0];
  const load = client.load("https://weights/", false, "expected");
  await flush(); first.finish("load"); await load;
  client.setVersion(8);
  const writing = client.write({ conv: 0 } as WriteJob, () => {});
  const failed = expect(writing).rejects.toThrow("GPU was reset");
  await flush(); first.emit({ t: "lost" }); await failed;
  const replacement = MockWorker.workers[1];
  expect(first.terminate).toHaveBeenCalledOnce();
  expect(replacement.messages[0]).toMatchObject({ t: "load", base: "https://weights/", expectedHash: "expected" });
  const inspection = client.inspect(0, {}, [1, 2], 3);
  await flush(); expect(replacement.messages.some((m) => m.t === "inspect")).toBe(false);
  replacement.finish("load"); await flush(); replacement.finish("use"); await flush();
  expect(replacement.messages).toContainEqual({ t: "version", id: 0, version: 8 });
  expect(lost).toHaveBeenCalledOnce(); expect(recovered).toHaveBeenCalledOnce();
  replacement.finish("inspect", { detail: new Map(), guesses: [] });
  await expect(inspection).resolves.toHaveProperty("guesses");
});

it("recovers a trained tiny model even when the full chat model was never loaded", async () => {
  const client = new EngineClient(), first = MockWorker.workers[0];
  const params = new Float32Array([1, 2, 3]);
  const training = client.loadTiny(params, { ...TINY, vocab: 64 });
  await flush(); first.finish("tiny", { floors: 2, heads: 4 }); await training;
  const use = client.use("tiny"); await flush(); first.finish("use"); await use;
  params.fill(0);
  first.emit({ t: "lost" });
  const replacement = MockWorker.workers[1];
  expect(replacement.messages[0]).toMatchObject({ t: "tiny", params: new Float32Array([1, 2, 3]) });
  replacement.finish("tiny"); await flush();
  expect(replacement.messages.find((m) => m.t === "use")).toMatchObject({ model: "tiny" });
  replacement.finish("use"); await flush();
});

it("reports a failed recovery and allows an explicit retry with a fresh worker", async () => {
  const client = new EngineClient(), failure = vi.fn(), first = MockWorker.workers[0];
  client.onFailure = failure;
  const load = client.load("https://weights/", true); await flush(); first.finish("load"); await load;
  first.emit({ t: "lost" });
  const replacement = MockWorker.workers[1];
  replacement.emit({ t: "error", id: replacement.messages[0].id, message: "No adapter" });
  await flush(); expect(failure).toHaveBeenCalledWith("No adapter");
  await expect(client.inspect(0, {}, [1], 2)).rejects.toThrow("could not recover");
  const retry = client.load("https://weights/", true); await flush();
  const final = MockWorker.workers[2]; final.finish("load");
  await retry; expect(replacement.terminate).toHaveBeenCalledOnce();
});

it("does not loop if the replacement GPU is lost again", async () => {
  const client = new EngineClient(), failure = vi.fn(), first = MockWorker.workers[0];
  client.onFailure = failure;
  const load = client.load("https://weights/", false); await flush(); first.finish("load"); await load;
  first.emit({ t: "lost" }); MockWorker.workers[1].emit({ t: "lost" });
  await flush(); expect(failure).toHaveBeenCalledOnce(); expect(MockWorker.workers).toHaveLength(2);
});
