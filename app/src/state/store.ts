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
  /** Turn where the current chips forked the conversation (-1: not forked). */
  fork: number;
  /** True while a reply is being written. */
  busy: boolean;
  /** The word whose numbers are shown. */
  word: WordRef | null;
  /** The tower follows the word being written until the visitor taps one. */
  follow: boolean;
  focus: Focus;
  /** Tower lighting: each part's push, or changed minus normal on the same words. */
  view: "push" | "difference";
  temperature: number;
  seed: number;
  /** Path step being shown (1-based), or null for free play. */
  step: number | null;
  /** The path list is open. */
  pathOpen: boolean;
  /** A step's control has been used, so its explanation line shows. */
  stepTried: boolean;
  /** The tiny model is open instead of Qwen3-0.6B. */
  tiny: boolean;
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
  fork: -1,
  busy: false,
  word: null,
  follow: true,
  focus: { kind: "word" },
  view: "push",
  temperature: 0.7,
  seed: 11,
  step: null,
  pathOpen: false,
  stepTried: false,
  tiny: false,
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
  return useSyncExternalStore(store.subscribe, () => sel(store.get()));
}

/** Replace one turn immutably. */
export function setTurn(i: number, f: (t: Turn) => Turn) {
  store.set((s) => ({ turns: s.turns.map((t, j) => (j === i ? f(t) : t)) }));
}
