// Experiment prompts and parameters. Every response is generated on this device.
import experiments from "./experiments.json";
import type { ChangeSpec } from "../model/types.ts";

export type StepControl =
  | { kind: "swap"; a: string; b: string; ids: [number, number] }
  | { kind: "zeroed"; weights: { floor: number; tensor: "q" | "k" | "v" | "o" | "gate" | "up" | "down"; row: number; col: number }[] }
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
  message?: string;
  control: StepControl;
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

type Facts = Record<string, string | number>;
/** Copy that may depend on the step's measured facts. */
type FactText = string | ((f: Facts) => string);

export interface StepCopy {
  title: FactText;
  question: string;
  /** What the control says. */
  action: FactText;
  /** One plain line after trying. */
  why: (f: Facts) => string;
  term?: string;
  /** Questions to tap once the model runs live, with the step's change still on. */
  suggestions?: string[];
}

const NUMBER_WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
const count = (v: string | number | undefined, d: number) => NUMBER_WORDS[Number(v ?? d)] ?? String(v ?? d);
const capital = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
export const COPY: Record<string, StepCopy> = {
  "step-1": {
    title: "Swap Paris and Rome",
    question: "The model stores every word as a row of numbers in its dictionary. What if Paris and Rome traded rows?",
    action: "Swap Paris and Rome",
    why: () => "The input and output dictionary rows are exchanged during computation. Your text stays the same, but these two token IDs use each other’s numbers. Other spellings or word pieces are unchanged.",
    term: "dictionary",
    suggestions: ["Why does Rome have the Eiffel Tower?", "What is Paris famous for?", "How far is Rome from Paris?"],
  },
  "step-2": {
    title: (f) => `${capital(count(f.k, 5))} numbers out of 596 million`,
    question: "Can a handful of numbers break it?",
    action: (f) => `Zero ${count(f.k, 5)} weights on layer ${f.floor ?? 3}`,
    why: () => "The selected connections contribute zero during this run. Their effects propagate through later layers. Compare the actual reply before and after; a few weights can matter much more than their count suggests.",
  },
  "step-3": {
    title: "Skip a layer",
    question: "The model has 28 layers, each adding to the stream of numbers. Can it lose one?",
    action: "Turn off a layer",
    why: () => "Turning a layer off removes its contribution to the stream. Later layers then work from that altered state. The reply may change a little, change a lot, or use the same words with different probabilities.",
    term: "floor",
    suggestions: ["What is the tallest mountain on Earth?", "Name three colors of the rainbow."],
  },
  "step-4": {
    title: "Hide the start marker",
    question: "Many heads rest their attention on the marker that starts the text. What if they couldn't see it?",
    action: "Hide the start marker",
    why: () => "This blocks later attention from landing on the start marker from the selected layer onward. That attention is redistributed to the remaining positions. The result depends on the prompt.",
    term: "head",
  },
  "step-5": {
    title: "Turn off the copying heads",
    question: "These heads affected pattern copying in earlier tests. What happens if you turn them off here?",
    action: "Turn off the copying heads",
    why: () => "These heads were selected in earlier pattern-copying tests. Turning them off removes their output. Compare against the fixed comparison group and try new patterns; the labels do not guarantee a role in every reply.",
    term: "induction",
  },
  "step-6": {
    title: "Add a concept, then push too far",
    question: "What if we added a little of a concept to its stream?",
    action: "Turn up the concept",
    why: () => "A direction derived from example sentences is added to the stream. It can shift the topic, have little visible effect, or disrupt the reply. Increasing its strength does not guarantee stronger or more coherent steering.",
    term: "steering",
    suggestions: ["Give me a tip for a job interview.", "Describe your perfect weekend."],
  },
  "step-7": {
    title: "Where does the answer form?",
    question: "If the model stopped at each layer, what would it say?",
    action: "Show the layer predictions",
    why: () => "The same output dictionary reads the stream after each layer. These intermediate predictions are computed for the selected token; early layers were not trained to answer on their own.",
    term: "lens",
  },
  "step-8": {
    title: "Ask about something made up",
    question: "Does it know when it doesn't know?",
    action: "Look at its probabilities",
    why: () => "The name in this question was invented for the experiment. The model may question it or invent an answer. Token probabilities measure its next-token preferences, not whether an answer is true.",
  },
  "step-9": {
    title: "Force its third choice",
    question: "What if it had picked a different word?",
    action: "Use its third choice",
    why: () => "The model is forced to take its third candidate at one position, then generates the continuation itself. This changes the generated context, not its weights.",
    suggestions: ["Write a two-sentence story about a fox.", "Write a short poem about rain."],
  },
  "step-10": {
    title: "Squeeze the numbers",
    question: "Each weight inside its layers can take 16 values. How few can it live with?",
    action: "Cut the levels",
    why: () => "The computation rounds each quantized weight to fewer levels. This adds error to the learned numbers. The effects on a reply depend on the prompt and precision.",
    term: "bits",
    suggestions: ["What is a good name for a dog?", "How do I make lemonade?"],
  },
  "step-11": {
    title: "Teach a tiny model your writing",
    question: "How does a model get its numbers in the first place?",
    action: "Teach a tiny model",
    why: () => "Backpropagation computes gradients from next-letter prediction errors and updates the tiny model’s weights. Learning is imperfect; new combinations test whether it generalized beyond the training text.",
  },
};

/** A step's copy with its measured facts filled in. */
export interface ResolvedCopy {
  title: string;
  question: string;
  action: string;
  why: string;
  term?: string;
  suggestions?: string[];
}

export function stepCopy(st: StepData): ResolvedCopy | null {
  const c = COPY[st.slug];
  if (!c) return null;
  const f = st.facts ?? {};
  const text = (x: FactText) => (typeof x === "function" ? x(f) : x);
  return { ...c, title: text(c.title), action: text(c.action), why: c.why(f) };
}

export function stepChanges(c: StepControl, stop?: number): ChangeSpec {
  switch (c.kind) {
    case "swap": return { swaps: [c.ids] };
    case "zeroed": return { zeroed: c.weights };
    case "hide": return { hidden: [{ key: c.key, from: c.from }] };
    case "heads": return { heads: c.heads.map(([floor, head]) => ({ floor, head, mult: 0 })) };
    case "concept": return { concept: { id: c.id, floor: c.floor, strength: stop ?? 0 } };
    case "bits": return stop === 3 || stop === 2 ? { bits: stop } : {};
    default: return {};
  }
}

export function loadPath(): PathData {
  return experiments as PathData;
}
