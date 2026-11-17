// The three 3D benches rendered to markup without a browser: which controls exist and which are
// enabled must follow the real state of the model, before any WebGL work starts.
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { initialLesson } from "@rewire/engine/src/lora.ts";
import { layout, TINY } from "@rewire/tiny/src/config.ts";
import { VOCAB } from "@rewire/tiny/src/data.ts";
import type { Tok } from "../src/model/types.ts";
import { pushIndex, pushLength } from "../src/stage/arch.ts";
import { QWEN_INFO } from "../src/model/info.ts";

let store: typeof import("../src/state/store.ts").store;
let initial: typeof import("../src/state/store.ts").initial;
let Dismantle: typeof import("../src/stage/DismantleStage.tsx").default;
let Teach: typeof import("../src/stage/TeachStage.tsx").default;
let Grow: typeof import("../src/stage/GrowStage.tsx").default;
let Lab: typeof import("../src/ui/Lab.tsx");

beforeEach(async () => {
  vi.resetModules();
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  vi.stubGlobal("document", { documentElement: { dataset: {} } });
  vi.stubGlobal("getComputedStyle", () => ({ getPropertyValue: () => "#808080" }));
  ({ store, initial } = await import("../src/state/store.ts"));
  store.set(initial);
  Dismantle = (await import("../src/stage/DismantleStage.tsx")).default;
  Teach = (await import("../src/stage/TeachStage.tsx")).default;
  Grow = (await import("../src/stage/GrowStage.tsx")).default;
  Lab = await import("../src/ui/Lab.tsx");
});
afterEach(() => vi.unstubAllGlobals());

/** Buttons by their visible text, with whether each is disabled. */
function buttons(html: string): Map<string, boolean[]> {
  const out = new Map<string, boolean[]>();
  for (const m of html.matchAll(/<button([^>]*)>(.*?)<\/button>/g)) {
    const label = m[2].replace(/<[^>]+>/g, "").replace(/&#x27;/g, "'").replace(/<!-- -->/g, "").trim();
    out.set(label, [...(out.get(label) ?? []), /\sdisabled=""/.test(m[1])]);
  }
  return out;
}
const text = (html: string) => html.replace(/<!-- -->/g, "").replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, " ");

const pushes = new Float32Array(pushLength(QWEN_INFO));
pushes[pushIndex(QWEN_INFO, { kind: "head", floor: 20, head: 13 })] = 1.5;
pushes[pushIndex(QWEN_INFO, { kind: "mlp", floor: 27 })] = -0.25;
const tok = (id: number): Tok => ({ id, lp1: -0.1, concept: 0, cut: 2, cands: [{ id, p: 0.8 }, { id: id + 1, p: 0.2 }], pushes });
const sample = () => ({ id: 1, user: "Capital of France?", normal: { read: [5, 6], toks: [tok(100), tok(101), tok(151645)], ended: true, done: true, changes: {}, source: "live" as const } });

it("explains itself and holds every model edit until the model is ready", () => {
  store.set({ mode: "unavailable", device: { kind: "downloading", loaded: 1e8, total: 3.85e8, paused: false, seconds: 3 } });
  const html = renderToString(<Dismantle />), b = buttons(html), t = text(html);
  // The tools and what they do are visible before any download finishes.
  for (const tool of ["Explore", "Grab", "Punch"]) expect(b.get(tool)).toEqual([false]);
  expect(t).toContain("Drag to turn the model");
  expect(t).toContain("Parts can be changed once the model is ready.");
  expect(t).toContain("28 layers · original model");
  expect(b.get("Restore model")).toEqual([true]);
  expect(b.get("Play")).toEqual([true]);
  expect(b.get("Cut layer 1")).toEqual([true]);
  // The whole architecture is selectable from ordinary menus.
  expect(html.match(/<option value="\d+">Layer (?:<!-- -->)?\d+<\/option>/g)).toHaveLength(28);
  expect(t).toContain("Words in");
  expect(t).toContain("It is not a timing of the real computation.");
  expect(html).toContain('aria-label="3D model of Qwen3-0.6B: 28 layers, each with 16 attention heads and one MLP.');
});

