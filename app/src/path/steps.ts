// The path (section 4.4). Copy lives here; which steps ship, their prompts and their exact parameters come
// from recordings/path.json, which Phase 0A curation writes after each step passes its rule.
import type { ChangeSpec } from "../model/types.ts";

export type StepControl =
  | { kind: "swap"; a: string; b: string; ids: [number, number] }
  | { kind: "zeroed"; weight: { floor: number; tensor: "q" | "k" | "v" | "o" | "gate" | "up" | "down"; row: number; col: number } }
  | { kind: "floors"; floors: number[] }
  | { kind: "hide"; key: number; from: number }
  | { kind: "heads"; heads: [number, number][]; random: [number, number][] }
  | { kind: "concept"; id: string; label: string; floor: number; stops: number[]; breaking: number }
  | { kind: "guesses"; index: number }
  | { kind: "madeup"; index: number }
  | { kind: "pick"; index: number; rank: number }
  | { kind: "bits" }
  | { kind: "tiny" };

/** One step as path.json describes it. */
export interface StepData {
  n: number;
  slug: string;
  core: boolean;
  recording?: string;
  message?: string;
  /** Recorded alternative questions for "Try it on another question" on replay-only devices. */
  alternatives?: string[];
  control: StepControl;
  /** The word the tower shows first. */
  featured?: { side: "normal" | "changed"; index: number };
  /** Numbers the copy states, measured in Phase 0A. */
  facts?: Record<string, string | number>;
}

export interface PathData {
  manifest_hash: string;
  steps: StepData[];
  atlas?: {
    copying?: [number, number][];
    start_marker?: [number, number][];
    answer_heads?: [number, number][];
    answer_memory?: number[];
  };
  concepts?: { id: string; label: string; best_floor: number; working: [number, number]; breaking: number }[];
  swap_pairs?: { a: string; b: string; ids: [number, number] }[];
  slurs_filtered?: number;
}

export interface StepCopy {
  title: string;
  question: string;
  /** What the control says. */
  action: string;
  /** One plain line after trying. */
  why: (f: Record<string, string | number>) => string;
  term?: string;
}

export const COPY: Record<string, StepCopy> = {
  "step-1": {
    title: "Swap Paris and Rome",
    question: "The model stores every word as a row of numbers in its dictionary. What if Paris and Rome traded rows?",
    action: "Swap Paris and Rome",
    why: () => "It never saw \"Rome\". It read the numbers stored for Paris.",
    term: "dictionary",
  },
  "step-2": {
    title: "One number out of 596 million",
    question: "Can one number break it?",
    action: "Set that number to zero",
    why: () => "A few numbers matter far more than the rest. This is one of them.",
  },
  "step-3": {
    title: "Skip a floor",
    question: "The model has 28 floors, each adding to the stream of numbers. Can it lose one?",
    action: "Turn off a floor",
    why: (f) => `Without the first floor it speaks nonsense. Without floor ${f.middle ?? "14"} it barely changes: the floors after it make up for it.`,
    term: "floor",
  },
  "step-4": {
    title: "Hide the start marker",
    question: "Many heads rest their attention on the marker that starts the text. What if they couldn't see it?",
    action: "Hide the start marker",
    why: () => "Heads with nothing useful to look at park their attention on the start marker. Without it, that attention lands on real words and the replies fall apart.",
    term: "head",
  },
  "step-5": {
    title: "Turn off the copying heads",
    question: "These heads, found by testing, help it continue patterns. What happens without them?",
    action: "Turn off the copying heads",
    why: (f) => `Without its ${f.count ?? "copying"} copying heads it loses the list, while turning off as many random heads does not.`,
    term: "induction",
  },
  "step-6": {
    title: "Add a concept, then push too far",
    question: "What if we added a little of a concept to its stream?",
    action: "Turn up the concept",
    why: () => "The concept is a direction in the stream. A little steers the topic; too much drowns out everything else, so it loops, rambles or switches language.",
    term: "steering",
  },
  "step-7": {
    title: "Where does the answer form?",
    question: "If the model stopped at each floor, what would it say?",
    action: "Show the floor guesses",
    why: (f) => `The answer first appears around floor ${f.floor ?? "20"}. It takes shape on the upper floors.`,
    term: "lens",
  },
  "step-8": {
    title: "Ask about something made up",
    question: "Does it know when it doesn't know?",
    action: "Look at its probabilities",
    why: () => "It describes something that does not exist. Its probabilities show how much it was guessing, but nothing makes it stop.",
  },
  "step-9": {
    title: "Force its third choice",
    question: "What if it had picked a different word?",
    action: "Use its third choice",
    why: () => "Nothing inside it changed. It writes by picking from probabilities, so one different pick changes the rest.",
  },
  "step-10": {
    title: "Squeeze the numbers",
    question: "Each weight inside its floors can take 16 values. How few can it live with?",
    action: "Cut the levels",
    why: (f) => (f.at3 === "breaks" ? "At 8 levels it already breaks, and at 4 it is nonsense: every weight lands far from its real value." :
      "At 8 levels it gets much worse, and at 4 it is nonsense: every weight lands far from its real value."),
    term: "bits",
  },
  "step-11": {
    title: "Teach a tiny model your writing",
    question: "How does a model get its numbers in the first place?",
    action: "Teach",
    why: () => "Training nudges every number a little toward predicting the next letter. Repeat that thousands of times and the noise becomes your kind of words.",
  },
};

export function stepChanges(c: StepControl, stop?: number): ChangeSpec {
  switch (c.kind) {
    case "swap": return { swaps: [c.ids] };
    case "zeroed": return { zeroed: [c.weight] };
    case "hide": return { hidden: [{ key: c.key, from: c.from }] };
    case "heads": return { heads: c.heads.map(([floor, head]) => ({ floor, head, mult: 0 })) };
    case "concept": return { concept: { id: c.id, floor: c.floor, strength: stop ?? 0 } };
    case "bits": return stop === 3 || stop === 2 ? { bits: stop } : {};
    default: return {};
  }
}

export async function loadPath(signal?: AbortSignal): Promise<PathData | null> {
  try {
    const r = await fetch(`${import.meta.env.BASE_URL}recordings/path.json`, { signal });
    if (!r.ok) return null;
    return (await r.json()) as PathData;
  } catch {
    return null;
  }
}
