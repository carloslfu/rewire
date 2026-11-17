// Full screen for the 3D bench. The bench always fills the viewport itself. On top of that it asks for
// the browser's own full screen, which also hides the browser's bars. A browser that refuses, or has no
// such thing (a phone), leaves the viewport view exactly as it was.
import { createContext, type ReactNode, useContext } from "react";

/** Whether the bench around this is in full screen. */
export const Immersive = createContext(false);

/** Controls that are under the stage when it is docked. Full screen has its own copy along the bottom. */
export function Docked({ children }: { children: ReactNode }) {
  return useContext(Immersive) ? null : children;
}

/** The parts of a document and an element that full screen uses, with the prefixed names older Safari has. */
export interface ScreenDocument {
  fullscreenEnabled?: boolean;
  webkitFullscreenEnabled?: boolean;
  fullscreenElement?: unknown;
  webkitFullscreenElement?: unknown;
  exitFullscreen?: () => Promise<void> | void;
  webkitExitFullscreen?: () => void;
  addEventListener(type: string, f: () => void): void;
  removeEventListener(type: string, f: () => void): void;
}
export interface ScreenElement {
  requestFullscreen?: () => Promise<void> | void;
  webkitRequestFullscreen?: () => void;
  ownerDocument: ScreenDocument;
}
const CHANGES = ["fullscreenchange", "webkitfullscreenchange"];
const quiet = (run: () => Promise<void> | void, failed?: () => void) => {
  try {
    const done = run();
    if (done) done.catch(() => failed?.());
  } catch { failed?.(); }
};

/**
 * The browser's full screen for one element.
 * - `enter` must be called inside the click or key press that asks for it. It never throws: a browser
 *   that refuses changes nothing.
 * - `exit` leaves it if this element has it.
 * - `onLeft` is called when the browser ends it by its own means (Escape, a gesture, another window),
 *   and not for an `exit` made here.
 */
export function nativeScreen(el: ScreenElement, onLeft: () => void) {
  const doc = el.ownerDocument;
  const owned = () => (doc.fullscreenElement ?? doc.webkitFullscreenElement) === el;
  let had = owned(), wanted = had, exiting = false;
  const leaveNative = () => {
    if (!owned() || exiting) return;
    exiting = true;
    quiet(() => doc.exitFullscreen ? doc.exitFullscreen() : doc.webkitExitFullscreen?.(), () => { exiting = false; });
  };
  const changed = () => {
    const now = owned();
    if (had && !now && !exiting) {
      wanted = false;
      onLeft();
    }
    if (!now) exiting = false;
    had = now;
    if (now && !wanted) leaveNative();
  };
  for (const type of CHANGES) doc.addEventListener(type, changed);
  return {
    get active() { return owned(); },
    enter() {
      wanted = true;
      if (owned() || (doc.fullscreenEnabled ?? doc.webkitFullscreenEnabled) === false) return;
      quiet(() => {
        const request = el.requestFullscreen ? el.requestFullscreen() : el.webkitRequestFullscreen?.();
        // The visitor can close the viewport view, or leave this bench, before the request settles.
        return request?.then(() => { if (!wanted) leaveNative(); });
      });
    },
    exit() { wanted = false; leaveNative(); },
    dispose() {
      wanted = false;
      leaveNative();
      for (const type of CHANGES) doc.removeEventListener(type, changed);
    },
  };
}
