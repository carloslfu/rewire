// Reading one exact number of a real tensor. The plates on the 3D stage pool many numbers into a
// tile and answer a pointer; these tests hold the benches to more than that: every matrix offered by
// name, every number reachable by its own row and column with ordinary fields and buttons, live
// value and change side by side, and the counts the retired flat weight maps used to give.
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { initialLesson, LESSON_RANK } from "@rewire/engine/src/lora.ts";
import { layout, TINY } from "@rewire/tiny/src/config.ts";
import { VOCAB } from "@rewire/tiny/src/data.ts";
import { weightStats } from "@rewire/tiny/src/lab.ts";
import { QWEN_INFO } from "../src/model/info.ts";
import { layerPlates, lessonPlates, lessonStats, tileOf, tinyLayerPlates } from "../src/stage/adapters.ts";
import { defaultCell, exact, lessonMatrices, matrixStats, plateMatrices, tinyMatrices } from "../src/stage/matrices.ts";
import { MatrixInspector, resolveCell } from "../src/stage/MatrixInspector.tsx";

let store: typeof import("../src/state/store.ts").store;
let initial: typeof import("../src/state/store.ts").initial;
let Teach: typeof import("../src/stage/TeachStage.tsx").default;
let Grow: typeof import("../src/stage/GrowStage.tsx").default;

beforeEach(async () => {
  vi.resetModules();
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  vi.stubGlobal("document", { documentElement: { dataset: {} } });
  vi.stubGlobal("getComputedStyle", () => ({ getPropertyValue: () => "#808080" }));
  ({ store, initial } = await import("../src/state/store.ts"));
  store.set(initial);
  Teach = (await import("../src/stage/TeachStage.tsx")).default;
  Grow = (await import("../src/stage/GrowStage.tsx")).default;
});
afterEach(() => vi.unstubAllGlobals());

/** Markup without the markers React puts between adjacent pieces of text. */
const render = (node: Parameters<typeof renderToString>[0]) => renderToString(node).replace(/<!-- -->/g, "");
const text = (html: string) => html.replace(/<!-- -->/g, "").replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/\s+/g, " ");
const cfg = { ...TINY, vocab: VOCAB }, { tensors, total } = layout(cfg);
const tensor = (name: string) => tensors.find((t) => t.name === name)!;
const W = 1024, U = 3072;

/** A tiny model whose f3.down[6, 8] moved by 0.75 and whose f1.q[3, 4] moved by −0.5 since the start. */
function trainedTiny() {
  const reference = Float32Array.from({ length: total }, (_, i) => Math.cos(i * 0.11) * 0.02), params = reference.slice();
  const down = tensor("f3.down"), q = tensor("f1.q");
  params[down.offset + 5 * 384 + 7] += 0.75;
  params[q.offset + 2 * 128 + 3] -= 0.5;
  return { reference, params, down, q };
}
/** An adapter whose B[11, 6] was set to 3 and whose A[3, 10] moved by 0.25. */
function trainedLesson() {
  const reference = initialLesson({ width: W, units: U }), trained = { a: reference.a.slice(), b: reference.b.slice() };
  trained.b[10 * LESSON_RANK + 5] = 3;
  trained.a[2 * U + 9] += 0.25;
  return { reference, trained };
}

