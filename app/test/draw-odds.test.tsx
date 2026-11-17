// What the page says the draw did. The engine keeps the first `cut` of its top 20 and draws among
// those, so a kept candidate's chance is its share of the kept ones and a candidate past the cut had
// none. These tests hold the page to the engine's own reference sampler, and to never calling a
// piece the visitor picked a draw.
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { candidates, sample } from "@rewire/engine/src/sampler.ts";
import type { Tok } from "../src/model/types.ts";
import { pushLength } from "../src/stage/arch.ts";
import { QWEN_INFO } from "../src/model/info.ts";
import { drawOdds, keptCount, written } from "../src/ui/odds.ts";
import { fmt, NO_NUMBER, pct, signed } from "../src/ui/color.ts";

let store: typeof import("../src/state/store.ts").store;
let initial: typeof import("../src/state/store.ts").initial;
let Detail: typeof import("../src/ui/Detail.tsx").Detail;
let Tower: typeof import("../src/ui/Tower.tsx").Tower;

beforeEach(async () => {
  vi.resetModules();
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  vi.stubGlobal("document", { documentElement: { dataset: {} } });
  vi.stubGlobal("getComputedStyle", () => ({ getPropertyValue: () => "#808080" }));
  ({ store, initial } = await import("../src/state/store.ts"));
  store.set(initial);
  ({ Detail } = await import("../src/ui/Detail.tsx"));
  ({ Tower } = await import("../src/ui/Tower.tsx"));
});
afterEach(() => vi.unstubAllGlobals());

const text = (html: string) => html.replace(/<!-- -->/g, "").replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/\s+/g, " ");
const listed = (p: number[], cut: number) => ({ cands: p.map((v, i) => ({ id: 10 + i, p: v })), cut });

it("gives each kept candidate its share of the kept ones, and nothing to a candidate past the cut", () => {
  const odds = drawOdds(listed([0.7, 0.2, 0.1], 2));
  expect(odds[0]).toBeCloseTo(0.7 / 0.9, 12);
  expect(odds[1]).toBeCloseTo(0.2 / 0.9, 12);
  expect(odds[2]).toBe(0);
  expect(odds[0] + odds[1]).toBeCloseTo(1, 12);
  // A cut that kept one candidate made the draw certain, whatever share of the top 20 it had.
  expect(drawOdds(listed([0.94, 0.04, 0.02], 1))).toEqual([1, 0, 0]);
  // Nothing was cut: the listed odds already are the draw's.
  expect(drawOdds(listed([0.5, 0.3, 0.2], 3)).map((v) => +v.toFixed(12))).toEqual([0.5, 0.3, 0.2]);
  // A greedy step lists 1 and zeros with a cut of one.
  expect(drawOdds(listed([1, 0, 0], 1))).toEqual([1, 0, 0]);
  // Odds that are not numbers are not turned into numbers, and a cut that is not a count keeps the list.
  expect(drawOdds(listed([Number.NaN, 0.2], 2)).every(Number.isNaN)).toBe(true);
  expect(keptCount(listed([0.5, 0.5], 0))).toBe(2);
  expect(keptCount(listed([0.5, 0.5], 7))).toBe(2);
});

it("agrees with the engine's reference sampler on how often each candidate is drawn", () => {
  // Scores for a small vocabulary with a clear head and a long tail, so the top-p cut drops part of the top 20.
  const vocab = 60, scores = Float32Array.from({ length: vocab }, (_, i) => 2.2 * Math.cos(i * 1.7) - i * 0.06);
  for (const temperature of [0.7, 1.3]) {
    const c = candidates(scores, vocab, temperature);
    expect(c.cut).toBeGreaterThan(1);
    expect(c.cut).toBeLessThan(c.ids.length);
    const odds = drawOdds({ cands: c.ids.map((id, k) => ({ id, p: c.probs[k] })), cut: c.cut });
    const drawn = new Map<number, number>(), draws = 40_000;
    for (let step = 0; step < draws; step++) { const id = sample(scores, vocab, 11, 0, step, temperature).id; drawn.set(id, (drawn.get(id) ?? 0) + 1); }
    c.ids.forEach((id, k) => {
      const seen = (drawn.get(id) ?? 0) / draws;
      if (k >= c.cut) expect(seen).toBe(0);
      else expect(Math.abs(seen - odds[k])).toBeLessThan(0.012);
      // The listed odds before the cut are a different number: they understate every kept candidate.
      if (k < c.cut) expect(odds[k]).toBeGreaterThan(c.probs[k]);
    });
    expect(odds.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 6);
  }
});

