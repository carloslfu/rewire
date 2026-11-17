// Full screen for the 3D bench, without a browser: the request for the browser's own full screen and
// every way it can be refused or ended, the order Escape closes things in, and where the training
// controls are in each view.
import { renderToString } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { Docked, Immersive, nativeScreen, type ScreenDocument, type ScreenElement } from "../src/stage/immersive.ts";
import { escapeIntent } from "../src/stage/keys.ts";

/** A document and an element with the standard full screen API, or Safari's prefixed one. The browser grants, refuses or ends it on request. */
function browser(api: "standard" | "webkit" | "none" = "standard") {
  const listeners = new Map<string, Set<() => void>>();
  const change = api === "webkit" ? "webkitfullscreenchange" : "fullscreenchange", owner = api === "webkit" ? "webkitFullscreenElement" : "fullscreenElement";
  const doc: ScreenDocument & Record<string, unknown> = {
    addEventListener: (type, f) => { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type)!.add(f); },
    removeEventListener: (type, f) => { listeners.get(type)?.delete(f); },
  };
  const el: ScreenElement = { ownerDocument: doc };
  const calls = { request: 0, exit: 0 };
  let pending: (() => void) | null = null;
  /** The browser changes who has full screen and says so. */
  const settle = (to: unknown) => { doc[owner] = to; for (const f of [...(listeners.get(change) ?? [])]) f(); };
  if (api === "standard") {
    doc.fullscreenElement = null;
    el.requestFullscreen = () => { calls.request++; return new Promise<void>((resolve) => { pending = () => { settle(el); resolve(); }; }); };
    doc.exitFullscreen = () => { calls.exit++; return new Promise<void>((resolve) => { pending = () => { settle(null); resolve(); }; }); };
  } else if (api === "webkit") {
    doc.webkitFullscreenElement = null;
    el.webkitRequestFullscreen = () => { calls.request++; pending = () => settle(el); };
    doc.webkitExitFullscreen = () => { calls.exit++; pending = () => settle(null); };
  }
  return { doc, el, calls, settle, listening: () => [...listeners.values()].reduce((n, s) => n + s.size, 0),
    /** The browser carries out the last request. */
    grant: () => { const run = pending; pending = null; run?.(); } };
}
it("asks the browser for full screen inside the call, and closes the view when the browser ends it by its own means", () => {
  for (const api of ["standard", "webkit"] as const) {
    const b = browser(api), left = vi.fn(), screen = nativeScreen(b.el, left);
    // The request is made synchronously, inside the click that called enter.
    screen.enter();
    expect(b.calls.request).toBe(1);
    expect(screen.active).toBe(false);
    b.grant();
    expect(screen.active).toBe(true);
    // Asking again while it is on asks for nothing.
    screen.enter();
    expect(b.calls.request).toBe(1);
    // The browser's Escape, a gesture or another window ends it: the view is told once.
    b.settle(null);
    expect(left).toHaveBeenCalledTimes(1);
    expect(screen.active).toBe(false);
    // It can be entered again afterwards.
    screen.enter(); b.grant();
    expect(screen.active).toBe(true);
    expect(left).toHaveBeenCalledTimes(1);
    screen.dispose();
  }
});

it("does not report its own exit as the browser's, even when asked twice or entered again before the exit lands", () => {
  const b = browser(), left = vi.fn(), screen = nativeScreen(b.el, left);
  screen.enter(); b.grant();
  // The exit button and the effect that follows it both ask: the browser is asked once.
  screen.exit(); screen.exit();
  expect(b.calls.exit).toBe(1);
  b.grant();
  expect(screen.active).toBe(false);
  expect(left).not.toHaveBeenCalled();
  // With nothing to leave, exit asks for nothing.
  screen.exit();
  expect(b.calls.exit).toBe(1);
  // A later exit by the browser is still reported.
  screen.enter(); b.grant();
  b.settle(null);
  expect(left).toHaveBeenCalledTimes(1);
});

it("tolerates a browser that has no full screen, refuses it, throws, or gives it to something else", () => {
  // No API at all, as on a phone: the viewport view is all there is, and nothing throws.
  const none = browser("none"), left = vi.fn(), plain = nativeScreen(none.el, left);
  expect(() => { plain.enter(); plain.exit(); }).not.toThrow();
  expect(plain.active).toBe(false);
  // Refused with a rejected promise (no permission, an embedding page that forbids it).
  const refused = browser(), denied = nativeScreen(refused.el, left);
  refused.el.requestFullscreen = () => Promise.reject(new TypeError("Permissions check failed"));
  expect(() => denied.enter()).not.toThrow();
  expect(denied.active).toBe(false);
  // Refused by throwing.
  refused.el.requestFullscreen = () => { throw new TypeError("not allowed"); };
  expect(() => denied.enter()).not.toThrow();
  // Another element in full screen is not ours: nothing is reported and nothing is exited.
  const other = browser(), mine = nativeScreen(other.el, left);
  other.settle({});
  expect(mine.active).toBe(false);
  mine.exit();
  expect(other.calls.exit).toBe(0);
  other.settle(null);
  expect(left).not.toHaveBeenCalled();
});

it("releases a late fullscreen grant after the visitor has already closed the view", () => {
  const b = browser(), left = vi.fn(), screen = nativeScreen(b.el, left);
  screen.enter();
  screen.exit();
  b.grant();
  expect(b.calls.exit).toBe(1);
  b.grant();
  expect(screen.active).toBe(false);
  expect(left).not.toHaveBeenCalled();
});

it("stops listening when the bench goes away", () => {
  const b = browser(), left = vi.fn(), screen = nativeScreen(b.el, left);
  expect(b.listening()).toBe(2);
  screen.enter(); b.grant();
  // The bench unmounts in full screen: it leaves, and the exit that follows is no longer anyone's business.
  screen.exit(); screen.dispose();
  expect(b.listening()).toBe(0);
  b.grant();
  expect(left).not.toHaveBeenCalled();
});

it("closes one thing per press of Escape in full screen, the nearest first", () => {
  const button = { tagName: "BUTTON" }, field = { tagName: "TEXTAREA" }, select = { tagName: "SELECT" }, stage = { tagName: "DIV" };
  // Everything open at once, with the focus in the question box of an open panel.
  expect(escapeIntent(field, false, true, true, true)).toBe("wait");
  expect(escapeIntent(field, false, false, true, true)).toBe("panel");
  expect(escapeIntent(field, false, false, false, true)).toBe("leave");
  // Out of the field, the panel over the stage closes before full screen does.
  for (const from of [button, stage, { tagName: "INPUT", type: "range" }]) {
    expect(escapeIntent(from, false, false, false, true)).toBe("overlay");
    expect(escapeIntent(from, false, false, false, false)).toBe("close");
  }
  // A select's first press is its menu's. The second closes the panel it is in, not full screen.
  expect(escapeIntent(select, false, false, false, true)).toBe("menu");
  expect(escapeIntent(select, true, false, false, true)).toBe("overlay");
  expect(escapeIntent(select, true, false, false, false)).toBe("close");
});

it("shows the docked training controls only while the bench is docked", () => {
  const controls = <Docked><button type="button">Teach Qwen</button></Docked>;
  expect(renderToString(controls)).toContain("Teach Qwen");
  expect(renderToString(<Immersive value={false}>{controls}</Immersive>)).toContain("Teach Qwen");
  // In full screen the bar along the bottom has them, so they are not on screen twice.
  expect(renderToString(<Immersive value>{controls}</Immersive>)).toBe("");
});
