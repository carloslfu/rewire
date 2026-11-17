import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { isolate } from "../src/stage/isolate.ts";
import { escapeIntent, stageKey } from "../src/stage/keys.ts";
import { type Box, declutter, dockInset, overlaps, placeBox, toolbarInset } from "../src/stage/labels.ts";

it("keeps a label on its point when there is room and inside the view when there is not", () => {
  // Centered above the point.
  expect(placeBox(200, 100, 60, 14, 0.5, 1, 400, 300)).toEqual({ left: 170, top: 86, width: 60, height: 14 });
  // To the left of a point at the left edge: moved in, not cut off.
  expect(placeBox(10, 100, 60, 14, 1, 0.5, 400, 300).left).toBe(3);
  expect(placeBox(395, 100, 60, 14, 0, 0.5, 400, 300).left).toBe(400 - 60 - 3);
  expect(placeBox(200, 2, 60, 14, 0.5, 1, 400, 300).top).toBe(3);
  expect(placeBox(200, 299, 60, 14, 0.5, 0, 400, 300).top).toBe(300 - 14 - 3);
  // At 320 pixels a long caption still fits entirely.
  for (let x = -8; x <= 328; x += 7) {
    const b = placeBox(x, 150, 150, 14, 0, 1, 320, 300);
    expect(b.left).toBeGreaterThanOrEqual(3);
    expect(b.left + b.width).toBeLessThanOrEqual(317);
  }
  // A label wider than the view is pinned to the left edge rather than centered out of sight.
  expect(placeBox(100, 100, 500, 14, 0.5, 1, 320, 300).left).toBe(3);
});

it("shows the most important labels and never lets two touch, or cover the toolbar", () => {
  const box = (left: number, top: number, width = 50, height = 14): Box => ({ left, top, width, height });
  expect(overlaps(box(0, 0), box(40, 0))).toBe(true);
  expect(overlaps(box(0, 0), box(51, 0))).toBe(true);
  expect(overlaps(box(0, 0), box(53, 0))).toBe(false);
  expect(overlaps(box(0, 0), box(0, 17))).toBe(false);
  // Three captions collide at the bottom of a narrow stage: the highest priority stays, then whatever still fits.
  const labels = [{ box: box(10, 200, 150), priority: 70 }, { box: box(120, 200, 40), priority: 72 }, { box: box(0, 195, 60), priority: 74 }, { box: box(170, 200, 30), priority: 30 }];
  expect(declutter(labels)).toEqual([false, true, true, true]);
  // The selected token beats everything near it, whatever order the labels came in.
  expect(declutter([{ box: box(0, 0), priority: 30 }, { box: box(20, 0), priority: 90 }, { box: box(40, 0), priority: 30 }])).toEqual([false, true, false]);
  // Equal priority: the earlier label wins, so a row of layer numbers thins evenly.
  expect(declutter(Array.from({ length: 6 }, (_, i) => ({ box: box(0, i * 9, 14, 12), priority: 40 })))).toEqual([true, false, true, false, true, false]);
  // Nothing is drawn over the tool buttons or the help text.
  const reserved = [box(12, 10, 190, 34), box(12, 50, 380, 40)];
  expect(declutter([{ box: box(100, 30), priority: 100 }, { box: box(100, 95), priority: 10 }, { box: box(300, 12), priority: 10 }], reserved)).toEqual([false, true, true]);
  const shown = declutter(labels, reserved), kept = labels.filter((_, i) => shown[i]).map((l) => l.box);
  for (const a of kept) for (const b of [...kept, ...reserved]) if (a !== b) expect(overlaps(a, b)).toBe(false);
});

