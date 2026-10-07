// Messages between the page and the engine worker.
import type { Cand, ChangeSpec, FloorDetail, Forced, Tok } from "../model/types.ts";
import type { TinyConfig } from "@rewire/tiny/src/config.ts";
import type { ConvId, WriteJob } from "./engine.ts";
import type { LessonWeights } from "@rewire/engine/src/lora.ts";
import type { LessonUpdate } from "../teach/types.ts";
import type { Example } from "../teach/lessons.ts";

export type ToWorker = { id: number } & (
  | { t: "check" }
  | { t: "lesson-train"; examples: Example[]; steps: number; lr: number; continueLesson: boolean }
  | { t: "lesson-stop" }
  | { t: "lesson-install"; weights: LessonWeights }
  | { t: "lesson-probe"; prompt: string; lesson: boolean }
  | { t: "load"; base: string; phone: boolean; expectedHash?: string }
  | { t: "pause"; paused: boolean }
  | { t: "version"; version: number }
  | { t: "cancel" }
  | { t: "first"; message: string }
  | { t: "next"; reply: number[]; message: string }
  | { t: "plain"; text: string }
  | { t: "pieces"; ids: number[] }
  | { t: "write"; job: WriteJob }
  | { t: "compare"; conv: ConvId; changes: ChangeSpec; history: number[]; reply: number[]; version: number }
  | { t: "inspect"; conv: ConvId; changes: ChangeSpec; tokens: number[]; target: number }
  | { t: "dictRow"; tokenId: number; changes: ChangeSpec }
  | { t: "tiny"; params: Float32Array; config: TinyConfig }
  | { t: "use"; model: "qwen" | "tiny" }
  | { t: "bench" }
  | { t: "map"; conv: ConvId; changes: ChangeSpec; tokens: number[]; floor: number; head: number }
);

export type FromWorker =
  | { t: "lesson-progress"; id: number; update: LessonUpdate }
  | { t: "progress"; loaded: number; total: number }
  | { t: "lost" }
  | { t: "tok"; id: number; tok: Tok; pieces?: [number, string][] }
  | { t: "done"; id: number; result: unknown }
  | { t: "error"; id: number; message: string };

export type { Cand, FloorDetail, Forced };