it("offers every weight matrix of the tiny model by name, each over its own slice of the real parameters", () => {
  const { reference, params, down } = trainedTiny(), ms = tinyMatrices(cfg, params, reference);
  // The letter embeddings and seven for each of the four layers: every two-dimensional tensor of the layout, none left out.
  expect(ms).toHaveLength(29);
  expect(ms.map((m) => m.id).sort()).toEqual(tensors.filter((t) => t.shape.length === 2).map((t) => t.name).sort());
  expect(ms.slice(0, 8).map((m) => (m.group ? `${m.group} · ${m.name}` : m.name))).toEqual(["Letter embeddings", "Layer 1 · Queries", "Layer 1 · Keys", "Layer 1 · Values", "Layer 1 · Head output", "Layer 1 · MLP gate", "Layer 1 · MLP up", "Layer 1 · MLP down"]);
  const m = ms.find((x) => x.id === "f3.down")!, at = 5 * 384 + 7;
  expect([m.rows, m.cols, m.unit]).toEqual([128, 384, "weight"]);
  expect(m.cell(5, 7)).toBe("W_down[6, 8]");
  // The numbers are the parameter array itself, not a copy: a training snapshot is what is read.
  expect((m.values as Float32Array).buffer).toBe(params.buffer);
  expect(m.values[at]).toBe(params[down.offset + at]);
  expect(m.start![at]).toBe(reference[down.offset + at]);
  // Its movement is this matrix's own, and agrees with the lab's statistics on the same slice.
  const stats = matrixStats(m), lab = weightStats(params.subarray(down.offset, down.offset + down.size), reference.subarray(down.offset, down.offset + down.size));
  expect(stats.change).toMatchObject({ changed: 1, at });
  expect(stats.change!.max).toBeCloseTo(0.75, 6);
  expect(stats.change!.rms).toBeCloseTo(lab.rms, 9);
  expect([stats.count, stats.unavailable]).toEqual([128 * 384, 0]);
  expect(defaultCell(m)).toBe(at);
  // Per-matrix movement adds up to the whole model's: two weights changed, one in each of two matrices.
  const moved = ms.map((x) => matrixStats(x).change!);
  expect(moved.reduce((n, c) => n + c.changed, 0)).toBe(weightStats(params, reference).changed);
  expect(ms.filter((_, i) => moved[i].rms > 0).map((x) => x.id)).toEqual(["f1.q", "f3.down"]);
  expect(Math.max(...moved.map((c) => c.max))).toBeCloseTo(weightStats(params, reference).max, 6);
  // A matrix that has not moved opens on its largest weight, and one with no start states no change at all.
  const still = ms.find((x) => x.id === "f0.down")!;
  expect(defaultCell(still)).toBe(matrixStats(still).now.at);
  const now = tinyMatrices(cfg, params, null).find((x) => x.id === "f3.down")!;
  expect(now.start).toBeUndefined();
  expect(matrixStats(now).change).toBeUndefined();
  // Each matrix knows the part whose plates draw it, and its id is that plate's id.
  expect(m.part).toEqual({ kind: "layer", floor: 3 });
  expect(ms[0].part).toEqual({ kind: "embed" });
  const plates = tinyLayerPlates(cfg, params, reference, 3), plate = plates.find((p) => p.id === m.id)!;
  expect(plates.map((p) => p.id)).toEqual(ms.filter((x) => x.group === "Layer 4").map((x) => x.id));
  // The exact weight and the pooled tile that stands for it are the same cell: the tile is found from the weight and names it back.
  const tile = tileOf(plate, at)!;
  expect(tile).toEqual({ row: 5, col: 2 });
  expect(plate.origin(tile.row, tile.col).index).toBe(at);
  expect(tileOf(plate, 128 * 384)).toBeNull();
  expect(tileOf(plate, -1)).toBeNull();
});