it("shows a selected part's real controls and measured value, and locks them while a reply is written", () => {
  store.set({ mode: "live", device: { kind: "ready", seconds: 3 }, turns: [sample()], word: { turn: 0, side: "normal", index: 0 }, follow: false,
    focus: { kind: "head", floor: 20, head: 13 } });
  let html = renderToString(<Dismantle />), b = buttons(html), t = text(html);
  expect(t).toContain("Attention head 14 · Layer 21");
  expect(t).toContain("+1.50 direct push for");
  expect(b.get("Knock out")).toEqual([false]);
  expect(b.get("Restore this head")).toEqual([true]);
  expect(b.get("Replay")).toEqual([false]);
  expect(b.get("Off")).toEqual([false]);
  expect(t).toContain("Every part is lit. Direct pushes add up to +1.25");
  // The bay is honest about a measurement that has not arrived.
  expect(t).toContain("Measuring every step for this token…");
  // The same part with a real change on it.
  store.set({ chips: { heads: [{ floor: 20, head: 13, mult: 0 }] } });
  html = renderToString(<Dismantle />); b = buttons(html); t = text(html);
  expect(b.get("Put back")).toEqual([false]);
  expect(b.get("Restore this head")).toEqual([false]);
  expect(b.get("Restore model")).toEqual([false]);
  expect(t).toContain("1 active change");
  // While a reply is being written nothing can be edited, and the reason is stated.
  store.set({ busy: true });
  html = renderToString(<Dismantle />); b = buttons(html);
  expect(b.get("Put back")).toEqual([true]);
  expect(b.get("Restore model")).toEqual([true]);
  expect(text(html)).toContain("Wait for the reply to finish");
  // A stale reply is never measured.
  store.set({ busy: false, turns: [{ ...sample(), changed: { ...sample().normal, stale: true, changes: { heads: [{ floor: 1, head: 1, mult: 0 }] } } }], word: { turn: 0, side: "changed", index: 0 } });
  expect(text(renderToString(<Dismantle />))).toContain("This reply used earlier settings.");
});

it("offers the same Follow output control in 2D and 3D, usable and explained before and after output", () => {
  /** The toggle, the hint it is described by, and whether it is disabled. */
  const control = (html: string) => {
    const all = [...html.matchAll(/<button([^>]*class="follow-toggle"[^>]*)>(.*?)<\/button>/g)];
    expect(all).toHaveLength(1);
    const attrs = all[0][1], id = /aria-describedby="([^"]+)"/.exec(attrs)![1];
    const hint = new RegExp(`<p class="note follow-hint" id="${id}">(.*?)</p>`).exec(html);
    return { label: all[0][2], pressed: /aria-pressed="(\w+)"/.exec(attrs)![1], type: /type="(\w+)"/.exec(attrs)![1], title: /title="([^"]+)"/.exec(attrs)![1],
      disabled: /\sdisabled=""/.test(attrs), hint: hint ? text(hint[1]).trim() : null };
  };
  store.set({ mode: "live", device: { kind: "ready", seconds: 3 } });
  // No output yet: enabled, on, and waiting rather than failed.
  let flat = control(renderToString(<Lab.LabScope />)), stage = control(renderToString(<Dismantle />));
  for (const c of [flat, stage]) expect(c).toMatchObject({ label: "Follow output", pressed: "true", type: "button", disabled: false });
  expect(flat.hint).toBe("Following: waiting for the first token.");
  expect(stage.hint).toBe(`${flat.hint} Replay animates one token and pauses following.`);
  expect(flat.title).toBe(stage.title);
  const following = flat.title;
  // Paused on a chosen token: the same words in both views, and only 3D mentions its replay.
  store.set({ turns: [sample()], word: { turn: 0, side: "normal", index: 0 }, follow: false });
  const paused = renderToString(<Dismantle />);
  flat = control(renderToString(<Lab.LabScope />)); stage = control(paused);
  for (const c of [flat, stage]) expect(c).toMatchObject({ label: "Follow output", pressed: "false", disabled: false });
  expect(flat.hint).toBe("Paused on this token. New replies will not move it.");
  expect(stage.hint).toBe(`${flat.hint} Replay animates this one token.`);
  expect(flat.title).toBe(stage.title);
  expect(flat.title).not.toBe(following);
  // Paused with nothing selected says what will happen, and following with a token says it is live.
  store.set({ turns: [], word: null });
  expect(control(renderToString(<Lab.LabScope />)).hint).toBe("Paused: the first token written will be selected and kept.");
  store.set({ turns: [sample()], word: { turn: 0, side: "normal", index: 1 }, follow: true });
  expect(control(renderToString(<Lab.LabScope />)).hint).toBe("Following: the newest token is selected as it is written.");
  // The copy never describes the replay as real timing, and uses no em dash.
  expect(text(paused)).toContain("It is not a timing of the real computation.");
  for (const c of [flat, stage]) expect(`${c.hint}${c.title}`).not.toContain("—");
});

