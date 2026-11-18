// What the bars over Words out say: the model's own probabilities (temperature 1, whole vocabulary),
// never the draw's odds, with the written piece always present and nothing rounded into a certainty.
import { expect, it } from "vitest";
import { NO_CANDIDATE } from "@rewire/engine/src/kernels.ts";
import { candidates } from "../src/live/cands.ts";
import type { Cand } from "../src/model/types.ts";
import { outputBars } from "../src/stage/adapters.ts";
import { modelPct } from "../src/ui/color.ts";
import { tokenLabel } from "../src/ui/token-label.ts";

it("distinguishes output candidates that differ by a space and preserves the number of spaces", () => {
  expect(["Paris", " Paris", "  Paris", "Paris ", "  ", "New York"].map(tokenLabel))
    .toEqual(["Paris", "␣Paris", "␣␣Paris", "Paris␣", "␣␣", "New York"]);
  expect(tokenLabel(" \n\t Paris")).toBe("␣↵⇥␣Paris");
});

it("keeps the draw's odds as they were and adds the model's probability beside them", () => {
  // A cold draw: the sampler is certain among its 20, the model over its whole vocabulary is not.
  const ids = [10, 11, 12, 0xffffffff], probs = [1, 0, 0, 0], lp = [Math.log(0.62), Math.log(0.2), Math.log(0.004), NO_CANDIDATE];
  const c = candidates(ids, probs, Float32Array.from(lp));
  expect(c.map((x) => x.id)).toEqual(ids);
  expect(c.map((x) => x.p)).toEqual(probs);
  expect(c[0].modelP).toBeCloseTo(0.62, 6);
  expect(c[1].modelP).toBeCloseTo(0.2, 6);
  expect(c[2].modelP).toBeCloseTo(0.004, 6);
  // A slot with no word in it, or a value that cannot be a log-probability, gets none.
  expect("modelP" in c[3]).toBe(false);
  for (const bad of [Number.NaN, 0.5, 1]) expect("modelP" in candidates([7], [1], [bad])[0]).toBe(false);
  expect(candidates([7], [1], [0])[0].modelP).toBe(1);
  expect(candidates([7], [1], [-Infinity])[0].modelP).toBe(0);
  // An engine result without the new data still gives the old shape.
  expect(candidates([7, 8], [0.75, 0.25])).toEqual([{ id: 7, p: 0.75 }, { id: 8, p: 0.25 }]);
});

