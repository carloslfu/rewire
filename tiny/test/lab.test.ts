import { describe, expect, it } from "vitest";
import { layout, TINY } from "../src/config.ts";
import { mutateWeights, secretLanguage, weightStats } from "../src/lab.ts";

const cfg = { ...TINY, vocab: 97 };
describe("physical weight experiments", () => {
  it("erases exactly the chosen floor matrices and preserves the original snapshot and norms", () => {
    const p = new Float32Array(layout(cfg).total).fill(0.125);
    const out = mutateWeights(p, cfg, { kind: "erase", amount: 1, seed: 8, floor: 2 });
    let changed = 0;
    for (const t of layout(cfg).tensors) {
      const erase = t.name.startsWith("f2.") && t.shape.length === 2;
      for (let i = t.offset; i < t.offset + t.size; i++) expect(out[i]).toBe(erase ? 0 : p[i]);
      if (erase) changed += t.size;
    }
    expect(weightStats(out, p).changed).toBe(changed);
    expect(p.every((v) => v === 0.125)).toBe(true);
  });
  it("makes repeatable noise with zero as identity", () => {
    const p = new Float32Array(layout(cfg).total).fill(0.02);
    const spec = { kind: "noise" as const, amount: 0.5, seed: 3 };
    expect(mutateWeights(p, cfg, spec)).toEqual(mutateWeights(p, cfg, spec));
    expect(weightStats(mutateWeights(p, cfg, { ...spec, amount: 0 }), p).changed).toBe(0);
    expect(weightStats(mutateWeights(p, cfg, spec), p).changed).toBeGreaterThan(700_000);
  });
  it("never trains on the six test combinations, while each component appears in training", () => {
    const { text, tests } = secretLanguage();
    expect(text.trim().split("\n")).toHaveLength(30);
    for (const t of tests) {
      expect(text).not.toContain(t.prompt);
      for (const word of [...t.prompt.split(" = ")[0].split(" "), ...t.answer.split(" ")]) expect(text).toContain(word);
    }
  });
});