it("reserves the top of the view only where the toolbar sits above the model", () => {
  const tools = { left: 12, top: 10, width: 190, height: 34 }, resets = { left: 318, top: 10, width: 190, height: 34 }, hint = { left: 12, top: 50, width: 380, height: 40 };
  // Docked at 520 pixels the model spans most of the width: everything above it counts.
  expect(toolbarInset([tools, resets, hint], 40, 480, 400)).toBeCloseTo((90 + 8) / 400, 6);
  // In a wide stage the model stands between the two corners and gives up nothing.
  const wide = [tools, { ...resets, left: 1200 - 202 }, hint];
  expect(toolbarInset(wide, 500, 700, 800)).toBe(0);
  // Only the help text reaches over the model.
  expect(toolbarInset(wide, 380, 820, 800)).toBeCloseTo(98 / 800, 6);
  // A phone's wrapped toolbar cannot take more than the cap, and an unmeasured view takes nothing.
  expect(toolbarInset([{ left: 8, top: 8, width: 304, height: 190 }], 10, 310, 300)).toBe(0.38);
  expect(toolbarInset([tools], 0, 100, 0)).toBe(0);
  expect(toolbarInset([], 0, 100, 400)).toBe(0);
});

// A minimal tree with the attribute and child surface `isolate` uses.
interface FakeNode { tagName: string; attrs: Map<string, string>; children: FakeNode[]; parentElement: FakeNode | null;
  hasAttribute(k: string): boolean; setAttribute(k: string, v: string): void; removeAttribute(k: string): void }
function node(tag: string, attrs: Record<string, string> = {}, children: FakeNode[] = []): FakeNode {
  const el: FakeNode = { tagName: tag, attrs: new Map(Object.entries(attrs)), children, parentElement: null,
    hasAttribute: (k: string) => el.attrs.has(k), setAttribute: (k: string, v: string) => { el.attrs.set(k, v); }, removeAttribute: (k: string) => { el.attrs.delete(k); } };
  for (const c of children) c.parentElement = el;
  return el;
}

it("reserves the bottom of the view only where the breadcrumb and dock sit under the model", () => {
  const tools = { left: 12, top: 10, width: 190, height: 34 }, crumb = { left: 12, top: 354, width: 230, height: 36 }, dock = { left: 500, top: 354, width: 288, height: 36 };
  // A wide stage: the model stands between the two corners, and neither end of the bottom row costs it anything.
  expect(dockInset([tools, crumb, dock], 300, 480, 400)).toBe(0);
  // The dock reaches under the model: the model is framed above it. The toolbar at the top is not the dock's business.
  expect(dockInset([tools, crumb, dock], 300, 520, 400)).toBeCloseTo((400 - 354 + 8) / 400, 6);
  expect(toolbarInset([tools, crumb, dock], 300, 520, 400)).toBe(0);
  expect(toolbarInset([tools, crumb, dock], 100, 520, 400)).toBeCloseTo((44 + 8) / 400, 6);
  // Wrapped onto two rows in a narrow stage, the higher row sets the line, up to the cap.
  expect(dockInset([{ ...crumb, top: 312 }, { ...dock, left: 12 }], 40, 300, 400)).toBeCloseTo((400 - 312 + 8) / 400, 6);
  expect(dockInset([{ left: 0, top: 210, width: 300, height: 190 }], 40, 300, 400)).toBe(0.3);
  expect(dockInset([dock], 0, 800, 0)).toBe(0);
});

it("lets Escape close a menu or leave a text field before it closes the full view", () => {
  // A select: the first Escape belongs to its menu, the second closes the view.
  expect(escapeIntent({ tagName: "SELECT" }, false, false)).toBe("menu");
  expect(escapeIntent({ tagName: "SELECT" }, true, false)).toBe("close");
  // The question box keeps its text and gives up the focus; an input method cancelling a candidate is left alone.
  expect(escapeIntent({ tagName: "TEXTAREA" }, false, false)).toBe("leave");
  expect(escapeIntent({ tagName: "TEXTAREA" }, false, true)).toBe("wait");
  expect(escapeIntent({ tagName: "INPUT", type: "text" }, false, false)).toBe("leave");
  // Sliders, buttons and the stage itself close it at once.
  for (const target of [{ tagName: "INPUT", type: "range" }, { tagName: "BUTTON" }, { tagName: "DIV" }]) expect(escapeIntent(target, false, false)).toBe("close");
});

