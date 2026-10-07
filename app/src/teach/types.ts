import type { LessonWeights } from "@rewire/engine/src/lora.ts";
export interface LessonUpdate {
  phase: "reading" | "training";
  step: number;
  total: number;
  loss?: number;
  weights?: LessonWeights;
}
export interface LessonResult {
  weights: LessonWeights | null;
  steps: number;
  seconds: number;
  tokens: number;
  stopped: boolean;
  initialLoss: number | null;
  finalLoss: number | null;
}
export interface ProbeResult { text: string; ended: boolean; cancelled: boolean }