it("reads the adapter's A and B by their real indices, with B on its side as the stage draws it", () => {
  const { reference, trained } = trainedLesson();
  const [b, a, rank] = lessonMatrices(trained, reference, W, U, { kind: "mlp", floor: 27 });
  expect([b.id, a.id, rank.id]).toEqual(["lora.b", "lora.a", "lora.rank"]);
  expect([b.name, a.name, rank.name]).toEqual(["Matrix B · writes to the stream", "Matrix A · reads the neurons", "Rank size"]);
  expect([b.rows, b.cols, a.rows, a.cols, rank.rows, rank.cols]).toEqual([8, 1024, 8, 3072, 8, 1]);
  expect([b.axes, a.axes]).toEqual([["rank", "stream number"], ["rank", "neuron"]]);
  // B[11, 6] in the model: rank 6 is row 5 here, stream number 11 is column 10. The name stays the model's own.
  const at = 5 * W + 10;
  expect(b.cell(5, 10)).toBe("B[11, 6]");
  expect([b.values[at], b.start![at]]).toEqual([3, reference.b[10 * LESSON_RANK + 5]]);
  expect(a.cell(2, 9)).toBe("A[3, 10]");
  expect(a.values[2 * U + 9] - a.start![2 * U + 9]).toBeCloseTo(0.25, 6);
  // A and B together are the adapter: their own counts add up to the whole adapter's.
  const sb = matrixStats(b).change!, sa = matrixStats(a).change!, all = lessonStats(trained, reference);
  expect([sb.changed, sa.changed]).toEqual([1, 1]);
  expect(sb.changed + sa.changed).toBe(all.changed);
  expect(Math.max(sb.max, sa.max)).toBeCloseTo(all.max, 6);
  expect(Math.sqrt((sb.rms ** 2 * b.values.length + sa.rms ** 2 * a.values.length) / (b.values.length + a.values.length))).toBeCloseTo(all.rms, 9);
  expect(defaultCell(b)).toBe(at);
  expect(defaultCell(a)).toBe(2 * U + 9);
  // The size of each rank moved too, from nothing: B started at zero.
  expect(matrixStats(rank).change!.changed).toBe(1);
  expect(rank.cell(5, 0)).toBe("rank 6");
  // The same cell on the plate the stage draws: the weight finds its tile, and the tile names the weight.
  const plate = lessonPlates(trained, reference, W, U).find((p) => p.id === "lora.b")!, tile = tileOf(plate, at)!;
  expect(plate.origin(tile.row, tile.col).index).toBe(at);
  expect(plate.values[tile.row * plate.cols + tile.col]).toBe(3);
});

it("reads a layer's measured values one number at a time: a vector by one index, attention by head and by position from 0", () => {
  const detail = new Map<string, Float32Array>();
  detail.set("f3.x", Float32Array.from({ length: 1024 }, (_, i) => (i === 700 ? -4 : i * 0.001)));
  detail.set("f3.probs", Float32Array.from({ length: 16 * 5 }, (_, i) => (i === 13 * 5 + 2 ? 0.9 : 0.02)));
  detail.set("f3.scores", Float32Array.from({ length: 16 * 5 }, (_, i) => (i % 5 === 4 ? Number.NEGATIVE_INFINITY : i * 0.1)));
  const plates = layerPlates(QWEN_INFO, detail, 3), ms = plateMatrices(plates, { kind: "layer", floor: 3 });
  expect(ms.map((m) => m.id)).toEqual(["x", "scores", "probs"]);
  // The stream is drawn folded into a block, and is read as what it is: 1,024 numbers with one index.
  const x = ms[0], drawn = plates[0];
  expect([drawn.source.rows, drawn.source.cols]).toEqual([16, 64]);
  expect([x.rows, x.cols, x.axes, x.first, x.unit]).toEqual([1, 1024, ["", "number"], [1, 1], "value"]);
  expect(x.cell(0, 700)).toBe("number 701");
  expect(x.values[700]).toBe(-4);
  expect(defaultCell(x)).toBe(700);
  expect(tileOf(drawn, 700)).toEqual({ row: 10, col: 60 });
  expect(drawn.origin(10, 60).index).toBe(700);
  // Attention is read by head and by position in the context, which starts at 0 as the model counts it.
  const probs = ms[2];
  expect([probs.rows, probs.cols, probs.axes, probs.first]).toEqual([16, 5, ["head", "position"], [1, 0]]);
  expect(probs.cell(13, 2)).toBe("head 14, position 2");
  expect(probs.values[13 * 5 + 2]).toBeCloseTo(0.9, 6);
  // Masked scores are not numbers: they are counted as unavailable and left out of the sizes.
  const scores = matrixStats(ms[1]);
  expect(scores.unavailable).toBe(16);
  expect(scores.now.max).toBeCloseTo(7.8, 5);
  expect(Number.isFinite(scores.now.rms)).toBe(true);
  expect(scores.change).toBeUndefined();
});