it("makes the page behind the full view inert and restores it exactly", () => {
  const bench = node("DIV"), sibling = node("P");
  const scope = node("ASIDE", {}, [sibling, bench]), main = node("MAIN");
  const layout = node("DIV", {}, [main, scope]);
  const header = node("HEADER"), skip = node("A"), live = node("DIV", { "aria-live": "polite" }), inspector = node("DIALOG"), about = node("DIALOG", { open: "" });
  const hidden = node("DIV", { hidden: "" }), already = node("DIV", { inert: "" });
  const root = node("DIV", {}, [skip, header, live, layout, inspector, about, hidden, already]);
  const script = node("SCRIPT"), body = node("BODY", {}, [root, script]);
  const html = node("HTML", {}, [node("HEAD"), body]);
  const inert = () => [skip, header, live, main, scope, layout, sibling, bench, inspector, about, hidden, already, root, script, body, html].filter((n) => n.hasAttribute("inert"));

  const release = isolate(bench as unknown as Element);
  // The header, the skip link, the conversation and the bench's own neighbors stop taking input.
  expect(inert()).toEqual([skip, header, main, sibling, hidden, already]);
  // The bench and its ancestors stay live; so do dialogs (the inspector opens over the full view) and announcements.
  for (const n of [bench, scope, layout, root, body, html, inspector, about, live, script]) expect(n.hasAttribute("inert")).toBe(false);
  release();
  // Only what was added is removed: something inert for its own reasons stays inert.
  expect(inert()).toEqual([already]);
  release();
  expect(inert()).toEqual([already]);
  // A bench with no parent has nothing to isolate.
  expect(() => isolate(node("DIV") as unknown as Element)()).not.toThrow();
});

