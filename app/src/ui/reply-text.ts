import type { TextSegment } from "@rewire/engine/src/token-text.ts";
import type { Reply } from "../model/types.ts";
import { sequence } from "../state/actions.ts";

export const STOP = new Set([151645, 151643]);

/** Display and speech share the same lossless decoding and the original token indices. */
export function replySegments(reply: Reply): TextSegment[] {
  // A length limit or Stop pauses generation; Continue can still finish the character.
  return sequence(reply.toks.map((t) => t.id), reply.ended)
    .filter((s) => !STOP.has(reply.toks[s.from].id) && s.text.length > 0);
}

export function replyText(reply: Reply): string {
  return replySegments(reply).map((s) => s.text).join("");
}

/** Keep adjacent pieces of one word together when a narrow reply wraps. */
export function wordGroups(segments: TextSegment[]): TextSegment[][] {
  const groups: TextSegment[][] = [];
  for (const s of segments) {
    const previous = groups.at(-1)?.at(-1);
    if (!previous || /^\s/.test(s.text) || /\s$/.test(previous.text)) groups.push([]);
    groups[groups.length - 1].push(s);
  }
  return groups;
}
