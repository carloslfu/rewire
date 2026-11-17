import { expect, it } from "vitest";
import type { Forced, Reply, Tok } from "../src/model/types.ts";
import { chosen, comparisonTarget, latestWord, originalWord, settledSelection, towerValues } from "../src/ui/word.ts";

const token = (id: number, values: number[]): Tok => ({ id, pushes: new Float32Array(values), lp1: -1, concept: 0, cut: 1, cands: [] });
const reply = (toks: Tok[], compare?: Forced[]): Reply => ({ toks, compare, read: [90], done: true, ended: true, changes: {}, source: "live" });
const fixture = () => ({
  turns: [{ id: 1, user: "Hello", normal: reply([token(10, [2, -3]), token(11, [-4, 5]), token(151645, [0, 0])]),
    changed: reply([token(20, [80, 90]), token(21, [90, 100]), token(22, [100, 110]), token(23, [110, 120])],
      [token(10, [1, 2]), token(11, [0, 8]), token(151645, [0, 0])]) }],
  word: { turn: 0, side: "changed" as const, index: 3 }, fork: 0,
});

it("opens comparison from a longer, different changed reply using a real original token", () => {
  const s = fixture();
  const word = comparisonTarget(s);
  expect(word).toEqual({ turn: 0, side: "normal", index: 1 });
  const c = chosen({ ...s, word });
  expect(c?.tok.id).toBe(11);
  expect(c?.forced?.id).toBe(11);
  expect([...towerValues(c, "difference")!]).toEqual([4, 3]);
  expect([...towerValues(c, "push")!]).toEqual([-4, 5]);
  expect(towerValues(chosen(s), "difference")).toBeNull();
});

it("does not compare different tokens, mismatched vectors or stale interventions", () => {
  const s = fixture();
  s.turns[0].changed.compare![1].id = 99;
  expect(comparisonTarget(s)).toBeNull();
  s.turns[0].changed.compare![1] = token(11, [2]);
  expect(comparisonTarget(s)).toBeNull();
  s.turns[0].changed.compare![1] = token(11, [0, 8]);
  s.turns[0].changed.compare![0].id = 99;
  expect(comparisonTarget(s)).toBeNull(); // The target matches, but its preceding token does not.
  s.turns[0].changed.compare![0].id = 10;
  s.turns[0].changed.stale = true;
  expect(comparisonTarget(s)).toBeNull();
});

it("waits for measurements and never selects a stop marker or another conversation turn", () => {
  const s = fixture();
  s.turns[0].changed.compare = undefined;
  expect(comparisonTarget(s)).toBeNull();
  expect(originalWord(s)?.index).toBe(1);
  s.turns.push(fixture().turns[0]);
  expect(comparisonTarget(s)).toBeNull();
  expect(comparisonTarget({ ...s, word: null })).toEqual({ turn: 1, side: "normal", index: 1 });
  expect(originalWord({ turns: [], word: null })).toBeNull();
});

it("resumes following the latest visible output while preserving the comparison reference", () => {
  const s = fixture();
  expect(latestWord({ ...s, view: "push" })).toEqual({ turn: 0, side: "changed", index: 3 });
  expect(latestWord({ ...s, view: "difference" })).toEqual({ turn: 0, side: "normal", index: 1 });
  s.turns[0].changed.stale = true;
  expect(latestWord({ ...s, view: "push" })).toEqual({ turn: 0, side: "normal", index: 1 });
  s.turns.push(fixture().turns[0]);
  expect(latestWord({ ...s, view: "push" })).toEqual({ turn: 1, side: "changed", index: 3 });
  s.turns[1].changed.toks = [];
  expect(latestWord({ ...s, view: "push" })).toEqual({ turn: 1, side: "normal", index: 1 });
  expect(latestWord({ turns: [], view: "push" })).toBeNull();
});

it("follows the sample written most recently, waits for its first token, and never selects a stop marker", () => {
  const s = fixture();
  s.turns.push({ ...fixture().turns[0], id: 2 });
  expect(latestWord({ ...s, view: "push", outputSample: 1 })).toEqual({ turn: 0, side: "changed", index: 3 });
  expect(latestWord({ ...s, view: "difference", outputSample: 1 })).toEqual({ turn: 0, side: "normal", index: 1 });
  // A removed sample's id falls back to the last sample.
  expect(latestWord({ ...s, view: "push", outputSample: 99 })).toEqual({ turn: 1, side: "changed", index: 3 });
  // Being written and still empty: nothing is selected yet. Finished with only a stop marker: another sample.
  s.turns[0].changed.toks = [];
  s.turns[0].normal = { ...s.turns[0].normal, toks: [], done: false };
  expect(latestWord({ ...s, view: "push", outputSample: 1 })).toBeNull();
  s.turns[0].normal = { ...s.turns[0].normal, toks: [token(151645, [0, 0])], done: true };
  expect(latestWord({ ...s, view: "push", outputSample: 1 })).toEqual({ turn: 1, side: "changed", index: 3 });
});

it("settles a paused selection on the nearest token that still exists, and leaves the comparison view when it cannot apply", () => {
  const s = { ...fixture(), view: "push" as const, follow: false, outputSample: null };
  s.turns.push({ ...fixture().turns[0], id: 2 });
  // A valid selection is returned as the same object, so nothing re-renders.
  expect(settledSelection(s).word).toBe(s.word);
  // A shorter reply: the last token of the same reply. No changed reply: the same sample's original.
  s.turns[0].changed.toks = s.turns[0].changed.toks.slice(0, 2);
  expect(settledSelection(s)).toEqual({ word: { turn: 0, side: "changed", index: 1 }, view: "push" });
  expect(settledSelection({ ...s, turns: s.turns.map((t) => ({ ...t, changed: undefined })) }).word).toEqual({ turn: 0, side: "normal", index: 1 });
  // A selection past the list, or none: the nearest sample to where it was.
  expect(settledSelection({ ...s, word: { turn: 5, side: "normal", index: 0 } }).word).toEqual({ turn: 1, side: "changed", index: 3 });
  expect(settledSelection({ ...s, word: null }, 0).word).toEqual({ turn: 0, side: "changed", index: 1 });
  expect(settledSelection({ ...s, word: null, turns: [] })).toEqual({ word: null, view: "push" });
  // The comparison view measures original tokens only, and needs a current changed reply.
  expect(settledSelection({ ...s, view: "difference" })).toEqual({ word: { turn: 0, side: "normal", index: 1 }, view: "difference" });
  s.turns[0].changed.stale = true;
  expect(settledSelection({ ...s, view: "difference" })).toEqual({ word: { turn: 0, side: "normal", index: 1 }, view: "push" });
  expect(settledSelection({ ...s, view: "difference", follow: true, outputSample: 2 })).toEqual({ word: { turn: 1, side: "normal", index: 1 }, view: "difference" });
});

it("measures token positions within each independent sample", () => {
  const s = fixture();
  s.turns.push({ ...fixture().turns[0], id: 2 });
  const word = { turn: 1, side: "normal" as const, index: 1 };
  const selected = chosen({ ...s, word });
  expect(selected?.position).toBe(1);
  expect(selected?.input).toBe(10);
  s.turns.shift();
  expect(chosen({ ...s, word: { ...word, turn: 0 } })?.position).toBe(selected?.position);
});