it("names every camera action, says where you are, and opens no empty bay before there is something to show", () => {
  store.set({ mode: "live", device: { kind: "ready", seconds: 3 }, focus: { kind: "head", floor: 20, head: 13 } });
  const html = renderToString(<Dismantle />), t = text(html);
  // Each dock button has an accessible name, a tooltip with its key, and a word for screens with no pointer.
  for (const [name, word] of [["Fit the whole model", "Fit"], ["Focus on the selected part", "Focus"], ["Zoom out", "Zoom out"], ["Zoom in", "Zoom in"], ["Spread the layers apart", "Spread"], ["Views", "Views"], ["How to move around the model", "Help"]]) {
    const button = new RegExp(`<button[^>]*aria-label="${name}"[^>]*>.*?</button>`).exec(html)?.[0] ?? "";
    expect(button).toContain("data-tip=");
    expect(button).toContain(`>${word}</span>`);
  }
  expect(html).toMatch(/aria-label="Pan: drags slide the view and clicks do nothing"[^>]*aria-pressed="false"/);
  expect(html).toContain('role="toolbar" aria-label="Camera and layout"');
  // The breadcrumb reads from the model down to the part, with steps to the layers on either side.
  expect(/<nav class="stage-crumb"[^>]*>(.*?)<\/nav>/.exec(html)![1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()).toBe("Model › Layer 21 › Head 14");
  expect(html).toMatch(/aria-label="Up one layer"[^>]*>/);
  expect(html).not.toMatch(/aria-label="Up one layer"[^>]*disabled=""/);
  // Nothing has been moved, so there is nothing to reset. The old Reset view is the dock's Fit.
  expect(buttons(html).get("Reset layout")).toEqual([true]);
  expect(buttons(html).has("Reset view")).toBe(false);
  // No question yet: the reason is given beside the stage, where it does not cover the model.
  expect(t).toContain("Ask a question and select a token to measure this layer.");
  expect(t).toContain("No shape stands for real hardware or for an individual parameter.");
  // At the top of the stack there is no layer above to step to.
  store.set({ focus: { kind: "word" } });
  const top = renderToString(<Dismantle />);
  expect(/<nav class="stage-crumb"[^>]*>(.*?)<\/nav>/.exec(top)![1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()).toBe("Model");
  expect(top).toMatch(/aria-label="Focus on the selected part"[^>]*disabled=""/);
});

it("offers the 3D view from the flat scope and falls back to it when WebGL is unavailable", () => {
  let html = renderToString(<Lab.LabScope />);
  expect(html).toContain('aria-label="Model view"');
  expect(buttons(html).get("3D")).toEqual([false]);
  expect(html).toContain('class="tower');
  // After a failed start the switch is disabled and the flat tower stays, whatever view was asked for.
  store.set({ stage3d: false, scopeView: "3d" });
  html = renderToString(<Lab.LabScope />);
  expect(buttons(html).get("3D")).toEqual([true]);
  expect(html).toContain('class="tower');
  expect(html).not.toContain("stage-bench");
});

it("keeps Teach's training controls in the 3D bench and never offers Punch there", () => {
  const reference = initialLesson({ width: 1024, units: 3072 });
  const controls = { busy: false, phase: "idle" as const, ready: false, validation: "", status: "", error: "", revision: 0, train() {}, halt() {}, dismantle() {} };
  const props = { weights: null, reference, step: 0, running: false, losses: [], run: null, examples: [{ prompt: "Q", answer: "A" }], active: true };
  let b = buttons(renderToString(<Teach {...props} controls={controls} />));
  expect(b.get("Teach Qwen")).toEqual([true]);
  expect(b.has("Punch")).toBe(false);
  expect(b.get("Dismantle this model")).toEqual([true]);
  b = buttons(renderToString(<Teach {...props} controls={{ ...controls, ready: true }} />));
  expect(b.get("Teach Qwen")).toEqual([false]);
  b = buttons(renderToString(<Teach {...props} controls={{ ...controls, ready: true, validation: "Example 1 needs both a question and an answer." }} />));
  expect(b.get("Teach Qwen")).toEqual([true]);
  // Training: only Stop. Afterwards: continue from the adapter or start again, and hand off to Dismantle.
  const trained = { a: reference.a.slice(), b: reference.b.map((_, i) => (i === 3 ? 0.5 : 0)) };
  let html = renderToString(<Teach {...props} weights={trained} step={40} running losses={[{ step: 0, loss: 3 }, { step: 40, loss: 1 }]} controls={{ ...controls, ready: true, busy: true, phase: "training" }} />);
  b = buttons(html);
  expect(b.get("Stop learning")).toEqual([false]);
  expect(b.has("Teach Qwen")).toBe(false);
  expect(text(html)).toContain("40 steps");
  expect(html).toContain("0.00276");
  html = renderToString(<Teach {...props} weights={trained} step={200} controls={{ ...controls, ready: true, revision: 1 }} />);
  b = buttons(html);
  expect(b.get("Continue learning")).toEqual([false]);
  expect(b.get("Train from original")).toEqual([false]);
  expect(b.get("Dismantle this model")).toEqual([false]);
  expect(text(html)).toContain("Parameters changed 1");
});

it("gates Grow's weight edits on a trained, idle model", () => {
  const total = layout({ ...TINY, vocab: VOCAB }).total, params = Float32Array.from({ length: total }, (_, i) => Math.sin(i) * 0.02);
  const controls = { disabled: false, unavailable: false, validText: true, status: "", loss: null, mutation: "", damage: null, strength: 0.25, setStrength() {}, teach() {}, stop() {},
    mutate() {}, restore() {}, prompt: "red star = ", setPrompt() {}, test() {}, result: null, baseline: null };
  const props = { params: null, reference: null, intact: null, step: 0, running: false, active: true };
  let b = buttons(renderToString(<Grow {...props} controls={controls} />));
  expect(b.get("Start learning")).toEqual([false]);
  expect(b.get("Scramble weights")).toEqual([true]);
  expect(b.get("Restore intact model")).toEqual([true]);
  expect(buttons(renderToString(<Grow {...props} controls={{ ...controls, unavailable: true }} />)).get("Start learning")).toEqual([true]);
  // Training: stop only, and no damage until the round finishes.
  b = buttons(renderToString(<Grow {...props} params={params} reference={params} running step={300} controls={{ ...controls, disabled: true, loss: 1.234 }} />));
  expect(b.get("Stop learning")).toEqual([false]);
  expect(b.get("Scramble weights")).toEqual([true]);
  // Trained and idle: every existing mutation is reachable, and Restore appears once something is damaged.
  const html = renderToString(<Grow {...props} params={params} reference={params} intact={params} step={1200}
    controls={{ ...controls, mutation: "Layer 2: noise at 25% of each matrix’s RMS", damage: { kind: "noise", floor: 1 } }} />);
  b = buttons(html);
  for (const label of ["Start over from noise", "Keep learning", "Scramble weights", "Erase weights", "Restore intact model", "Punch"]) expect(b.get(label)).toEqual([false]);
  expect(text(html)).toContain("Layer 2: noise at 25%");
  // The Strength slider is the control its label names.
  const strength = /<label for="([^"]+)">Strength<\/label>/.exec(html)![1];
  expect(html).toMatch(new RegExp(`<input[^>]*id="${strength}"[^>]*type="range"|<input[^>]*type="range"[^>]*id="${strength}"`));
  expect(text(html)).toContain("1,200 steps");
});
