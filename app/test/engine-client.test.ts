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

it("streams real lesson progress without completing the training promise and stops independently of chat",async()=>{
  const client=new EngineClient(),w=MockWorker.workers[0],progress=vi.fn(),finished=vi.fn();
  const task=client.trainLesson([{prompt:"Q",answer:"A"}],200,0.003,progress).then(finished);
  await flush();const m=w.messages.find(m=>m.t==="lesson-train")!;
  expect(m).toMatchObject({continueLesson:false});
  w.emit({t:"lesson-progress",id:m.id,update:{phase:"training",step:10,total:200,loss:1}});
  await flush();expect(progress).toHaveBeenCalledOnce();expect(finished).not.toHaveBeenCalled();
  client.stopLesson();expect(w.messages.at(-1)).toEqual({t:"lesson-stop",id:0});
  w.finish("lesson-train",{steps:10,stopped:true});await task;
  expect(finished).toHaveBeenCalledWith({steps:10,stopped:true});
});

it("explicitly requests continuation without replacing the installed checkpoint",async()=>{
  const client=new EngineClient(),w=MockWorker.workers[0];
  const task=client.trainLesson([{prompt:"Q",answer:"A"}],80,0.001,()=>{},true);
  await flush();expect(w.messages.at(-1)).toMatchObject({t:"lesson-train",continueLesson:true});
  w.finish("lesson-train",{steps:80});await task;
  expect(w.messages.some(m=>m.t==="lesson-install")).toBe(false);
});

it("restores installed learned weights after device loss before any new inference",async()=>{
  const client=new EngineClient(),w=MockWorker.workers[0];
  const load=client.load("https://weights/",false);await flush();w.finish("load");await load;
  const p={a:new Float32Array([1,2]),b:new Float32Array([3,4])};
  const install=client.installLesson(p);await flush();w.finish("lesson-install");await install;p.a.fill(0);
  w.emit({t:"lost"});const replacement=MockWorker.workers[1];replacement.finish("load");await flush();
  expect(replacement.messages.at(-1)).toMatchObject({t:"lesson-install",weights:{a:new Float32Array([1,2])}});
  const test=client.probeLesson("fresh question",true);await flush();expect(replacement.messages.some(m=>m.t==="lesson-probe")).toBe(false);
  replacement.finish("lesson-install");await flush();replacement.finish("use");await flush();
  expect(replacement.messages.at(-1)).toMatchObject({t:"lesson-probe",prompt:"fresh question",lesson:true});
  replacement.finish("lesson-probe",{text:"answer",ended:true,cancelled:false});await expect(test).resolves.toHaveProperty("text","answer");
});

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

it("restores the trained model after an explicit retry of failed recovery", async () => {
  const client = new EngineClient(), first = MockWorker.workers[0];
  const training = client.loadTiny(new Float32Array([1, 2]), { ...TINY, vocab: 97 });
  await flush(); first.finish("tiny"); await training;
  const use = client.use("tiny"); await flush(); first.finish("use"); await use;
  first.emit({ t: "lost" });
  const broken = MockWorker.workers[1];
  broken.emit({ t: "error", id: broken.messages[0].id, message: "No adapter" }); await flush();
  const retry = client.load("https://weights/", false); await flush();
  const final = MockWorker.workers[2]; final.finish("load", { manifestHash: "expected", contextCap: 1024, stored: true });
  await flush(); expect(final.messages.some((m) => m.t === "tiny")).toBe(true);
  final.finish("tiny"); await flush();
  expect(final.messages.find((m) => m.t === "use")).toMatchObject({ model: "tiny" });
  final.finish("use"); await expect(retry).resolves.toHaveProperty("stored", true);
});

it("rechecks a failed worker before retrying automatic initialization", async () => {
  const client = new EngineClient(), first = MockWorker.workers[0];
  first.onerror!({ message: "Worker stopped" });
  const checking = client.check(); await flush();
  const checked = MockWorker.workers[1];
  expect(checked.messages[0]).toMatchObject({ t: "check" });
  checked.finish("check", { webgpu: true, seconds: 2 });
  await expect(checking).resolves.toEqual({ webgpu: true, seconds: 2 });
  const loading = client.load("https://weights/", false); await flush();
  const loaded = MockWorker.workers[2];
  loaded.finish("load", { manifestHash: "expected", contextCap: 1024, stored: true });
  await expect(loading).resolves.toHaveProperty("stored", true);
});
