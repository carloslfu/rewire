import { beforeAll, expect, it } from "vitest";
import { encodeTable, isNeutral, type HeadGeometry } from "../src/changes.ts";
import { tableLayout, type ModelConfig } from "../src/config.ts";
import { transformHead, vectorStats } from "../src/geometry.ts";
import { bind, download, encode, getDevice, storage, upload } from "../src/gpu.ts";
import { headGeometryKernel } from "../src/kernels.ts";

let dev: GPUDevice;
beforeAll(async () => {
  const wg = await import("webgpu"); Object.assign(globalThis, wg.globals); dev = await getDevice(wg.create([]));
});
for (const width of [128, 1024]) {
  it(`preserves the geometric invariants on the GPU at width ${width}`, async () => {
    const cfg = { width, floors: 1, queryHeads: 4 } as ModelConfig;
    const v = Float32Array.from({ length: width }, (_, i) => Math.sin(i * 1.33) + i / width);
    const x = Float32Array.from(v, (a, i) => a + Math.cos(i * 0.1));
    const input = upload(dev, Float32Array.from({ length: width * 4 }, (_, i) => v[i % width]));
    const stream = upload(dev, x), changed = storage(dev, width * 4 * 4);
    const sp = dev.createBuffer({ size: 64, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    dev.queue.writeBuffer(sp, 0, new Uint32Array([1, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]));
    const fp = dev.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    const p = dev.createComputePipeline({ layout: "auto", compute: { module: dev.createShaderModule({ code: headGeometryKernel({ cfg, lay: tableLayout(cfg) }) }), entryPoint: "main" } });
    for (const transform of [
      { kind: "rotate", angle: 0, seed: 1 }, { kind: "rotate", angle: 45, seed: 22 },
      { kind: "rotate", angle: 90, seed: 1 }, { kind: "rotate", angle: -90, seed: 100 },
      { kind: "rotate", angle: 180, seed: 999 }, { kind: "remove", amount: 1 },
      { kind: "remove", amount: 0.5 }, { kind: "shuffle", seed: 99 },
    ] as const) {
      const g: HeadGeometry = { ...transform, floor: 0, head: 0 };
      const ct = upload(dev, encodeTable({ geometry: [g] }, cfg));
      const enc = dev.createCommandEncoder();
      encode(enc, [{ pipeline: p, group: bind(dev, p, [input, stream, ct, sp, fp, changed]), x: 1, y: 4 }]);
      dev.queue.submit([enc.finish()]);
      const all = new Float32Array(await download(dev, changed)), y = all.slice(0, width);
      const expected = transformHead(v, x, g), stats = vectorStats(v, y, x);
      expect(Math.max(...y.map((a, i) => Math.abs(a - expected[i])))).toBeLessThan(1e-5);
      // Other heads remain untouched, including when their geometry table entries are zero.
      expect(all.slice(width, 2 * width)).toEqual(v);
      if (g.kind === "rotate") {
        expect(stats.ratio).toBeCloseTo(1, 6);
        expect(stats.angle).toBeCloseTo(Math.abs(g.angle), 4);
        if (g.angle === 180) expect(Math.max(...y.map((a, i) => Math.abs(a + v[i])))).toBe(0);
      }
      if (g.kind === "shuffle") {
        expect(stats.ratio).toBeCloseTo(1, 7);
        expect(Array.from(y).sort()).toEqual(Array.from(v).sort());
      }
      if (g.kind === "remove" && g.amount === 1) expect(stats.streamCosine).toBeCloseTo(0, 6);
      ct.destroy();
    }
    for (const b of [input, stream, changed, sp, fp]) b.destroy();
  });
}

it("validates transforms and treats zero-strength controls as neutral", () => {
  const cfg = { width: 128, floors: 2, queryHeads: 4 };
  expect(isNeutral({ geometry: [{ floor: 0, head: 1, kind: "rotate", angle: 0, seed: 1 }] })).toBe(true);
  expect(isNeutral({ geometry: [{ floor: 0, head: 1, kind: "remove", amount: 0 }] })).toBe(true);
  expect(isNeutral({ geometry: [{ floor: 0, head: 1, kind: "shuffle", seed: 1 }] })).toBe(false);
  expect(() => encodeTable({ geometry: [{ floor: 2, head: 0, kind: "remove", amount: 1 }] }, cfg)).toThrow();
  expect(() => encodeTable({ geometry: [{ floor: 0, head: 0, kind: "rotate", angle: NaN, seed: 1 }] }, cfg)).toThrow();
  const zero = new Float32Array(128);
  const y = transformHead(zero, zero, { floor: 0, head: 0, kind: "remove", amount: 1 });
  expect(Array.from(y)).toEqual(Array.from(zero));
  expect(vectorStats(zero, y).angle).toBeNull();
});
