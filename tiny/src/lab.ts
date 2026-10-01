// CPU-side operations on the actual parameter array. No prompt or output rewriting.
import { layout, type TinyConfig } from "./config.ts";

export type Mutation = { kind: "erase" | "noise"; amount: number; seed: number; floor?: number };

export function mutateWeights(params: Float32Array, cfg: TinyConfig, mutation: Mutation): Float32Array {
  const out = params.slice();
  let seed = mutation.seed >>> 0;
  const random = () => {
    seed = (Math.imul(seed ^ (seed >>> 15), 2246822519) + 3266489917) >>> 0;
    return seed / 4294967296;
  };
  for (const tensor of layout(cfg).tensors) {
    if (tensor.shape.length !== 2 || (mutation.floor !== undefined && !tensor.name.startsWith(`f${mutation.floor}.`))) continue;
    let squares = 0;
    for (let i = tensor.offset; i < tensor.offset + tensor.size; i++) squares += params[i] ** 2;
    const rms = Math.sqrt(squares / tensor.size);
    for (let i = tensor.offset; i < tensor.offset + tensor.size; i++) {
      if (mutation.kind === "erase") { if (random() < mutation.amount) out[i] = 0; }
      else out[i] += (random() * 2 - 1) * Math.sqrt(3) * rms * mutation.amount;
    }
  }
  return out;
}

export function weightStats(params: Float32Array, before: Float32Array) {
  let changed = 0, sum = 0, max = 0;
  for (let i = 0; i < params.length; i++) {
    const d = params[i] - before[i];
    if (d !== 0) changed++;
    sum += d * d;
    max = Math.max(max, Math.abs(d));
  }
  return { changed, rms: Math.sqrt(sum / params.length), max };
}

/** A small compositional language. Diagonal combinations never enter the training corpus. */
export function secretLanguage() {
  const colors = [["red", "zor"], ["blue", "vek"], ["green", "nup"], ["gold", "fim"], ["white", "dal"], ["black", "tob"]];
  const shapes = [["circle", "mip"], ["square", "kef"], ["star", "wug"], ["moon", "pel"], ["ring", "saz"], ["cross", "hir"]];
  const train: string[] = [], tests: { prompt: string; answer: string }[] = [];
  colors.forEach(([color, a], i) => shapes.forEach(([shape, b], j) => {
    const prompt = `${color} ${shape} = `, answer = `${a} ${b}`;
    if (i === j) tests.push({ prompt, answer });
    else train.push(prompt + answer);
  }));
  return { text: train.join("\n") + "\n", tests };
}
