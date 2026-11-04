// The tokenizer (Tokenizers.js, the library inside Transformers.js) and the template rule of section 7.1.
import { ByteLevelDecoder, Tokenizer } from "@huggingface/tokenizers";
import { bytePiece, type TokenPiece } from "./token-text.ts";

export interface ChatTokens {
  im_start: number; im_end: number; think: number; end_think: number; endoftext: number;
}

export class ChatTokenizer {
  /** Recognizes chat markers (for decoding and the template). */
  private readonly full: Tokenizer;
  /** Treats everything as plain text: typed text can never produce a chat marker. */
  private readonly plainTok: Tokenizer;
  private readonly addedIds: Set<number>;
  private readonly pieces = new Map<number, TokenPiece>();

  constructor(tokenizerJson: Record<string, unknown>, tokenizerConfig: Record<string, unknown>, readonly t: ChatTokens,
    readonly systemPrompt: string) {
    this.full = new Tokenizer(tokenizerJson as never, tokenizerConfig as never);
    this.addedIds = new Set(this.full.get_added_tokens_decoder().keys());
    const plainJson = { ...tokenizerJson, added_tokens: [] };
    this.plainTok = new Tokenizer(plainJson as never, { ...tokenizerConfig, added_tokens_decoder: {} } as never);
  }

  plain(text: string): number[] {
    if (!text) return [];
    return this.plainTok.encode(text, { add_special_tokens: false } as never).ids as number[];
  }

  private opening(): number[] {
    const t = this.t;
    return [t.im_start, ...this.plain("assistant\n"), t.think, ...this.plain("\n\n"), t.end_think, ...this.plain("\n\n")];
  }

  firstTurn(message: string, system = this.systemPrompt): number[] {
    const t = this.t;
    return [t.im_start, ...this.plain("system\n" + system), t.im_end, ...this.plain("\n"),
      t.im_start, ...this.plain("user\n" + message), t.im_end, ...this.plain("\n"), ...this.opening()];
  }

  nextTurn(generated: number[], message: string): number[] {
    const t = this.t;
    const out = [...generated];
    if (out.length === 0 || out[out.length - 1] !== t.im_end) out.push(t.im_end);
    return [...out, ...this.plain("\n"), t.im_start, ...this.plain("user\n" + message), t.im_end, ...this.plain("\n"), ...this.opening()];
  }

  /** First position after the system turn (the user turn's start marker); a concept applies from here. */
  systemEnd(tokens: number[]): number {
    let seen = 0;
    for (let i = 0; i < tokens.length; i++) {
      if (tokens[i] === this.t.im_start && ++seen === 2) return i;
    }
    return tokens.length;
  }

  decode(ids: number[]): string {
    return this.full.decode(ids, { skip_special_tokens: false } as never);
  }

  piece(id: number): string {
    return this.pieceData(id).text;
  }

  pieceData(id: number): TokenPiece {
    const cached = this.pieces.get(id);
    if (cached) return cached;
    const decoder = this.full.decoder;
    const raw = this.full.id_to_token(id);
    const result = decoder instanceof ByteLevelDecoder && raw !== undefined && !this.addedIds.has(id)
      ? bytePiece([...raw].map((c) => Number(decoder.byte_decoder[c]))) : { text: this.decode([id]) };
    this.pieces.set(id, result);
    return result;
  }
}
