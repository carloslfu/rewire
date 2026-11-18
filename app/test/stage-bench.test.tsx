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
import { afterDamage, afterTraining, continueNote, copyLabel, isDamaged, type Lineage, whileTraining } from "../src/tiny/lineage.ts";
import { S } from "../src/strings.ts";

let store: typeof import("../src/state/store.ts").store;
let initial: typeof import("../src/state/store.ts").initial;
let Dismantle: typeof import("../src/stage/DismantleStage.tsx").default;
let Teach: typeof import("../src/stage/TeachStage.tsx").default;
let Grow: typeof import("../src/stage/GrowStage.tsx").default;
let Lab: typeof import("../src/ui/Lab.tsx");
let Talk: typeof import("../src/ui/Conversation.tsx");
let R: typeof import("../src/stage/replay-session.ts");

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
  Talk = await import("../src/ui/Conversation.tsx");
  R = await import("../src/stage/replay-session.ts");
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
  // Replay is in plain sight before there is anything to replay, and says how to get there.
  expect(b.get("Replay answer")).toEqual([true]);
  expect(t).toContain("Live output");
  expect(t).toContain("Ask a question first. Once the reply is finished you can replay it here.");
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
  expect(b.get("Replay answer")).toEqual([false]);
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
  expect(b.get("Replay answer")).toEqual([true]);
  expect(text(html)).toContain("Wait for the reply to finish");
  expect(text(html)).toContain("Replay is ready when this reply is finished.");
  // A stale reply is never measured.
  store.set({ busy: false, turns: [{ ...sample(), changed: { ...sample().normal, stale: true, changes: { heads: [{ floor: 1, head: 1, mult: 0 }] } } }], word: { turn: 0, side: "changed", index: 0 } });
  expect(text(renderToString(<Dismantle />))).toContain("This reply used earlier settings.");
});