it("says how the written piece came to be written: drawn, or picked by the visitor from inside, past or outside the list", () => {
  const tok = { ...listed([0.6, 0.3, 0.1], 2), id: 10 };
  const drawn = written(tok), kept = written({ ...tok, id: 11, picked: true });
  expect(drawn.by).toBe("draw");
  expect(drawn.chance).toBeCloseTo(0.6 / 0.9, 12);
  expect(kept).toMatchObject({ by: "visitor", place: "kept" });
  expect(kept.chance).toBeCloseTo(0.3 / 0.9, 12);
  expect(written({ ...tok, id: 12, picked: true })).toEqual({ by: "visitor", chance: 0, place: "cut" });
  expect(written({ ...tok, id: 999, picked: true })).toEqual({ by: "visitor", chance: 0, place: "unlisted" });
});

const pushes = new Float32Array(pushLength(QWEN_INFO));
/** The token of the report: 94% of the top 20 at temperature 0.7, 86% at temperature 1, and a cut that kept it alone. */
const certain: Tok = { id: 100, lp1: Math.log(0.86), concept: 0, cut: 1, pushes,
  cands: [{ id: 100, p: 0.94, modelP: 0.86 }, { id: 101, p: 0.04, modelP: 0.08 }, { id: 102, p: 0.02, modelP: 0.03 }] };
const show = (tok: Tok) => store.set({ mode: "live", device: { kind: "ready", seconds: 3 }, word: { turn: 0, side: "normal", index: 0 }, follow: false,
  turns: [{ id: 1, user: "Q", temperature: 0.7, normal: { read: [5, 6], toks: [tok], ended: true, done: true, changes: {}, source: "live" } }] });

it("shows a certain draw as certain in the inspector, the candidate table and the 2D tower, beside the model's own probability", () => {
  show(certain);
  const panel = text(renderToString(<Detail />));
  expect(panel).toContain("Chance in the draw 100% at temperature 0.7, the only candidate the top-p cut kept");
  expect(panel).toContain("Model's probability 86.00% at temperature 1, over the whole vocabulary");
  expect(panel).not.toContain("94%");
  expect(panel).not.toContain("Probability when drawn");
  // The table: the kept candidate's real chance, "cut" for the rest, and the model's probability of each beside it.
  const rows = [...renderToString(<Detail />).matchAll(/<tr class="([^"]*)">(.*?)<\/tr>/g)].map((m) => [m[1].trim(), text(m[2]).trim()]);
  expect(rows[0][0]).toBe("chosen");
  expect(rows[0][1]).toMatch(/^1\. … 100% 86\.00%/);
  expect(rows[1][0]).toContain("dropped");
  expect(rows[1][1]).toMatch(/^2\. … cut 8\.00% Use this word/);
  expect(panel).toContain("The top-p cut (0.8) kept the top 1 of 3; the rest had no chance, though you can still use one yourself.");
  // Words out in the 2D tower says the same thing.
  const tower = renderToString(<Tower />);
  expect(tower).toMatch(/aria-label="Words out: &quot;…&quot;, 100% in the draw"/);
  expect(text(tower)).toContain('"…" 100%');
  store.set({ focus: { kind: "words-out" } });
  expect(text(renderToString(<Detail />))).toContain("drawn from 1 candidate after the cut.");
});

it("renormalises several kept candidates and never mixes the two measures", () => {
  show({ ...certain, cut: 2, cands: [{ id: 100, p: 0.6, modelP: 0.5 }, { id: 101, p: 0.2, modelP: 0.2 }, { id: 102, p: 0.2, modelP: 0.1 }], lp1: Math.log(0.5) });
  const panel = text(renderToString(<Detail />));
  expect(panel).toContain("Chance in the draw 75% at temperature 0.7, among the 2 candidates the top-p cut kept");
  expect(panel).toContain("Model's probability 50.00% at temperature 1");
  expect(text(renderToString(<Tower />))).toContain('"…" 75%');
});

