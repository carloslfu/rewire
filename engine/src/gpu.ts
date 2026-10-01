// Small WebGPU helpers shared by the engine and the tests.

export type Gpu = GPUDevice;

// WebGPU usage flags as numbers, so modules load before a test installs the WebGPU globals.
export const BU = { MAP_READ: 1, MAP_WRITE: 2, COPY_SRC: 4, COPY_DST: 8, UNIFORM: 64, STORAGE: 128 } as const;
const MAP_MODE_READ = 1;

export async function getDevice(gpu?: GPU, want: Partial<Record<string, number>> = {}): Promise<GPUDevice> {
  const g = gpu ?? (globalThis.navigator as Navigator | undefined)?.gpu;
  if (!g) throw new Error("WebGPU is not available");
  const adapter = await g.requestAdapter({ powerPreference: "high-performance" });
  if (!adapter) throw new Error("No WebGPU adapter");
  const limits: Record<string, number> = {};
  const lim = adapter.limits as unknown as Record<string, number>;
  for (const key of [
    "maxStorageBufferBindingSize",
    "maxBufferSize",
    "maxComputeWorkgroupStorageSize",
    "maxStorageBuffersPerShaderStage",
    "maxComputeInvocationsPerWorkgroup",
    "maxComputeWorkgroupSizeX",
  ]) {
    if (lim[key] !== undefined) limits[key] = Math.min(lim[key], want[key] ?? lim[key]);
  }
  const dev = await adapter.requestDevice({ requiredLimits: limits });
  // Keep the GPU object alive as long as the device: Dawn's Node bindings crash if it is collected.
  (dev as unknown as { __gpu: GPU }).__gpu = g;
  return dev;
}

export function buffer(dev: GPUDevice, size: number, usage: number, label?: string): GPUBuffer {
  return dev.createBuffer({ size: Math.max(16, Math.ceil(size / 16) * 16), usage, label });
}

export const STORAGE = BU.STORAGE | BU.COPY_DST | BU.COPY_SRC;

export function storage(dev: GPUDevice, size: number, label?: string): GPUBuffer {
  return buffer(dev, size, STORAGE, label);
}

export function upload(dev: GPUDevice, data: ArrayBufferView, label?: string): GPUBuffer {
  const b = storage(dev, data.byteLength, label);
  dev.queue.writeBuffer(b, 0, data.buffer, data.byteOffset, data.byteLength);
  return b;
}

export async function download(dev: GPUDevice, src: GPUBuffer, size = src.size, offset = 0): Promise<ArrayBuffer> {
  const rb = dev.createBuffer({ size, usage: BU.MAP_READ | BU.COPY_DST });
  const enc = dev.createCommandEncoder();
  enc.copyBufferToBuffer(src, offset, rb, 0, size);
  dev.queue.submit([enc.finish()]);
  await rb.mapAsync(MAP_MODE_READ);
  const out = rb.getMappedRange().slice(0);
  rb.unmap();
  rb.destroy();
  return out;
}

export class Pipelines {
  private cache = new Map<string, GPUComputePipeline>();
  constructor(private dev: GPUDevice) {}

  get(key: string, code: string, entry = "main"): GPUComputePipeline {
    let p = this.cache.get(key);
    if (!p) {
      const module = this.dev.createShaderModule({ code, label: key });
      p = this.dev.createComputePipeline({ layout: "auto", compute: { module, entryPoint: entry }, label: key });
      this.cache.set(key, p);
    }
    return p;
  }
}

/** A bind group for a pipeline from a list of buffers, bound in order from binding 0. */
export function bind(dev: GPUDevice, p: GPUComputePipeline, buffers: (GPUBuffer | { buffer: GPUBuffer; offset?: number; size?: number })[]): GPUBindGroup {
  return dev.createBindGroup({
    layout: p.getBindGroupLayout(0),
    entries: buffers.map((b, i) => ({ binding: i, resource: "buffer" in b ? b : { buffer: b } })),
  });
}

export interface Dispatch {
  pipeline: GPUComputePipeline;
  group: GPUBindGroup;
  x: number;
  y?: number;
  z?: number;
}

export function encode(enc: GPUCommandEncoder, list: Dispatch[]) {
  const pass = enc.beginComputePass();
  for (const d of list) {
    pass.setPipeline(d.pipeline);
    pass.setBindGroup(0, d.group);
    pass.dispatchWorkgroups(d.x, d.y ?? 1, d.z ?? 1);
  }
  pass.end();
}

export function f16(x: number): number {
  // float32 -> float16 bits, round to nearest even (for tests and synthetic data)
  const f32 = new Float32Array([x]);
  const u = new Uint32Array(f32.buffer)[0];
  const sign = (u >>> 16) & 0x8000;
  let exp = ((u >>> 23) & 0xff) - 127 + 15;
  let mant = u & 0x7fffff;
  if (((u >>> 23) & 0xff) === 0xff) return sign | 0x7c00 | (mant ? 0x200 : 0);
  if (exp >= 0x1f) return sign | 0x7c00;
  if (exp <= 0) {
    if (exp < -10) return sign;
    mant = (mant | 0x800000) >>> (1 - exp);
    const r = mant & 0x1fff;
    let h = mant >>> 13;
    if (r > 0x1000 || (r === 0x1000 && (h & 1))) h++;
    return sign | h;
  }
  const r = mant & 0x1fff;
  let h = (exp << 10) | (mant >>> 13);
  if (r > 0x1000 || (r === 0x1000 && (h & 1))) h++;
  return sign | h;
}

export function fromF16(h: number): number {
  const s = h & 0x8000 ? -1 : 1;
  const e = (h >>> 10) & 0x1f;
  const m = h & 0x3ff;
  if (e === 0) return s * m * 2 ** -24;
  if (e === 0x1f) return m ? NaN : s * Infinity;
  return s * (1 + m / 1024) * 2 ** (e - 15);
}