it("offers one Follow output control on the model the page mounts, usable and explained before and after output", () => {
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
  expect(stage.hint).toBe(flat.hint);
  expect(flat.title).toBe(stage.title);
  const following = flat.title;
  // Paused on a chosen token: the same words in both views.
  store.set({ turns: [sample()], word: { turn: 0, side: "normal", index: 0 }, follow: false });
  const paused = renderToString(<Dismantle />);
  flat = control(renderToString(<Lab.LabScope />)); stage = control(paused);
  for (const c of [flat, stage]) expect(c).toMatchObject({ label: "Follow output", pressed: "false", disabled: false });
  expect(flat.hint).toBe("Paused on this token. New replies will not move it.");
  expect(stage.hint).toBe(flat.hint);
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

it("puts Replay answer in plain sight under the stage and says why it is waiting", () => {
  /** The primary entry, and the sentence it is described by. */
  const entry = (html: string) => {
    const m = /<button([^>]*class="btn primary replay-enter"[^>]*)>(.*?)<\/button>/.exec(html)!;
    const how = new RegExp(`<p class="note replay-how" id="${/aria-describedby="([^"]+)"/.exec(m[1])![1]}">(.*?)</p>`).exec(html)!;
    return { label: text(m[2]).trim(), type: /type="(\w+)"/.exec(m[1])![1], disabled: /\sdisabled=""/.test(m[1]), how: text(how[1]).trim() };
  };
  // The strip sits directly under the stage, before the scrolling controls, in the one section that names both modes.
  store.set({ mode: "live", device: { kind: "ready", seconds: 3 } });
  let html = renderToString(<Dismantle />);
  expect(html.indexOf('class="stage-bar"')).toBeGreaterThan(html.indexOf('class="stage-view"'));
  expect(html.indexOf('class="stage-bar"')).toBeLessThan(html.indexOf('class="stage-lower"'));
  expect(html).toContain('<section class="replay-bar" aria-label="Live output and replay">');
  expect(html).toContain('<span class="replay-mode live">Live output</span>');
  // Nothing asked yet: the way there is spelled out.
  expect(entry(html)).toEqual({ label: "Replay answer", type: "button", disabled: true, how: "Ask a question first. Once the reply is finished you can replay it here." });
  expect(text(html)).toContain("Ask a question to light up the model.");
  // The reply is being written: tokens are on screen, and Replay waits for the end.
  const writing = { ...sample(), normal: { ...sample().normal, toks: [tok(100)], ended: false, done: false } };
  store.set({ turns: [writing], word: { turn: 0, side: "normal", index: 0 }, busy: true });
  expect(entry(renderToString(<Dismantle />))).toMatchObject({ disabled: true, how: "Replay is ready when this reply is finished." });
  // The model is rewriting changed answers (the store calls that `replay`): a different thing, and Replay waits for it too.
  store.set({ turns: [sample()], replay: { turn: 0, status: "running" } });
  expect(entry(renderToString(<Dismantle />))).toMatchObject({ disabled: true, how: "Replay is ready when the sample update is finished." });
  store.set({ busy: false, replay: { turn: 0, status: "stopped" } });
  expect(entry(renderToString(<Dismantle />))).toMatchObject({ disabled: true, how: "Retry the sample update or restore the originals, then replay." });
  // A reply written under earlier settings is never replayed.
  store.set({ replay: null, turns: [{ ...sample(), changed: { ...sample().normal, stale: true, changes: { heads: [{ floor: 1, head: 1, mult: 0 }] } } }], word: { turn: 0, side: "changed", index: 0 } });
  expect(entry(renderToString(<Dismantle />))).toMatchObject({ disabled: true, how: "This reply used earlier settings. Select a token in a current reply." });
  // Finished and idle: enabled, explained, with the single-token replay as the smaller choice beside it.
  store.set({ turns: [sample()], word: { turn: 0, side: "normal", index: 1 } });
  html = renderToString(<Dismantle />);
  expect(entry(html)).toEqual({ label: "Replay answer", type: "button", disabled: false,
    how: "Walks this reply through the whole model, token by token. Replay only this token" });
  expect(buttons(html).get("Replay only this token")).toEqual([false]);
  expect(text(html)).toContain("Token 2 of 2 · Original reply");
  expect(html).toMatch(/aria-label="Previous token"[^>]*>/);
  expect(html).toMatch(/aria-label="Next token"[^>]*disabled=""/);
  // Live has no transport, and the page never calls a replay real timing.
  for (const label of ["Pause", "Resume", "Back to live"]) expect(buttons(html).has(label)).toBe(false);
  expect(html).not.toContain('type="range" min="1"');
  expect(text(html)).toContain("Nothing is generated again. It is not a timing of the real computation.");
  expect(text(html)).not.toContain("—");
});

it("shows Replay as its own mode: what is playing, where it is, what each control does, and the way back", () => {
  store.set({ mode: "live", device: { kind: "ready", seconds: 3 }, turns: [sample()], word: { turn: 0, side: "normal", index: 1 }, follow: true });
  expect(R.startReplay("answer")).toBe(true);
  let html = renderToString(<Dismantle />), b = buttons(html), t = text(html);
  // The mode, the token and its place in the answer, and one obvious way out. Follow output is not offered inside a replay.
  expect(html).toContain('<section class="replay-bar replaying" aria-label="Replay of this answer">');
  expect(html).toContain('<span class="replay-mode on playing">Replaying</span>');
  expect(b.get("Back to live")).toEqual([false]);
  expect(b.has("Replay answer")).toBe(false);
  expect(html).not.toContain("follow-toggle");
  expect(t).toContain("Token 1 of 2 · Original reply");
  expect(html).toContain('<strong title="Awaiting output">…</strong>');
  expect(store.get()).toMatchObject({ follow: false, word: { turn: 0, side: "normal", index: 0 } });
  // One primary control. While playing it pauses.
  expect(html.match(/class="btn primary[^"]*"/g)).toHaveLength(1);
  expect(b.get("Pause")).toEqual([false]);
  // The scrubber is labelled with what it moves through, and reads its position in words.
  const scrub = /<label class="replay-scrub" for="([^"]+)">(.*?)<\/label>/.exec(html)!;
  expect(text(scrub[2])).toContain("Steps for this token");
  expect(text(scrub[2])).toContain("Step 1 of 58");
  expect(scrub[2]).toContain(`id="${scrub[1]}"`);
  expect(scrub[2]).toMatch(/type="range" min="1" max="58" step="1"/);
  expect(scrub[2]).toContain('aria-valuetext="Step 1 of 58: Read the token"');
  // Whole answer: progress runs from nothing at the first step of the first token to full at the last step of the last.
  expect(html).toMatch(/<progress class="replay-progress playing" max="115" value="0" aria-label="Replay progress through the whole answer: Token 1 of 2, step 1 of 58"/);
  // Steps through the model are words in their own named group; tokens are the chevrons beside the token.
  const steps = /<div class="replay-steps" role="group" aria-label="Step through the model">(.*?)<\/div>/.exec(html)![1];
  expect([...buttons(steps).entries()]).toEqual([["Back a step", [true]], ["Next step", [false]]]);
  expect(steps.match(/Pauses the replay\./g)).toHaveLength(2);
  for (const [name, off] of [["Previous token", true], ["Next token", false]] as const) {
    const button = new RegExp(`<button[^>]*aria-label="${name}"[^>]*>`).exec(html)![0];
    expect(/\sdisabled=""/.test(button)).toBe(off);
    expect(button).toContain("Pauses the replay.");
  }
  // Scope and speed are named groups with the current choice pressed.
  expect(html).toMatch(/aria-pressed="true"[^>]*>Whole answer<\/button>/);
  expect(html).toMatch(/aria-pressed="false"[^>]*>This token<\/button>/);
  for (const [speed, on] of [["Slow", false], ["Steady", true], ["Fast", false]] as const) expect(html).toMatch(new RegExp(`aria-pressed="${on}"[^>]*>${speed}</button>`));
  // The readout names the step, and a screen reader hears the state, not every step.
  expect(t).toContain("Read the token.");
  expect(html).toContain('<p class="sr-only" aria-live="polite">Replay playing: the whole answer.</p>');
  expect(t).not.toContain("Every part is lit.");

  // Paused part way: Resume, and the place is announced.
  R.session.seek(42);
  html = renderToString(<Dismantle />); b = buttons(html); t = text(html);
  expect(b.get("Resume")).toEqual([false]);
  expect(b.get("Start over")).toEqual([false]);
  expect(html).toContain('<span class="replay-mode on paused">Replay paused</span>');
  expect(html).toMatch(/<progress class="replay-progress paused" max="115" value="41"/);
  expect(t).toContain("Layer 21 · attention. Direct pushes so far: +1.50 of +1.25.");
  expect(html).toContain('aria-live="polite">Replay paused. Token 1 of 2, step 42 of 58, Layer 21 · attention.</p>');
  // A token chosen by hand is shown whole, and the button says what Play will do with it.
  R.session.toToken(1);
  html = renderToString(<Dismantle />); t = text(html);
  expect(buttons(html).get("Play from this token")).toEqual([false]);
  expect(t).toContain("Token written: “…”, which the model gave 90.48%. Direct pushes add up to +1.25.");
  // This token: the same bar is about the token alone. Its first step is empty and its last is full, wherever the token sits in the answer.
  R.session.setScope("token");
  html = renderToString(<Dismantle />);
  expect(buttons(html).get("Play this token")).toEqual([false]);
  expect(html).toMatch(/<progress class="replay-progress paused" max="57" value="57" aria-label="Replay progress through this token: step 58 of 58"/);
  R.session.seek(1);
  expect(renderToString(<Dismantle />)).toMatch(/<progress class="replay-progress paused" max="57" value="0" aria-label="Replay progress through this token: step 1 of 58"/);
  R.session.setScope("answer");
  R.session.seek(58);
  // The end is an end: said in words, with Replay again, and nothing left to step into.
  R.session.play();
  for (let i = 0; i < 5000 && !R.session.get().ended; i++) R.session.frame(100);
  html = renderToString(<Dismantle />); b = buttons(html); t = text(html);
  expect(b.get("Replay again")).toEqual([false]);
  expect(html).toContain('<span class="replay-mode on ended">Replay finished</span>');
  expect(html).toMatch(/<progress class="replay-progress ended" max="115" value="115"/);
  expect(b.has("Start over")).toBe(false);
  expect(t).toContain("End of the answer. Token written:");
  expect(buttons(html).get("Next step")).toEqual([true]);
  expect(html).toContain('aria-live="polite">Replay finished at token 2 of 2.</p>');
  expect(t).not.toContain("—");

  // While a whole answer plays, a selected layer is not measured for each token going by, and says so.
  R.session.play();
  store.set({ focus: { kind: "head", floor: 20, head: 13 } });
  expect(text(renderToString(<Dismantle />))).toContain("Pause the replay to measure this layer for the token on screen.");
  R.session.pause();
  expect(text(renderToString(<Dismantle />))).toContain("Measuring every step for this token…");
  // Back to live: the live strip again, following.
  R.session.exit("live");
  html = renderToString(<Dismantle />);
  expect(html).toContain('<span class="replay-mode live">Live output</span>');
  expect(buttons(html).get("Replay answer")).toEqual([false]);
  expect(html).toMatch(/class="follow-toggle"[^>]*aria-pressed="true"/);
});

it("offers a replay on each finished reply in the conversation, and not while the model is writing or the 3D drawing could not start", () => {
  const changed = { ...sample().normal, toks: [tok(200), tok(151645)], changes: { heads: [{ floor: 20, head: 13, mult: 0 }] } };
  store.set({ mode: "live", device: { kind: "ready", seconds: 3 }, turns: [{ ...sample(), changed }], fork: 0 });
  let b = buttons(renderToString(<Talk.Conversation />));
  expect(b.get(S.replayIn3d)).toEqual([false, false]);
  store.set({ busy: true });
  expect(buttons(renderToString(<Talk.Conversation />)).has(S.replayIn3d)).toBe(false);
  store.set({ busy: false, replay: { turn: 0, status: "stopped" } });
  expect(buttons(renderToString(<Talk.Conversation />)).has(S.replayIn3d)).toBe(false);
  store.set({ replay: null, stage3d: false });
  expect(buttons(renderToString(<Talk.Conversation />)).has(S.replayIn3d)).toBe(false);
  // A stale reply is not offered; its current sibling still is.
  store.set({ stage3d: true, turns: [{ ...sample(), changed: { ...changed, stale: true } }] });
  b = buttons(renderToString(<Talk.Conversation />));
  expect(b.get(S.replayIn3d)).toEqual([false]);
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

it("is the one drawing of the model: no 2D view to fall back to, and a failed start says so and keeps named parts, real controls and readings", async () => {
  const { startsStage } = await import("../src/stage/Workbench.tsx");
  const readout = (html: string) => text(/<p class="stage-readout" role="status">(.*?)<\/p>/.exec(html)![1]).trim();
  store.set({ mode: "live", device: { kind: "ready", seconds: 3 }, turns: [sample()], word: { turn: 0, side: "normal", index: 0 }, follow: false, focus: { kind: "head", floor: 20, head: 13 } });
  // What the page mounts is the 3D bench itself. Nothing offers another view, and nothing draws a flat diagram.
  let html = renderToString(<Lab.LabScope />);
  expect(html).toContain('class="stage-bench"');
  expect(html).not.toMatch(/aria-label="Model view"|class="tower|stage-recovery/);
  for (const other of ["2D", "3D", "Use the 2D view"]) expect(buttons(html).has(other)).toBe(false);
  expect(text(html)).toContain("Opening the 3D model…");
  expect(readout(html)).toMatch(/^Every part is lit\. Direct pushes add up to \+1\.25/);
  expect(html).toContain('class="stage-legend"');

  // The drawing could not start: no WebGL, or its code did not load. The bench stays and says so.
  store.set({ stage3d: false });
  html = renderToString(<Lab.LabScope />);
  const b = buttons(html), t = text(html);
  expect(html).toContain('class="stage-bench undrawn"');
  const said = text(/<div class="stage-state stage-recovery" role="alert">(.*?)<\/div><\/div>/.exec(html)![1]);
  expect(said).toContain("The 3D model could not start in this browser.");
  expect(said).toContain("The model itself is not affected. Every part can still be selected by name, and its controls and measurements are real and work without the drawing.");
  expect(said).toContain("There is no other drawing of the model.");
  expect(b.get("Try again")).toEqual([false]);
  expect(b.get("Select a part by name")).toEqual([false]);
  expect(t).not.toContain("Opening the 3D model");
  // Tools and the camera act on a drawing. Without one they are not offered as if they worked.
  for (const gone of ["Explore", "Grab", "Punch", "Reset layout", "2D", "Use the 2D view"]) expect(b.has(gone)).toBe(false);
  expect(html).not.toContain('role="toolbar" aria-label="Camera and layout"');
  expect(html).toContain('aria-label="Parts of Qwen3-0.6B, without the 3D drawing: 28 layers, each with 16 attention heads and one MLP. Arrow keys move between parts."');
  // Every part is still selectable by name, each with its own measured number for the selected token.
  expect(html.match(/<option value="\d+"[^>]*>Layer \d+[^<]*<\/option>/g)).toHaveLength(28);
  for (const named of [/<option value="out">Words out<\/option>/, /<option value="norm">Final normalization<\/option>/, /<option value="in">Words in · \+0\.00<\/option>/,
    /<option value="20"[^>]*>Layer 21 · \+1\.50<\/option>/, /<option value="h13"[^>]*>Attention head 14 · \+1\.50<\/option>/, /<option value="mlp">MLP · \+0\.00<\/option>/, /<option value="k7">Keys and values of heads 15 to 16<\/option>/]) expect(html).toMatch(named);
  // The selected part's real controls and readings are all here, in numbers.
  expect(t).toContain("Attention head 14 · Layer 21");
  expect(t).toContain("+1.50 direct push for");
  expect(t).toContain("16 attention heads, summed +1.50 MLP +0.00 Layer total +1.50");
  for (const control of ["Knock out", "Off", "Cut layer 1"]) expect(b.get(control)).toEqual([false]);
  // Nothing claims to be lit or colored, and the same total is given as a number.
  expect(readout(html)).toMatch(/^Every part has a number\. Direct pushes add up to \+1\.25 for “.+”\.$/);
  expect(html).not.toContain('class="stage-legend"');
  expect(t).toContain("Numbers show");
  expect(t).not.toContain("Colors show");
  // A replay is drawn on the model, so it waits and says why.
  expect(b.get("Replay answer")).toEqual([true]);
  expect(t).toContain("Replay needs the 3D drawing, which could not start here. Try again on the model.");
  expect(t).not.toContain("—");

  // The other two benches found out from the first: they say the same, and keep their own controls and numbers.
  const reference = initialLesson({ width: 1024, units: 3072 });
  const teach = renderToString(<Teach weights={null} reference={reference} step={0} running={false} losses={[]} run={null} active
    controls={{ busy: false, phase: "idle", ready: true, validation: "", status: "", error: "", revision: 0, train() {}, halt() {}, dismantle() {} }} />);
  const total = layout({ ...TINY, vocab: VOCAB }).total, params = Float32Array.from({ length: total }, (_, i) => Math.sin(i) * 0.02);
  const grow = renderToString(<Grow params={params} reference={params} intact={params} step={1200} running={false} active
    controls={{ disabled: false, unavailable: false, validText: true, status: "", loss: null, mutation: "", damage: null, strength: 0.25, setStrength() {}, teach() {}, stop() {},
      mutate() {}, restore() {}, keepLabel: "Keep learning", continueNote: "", retrained: 0, intactStep: 0, adopt() {} }} />);
  for (const bench of [teach, grow]) {
    expect(bench).toContain('class="stage-state stage-recovery" role="alert"');
    expect(buttons(bench).get("Try again")).toEqual([false]);
    for (const gone of ["Explore", "Grab", "Punch", "2D"]) expect(buttons(bench).has(gone)).toBe(false);
  }
  expect(buttons(teach).get("Teach Qwen")).toEqual([false]);
  expect(teach).toMatch(/<option value="27"[^>]*>Layer 28 · holds the adapter<\/option>/);
  expect(teach).toMatch(/<option value="mlp"[^>]*>MLP · the adapter learns here<\/option>/);
  for (const control of ["Start over from noise", "Scramble weights", "Erase weights"]) expect(buttons(grow).get(control)).toEqual([false]);
  expect(grow).toMatch(/<option value="3">Layer 4 · 0\.00000<\/option>/);

  // A stage that could not start is started again only by a newer request than the last one answered: Try
  // again, never a render or a return to the bench. One that can start always does.
  expect(startsStage(true, 0, 0)).toBe(true);
  expect(startsStage(false, 0, 0)).toBe(false);
  expect(startsStage(false, 0, 1)).toBe(true);
  expect(startsStage(false, 1, 1)).toBe(false);
});

it("goes from the inspector back to this same model at the same part, with no second model nested in the inspector", async () => {
  const { Inspector } = await import("../src/ui/Inspector.tsx");
  const actions = await import("../src/state/actions.ts");
  const crumb = (html: string) => /<nav class="stage-crumb"[^>]*>(.*?)<\/nav>/.exec(html)![1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  store.set({ mode: "live", device: { kind: "ready", seconds: 3 }, turns: [sample()], word: { turn: 0, side: "normal", index: 0 }, follow: false });
  actions.setFocus({ kind: "head", floor: 20, head: 13 });
  expect(store.get()).toMatchObject({ sheet: true, inspectView: "word", stageFocus: null });
  let html = renderToString(<Inspector />);
  // One panel, about the part. The model itself is not drawn a second time inside it.
  expect(buttons(html).get("Explore the full model")).toEqual([false]);
  expect(buttons(html).has("Hide the full model")).toBe(false);
  expect(html).not.toMatch(/aria-label="The tower"|class="tower|inspection-grid|full-model|stage-bench/);
  expect(html.match(/aria-label="Details"/g)).toHaveLength(1);
  expect(html).toContain('title="Close this panel and go to Attention head 14 · Layer 21 in the 3D model"');
  // Pressing it closes the inspector and asks the bench for that part. The selection is shared, so the bench already has it.
  actions.exploreModel();
  expect(store.get()).toMatchObject({ sheet: false, focus: { kind: "head", floor: 20, head: 13 }, stageFocus: { n: 1 } });
  const bench = renderToString(<Dismantle />);
  expect(crumb(bench)).toBe("Model › Layer 21 › Head 14");
  expect(text(bench)).toContain("Attention head 14 · Layer 21");
  // Each press is a new request, so asking again from the same part is answered again.
  actions.exploreModel();
  expect(store.get().stageFocus).toEqual({ n: 2 });
  // From a panel about no one part, it goes to the whole model. Opening a panel never asks the stage by itself.
  store.set({ stageFocus: null });
  actions.setFocus({ kind: "word" });
  expect(store.get().stageFocus).toBeNull();
  html = renderToString(<Inspector />);
  expect(html).toContain('title="Close this panel and go to the whole 3D model"');
  // The token's own details are one press from the bench, and open this same inspector.
  expect(buttons(renderToString(<Dismantle />)).has("Details and candidates for “…” →")).toBe(true);
});

it("keeps Teach's training controls in the 3D bench and never offers Punch there", () => {
  const reference = initialLesson({ width: 1024, units: 3072 });
  const controls = { busy: false, phase: "idle" as const, ready: false, validation: "", status: "", error: "", revision: 0, train() {}, halt() {}, dismantle() {} };
  const props = { weights: null, reference, step: 0, running: false, losses: [], run: null, active: true };
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
    mutate() {}, restore() {}, keepLabel: "Keep learning", continueNote: "", retrained: 0, intactStep: 0, adopt() {},
    prompt: "red star = ", setPrompt() {}, test() {}, result: null, baseline: null };
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
  // Nothing has been retrained yet, so there is nothing to make the intact copy.
  expect(b.has("Make this the intact copy")).toBe(false);
  // The Strength slider is the control its label names.
  const strength = /<label for="([^"]+)">Strength<\/label>/.exec(html)![1];
  expect(html).toMatch(new RegExp(`<input[^>]*id="${strength}"[^>]*type="range"|<input[^>]*type="range"[^>]*id="${strength}"`));
  expect(text(html)).toContain("1,200 steps");
});

it("says what training a damaged copy does before it is pressed, and replaces the intact weights only when asked", () => {
  const total = layout({ ...TINY, vocab: VOCAB }).total, params = Float32Array.from({ length: total }, (_, i) => Math.sin(i) * 0.02);
  const damaged = params.map((x, i) => (i % 7 ? x : 0));
  const base = { disabled: false, unavailable: false, validText: true, status: "", loss: null, strength: 0.25, setStrength() {}, teach() {}, stop() {},
    mutate() {}, restore() {}, adopt() {}, damage: { kind: "erase" as const, floor: 1 } };
  const props = { params: damaged, reference: params, intact: params, running: false, active: true };
  // The bench is told by the lineage what to call things, so the page and the 3D bench cannot disagree.
  const erased = afterDamage({ intact: { params, step: 1200, corpus: "red star = warm\n", run: { samples: [], losses: [] } }, damage: "", retrained: 0 }, "Layer 2: weights erased");
  const view = (l: Lineage, step: number, running = false) => renderToString(<Grow {...props} running={running} step={step}
    controls={{ ...base, mutation: copyLabel(l), keepLabel: isDamaged(l) ? "Retrain the damaged copy" : "Keep learning", continueNote: continueNote(l), retrained: l.retrained, intactStep: l.intact?.step ?? 0, disabled: running }} />);
  let html = view(erased, 1200), b = buttons(html);
  expect(b.has("Keep learning")).toBe(false);
  expect(b.get("Retrain the damaged copy")).toEqual([false]);
  expect(text(html)).toContain("Training continues from the damaged copy. The intact weights from step 1,200 are kept, and Restore intact model returns to them.");
  expect(b.has("Make this the intact copy")).toBe(false);
  expect(b.get("Restore intact model")).toEqual([false]);
  // After 306 more steps the copy says so, Restore is still there, and adopting names what it replaces.
  const retrained = afterTraining(whileTraining(erased), { params: damaged, step: 1506, corpus: "red star = warm\n", run: { samples: [], losses: [] } }, 306);
  expect(retrained.intact?.params).toBe(params);
  expect(retrained.intact?.step).toBe(1200);
  html = view(retrained, 1506); b = buttons(html);
  expect(text(html)).toContain("Layer 2: weights erased, then 306 more training steps");
  expect(b.get("Restore intact model")).toEqual([false]);
  expect(b.get("Make this the intact copy")).toEqual([false]);
  expect(text(html)).toContain("It replaces the intact weights from step 1,200.");
  // While it trains, the note about what pressing would do is not shown beside a button that is not there.
  html = view(retrained, 1506, true);
  expect(buttons(html).has("Retrain the damaged copy")).toBe(false);
  expect(text(html)).not.toContain("Training continues from the damaged copy");
  expect(html).not.toContain("—");
});

it("states no total in the difference view while the comparison is being measured or was never made", () => {
  const cut = { floors: [{ floor: 14, mult: 0 }] };
  const forced = (id: number) => ({ id, lp1: -0.3, concept: 0, pushes: pushes.map((x) => x * 0.5) });
  const base = { mode: "live" as const, device: { kind: "ready" as const, seconds: 3 }, view: "difference" as const, chips: cut, follow: true };
  const readout = (html: string) => text(/<p class="stage-readout" role="status">(.*?)<\/p>/.exec(html)![1]).trim();
  // A new question under an active change, followed as it is written: the changed reply has a token and no comparison yet.
  const writing = { ...sample(), changed: { ...sample().normal, toks: [tok(200)], ended: false, done: false, changes: cut } };
  store.set({ ...base, turns: [writing], word: { turn: 0, side: "changed", index: 0 }, busy: true });
  let said = readout(renderToString(<Dismantle />));
  expect(said).toBe(`Measuring the change from the original for “${said.split("“")[1].split("”")[0]}”. Nothing is lit until it is done.`);
  expect(said).not.toContain("add up to");
  expect(said).not.toMatch(/[+-]?0\.00|\b0\b/);
  // Written, and the changed model is reading the original reply: still measuring.
  const comparing = { ...sample(), changed: { ...sample().normal, toks: [tok(200), tok(151645)], changes: cut, comparing: true } };
  store.set({ turns: [comparing], busy: false });
  expect(readout(renderToString(<Dismantle />))).toContain("Measuring the change from the original");
  // The comparison did not arrive: it says there is none, offers the retry, and still gives no number.
  store.set({ turns: [{ ...comparing, changed: { ...comparing.changed, comparing: false, compareError: "lost" } }] });
  let html = renderToString(<Dismantle />);
  said = readout(html);
  expect(said).toMatch(/^No comparison has been measured for “.+”, so nothing is lit\.$/);
  expect(buttons(html).get("Retry comparison")).toEqual([false]);
  // One measured on other tokens (the original was rewritten since) is not a comparison of these.
  store.set({ turns: [{ ...comparing, changed: { ...comparing.changed, comparing: false, compare: [forced(100), forced(999), forced(151645)] } }] });
  expect(readout(renderToString(<Dismantle />))).toMatch(/^No comparison has been measured/);
  // Measured on these tokens: now, and only now, every part is lit and the changes are totalled.
  store.set({ turns: [{ ...comparing, changed: { ...comparing.changed, comparing: false, compare: [forced(100), forced(101), forced(151645)] } }], word: { turn: 0, side: "normal", index: 0 } });
  html = renderToString(<Dismantle />);
  expect(readout(html)).toMatch(/^Every part is lit\. Changes in direct push add up to [+−-]\d/);
  expect(text(html)).not.toContain("—");
});

it("enables every change control by one rule in the inspector, on the change chips and on the 3D bench", async () => {
  const { Detail } = await import("../src/ui/Detail.tsx");
  const Panels = await import("../src/ui/Panels.tsx");
  const chips = { heads: [{ floor: 20, head: 13, mult: 0 }] };
  store.set({ mode: "live", device: { kind: "ready", seconds: 3 }, turns: [sample()], word: { turn: 0, side: "normal", index: 0 }, follow: false,
    focus: { kind: "head", floor: 20, head: 13 }, chips });
  /** Whether the strength stops and the restore controls are disabled, per view. */
  const state = () => {
    const flat = buttons(renderToString(<Detail />)), stage = buttons(renderToString(<Dismantle />)), chip = renderToString(<Panels.Chips />);
    return { inspector: flat.get("Off"), bench: stage.get("Off"), benchRestore: stage.get("Restore model"), chip: /<button[^>]*disabled=""[^>]*aria-label="Remove/.test(chip) || /aria-label="Remove[^>]*disabled=""/.test(chip) };
  };
  expect(state()).toEqual({ inspector: [false], bench: [false], benchRestore: [false], chip: false });
  const locked = { inspector: [true], bench: [true], benchRestore: [true], chip: true };
  // A reply is being written.
  store.set({ busy: true });
  expect(state()).toEqual(locked);
  // While samples are updated, and after the update is stopped part way, a change restarts the update. Every view offers it.
  const open = { inspector: [false], bench: [false], benchRestore: [false], chip: false };
  store.set({ busy: true, replay: { turn: 0, status: "running" } });
  expect(state()).toEqual(open);
  store.set({ busy: false, replay: { turn: 0, status: "stopped" } });
  expect(state()).toEqual(open);
  // Qwen is being taught, and the model is not ready.
  store.set({ replay: null, teachingBusy: true });
  expect(state()).toEqual(locked);
  store.set({ teachingBusy: false, mode: "unavailable" });
  expect(state()).toEqual(locked);
  store.set({ mode: "live" });
  expect(state()).toEqual({ inspector: [false], bench: [false], benchRestore: [false], chip: false });
  // The inspector's other change controls follow the same rule: precision, and hiding a prompt word.
  const other = (focus: typeof initial.focus, label: string) => { store.set({ focus }); return buttons(renderToString(<Detail />)).get(label); };
  expect(other({ kind: "bits" }, "2 bits (4 levels)")).toEqual([false]);
  expect(other({ kind: "words-in", position: 1 }, "Hide this word from later words")).toEqual([false]);
  store.set({ busy: true });
  expect(other({ kind: "bits" }, "2 bits (4 levels)")).toEqual([true]);
  expect(other({ kind: "words-in", position: 1 }, "Hide this word from later words")).toEqual([true]);
  // Each panel says once why its controls wait, in the words the 3D bench uses, and says nothing when they do not.
  const waits = (focus: typeof initial.focus) => { store.set({ focus }); return (renderToString(<Detail />).match(/<p class="note edit-wait">(.*?)<\/p>/g) ?? []).map((m) => text(m).trim()); };
  const panels: (typeof initial.focus)[] = [{ kind: "head", floor: 20, head: 13 }, { kind: "memory", floor: 20 }, { kind: "floor", floor: 20 }, { kind: "bits" }, { kind: "words-in", position: 1 }];
  for (const focus of panels) expect(waits(focus)).toEqual(["Wait for the reply to finish, then change a part."]);
  expect(text(renderToString(<Dismantle />))).toContain("Wait for the reply to finish");
  // A dictionary swap that is on cannot be undone or replaced while the reply is written, and typing another is not offered.
  store.set({ chips: { swaps: [[100, 7]] }, focus: { kind: "word" } });
  expect(buttons(renderToString(<Detail />)).get("Undo")).toEqual([true]);
  expect(waits({ kind: "word" })).toEqual(["Wait for the reply to finish, then change a part."]);
  store.set({ chips });
  expect(renderToString(<Detail />)).not.toContain('aria-label="Word to swap with"');
  // While samples are updated a change restarts the update, so nothing waits. Idle, nothing waits either.
  store.set({ replay: { turn: 0, status: "running" } });
  for (const focus of [...panels, { kind: "word" } as const]) expect(waits(focus)).toEqual([]);
  expect(renderToString(<Detail />)).toContain('aria-label="Word to swap with"');
  store.set({ chips: { swaps: [[100, 7]] } });
  expect(buttons(renderToString(<Detail />)).get("Undo")).toEqual([false]);
  store.set({ busy: false, replay: null, chips });
  for (const focus of panels) expect(waits(focus)).toEqual([]);
});

it("says a reply reached the context limit instead of offering a Continue that cannot write", () => {
  const read = Array.from({ length: 500 }, (_, i) => i + 10);
  const cut = (n: number) => ({ id: 1, user: "Long", normal: { read, toks: Array.from({ length: n }, (_, i) => tok(300 + i)), ended: false, done: true, changes: {}, source: "live" as const } });
  store.set({ mode: "live", device: { kind: "ready", seconds: 3 }, turns: [cut(8)], contextCaps: { qwen: 512 } });
  // Room left: stopped at the reply cap, and Continue is there.
  let html = renderToString(<Talk.Conversation />);
  expect(buttons(html).get("Continue")).toEqual([false]);
  expect(text(html)).not.toContain("context limit");
  // Prompt and reply fill the context: the reason is given and there is no button that would do nothing.
  store.set({ turns: [cut(12)] });
  html = renderToString(<Talk.Conversation />);
  expect(buttons(html).has("Continue")).toBe(false);
  expect(text(html)).toContain("Reached the model's context limit at 12 word pieces. There is no room to continue it.");
  // The other model's limit is its own.
  store.set({ contextCaps: { tiny: 512 } });
  expect(buttons(renderToString(<Talk.Conversation />)).get("Continue")).toEqual([false]);
});

it("marks no word with the changed model's probability unless the comparison was measured on these tokens", () => {
  const changes = { floors: [{ floor: 14, mult: 0 }] };
  const forced = (id: number, p: number) => ({ id, lp1: Math.log(p), concept: 0, pushes });
  const turn = (compare: ReturnType<typeof forced>[]) => ({ ...sample(), changed: { ...sample().normal, toks: [tok(200), tok(151645)], changes, compare } });
  store.set({ mode: "live", device: { kind: "ready", seconds: 3 }, turns: [turn([forced(100, 0.01), forced(101, 0.9), forced(151645, 0.9)])], chips: changes });
  let html = renderToString(<Talk.Conversation />);
  expect(html).toMatch(/class="tok under"[^>]*aria-label="[^"]*the changed model gives it 1%"/);
  expect(html).toContain('title="Normal 90%, changed 1%"');
  // The same numbers left over from a picked reply (another first token): nothing is underlined and no 1% is claimed.
  store.set({ turns: [turn([forced(777, 0.01), forced(101, 0.9), forced(151645, 0.9)])] });
  html = renderToString(<Talk.Conversation />);
  expect(html).not.toContain("tok under");
  expect(html).not.toContain("changed 1%");
  expect(text(html)).not.toMatch(/gives .* 1%/);
  // A comparison of a longer or shorter reply is no better.
  store.set({ turns: [turn([forced(100, 0.01), forced(101, 0.9)])] });
  expect(renderToString(<Talk.Conversation />)).not.toContain("tok under");
});

it("names a hidden word on the change chip only when every sample has that word there", async () => {
  const Panels = await import("../src/ui/Panels.tsx");
  const other = { ...sample(), id: 2, user: "Capital of Peru?", normal: { ...sample().normal, read: [5, 9] } };
  const labels = (html: string) => [...html.matchAll(/<span class="chip">(.*?)<button/g)].map((m) => text(m[1]).trim());
  store.set({ mode: "live", device: { kind: "ready", seconds: 3 }, turns: [sample()], chips: { hidden: [{ key: 1, from: 2 }] } });
  const [alone] = labels(renderToString(<Panels.Chips />));
  expect(alone).not.toContain("prompt position");
  // A second sample with another word at that position: the chip stands for both, so it names the position.
  store.set({ turns: [sample(), other] });
  expect(labels(renderToString(<Panels.Chips />))).toEqual(["prompt position 1 hidden from later words in every sample"]);
  // A position both samples share keeps its word, and position 0 is the start marker in every sample.
  store.set({ turns: [other, { ...other, id: 3, user: "Capital of Chile?" }] });
  expect(labels(renderToString(<Panels.Chips />))[0]).not.toContain("prompt position");
  store.set({ chips: { hidden: [{ key: 0, from: 1 }] } });
  expect(labels(renderToString(<Panels.Chips />))).toEqual(["the start marker hidden"]);
});

it("says a pick was stopped only once the reply has stopped, never while the picked piece is still on its way", () => {
  const original = sample().normal;
  const picking = { ...sample(), normal: { ...original, toks: [tok(100)], ended: false, done: false, pickedAt: 1, original } };
  store.set({ mode: "live", device: { kind: "ready", seconds: 3 }, turns: [picking], busy: true });
  // Being written: no claim about the pick yet, and Undo waits for the write.
  let html = renderToString(<Talk.Conversation />);
  expect(text(html)).not.toContain("The pick was stopped");
  expect(text(html)).not.toContain("You picked this word");
  expect(buttons(html).get("Undo")).toEqual([true]);
  // Stopped before the piece was written: said plainly, with the way back.
  store.set({ turns: [{ ...picking, normal: { ...picking.normal, done: true } }], busy: false });
  html = renderToString(<Talk.Conversation />);
  expect(text(html)).toContain("The pick was stopped before it was written.");
  expect(buttons(html).get("Undo")).toEqual([false]);
  // Written: the piece is named.
  store.set({ turns: [{ ...picking, normal: { ...picking.normal, toks: [tok(100), { ...tok(555), picked: true }], done: true } }] });
  html = renderToString(<Talk.Conversation />);
  expect(text(html)).not.toContain("The pick was stopped");
  expect(text(html)).toMatch(/You picked this word: "[^"]+"/);
});

it("gives no total and does not say every part is lit when some of a token's pushes are not numbers", () => {
  const readout = (html: string) => text(/<p class="stage-readout" role="status">(.*?)<\/p>/.exec(html)![1]).trim();
  const withPushes = (p: Float32Array) => ({ ...sample(), normal: { ...sample().normal, toks: [{ ...tok(100), pushes: p }, tok(151645)] } });
  store.set({ mode: "live", device: { kind: "ready", seconds: 3 }, turns: [withPushes(pushes)], word: { turn: 0, side: "normal", index: 0 }, follow: false });
  // The measured path is unchanged: the same sentence and the same total as before.
  expect(readout(renderToString(<Dismantle />))).toMatch(/^Every part is lit\. Direct pushes add up to \+1\.25 for “.+”\.$/);
  // Two values are not numbers. Nothing is totalled, and the parts without a value are said to be unlit.
  const broken = pushes.slice();
  broken[pushIndex(QWEN_INFO, { kind: "head", floor: 3, head: 2 })] = Number.NaN;
  broken[pushIndex(QWEN_INFO, { kind: "mlp", floor: 9 })] = Number.POSITIVE_INFINITY;
  store.set({ turns: [withPushes(broken)] });
  let said = readout(renderToString(<Dismantle />));
  expect(said).toMatch(new RegExp(`^Incomplete measurement for “.+”: 2 of ${pushLength(QWEN_INFO)} direct pushes are unavailable\\. Parts without a value are not lit, and no total is given\\.$`));
  expect(said).not.toContain("Every part is lit");
  expect(said).not.toMatch(/add up to|not a number|∞/);
  // In a replay the same holds for the running total and the final one.
  expect(R.startReplay("token")).toBe(true);
  R.session.seek(3);
  let bar = text(renderToString(<Dismantle />));
  expect(bar).toContain("Some direct pushes are unavailable for this token, so no total is given.");
  expect(bar).not.toMatch(/Direct pushes so far|add up to/);
  R.session.seek(58);
  bar = text(renderToString(<Dismantle />));
  expect(bar).toContain("Some direct pushes are unavailable for this token, so no total is given.");
  expect(bar).not.toMatch(/add up to|not a number/);
  R.session.exit("live");
  // No value at all is not an incomplete measurement: nothing was measured.
  store.set({ turns: [withPushes(new Float32Array(pushLength(QWEN_INFO)).fill(Number.NaN))] });
  said = readout(renderToString(<Dismantle />));
  expect(said).toMatch(/^No direct pushes were measured for “.+”\. Nothing is lit\.$/);
});

it("offers full screen on every bench, on a desktop and on a phone, and starts docked with one set of training controls", () => {
  const reference = initialLesson({ width: 1024, units: 3072 });
  const teach = { weights: null, reference, step: 0, running: false, losses: [], run: null, active: true,
    controls: { busy: false, phase: "idle" as const, ready: true, validation: "", status: "", error: "", revision: 0, train() {}, halt() {}, dismantle() {} } };
  const grow = { params: null, reference: null, intact: null, step: 0, running: false, active: true,
    controls: { disabled: false, unavailable: false, validText: true, status: "", loss: null, mutation: "", damage: null, strength: 0.25, setStrength() {}, teach() {}, stop() {},
      mutate() {}, restore() {}, keepLabel: "Keep learning", continueNote: "", retrained: 0, intactStep: 0, adopt() {} } };
  for (const phone of [false, true]) {
    vi.stubGlobal("matchMedia", () => ({ matches: phone, addEventListener() {}, removeEventListener() {} }));
    const benches = [renderToString(<Dismantle />), renderToString(<Teach {...teach} />), renderToString(<Grow {...grow} />)];
    for (const html of benches) {
      expect(buttons(html).get("Full screen")).toEqual([false]);
      // Docked until asked: no dialog and no panels over the stage. There is no other view to switch to.
      expect(html).not.toMatch(/role="dialog"|stage-panel-head|immersive|training-bar/);
      for (const other of ["2D", "3D"]) expect(buttons(html).has(other)).toBe(false);
      expect(html).not.toContain('aria-label="Model view"');
    }
    // The bar along the bottom of full screen is a second home for the training controls, never a second copy.
    if (!phone) {
      expect(buttons(benches[1]).get("Teach Qwen")).toEqual([false]);
      expect(buttons(benches[2]).get("Start learning")).toEqual([false]);
    }
  }
});
