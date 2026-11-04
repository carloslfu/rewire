import { describe, expect, it } from "vitest";
import { ChatTokenizer } from "@rewire/engine/src/tokenizer.ts";
import { bytePiece, textSegments } from "@rewire/engine/src/token-text.ts";
import fixture from "./unicode-fixture.json";

// Actual Qwen vocabulary entries, small enough to run without downloaded model weights.
const tokenizer = new ChatTokenizer({ normalizer: null, pre_tokenizer: null, post_processor: null, model: { type: "BPE", vocab: fixture.vocab, merges: [] },
  decoder: { type: "ByteLevel" }, added_tokens: fixture.added_tokens }, { clean_up_tokenization_spaces: false },
  { im_start: 151644, im_end: 151645, think: 151667, end_think: 151668, endoftext: 151643 }, "");
const text = (ids: number[], final = true) => textSegments(ids.map((id) => tokenizer.pieceData(id)), final).map((s) => s.text).join("");

describe("Unicode token display", () => {
  for (const c of fixture.cases) it(`preserves ${JSON.stringify(c.text)}`, () => {
    expect(text(c.ids)).toBe(c.text);
    expect(text(c.ids)).toBe(tokenizer.decode(c.ids));
    const segments = textSegments(c.ids.map((id) => tokenizer.pieceData(id)));
    expect(segments.flatMap((s) => Array.from({ length: s.to - s.from }, (_, i) => s.from + i))).toEqual(c.ids.map((_, i) => i));
    // No partial byte sequence can flash as a replacement character during streaming.
    if (!c.text.includes("�")) for (let i = 0; i <= c.ids.length; i++) expect(text(c.ids.slice(0, i), false)).not.toContain("�");
  });

  it("labels both parts of the reported emoji without losing their bytes or token IDs", () => {
    expect(tokenizer.pieceData(26525)).toEqual({ text: "UTF-8 bytes 20 F0 9F 98", bytes: [32, 240, 159, 152], fragment: true });
    expect(tokenizer.pieceData(232)).toEqual({ text: "UTF-8 bytes 8A", bytes: [138], fragment: true });
    expect(textSegments([tokenizer.pieceData(26525), tokenizer.pieceData(232)])).toEqual([{ text: " 😊", from: 0, to: 2 }]);
  });

  it("waits at an unfinished character, then flushes honestly if generation stops there", () => {
    const a = bytePiece([65, 240, 159]);
    expect(textSegments([a], false)).toEqual([{ text: "A", from: 0, to: 1 }]);
    expect(textSegments([a], true)[0].text).toBe("A�");
    expect(textSegments([a, bytePiece([152, 138])])[0].text).toBe("A😊");
  });

  it("keeps invalid bytes and literal replacement characters, and does not swallow following text", () => {
    for (const bytes of [[0xC0, 0x80, 65], [0xE2, 0x82, 65], [0xED, 0xA0, 0x80, 66], [0xF4, 0x90, 0x80, 0x80, 67]]) {
      const parts = bytes.map((b) => bytePiece([b]));
      expect(textSegments(parts).map((s) => s.text).join("")).toBe(new TextDecoder().decode(Uint8Array.from(bytes)));
    }
    expect(textSegments([bytePiece([0xEF, 0xBF, 0xBD])])[0].text).toBe("�");
  });

  it("does not combine bytes across chat markers or separate sample decodes", () => {
    expect(textSegments([bytePiece([0xF0]), { text: "<|im_end|>" }, bytePiece([0x9F])]).map((s) => s.text).join("")).toBe("�<|im_end|>�");
    expect(textSegments([bytePiece([0x9F])])[0].text).toBe("�");
  });

  it("keeps accents, flags, variation selectors and joined emojis together across arbitrary splits", () => {
    for (const value of ["é", "👩🏽‍💻", "🇨🇴", "❤️"]) {
      const bytes = [...new TextEncoder().encode(value)];
      expect(textSegments(bytes.map((b) => bytePiece([b])))).toEqual([{ text: value, from: 0, to: bytes.length }]);
    }
  });

  it("matches UTF-8 decoding for arbitrary byte sequences, including malformed output", () => {
    let seed = 17;
    const next = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed >>> 24; };
    for (let i = 0; i < 2000; i++) {
      const bytes = Array.from({ length: 1 + i % 12 }, next);
      expect(textSegments(bytes.map((b) => bytePiece([b]))).map((s) => s.text).join(""))
        .toBe(new TextDecoder("utf-8", { ignoreBOM: true }).decode(Uint8Array.from(bytes)));
    }
  });
});
