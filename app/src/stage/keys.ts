// What keys mean on the 3D bench: Escape, which closes the full screen view only once nothing nearer
// has a claim on it, and the keys of the focused model.
import type { ViewName } from "./scene/camera.ts";

export type EscapeIntent = "panel" | "menu" | "leave" | "wait" | "overlay" | "close";

/**
 * Escape pressed with the focus on an element of the full screen view. One press closes one thing,
 * the nearest first.
 * - `wait`: a text field mid-composition. The input method is cancelling its own candidate.
 * - `panel`: a dock panel (Views, Help) is open. It closes first, wherever the focus is.
 * - `menu`: a select. The browser uses this Escape to close its open menu, so the view stays; pressing
 *   again on the same select moves on (`repeated`).
 * - `leave`: a text field. Focus steps out of the field and the text stays.
 * - `overlay`: the question or the selected part's panel is open over the stage. It closes.
 * - `close`: nothing else is open. Full screen ends.
 */
export function escapeIntent(target: { tagName: string; type?: string }, repeated: boolean, composing: boolean, panelOpen = false, overlayOpen = false): EscapeIntent {
  const typing = target.tagName === "TEXTAREA" || (target.tagName === "INPUT" && (target.type === "text" || target.type === "search" || target.type === undefined));
  if (typing && composing) return "wait";
  if (panelOpen) return "panel";
  if (target.tagName === "SELECT" && !repeated) return "menu";
  if (typing) return "leave";
  return overlayOpen ? "overlay" : "close";
}

/** What a key does with the 3D model focused. `ignore` is a key that is ours but does nothing this time. */
export type StageKey =
  | { act: "move"; key: string }
  | { act: "orbit"; azimuth: number; polar: number }
  | { act: "zoom"; factor: number }
  | { act: "fit" }
  | { act: "focus"; orFit: boolean }
  | { act: "view"; view: ViewName }
  | { act: "spread" } | { act: "help" } | { act: "pan" } | { act: "punch" } | { act: "ignore" };

const VIEW_KEYS: Record<string, ViewName> = { 1: "home", 2: "front", 3: "side", 4: "top" };

/**
 * The action for a key press on the focused model, or null for a key that is not the model's.
 * Moving, turning and zooming repeat while a key is held. Keys that switch something on or off, or
 * change the model, act once per press: a held P must not knock a part out and put it back for as
 * long as it is down, and a held E must not leave the layers wherever the repeat happened to stop.
 */
export function stageKey(e: { key: string; shiftKey: boolean; repeat: boolean }): StageKey | null {
  const k = e.key, once = (action: StageKey): StageKey => (e.repeat ? { act: "ignore" } : action);
  if (k.startsWith("Arrow")) {
    return e.shiftKey ? { act: "orbit", azimuth: k === "ArrowLeft" ? -0.2 : k === "ArrowRight" ? 0.2 : 0, polar: k === "ArrowUp" ? -0.12 : k === "ArrowDown" ? 0.12 : 0 } : { act: "move", key: k };
  }
  if (k === "+" || k === "=") return { act: "zoom", factor: 0.8 };
  if (k === "-" || k === "_") return { act: "zoom", factor: 1.25 };
  if (k === "0" || k === "Home") return { act: "fit" };
  if (k === "f" || k === "F") return { act: "focus", orFit: true };
  if (k === "Enter") return { act: "focus", orFit: false };
  if (VIEW_KEYS[k]) return { act: "view", view: VIEW_KEYS[k] };
  if (k === "e" || k === "E") return once({ act: "spread" });
  if (k === "?") return once({ act: "help" });
  if (k === " ") return once({ act: "pan" });
  if (k === "p" || k === "P") return once({ act: "punch" });
  return null;
}
