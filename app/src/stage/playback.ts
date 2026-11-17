// One token's measured values in the order the architecture computes them: the steps a replay walks
// through. The order is the model's; the pace is an illustration, not how long any step took on the GPU.
// Moving through the steps, and from token to token, is replay.ts.
import type { ModelInfo } from "../model/info.ts";
import type { Part } from "./arch.ts";

export type Beat =
  | { kind: "embed" }
  | { kind: "attention"; floor: number }
  | { kind: "mlp"; floor: number }
  | { kind: "output" };

type Shape = Pick<ModelInfo, "floors" | "heads">;

/** Read the token, then each layer's attention and MLP, then choose the word. */
export const beatCount = (model: Pick<ModelInfo, "floors">) => 2 + 2 * model.floors;

export function beatAt(model: Pick<ModelInfo, "floors">, index: number): Beat {
  const n = beatCount(model), i = Math.max(0, Math.min(n - 1, Math.floor(index)));
  if (i === 0) return { kind: "embed" };
  if (i === n - 1) return { kind: "output" };
  const floor = Math.floor((i - 1) / 2);
  return (i - 1) % 2 === 0 ? { kind: "attention", floor } : { kind: "mlp", floor };
}

/** The beat in which a part does its work, or -1 for parts the replay does not light. */
export function beatOf(model: Pick<ModelInfo, "floors">, p: Part): number {
  if (p.kind === "embed") return 0;
  if (p.kind === "head" || p.kind === "kv") return 1 + 2 * p.floor;
  if (p.kind === "mlp") return 2 + 2 * p.floor;
  if (p.kind === "norm" || p.kind === "unembed") return beatCount(model) - 1;
  return -1;
}

export function beatLabel(b: Beat): string {
  return b.kind === "embed" ? "Read the token" : b.kind === "output" ? "Choose the next token"
    : b.kind === "attention" ? `Layer ${b.floor + 1} · attention` : `Layer ${b.floor + 1} · MLP`;
}

/** How lit a part is at time t: dark before its beat, rising through it, fully lit after. */
export function lit(beat: number, t: number | null): number {
  if (t === null || beat < 0) return 1;
  return Math.max(0, Math.min(1, t - beat));
}

/** Sum of the direct pushes of every part that has worked by the end of each beat. */
export function runningPush(model: Shape, pushes: ArrayLike<number>): Float32Array {
  const n = beatCount(model), out = new Float32Array(n), per = model.heads + 1;
  let sum = pushes[0] ?? 0;
  out[0] = sum;
  for (let L = 0; L < model.floors; L++) {
    for (let h = 0; h < model.heads; h++) sum += pushes[1 + L * per + h] ?? 0;
    out[1 + 2 * L] = sum;
    sum += pushes[1 + L * per + model.heads] ?? 0;
    out[2 + 2 * L] = sum;
  }
  out[n - 1] = sum;
  return out;
}

/** The running sum at time t, counting only completed beats. */
export function pushSoFar(running: Float32Array, t: number | null): number {
  if (!running.length) return 0;
  if (t === null) return running[running.length - 1];
  const done = Math.min(running.length, Math.floor(t));
  return done <= 0 ? 0 : running[done - 1];
}

/** A playhead position kept inside the token: 0 is before anything ran, the beat count is everything lit. */
export function seek(t: number, beats: number): number {
  return Number.isFinite(t) ? Math.max(0, Math.min(beats, t)) : 0;
}

/** Height of the replay marker on the spine, as a fraction of the tower from the dictionary to the output. */
export function spineFraction(model: Pick<ModelInfo, "floors">, t: number | null): number {
  const n = beatCount(model);
  return t === null ? 1 : Math.max(0, Math.min(1, t / n));
}

/**
 * How revealed a detail plate is while its own layer replays: the plates of a beat appear one after
 * another through that beat, in computation order. With no replay running everything is shown.
 */
export function plateLit(floor: number, phase: "attention" | "mlp", index: number, count: number, t: number | null): number {
  if (t === null) return 1;
  const beat = (phase === "attention" ? 1 : 2) + 2 * floor;
  return Math.max(0, Math.min(1, (t - beat) * Math.max(1, count) - index));
}
