// The page reads recordings exactly as the Python writer wrote them.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { canonical, parseRecording } from "../src/model/recording.ts";

const FX = join(__dirname, "..", "..", "artifacts", "test");
const have = existsSync(join(FX, "fixture.rwr"));

describe.skipIf(!have)("recordings", () => {
  it("parses the Python fixture", () => {
    const b = readFileSync(join(FX, "fixture.rwr"));
    const exp = JSON.parse(readFileSync(join(FX, "fixture.json"), "utf8"));
    const rec = parseRecording(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), "http://x/fixture.rwr");
    const n = rec.runs.get("normal")!, c = rec.runs.get("changed")!;
    expect(n.turns[0].toks.map((t) => t.id)).toEqual(exp.normal_ids);
    expect(c.turns[0].toks.map((t) => t.id)).toEqual(exp.changed_ids);
    expect(n.turns[0].toks.map((t) => t.cut)).toEqual(exp.normal_cut);
    expect(n.turns[0].ended).toBe(true);
    expect(c.turns[0].ended).toBe(false);
    const p = Array.from(n.turns[0].toks[0].pushes.slice(0, 10));
    p.forEach((v, i) => expect(Math.abs(v - exp.first_pushes[i])).toBeLessThan(2e-3 + 1e-3 * Math.abs(exp.first_pushes[i])));
    expect(n.turns[0].toks[0].lp1).toBeCloseTo(exp.first_lp1, 5);
    expect(n.turns[0].toks[0].guesses![0][0].id).toBe(exp.first_guess[0]);
    expect(c.turns[0].toks[0].guesses).toBeUndefined();
    expect(c.compare!.length).toBe(5);
    expect(c.compare![0].lp1).toBeCloseTo(exp.forced_lp1, 6);
    expect(rec.find({ floors: [{ floor: 0, mult: 0 }] }, "Hello?")).toBe(c);
    expect(rec.find({}, "Hello?")).toBe(n);
  });
  it("canonical change keys ignore order and neutral entries", () => {
    expect(canonical({ heads: [{ floor: 1, head: 2, mult: 0 }, { floor: 0, head: 3, mult: 1 }] })).toBe(canonical({ heads: [{ floor: 1, head: 2, mult: 0 }] }));
    expect(canonical({ swaps: [[5, 3]] })).toBe(canonical({ swaps: [[3, 5]] }));
    expect(canonical({ bits: 4 })).toBe("{}");
  });
});