it("stacks the full view above the sticky page header", () => {
  const css = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
  const z = (selector: string) => {
    const rule = new RegExp(`(?:^|[},])\\s*${selector.replace(/[.:()]/g, "\\$&")}\\s*(?:,[^{]*)?\\{([^}]*)\\}`, "m").exec(css);
    return rule ? Number(/z-index:\s*(\d+)/.exec(rule[1])?.[1] ?? NaN) : NaN;
  };
  // The header and the scope panel are both sticky, so each is a stacking context in the page. A z-index
  // on the bench inside the panel cannot beat the header; the panel itself has to be lifted.
  expect(css).toMatch(/\.top \{ position: sticky;[^}]*z-index: 5;/);
  expect(css).toMatch(/\.lab-scope \{ position: sticky;/);
  expect(z(".lab-scope.stage-raised")).toBeGreaterThan(5);
  expect(z(".stage-bench.expanded")).toBeGreaterThan(5);
});

it("closes an open dock panel first, wherever the focus is, and leaves a composition to the input method", () => {
  // A panel is open and the focus is on a button, a select or in a text field outside the stage: the panel goes first.
  for (const target of [{ tagName: "BUTTON" }, { tagName: "SELECT" }, { tagName: "TEXTAREA" }, { tagName: "INPUT", type: "text" }]) {
    expect(escapeIntent(target, false, false, true)).toBe("panel");
  }
  // The input method's own Escape is still its own.
  expect(escapeIntent({ tagName: "TEXTAREA" }, false, true, true)).toBe("wait");
  // With the panel closed, the next Escape is what it always was.
  expect(escapeIntent({ tagName: "BUTTON" }, false, false, false)).toBe("close");
  expect(escapeIntent({ tagName: "TEXTAREA" }, false, false, false)).toBe("leave");
});

it("acts once per press for keys that switch something or change the model, and repeats only movement", () => {
  const press = (key: string, repeat = false, shiftKey = false) => stageKey({ key, repeat, shiftKey });
  // Held down, P must not knock a part out and put it back, E must not flap the layers, and ? must not flicker the help.
  for (const key of ["p", "P", "e", "E", "?", " "]) {
    expect(press(key)?.act).not.toBe("ignore");
    expect(press(key, true)).toEqual({ act: "ignore" });
  }
  expect(press("p")).toEqual({ act: "punch" });
  expect(press("E")).toEqual({ act: "spread" });
  expect(press("?")).toEqual({ act: "help" });
  expect(press(" ")).toEqual({ act: "pan" });
  // Moving between parts, turning and zooming go on for as long as the key is held.
  expect(press("ArrowUp", true)).toEqual({ act: "move", key: "ArrowUp" });
  expect(press("ArrowLeft", true, true)).toEqual({ act: "orbit", azimuth: -0.2, polar: 0 });
  expect(press("ArrowDown", false, true)).toEqual({ act: "orbit", azimuth: 0, polar: 0.12 });
  expect(press("+", true)).toEqual({ act: "zoom", factor: 0.8 });
  expect(press("-", true)).toEqual({ act: "zoom", factor: 1.25 });
  // Fitting, focusing and the named views land in the same place however often they fire.
  expect(press("0")).toEqual({ act: "fit" });
  expect(press("Home", true)).toEqual({ act: "fit" });
  expect(press("f")).toEqual({ act: "focus", orFit: true });
  expect(press("Enter")).toEqual({ act: "focus", orFit: false });
  expect(["1", "2", "3", "4"].map((k) => press(k))).toEqual(["home", "front", "side", "top"].map((view) => ({ act: "view", view })));
  // Anything else is not the model's key and is left to the browser.
  for (const key of ["a", "Tab", "Escape", "5", "Shift"]) expect(press(key)).toBeNull();
});

it("lets no page style move a label off the box it was placed and measured on", () => {
  // A label's kind is a plain second class, and the page has classes of the same names (.caption, .step).
  // A margin or border from one of those shifts the label after it was placed: two labels the layout kept
  // apart then overlap on screen. Every such property must be taken back for labels.
  const css = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  const stage = readFileSync(new URL("../src/stage/scene/stage.ts", import.meta.url), "utf8");
  const kinds = new Set([...stage.matchAll(/stage-label((?: [a-z]+)+)/g)].flatMap((m) => m[1].trim().split(" ")));
  for (const kind of ["caption", "step", "token", "bar", "layer", "plate", "message", "pending"]) expect(kinds).toContain(kind);
  kinds.add("current");
  const rules = [...css.matchAll(/([^{}@;]+)\{([^{}]*)\}/g)].map((m) => ({
    selectors: m[1].split(",").map((s) => s.trim()),
    properties: m[2].split(";").map((d) => d.split(":")[0].trim()).filter(Boolean),
  }));
  const moves = (p: string) => /^(margin|border|padding|inset|top|left|right|bottom|position|display|float|transform|translate)(-|$)/.test(p);
  const family = (p: string) => p.split("-")[0];
  const reset = new Set(rules.filter((r) => r.selectors.includes(".stage-labels > .stage-label")).flatMap((r) => r.properties.map(family)));
  expect(reset).toContain("margin");
  expect(reset).toContain("border");
  const stray: string[] = [];
  for (const kind of kinds) {
    // What the label's own rule sets for this kind is deliberate.
    const own = new Set(rules.filter((r) => r.selectors.includes(`.stage-label.${kind}`)).flatMap((r) => r.properties.map(family)));
    for (const r of rules) {
      if (!r.selectors.includes(`.${kind}`)) continue;
      for (const p of r.properties) if (moves(p) && !reset.has(family(p)) && !own.has(family(p))) stray.push(`.${kind} { ${p} }`);
    }
  }
  expect(stray).toEqual([]);
  // The two that caused it are really there, so this test is about something.
  expect(rules.some((r) => r.selectors.includes(".caption") && r.properties.includes("margin-top"))).toBe(true);
  expect(rules.some((r) => r.selectors.includes(".step") && r.properties.some((p) => p.startsWith("border")))).toBe(true);
});