it("never calls a picked piece a draw, and still says what the draw would have done with it", () => {
  // Picked from past the cut: an explicit intervention on a candidate the draw had dropped.
  show({ ...certain, id: 101, picked: true, lp1: Math.log(0.08) });
  let panel = text(renderToString(<Detail />));
  expect(panel).toContain("Selection Your choice");
  expect(panel).not.toContain("Written by");
  expect(panel).toContain("Chance in the draw none: the top-p cut dropped it");
  expect(panel).toContain("you picked in place of the model's draw");
  expect(panel).not.toContain("It was drawn from the candidates below");
  expect(renderToString(<Tower />)).toMatch(/aria-label="Words out: &quot;…&quot;, your choice"/);
  store.set({ focus: { kind: "words-out" } });
  expect(text(renderToString(<Detail />))).toContain("your choice in place of the draw. The draw would have chosen among 1 candidate.");
  // Picked from outside the top 20: no chance in the draw, and its real probability from the model.
  store.set({ focus: { kind: "word" } });
  show({ ...certain, id: 555, picked: true, lp1: Math.log(0.004) });
  panel = text(renderToString(<Detail />));
  expect(panel).toContain("Chance in the draw none: it was outside the top 20");
  expect(panel).toContain("Model's probability 0.40% at temperature 1");
  // Every candidate stays usable, the ones past the cut included.
  expect(renderToString(<Detail />).match(/Use this word<\/button>/g)).toHaveLength(3);
});

it("keeps the model's probability exact enough to tell tokens apart, and never rounds it to 0% or 100%", () => {
  // Near certainty at temperature 1 is not certainty. The draw, with one candidate kept, really is 100%.
  show({ ...certain, lp1: Math.log(0.99999), cands: [{ id: 100, p: 0.999, modelP: 0.99999 }, { id: 101, p: 0.001, modelP: 0.000004 }] });
  let html = renderToString(<Detail />), panel = text(html);
  expect(panel).toContain("Chance in the draw 100% at temperature 0.7, the only candidate the top-p cut kept");
  expect(panel).toContain("Model's probability >99.99% at temperature 1, over the whole vocabulary");
  const rows = () => [...html.matchAll(/<tr class="([^"]*)">(.*?)<\/tr>/g)].map((m) => text(m[2]).trim());
  expect(rows()[0]).toMatch(/^1\. … 100% >99\.99%/);
  expect(rows()[1]).toMatch(/^2\. … cut <0\.01%/);
  // A log-probability that rounds to zero is still shown as a bound, not as exactly 100%.
  show({ ...certain, lp1: 0, cands: [{ id: 100, p: 1, modelP: 1 }] });
  html = renderToString(<Detail />);
  expect(text(html)).toContain("Model's probability >99.99% at temperature 1");
  expect(text(html)).not.toMatch(/Model's probability 100%/);
  // Two tokens the old integer rounding showed as the same 62%.
  const seen = [0.6218, 0.6243].map((p) => {
    show({ ...certain, cut: 2, lp1: Math.log(p), cands: [{ id: 100, p: 0.7, modelP: p }, { id: 101, p: 0.3, modelP: 0.2 }] });
    html = renderToString(<Detail />);
    return [/Model's probability ([^ ]+) at/.exec(text(html))![1], rows()[0]];
  });
  expect(seen[0][0]).toBe("62.18%");
  expect(seen[1][0]).toBe("62.43%");
  expect(seen[0][1]).toMatch(/^1\. … 70% 62\.18%/);
  expect(seen[1][1]).toMatch(/^1\. … 70% 62\.43%/);
  // The changed model's probability of the same piece is the same measure, shown the same way.
  store.set({ turns: [{ ...store.get().turns[0], changed: { read: [5, 6], toks: [certain], ended: true, done: true, changes: { floors: [{ floor: 3, mult: 0 }] }, source: "live",
    compare: [{ id: 100, lp1: Math.log(0.00314), concept: 0, pushes }] } }] });
  expect(text(renderToString(<Detail />))).toContain("Changed model 0.31% at temperature 1");
});

it("names a value that is not a number instead of printing one", () => {
  expect(signed(Number.NaN)).toBe(NO_NUMBER);
  expect(signed(Number.POSITIVE_INFINITY)).toBe("+∞");
  expect(signed(Number.NEGATIVE_INFINITY)).toBe("−∞");
  expect(fmt(Number.NaN)).toBe(NO_NUMBER);
  expect(pct(Number.NaN)).toBe("unavailable");
  expect(pct(1)).toBe("100%");
  // A direct push that is not a number leaves its cell uncolored and is read out as such; the others keep their scale.
  const broken = pushes.slice(); broken[1] = Number.NaN; broken[2] = 0.5;
  show({ ...certain, pushes: broken });
  const tower = renderToString(<Tower />);
  expect(tower).not.toContain("NaN");
  expect(tower).toContain("is not a number");
  expect(tower).toContain("+0.50");
});
