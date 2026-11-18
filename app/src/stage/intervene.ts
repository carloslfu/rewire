// What a gesture on a 3D part means for the real model. Every edit here becomes the same change spec
// the strength controls and the inspector write; the scene only draws what the spec says.
import { geometryActive } from "@rewire/engine/src/changes.ts";
import type { ModelInfo } from "../model/info.ts";
import type { ChangeSpec, Focus } from "../model/types.ts";
import type { State } from "../state/store.ts";
import { multOf, withMult } from "../ui/describe.ts";
import type { Part } from "./arch.ts";

/** Parts with a real strength control. */
export type Target = Extract<Part, { kind: "head" | "mlp" | "layer" }>;

export const isTarget = (p: Part | null | undefined): p is Target => !!p && (p.kind === "head" || p.kind === "mlp" || p.kind === "layer");

const kindOf = (p: Target) => (p.kind === "mlp" ? "memory" : p.kind === "layer" ? "floor" : "head");
const headOf = (p: Target) => (p.kind === "head" ? p.head : 0);

export function strengthOf(chips: ChangeSpec, p: Target): number {
  return multOf(chips, kindOf(p), p.floor, headOf(p));
}

export function withStrength(chips: ChangeSpec, p: Target, mult: number): ChangeSpec {
  return withMult(chips, kindOf(p), p.floor, headOf(p), mult);
}

/** A punch knocks the part out: its output is multiplied by zero. Punching a knocked-out part seats it again. */
export function punched(chips: ChangeSpec, p: Target): ChangeSpec {
  return withStrength(chips, p, strengthOf(chips, p) === 0 ? 1 : 0);
}

/**
 * Undo the changes that belong to one part and nothing else.
 * - A head: its strength and its direction change.
 * - An MLP: its strength and the additions to its neurons.
 * - A layer: its strength, the weights zeroed in it, a concept pushed at it, and everything above for
 *   each head and the MLP on its deck.
 * Changes that are not a part's own stay: other layers, weight precision, dictionary swaps, hidden
 * words, and the taught adapter, which has its own switch.
 */
export function restored(chips: ChangeSpec, p: Target): ChangeSpec {
  const s = withStrength(chips, p, 1);
  const here = (x: { floor: number }) => x.floor === p.floor;
  if (p.kind === "head") {
    if (s.geometry) s.geometry = s.geometry.filter((g) => !(here(g) && g.head === p.head));
  } else if (p.kind === "mlp") {
    if (s.neurons) s.neurons = s.neurons.filter((n) => !here(n));
  } else {
    if (s.heads) s.heads = s.heads.filter((h) => !here(h));
    if (s.geometry) s.geometry = s.geometry.filter((g) => !here(g));
    if (s.memory) s.memory = s.memory.filter((m) => !here(m));
    if (s.neurons) s.neurons = s.neurons.filter((n) => !here(n));
    if (s.zeroed) s.zeroed = s.zeroed.filter((z) => !here(z));
    if (s.concept && s.concept.floor === p.floor) s.concept = null;
  }
  return s;
}

/** Whether `restored` would change anything for this part. */
export function partChanged(chips: ChangeSpec, p: Target): boolean {
  const here = (x: { floor: number }) => x.floor === p.floor;
  if (strengthOf(chips, p) !== 1) return true;
  if (p.kind === "head") return !!chips.geometry?.some((g) => here(g) && g.head === p.head && geometryActive(g));
  if (p.kind === "mlp") return !!chips.neurons?.some((n) => here(n) && n.delta !== 0);
  return !!chips.heads?.some((h) => here(h) && h.mult !== 1) || !!chips.geometry?.some((g) => here(g) && geometryActive(g))
    || !!chips.memory?.some((m) => here(m) && m.mult !== 1) || !!chips.neurons?.some((n) => here(n) && n.delta !== 0)
    || !!chips.zeroed?.some(here) || (!!chips.concept && chips.concept.strength !== 0 && chips.concept.floor === p.floor);
}

/** What the restore button for a part says, matching exactly what `restored` undoes. */
export function restoreLabel(p: Target): string {
  return p.kind === "head" ? "Restore this head" : p.kind === "mlp" ? "Restore this MLP" : "Restore this layer and its parts";
}

