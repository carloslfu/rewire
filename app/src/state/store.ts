// All state lives in one object in the page's memory (section 6.4). Nothing is saved to the device
// except cached model files.
import { useSyncExternalStore } from "react";
import { type ModelInfo, QWEN_INFO } from "../model/info.ts";
import type { ChangeSpec, Focus, Turn, WordRef } from "../model/types.ts";

export type Mode = "unavailable" | "live";

export type DeviceState =
  | { kind: "checking" }
  | { kind: "no-webgpu" }
  | { kind: "downloading"; loaded: number; total: number; paused: boolean; seconds: number }
  | { kind: "loading"; seconds: number }
  | { kind: "recovering" }
  | { kind: "ready"; seconds: number }
  | { kind: "error"; message: string };

export interface State {
  /** The model on screen. */
  model: ModelInfo;
  mode: Mode;
  device: DeviceState;
  /** False if the browser refused the model cache or ran out of storage. */
  modelStored?: boolean;
  /** The active changes (chips). */
  chips: ChangeSpec;
  /** Bumped whenever the chips change, so stale work can be dropped. */
  version: number;
  turns: Turn[];
  /** Removed samples, newest last, available to undo until the experiment is cleared. */
  removed: { sample: Turn; index: number }[];
  /** 0 while samples have changed replies, otherwise -1. */
  fork: number;
  /** True while a reply is being written. */
  busy: boolean;
  /** Sequential update of independent samples after changing the model. */
  replay: { turn: number; status: "running" | "stopped" | "error" } | null;
  /** The word whose numbers are shown. */
  word: WordRef | null;
  /**
   * Follow output. On: the newest token of the sample being written is selected automatically. Off
   * (paused): the visitor's token stays selected across new questions, Continue and model changes.
   * Only the visitor changes it: the Follow output control turns it on or off, and choosing a token
   * or moving the 3D replay pauses it. Clearing the samples, opening a guided step and switching
   * models start a new experiment, which follows again.
   */
  follow: boolean;
  /** Bumped each time following is resumed, so a 3D replay ends even when the followed token is unchanged. */
  followRevision: number;
  /** Id of the sample whose output was written most recently. Following tracks it; null means the last sample. */
  outputSample: number | null;
  focus: Focus;
  /** Tower lighting: each part's push, or changed minus normal on the same words. */
  view: "push" | "difference";
  /** Which instrument the benches show: the flat diagrams or the 3D model. Kept for the visit only. */
  scopeView: "2d" | "3d";
  /** False once this browser has failed to draw the 3D model; the benches then stay in 2D. */
  stage3d: boolean;
  temperature: number;
  seed: number;
  /** Editable text prepared by an example or typed by the visitor. */
  draft: string;
  /** Path step being shown (1-based), or null for free play. */
  step: number | null;
  /** The path list is open. */
  pathOpen: boolean;
  /** A step's control has been used, so its explanation line shows. */
  stepTried: boolean;
  /** The tiny model is open instead of Qwen3-0.6B. */
  tiny: boolean;
  teach: boolean;
  teachingBusy: boolean;
  lessonRevision: number;
  /** A message for screen readers and the status line. */
  announce: string;
  /** Phone: the detail sheet is open. */
  sheet: boolean;
  /** Inspection is revealed only after an explicit request. */
  inspectView: "explanation" | "word" | "model";
  error: string | null;
  /** Qwen's mode while the tiny model is on screen. */
  qwenMode?: Mode;
  /** The conversation reached the model's context limit. */
  full?: boolean;
  /** Speed bench results (?bench). */
  bench?: Record<string, unknown>;
}

export const initial: State = {
  model: QWEN_INFO,
  mode: "unavailable",
  device: { kind: "checking" },
  chips: {},
  version: 0,
  turns: [],
  removed: [],
  fork: -1,
  busy: false,
  replay: null,
  word: null,
  follow: true,
  followRevision: 0,
  outputSample: null,
  focus: { kind: "word" },
  view: "push",
  scopeView: "2d",
  stage3d: true,
  temperature: 0.7,
  seed: 11,
  draft: "",
  step: null,
  pathOpen: false,
  stepTried: false,
  tiny: false,
  teach: false,
  teachingBusy: false,
  lessonRevision: 0,
  announce: "",
  sheet: false,
  inspectView: "word",
  error: null,
};

type Listener = () => void;

export class Store {
  private s: State;
  private listeners = new Set<Listener>();
  constructor(s: State) {
    this.s = s;
  }
  get = () => this.s;
  set = (patch: Partial<State> | ((s: State) => Partial<State>)) => {
    const p = typeof patch === "function" ? patch(this.s) : patch;
    this.s = { ...this.s, ...p };
    for (const l of this.listeners) l();
  };
  subscribe = (l: Listener) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };
}

export const store = new Store(initial);

export function useStore<T>(sel: (s: State) => T): T {
  const read = () => sel(store.get());
  // The same snapshot serves rendering to a string, which the component tests use.
  return useSyncExternalStore(store.subscribe, read, read);
}

/** Replace one turn immutably. */
export function setTurn(i: number, f: (t: Turn) => Turn) {
  store.set((s) => ({ turns: s.turns.map((t, j) => (j === i ? f(t) : t)) }));
}
