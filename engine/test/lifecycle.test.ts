import { expect, it, vi } from "vitest";
import { download } from "../src/gpu.ts";
import { loadWeights, type Manifest } from "../src/manifest.ts";

it("releases allocated weights when a download fails", async () => {
  const buffers: { destroy: ReturnType<typeof vi.fn> }[] = [];
  const dev = { createBuffer: () => { const b = { destroy: vi.fn() }; buffers.push(b); return b; } } as unknown as GPUDevice;
  const manifest = { tensors: [{ name: "dict", bytes: 16 }, { name: "final_norm", bytes: 16 }],
    files: [{ name: "chunk.bin", bytes: 32, sha256: "" }] } as Manifest;
  await expect(loadWeights(dev, manifest, async () => { throw new Error("disconnected"); })).rejects.toThrow("disconnected");
  expect(buffers).toHaveLength(2);
  for (const b of buffers) expect(b.destroy).toHaveBeenCalledOnce();
});

it("releases the readback buffer when the device is lost while mapping", async () => {
  const destroy = vi.fn();
  const dev = { createBuffer: () => ({ mapAsync: async () => { throw new Error("device lost"); }, destroy }),
    createCommandEncoder: () => ({ copyBufferToBuffer: () => {}, finish: () => ({}) }), queue: { submit: () => {} } } as unknown as GPUDevice;
  await expect(download(dev, { size: 16 } as GPUBuffer)).rejects.toThrow("device lost");
  expect(destroy).toHaveBeenCalledOnce();
});
