// Messages between the page and the engine worker.
import type { Cand, ChangeSpec, FloorDetail, Forced, Tok } from "../model/types.ts";
import type { TinyConfig } from "@rewire/tiny/src/model.ts";
import type { ConvId, WriteJob } from "./engine.ts";

export type ToWorker = { id: number } & (
  | { t: "check" }
  | { t: "load"; base: string; phone: boolean }
  | { t: "pause"; paused: boolean }
  | { t: "version"; version: number }
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
);

export type FromWorker =
  | { t: "progress"; loaded: number; total: number }
  | { t: "lost" }
  | { t: "tok"; id: number; tok: Tok }
  | { t: "done"; id: number; result: unknown }
  | { t: "error"; id: number; message: string };

export type { Cand, FloorDetail, Forced };
