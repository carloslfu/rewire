// What Escape means in the full view. It closes the view, but only once nothing nearer has a claim on it.

export type EscapeIntent = "menu" | "leave" | "wait" | "close";

/**
 * Escape pressed with the focus on an element of the full view.
 * - `menu`: a select. The browser uses this Escape to close its open menu, so the view stays; pressing
 *   again on the same select closes the view (`repeated`).
 * - `leave`: a text field. Focus steps out of the field and the text stays.
 * - `wait`: a text field mid-composition. The input method is cancelling its own candidate.
 * - `close`: anything else.
 */
export function escapeIntent(target: { tagName: string; type?: string }, repeated: boolean, composing: boolean): EscapeIntent {
  if (target.tagName === "SELECT") return repeated ? "close" : "menu";
  const typing = target.tagName === "TEXTAREA" || (target.tagName === "INPUT" && (target.type === "text" || target.type === "search" || target.type === undefined));
  if (typing) return composing ? "wait" : "leave";
  return "close";
}