it("writes a number with enough digits to tell neighbors apart, and names one that is not a number", () => {
  expect(exact(0)).toBe("0");
  expect(exact(0.5)).toBe("+0.500000");
  expect(exact(-0.000123)).toBe("−0.000123");
  expect(exact(-12.3456)).toBe("−12.3456");
  expect(exact(1234.56)).toBe("+1234.6");
  expect(exact(Number.NaN)).toBe("not a number");
  expect(exact(Number.NEGATIVE_INFINITY)).toBe("−∞");
});

it("keeps the visitor's own number while its matrix is offered, and otherwise opens where the matrix moved the most", () => {
  const { reference, params } = trainedTiny(), ms = tinyMatrices(cfg, params, reference);
  // Nothing chosen: the preferred matrix, or the first, at its default number.
  expect(resolveCell(ms, null)).toEqual({ id: "dict", index: defaultCell(ms[0]) });
  expect(resolveCell(ms, null, "f3.down")).toEqual({ id: "f3.down", index: 5 * 384 + 7 });
  // A matrix chosen by name (index below zero) opens on its default number; a number chosen stays exactly that one.
  expect(resolveCell(ms, { id: "f1.q", index: -1 }, "f3.down")).toEqual({ id: "f1.q", index: 2 * 128 + 3 });
  const own = { id: "f1.q", index: 17 };
  expect(resolveCell(ms, own, "f3.down")).toBe(own);
  // A number the matrix does not have, or a matrix that is not offered, falls back instead of reading out of bounds.
  expect(resolveCell(ms, { id: "f1.q", index: 128 * 128 })).toEqual({ id: "f1.q", index: 2 * 128 + 3 });
  expect(resolveCell(ms, { id: "gone", index: 3 }, "f3.down")).toEqual({ id: "f3.down", index: 5 * 384 + 7 });
  expect(resolveCell([], { id: "f1.q", index: 3 })).toBeNull();
});

