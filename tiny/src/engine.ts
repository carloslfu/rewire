// Train with jax-js, explain with the engine: the trained flat parameters become engine weights on its
// 32-bit path, so the tiny model gets the same views and changes as the real one.
import type { ModelConfig } from "@rewire/engine/src/config.ts";
import { upload } from "@rewire/engine/src/gpu.ts";
import type { FloorWeights, Weights } from "@rewire/engine/src/model.ts";
import { layout, type TinyConfig } from "./config.ts";

export function engineConfig(c: TinyConfig, maxContext = 256): ModelConfig {
  return {
    name: "tiny", floors: c.floors, width: c.width, queryHeads: c.heads, kvHeads: c.kvHeads, headSize: c.headSize, units: c.units,
    vocabRows: c.vocab, vocabReal: c.vocab, ropeTheta: c.theta, eps: c.eps, maxContext, group: 32, dictBits: 32, floorBits: 32,
  };
}

export function engineWeights(dev: GPUDevice, c: TinyConfig, P: Float32Array): Weights {
  const { tensors } = layout(c);
  const t = (name: string) => {
    const x = tensors.find((u) => u.name === name)!;
    return P.subarray(x.offset, x.offset + x.size);
  };
  const up = (name: string) => upload(dev, new Float32Array(t(name)), name);
  const dict = t("dict");
  const mean = new Float32Array(c.width);
  for (let r = 0; r < c.vocab; r++) for (let i = 0; i < c.width; i++) mean[i] += dict[r * c.width + i] / c.vocab;
  const floors: FloorWeights[] = [];
  for (let L = 0; L < c.floors; L++) {
    const qk = new Float32Array(2 * c.headSize);
    qk.set(t(`f${L}.q_norm`), 0);
    qk.set(t(`f${L}.k_norm`), c.headSize);
    floors.push({
      q: up(`f${L}.q`), k: up(`f${L}.k`), v: up(`f${L}.v`), o: up(`f${L}.o`), gate: up(`f${L}.gate`), up: up(`f${L}.up`),
      down: up(`f${L}.down`), inNorm: up(`f${L}.in_norm`), postNorm: up(`f${L}.post_norm`), qkNorm: upload(dev, qk, `f${L}.qk_norm`),
    });
  }
  return { dict: up("dict"), finalNorm: up("final_norm"), meanRow: upload(dev, mean, "mean_row"), floors };
}