/** The detail panel for a part, or null for parts that exist only in the drawing's vocabulary. */
export function focusOf(p: Part): Focus | null {
  switch (p.kind) {
    case "head": return { kind: "head", floor: p.floor, head: p.head };
    case "mlp": return { kind: "memory", floor: p.floor };
    case "layer": return { kind: "floor", floor: p.floor };
    case "embed": return { kind: "dictionary" };
    case "unembed": case "norm": return { kind: "words-out" };
    case "kv": return { kind: "floor", floor: p.floor };
  }
}

/**
 * The part an inspector panel is about, or null for panels about no one part: a word, the weights'
 * precision. Several parts can share a panel (the final normalization opens Words out, shared keys and
 * values open their layer), so a part is kept selected while the panel is still its own: see `sameFocus`.
 */
export function partOf(focus: Focus): Part | null {
  switch (focus.kind) {
    case "head": return { kind: "head", floor: focus.floor, head: focus.head };
    case "memory": return { kind: "mlp", floor: focus.floor };
    case "floor": return { kind: "layer", floor: focus.floor };
    case "dictionary": case "words-in": return { kind: "embed" };
    case "words-out": return { kind: "unembed" };
    default: return null;
  }
}

/** Whether a part's own inspector panel is the one being shown, whatever position or side that panel is on. */
export function sameFocus(part: Part | null, focus: Focus): boolean {
  const mine = part ? focusOf(part) : null;
  if (!mine) return !part && partOf(focus) === null;
  if (part!.kind === "embed") return focus.kind === "dictionary" || focus.kind === "words-in";
  return JSON.stringify(mine) === JSON.stringify(focus);
}

/** Why the model cannot be edited right now, or null when an edit will run. Mirrors applyChips' own guard. */
export function blocked(s: Pick<State, "mode" | "busy" | "replay" | "teachingBusy">): string | null {
  if (s.teachingBusy) return "Teaching is running. Parts can be changed when it finishes.";
  if (s.mode !== "live") return "Parts can be changed once the model is ready.";
  if (s.busy && !s.replay) return "Wait for the reply to finish, then change a part.";
  return null;
}

export interface Pose {
  /** Output multiplier on this part (1 when untouched). */
  mult: number;
  /** Contributes nothing: its own strength is zero or its layer is off. */
  off: boolean;
  /** Carries any active change. */
  edited: boolean;
  /** Degrees the drawing turns the part: a flip is 180, a head rotation adds its angle. */
  roll: number;
}

const REST: Pose = { mult: 1, off: false, edited: false, roll: 0 };

/** How the active changes show on one part. Derived from the spec alone, so the drawing cannot drift from the model. */
export function poseOf(chips: ChangeSpec, p: Part, model: Pick<ModelInfo, "id" | "floors">): Pose {
  if (p.kind === "norm") return REST;
  if (p.kind === "embed" || p.kind === "unembed") return { ...REST, edited: !!chips.swaps?.length || (p.kind === "embed" && !!chips.hidden?.length) };
  const layer = multOf(chips, "floor", p.floor);
  if (p.kind === "layer") {
    const local = !!chips.zeroed?.some((z) => z.floor === p.floor) || (!!chips.concept && chips.concept.strength !== 0 && chips.concept.floor === p.floor);
    return { mult: layer, off: layer === 0, edited: layer !== 1 || local || (!!chips.bits && chips.bits !== 4), roll: 0 };
  }
  if (p.kind === "kv") return { ...REST, off: layer === 0 };
  if (p.kind === "head") {
    const mult = multOf(chips, "head", p.floor, p.head);
    const g = chips.geometry?.find((x) => x.floor === p.floor && x.head === p.head && geometryActive(x));
    return { mult, off: mult === 0 || layer === 0, edited: mult !== 1 || !!g, roll: (mult < 0 ? 180 : 0) + (g?.kind === "rotate" ? g.angle : 0) };
  }
  const mult = multOf(chips, "memory", p.floor);
  const learned = model.id === "qwen" && p.floor === model.floors - 1 && !!chips.lesson;
  return { mult, off: mult === 0 || layer === 0, edited: mult !== 1 || learned || !!chips.neurons?.some((n) => n.floor === p.floor && n.delta !== 0), roll: mult < 0 ? 180 : 0 };
}