it("reads one weight exactly by row and column, with fields and buttons for the keyboard and for touch", () => {
  const { reference, trained } = trainedLesson(), ms = lessonMatrices(trained, reference, W, U);
  let html = render(<MatrixInspector matrices={ms} cell={resolveCell(ms, null)} onCell={() => {}} heading="Read one adapter weight" empty="Nothing yet." difference onLook={() => {}} />);
  let t = text(html);
  // The matrix is chosen by name from an ordinary menu.
  expect([...html.matchAll(/<option value="([^"]+)"[^>]*>([^<]*)<\/option>/g)].map((m) => [m[1], m[2]])).toEqual([["lora.b", "Matrix B · writes to the stream"], ["lora.a", "Matrix A · reads the neurons"], ["lora.rank", "Rank size"]]);
  expect(html).toMatch(/<option value="lora\.b" selected="">/);
  expect(t).toContain("1,024 × 8 weights, one row here for each rank · m += B z");
  // Each coordinate is a labelled number field with its range, and a step either way that a finger can press.
  const field = (name: string) => {
    const id = new RegExp(`<label for="([^"]+)">${name} <span class="note">([^<]*)</span></label>`).exec(html)!;
    const input = new RegExp(`<input[^>]*id="${id[1]}"[^>]*>`).exec(html)![0];
    return { range: id[2], type: /type="(\w+)"/.exec(input)![1], min: /min="(\d+)"/.exec(input)![1], max: /max="(\d+)"/.exec(input)![1], value: /value="(\d+)"/.exec(input)![1] };
  };
  expect(field("Rank")).toEqual({ range: "1 to 8", type: "number", min: "1", max: "8", value: "6" });
  expect(field("Stream number")).toEqual({ range: "1 to 1,024", type: "number", min: "1", max: "1024", value: "11" });
  for (const step of ["Previous rank", "Next rank", "Previous stream number", "Next stream number"]) expect(html).toMatch(new RegExp(`<button type="button" class="btn" aria-label="${step}">`));
  // The number itself: its real name, its value now, at the start, and the change. Also said aloud as it changes.
  expect(t).toContain("B[11, 6] Now +3.0000 At the start 0 Change +3.0000");
  expect(html).toContain('<p class="sr-only" aria-live="polite">B[11, 6]: now +3.0000, at the start 0, change +3.0000</p>');
  // Around it, exact neighbors as buttons: 5 by 5, one of them current and the only one in the tab order.
  const cells = [...html.matchAll(/<button type="button" class="matrix-cell num"([^>]*)>([^<]*)<\/button>/g)].map((m) => ({ attrs: m[1], shown: m[2] }));
  expect(cells).toHaveLength(25);
  const current = cells.filter((c) => c.attrs.includes('aria-current="true"'));
  expect(current).toHaveLength(1);
  expect(current[0].attrs).toContain('aria-label="B[11, 6]: +3.0000"');
  expect(current[0].attrs).toContain('tabindex="0"');
  expect(cells.filter((c) => c.attrs.includes('tabindex="0"'))).toHaveLength(1);
  expect(cells.filter((c) => c.attrs.includes('tabindex="-1"'))).toHaveLength(24);
  expect(cells.some((c) => c.attrs.includes('aria-label="B[10, 6]: 0"'))).toBe(true);
  expect(cells.some((c) => c.attrs.includes('aria-label="B[11, 5]: 0"'))).toBe(true);
  expect(html).toMatch(/<table class="matrix-window" aria-label="Exact changes since the start around B\[11, 6\]\. Arrow keys move one number at a time; Page Up and Page Down move 5 rows\."/);
  expect(t).toContain("Change since the start, around the one being read");
  // This matrix's own counts, and the two jumps.
  expect(t).toContain("Weights changed 1 of 8,192");
  expect(t).toContain("Largest change 3.00000");
  for (const jump of ["Largest change", "Largest weight", "Show on the model"]) expect(html).toMatch(new RegExp(`<button[^>]*>${jump}</button>`));
  // Nothing here depends on a pointer, and nothing prints a raw not-a-number.
  expect(html).not.toMatch(/[Hh]over|NaN/);

  // Weights now: the same number, and its neighbors as they are instead of as they moved.
  const a = { id: "lora.a", index: 2 * U + 9 };
  html = render(<MatrixInspector matrices={ms} cell={a} onCell={() => {}} heading="Read one adapter weight" empty="Nothing yet." />);
  t = text(html);
  expect(field("Rank").value).toBe("3");
  expect(field("Neuron")).toMatchObject({ range: "1 to 3,072", max: "3072", value: "10" });
  expect(t).toContain("Weights now, around the one being read");
  expect(t).toMatch(new RegExp(`A\\[3, 10\\] Now ${exact(trained.a[2 * U + 9]).replace(/[+.]/g, "\\$&")} At the start ${exact(reference.a[2 * U + 9]).replace(/[+.]/g, "\\$&")} Change \\+0\\.25`));
  expect(html).toContain(`aria-label="A[3, 10]: ${exact(trained.a[2 * U + 9])}"`);
  // A column of eight numbers has one coordinate, not two.
  html = render(<MatrixInspector matrices={ms} cell={{ id: "lora.rank", index: 5 }} onCell={() => {}} heading="Read one adapter weight" empty="Nothing yet." />);
  expect(field("Rank").value).toBe("6");
  expect(html.match(/<input/g)).toHaveLength(1);
  expect(text(html)).toContain("rank 6 Now");

  // Measurements have no earlier state: one value, and no change is claimed.
  const detail = new Map<string, Float32Array>([["f3.probs", Float32Array.from({ length: 16 * 5 }, (_, i) => (i === 13 * 5 + 2 ? 0.9 : 0.02))]]);
  const measured = plateMatrices(layerPlates(QWEN_INFO, detail, 3));
  html = render(<MatrixInspector matrices={measured} cell={resolveCell(measured, null)} onCell={() => {}} heading="Read one measured value" empty="" />);
  t = text(html);
  expect(field("Head")).toMatchObject({ range: "1 to 16", value: "14" });
  expect(field("Position")).toEqual({ range: "0 to 4", type: "number", min: "0", max: "4", value: "2" });
  expect(t).toContain("head 14, position 2 Value +0.900000");
  expect(t).not.toMatch(/At the start|Largest change|changed/);
  expect(t).toContain("Values 80");

  // With nothing to read yet it says so, and offers no field that would read nothing.
  html = render(<MatrixInspector matrices={[]} cell={null} onCell={() => {}} heading="Read one weight" empty="The weights can be read here once learning has started." />);
  expect(text(html)).toContain("Read one weight The weights can be read here once learning has started.");
  expect(html).not.toMatch(/<select|<input|<table/);
});

it("keeps Teach's A and B, their counts, the loss and the handoff in the 3D bench, with each weight readable without a pointer", () => {
  const { reference, trained } = trainedLesson();
  const controls = { busy: false, phase: "idle" as const, ready: true, validation: "", status: "", error: "", revision: 1, train() {}, halt() {}, dismantle() {} };
  const props = { reference, running: false, active: true, controls };
  // Before any lesson the place for the numbers is there and says what will appear.
  let html = render(<Teach {...props} weights={null} step={0} losses={[]} run={null} />), t = text(html);
  expect(t).toContain("Read one adapter weight Start a lesson to read its real parameter updates here, one weight at a time.");
  expect(t).toContain("Parameters changed Waiting");
  // After one: both matrices by name, the adapter's counts, this matrix's own, and one exact weight.
  html = render(<Teach {...props} weights={trained} step={200} losses={[{ step: 0, loss: 3 }, { step: 200, loss: 0.5 }]}
    run={{ weights: trained, steps: 200, seconds: 4, tokens: 900, stopped: false, initialLoss: 2.5, finalLoss: 0.0004 }} />);
  t = text(html);
  for (const name of ["Matrix B · writes to the stream", "Matrix A · reads the neurons", "Rank size"]) expect(html).toContain(`>${name}</option>`);
  expect(t).toContain("Parameters changed 2");
  expect(t).toContain("B[11, 6] Now +3.0000 At the start 0 Change +3.0000");
  expect(t).toContain("Weights changed 1 of 8,192");
  // Live weights or their change is one switch for the plates and for the numbers beside them.
  expect(html).toMatch(/<div class="seg" role="group" aria-label="Plates show"><button type="button" aria-pressed="true">Change from original adapter<\/button><button type="button" aria-pressed="false">Weights now<\/button>/);
  // The loss of the round and of the full lesson, where a tiny final loss is not printed as zero.
  expect(t).toContain("Prediction error · this round");
  expect(t).toContain("Full lesson: 2.500 to <0.001.");
  // What is learning, where, and the way on to Dismantle.
  expect(t).toContain("Layers 1 to 27 are frozen, the learned addition B × A runs inside layer 28’s MLP");
  expect(t).toContain("Real training parameters, installed for inference when the round ends. Snapshots arrive every 10 steps.");
  expect(html).toMatch(/<button type="button" class="btn">Dismantle this model<\/button>/);
  expect(html).not.toMatch(/[Hh]over a tile|[Hh]over or tap|NaN|—/);
});

it("keeps Grow's weight counts and every matrix's movement in the 3D bench, with each weight readable without a pointer", () => {
  const { reference, params } = trainedTiny();
  const controls = { disabled: false, unavailable: false, validText: true, status: "", loss: null, mutation: "", damage: null, strength: 0.25, setStrength() {}, teach() {}, stop() {},
    mutate() {}, restore() {}, keepLabel: "Keep learning", continueNote: "", retrained: 0, intactStep: 1200, adopt() {}, prompt: "red star = ", setPrompt() {}, test() {}, result: null, baseline: null };
  const props = { running: false, active: true, controls };
  let html = render(<Grow {...props} params={null} reference={null} intact={null} step={0} />);
  expect(text(html)).toContain("Read one weight The weights can be read here, one at a time, once learning has started.");
  expect(text(html)).toContain("Weights changed Waiting");
  expect(html).not.toContain("matrix-movement");

  html = render(<Grow {...props} params={params} reference={reference} intact={params} step={1200} />);
  const t = text(html);
  // Every matrix is a choice, by layer and by name.
  const options = [...html.matchAll(/<option value="((?:f\d\.\w+)|dict)"[^>]*>([^<]*)<\/option>/g)].map((m) => m[2]);
  expect(options).toHaveLength(29);
  expect(options.slice(0, 3)).toEqual(["Letter embeddings", "Layer 1 · Queries", "Layer 1 · Keys"]);
  expect(options.at(-1)).toBe("Layer 4 · MLP down");
  // The whole model's counts, as the flat weight map gave them.
  expect(t).toContain(`Weights changed ${weightStats(params, reference).changed} RMS change ${weightStats(params, reference).rms.toFixed(5)} Largest change 0.75000`);
  expect(t).toContain(`over all ${total.toLocaleString("en-US")} trainable numbers`);
  expect(t).toContain("Snapshots arrive every 100 steps.");
  // Every matrix's own movement is a number on a button that opens that matrix: four layers of seven, and the letters.
  const movement = /<table class="matrix-movement">(.*?)<\/table>/.exec(html)![1];
  const moved = [...movement.matchAll(/<button type="button" class="matrix-cell num" aria-pressed="(\w+)"[^>]*aria-label="([^"]+)"[^>]*>([^<]*)<\/button>/g)].map((m) => ({ pressed: m[1], label: m[2], shown: m[3] }));
  expect(moved).toHaveLength(29);
  expect(moved.filter((m) => m.shown !== "0.0000").map((m) => m.label)).toEqual([
    `Layer 2 · Queries: RMS change ${(0.5 / Math.sqrt(128 * 128)).toFixed(5)}`, `Layer 4 · MLP down: RMS change ${(0.75 / Math.sqrt(128 * 384)).toFixed(5)}`]);
  expect(moved.at(-1)!.label).toBe("Letter embeddings: RMS change 0.00000");
  expect(text(movement)).toContain("RMS change of each matrix since the start. Select one to read its weights.");
  // With nothing selected on the stage the reading opens where the flat map did, and that matrix is the one marked.
  expect(moved.filter((m) => m.pressed === "true").map((m) => m.label)).toEqual(["Layer 1 · MLP down: RMS change 0.00000"]);
  expect(html).toMatch(/<option value="f0\.down" selected="">Layer 1 · MLP down<\/option>/);
  expect(t).toMatch(/W_down\[\d+, \d+\] Now [+−]0\.\d{6} At the start [+−]0\.\d{6} Change 0/);
  // Live weights or their change is one switch for the colors, the plates and the numbers.
  expect(html).toMatch(/aria-label="Colors show"><button type="button" aria-pressed="true">Change since start<\/button><button type="button" aria-pressed="false">Weights now<\/button>/);
  // Each part is named in the menus with its own number.
  expect(html).toMatch(/<option value="1">Layer 2 · 0\.\d{5}<\/option>/);
  expect(html).not.toMatch(/[Hh]over a tile|[Hh]over or tap|NaN|—/);
});
