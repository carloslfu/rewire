/** Lossless bytes travel with a token. Its standalone label may describe an incomplete character. */
export interface TokenPiece {
  text: string;
  bytes?: number[];
  fragment?: true;
}

export interface TextSegment {
  text: string;
  /** Token indices, with to exclusive. A character can span more than one token. */
  from: number;
  to: number;
}

const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });

/** A combining accent, flag or joined emoji must stay in one text run, even across token boundaries. */
function joinGraphemes(segments: TextSegment[]): TextSegment[] {
  const text = segments.map((s) => s.text).join("");
  const ends = new Set([...graphemes.segment(text)].map((s) => s.index + s.segment.length));
  const out: TextSegment[] = [];
  let position = 0;
  for (const s of segments) {
    const previous = out.at(-1);
    if (previous && !ends.has(position)) { previous.text += s.text; previous.to = s.to; }
    else out.push({ ...s });
    position += s.text.length;
  }
  return out;
}

export function byteLabel(bytes: readonly number[]): string {
  return `UTF-8 bytes ${bytes.map((b) => b.toString(16).padStart(2, "0").toUpperCase()).join(" ")}`;
}

export function bytePiece(bytes: number[]): TokenPiece {
  try {
    return { text: new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(Uint8Array.from(bytes)), bytes };
  } catch {
    return { text: byteLabel(bytes), bytes, fragment: true };
  }
}

/** Is the suffix a valid, unfinished UTF-8 character? Invalid bytes are never silently dropped. */
function unfinished(bytes: readonly number[]): boolean {
  let start = bytes.length - 1;
  while (start >= 0 && bytes[start] >= 0x80 && bytes[start] <= 0xBF) start--;
  const lead = bytes[start], size = bytes.length - start;
  const need = lead >= 0xC2 && lead <= 0xDF ? 2 : lead >= 0xE0 && lead <= 0xEF ? 3 : lead >= 0xF0 && lead <= 0xF4 ? 4 : 0;
  if (!need || size >= need) return false;
  const second = bytes[start + 1];
  return size === 1 || !((lead === 0xE0 && second < 0xA0) || (lead === 0xED && second > 0x9F)
    || (lead === 0xF0 && second < 0x90) || (lead === 0xF4 && second > 0x8F));
}

/** Reassemble UTF-8 bytes and keep graphemes together. Never repair already decoded replacement characters. */
export function textSegments(pieces: readonly TokenPiece[], final = true): TextSegment[] {
  const out: TextSegment[] = [];
  let bytes: number[] = [], from = 0;
  const flush = (to: number, end: boolean) => {
    if (!bytes.length) return;
    const text = new TextDecoder("utf-8", { ignoreBOM: true }).decode(Uint8Array.from(bytes), { stream: !end });
    out.push({ text, from, to });
    bytes = [];
  };
  pieces.forEach((p, i) => {
    if (!p.bytes) {
      flush(i, true); // Added chat markers are boundaries, never bytes of a character.
      out.push({ text: p.text, from: i, to: i + 1 });
    } else {
      if (!bytes.length) from = i;
      bytes.push(...p.bytes);
      if (!unfinished(bytes)) flush(i + 1, true);
    }
  });
  // While streaming, wait for the remaining bytes instead of flashing a replacement character.
  flush(pieces.length, final);
  return joinGraphemes(out);
}
