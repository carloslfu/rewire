// The browser tokenizer agrees with the Python tokenizer on a fixed set of texts (section 6.2).
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ChatTokenizer } from "../src/tokenizer.ts";

const SNAP = join(homedir(), ".cache/huggingface/hub/models--Qwen--Qwen3-0.6B/snapshots/c1899de289a04d12100db370d81485cdf75e47ca");
const have = existsSync(join(SNAP, "tokenizer.json"));

describe.skipIf(!have)("tokenizer", () => {
  const tj = have ? JSON.parse(readFileSync(join(SNAP, "tokenizer.json"), "utf8")) : {};
  const tc = have ? JSON.parse(readFileSync(join(SNAP, "tokenizer_config.json"), "utf8")) : {};
  const tok = new ChatTokenizer(tj, tc, { im_start: 151644, im_end: 151645, think: 151667, end_think: 151668, endoftext: 151643 },
    "Answer in one or two short sentences.");
  const fx = JSON.parse(readFileSync(join(__dirname, "tokenizer-fixture.json"), "utf8"));
  it("plain text matches Python", () => {
    for (const [text, ids] of fx.plain) expect(tok.plain(text), JSON.stringify(text)).toEqual(ids);
  });
  it("turn 1 matches the template rule", () => {
    for (const [text, ids] of fx.first_turn) expect(tok.firstTurn(text)).toEqual(ids);
  });
  it("later turns match", () => {
    expect(tok.nextTurn([785, 12095, 13], "Tell me more.")).toEqual(fx.next_turn[0]);
    expect(tok.nextTurn([785, 151645], "And Paris?")).toEqual(fx.next_turn[1]);
  });
  it("decodes like Python", () => {
    for (const [ids, text] of fx.decode) expect(tok.decode(ids)).toBe(text);
  });
});
