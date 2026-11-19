import type { LessonWeights } from "@rewire/engine/src/lora.ts";
export interface LessonUpdate {
  phase: "reading" | "training";
  step: number;
  total: number;
  /**
   * Cross entropy of one sampled batch, measured before an update. `lossStep` is the number of updates
   * the adapter had received when it was measured, which is one fewer than `step`.
   */
  loss?: number;
  lossStep?: number;
  weights?: LessonWeights;
}
export interface LessonResult {
  /**
   * The adapter to install, or null when nothing may be installed: no step ran, or a fresh adapter
   * that would replace an installed lesson was stopped before it finished (`discarded`).
   */
  weights: LessonWeights | null;
  /** Updates applied this round, out of `total` requested. */
  steps: number;
  total: number;
  /** A stopped fresh restart: its partial adapter was dropped and the installed lesson stays as it was. */
  discarded: boolean;
  seconds: number;
  tokens: number;
  stopped: boolean;
  initialLoss: number | null;
  finalLoss: number | null;
}
export interface ProbeResult { text: string; ended: boolean; cancelled: boolean }