it("draws the model's probabilities, with the written piece at exp(lp1), and never the draw's odds", () => {
  const cands: Cand[] = [{ id: 10, p: 1, modelP: 0.62 }, { id: 11, p: 0, modelP: 0.2 }, { id: 12, p: 0, modelP: 0.05 }, { id: 13, p: 0, modelP: 0.03 },
    { id: 14, p: 0, modelP: 0.02 }, { id: 15, p: 0, modelP: 0.01 }];
  // The top piece was written. The sampler said 100%; the bar says what the model said.
  let bars = outputBars({ id: 10, lp1: Math.log(0.62), cands }, 5);
  expect(bars.map((b) => b.id)).toEqual([10, 11, 12, 13, 14]);
  expect(bars.map((b) => b.chosen)).toEqual([true, false, false, false, false]);
  expect(bars[0].p).toBeCloseTo(0.62, 6);
  expect(bars.map((b) => +b.p.toFixed(2))).toEqual([0.62, 0.2, 0.05, 0.03, 0.02]);
  expect(bars.reduce((a, b) => a + b.p, 0)).toBeLessThan(1);
  // A lower-ranked piece was drawn: it keeps its place in the order and takes the last alternative's slot.
  bars = outputBars({ id: 15, lp1: Math.log(0.01), cands }, 5);
  expect(bars.map((b) => b.id)).toEqual([10, 11, 12, 13, 15]);
  expect(bars.at(-1)).toMatchObject({ chosen: true });
  expect(bars.at(-1)!.p).toBeCloseTo(0.01, 6);
  // A piece picked by hand from outside the top 20: still drawn, with its real probability from lp1.
  bars = outputBars({ id: 999, lp1: Math.log(0.0004), cands }, 5);
  expect(bars.map((b) => b.id)).toEqual([10, 11, 12, 13, 999]);
  expect(bars.at(-1)!.chosen).toBe(true);
  expect(bars.at(-1)!.p).toBeCloseTo(0.0004, 8);
  expect(bars.filter((b) => b.chosen)).toHaveLength(1);
  // The written piece is measured by lp1 even where the list has a slightly different number for it.
  bars = outputBars({ id: 11, lp1: Math.log(0.21), cands }, 5);
  expect(bars.find((b) => b.chosen)!.p).toBeCloseTo(0.21, 6);
  // With no model probabilities for the alternatives, they are left out, not drawn with sampling odds.
  bars = outputBars({ id: 10, lp1: Math.log(0.62), cands: cands.map(({ id, p }) => ({ id, p })) }, 5);
  expect(bars).toHaveLength(1);
  expect(bars[0]).toMatchObject({ id: 10, chosen: true });
  expect(bars[0].p).toBeCloseTo(0.62, 6);
  // The tiny model's letters work the same way, and a nonsense log-probability cannot leave the 0 to 1 range.
  expect(outputBars({ id: 3, lp1: 0.2, cands: [{ id: 3, p: 1, modelP: 1 }] }, 5)[0].p).toBe(1);
  expect(outputBars({ id: 3, lp1: -Infinity, cands: [] }, 5)[0].p).toBe(0);
  // A log-probability that is not a number: the written piece keeps its bar, last, and is labelled unavailable.
  bars = outputBars({ id: 10, lp1: Number.NaN, cands }, 5);
  expect(bars.map((b) => b.id)).toEqual([11, 12, 13, 14, 10]);
  expect(bars.at(-1)!.chosen).toBe(true);
  expect(modelPct(bars.at(-1)!.p)).toBe("unavailable");
});

it("always shows two decimals, so different probabilities read as different numbers, and is honest at both ends", () => {
  const cases: [number, string][] = [
    [0.6218, "62.18%"], [0.62184, "62.18%"], [0.6219, "62.19%"], [0.9972, "99.72%"], [0.01, "1.00%"], [0.905, "90.50%"], [0.5, "50.00%"],
    [0.032, "3.20%"], [0.0042, "0.42%"], [0.0001, "0.01%"], [0.00016, "0.02%"],
    // Below 0.01%: said so, not rounded to a number that looks measured.
    [0.0000999, "<0.01%"], [0.00004, "<0.01%"], [1e-12, "<0.01%"], [0, "<0.01%"],
    // From 99.995% two decimals would say 100%. Nothing over a whole vocabulary is.
    [0.99994, "99.99%"], [0.999949, "99.99%"], [0.99995, ">99.99%"], [0.999999, ">99.99%"], [1, ">99.99%"],
    // Not a probability: unavailable, never a pretend near-zero.
    [Number.NaN, "unavailable"], [Infinity, "unavailable"], [-Infinity, "unavailable"], [-0.2, "unavailable"], [1.2, "unavailable"],
  ];
  for (const [p, shown] of cases) expect(`${p} ${modelPct(p)}`).toBe(`${p} ${shown}`);
  // Never exactly 100% or 0%, and always two decimals when it is a number.
  for (let p = 0; p <= 1; p += 0.00037) {
    const shown = modelPct(p);
    expect(["100.00%", "0.00%"]).not.toContain(shown);
    expect(shown).toMatch(/^(<0\.01%|>99\.99%|\d{1,2}\.\d{2}%)$/);
  }
  // Two tokens whose probabilities differ by a hundredth of a percent are told apart.
  expect(modelPct(0.4312)).not.toBe(modelPct(0.4313));
});
