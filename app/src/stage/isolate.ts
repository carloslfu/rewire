// While the 3D bench fills the window, the page behind it must not take clicks, focus or reading order.

const SKIP = new Set(["DIALOG", "SCRIPT", "STYLE", "NOSCRIPT"]);

/**
 * Make everything outside `root` inert, up to the document body. Modal dialogs stay usable (the
 * inspector opens above the full view), live regions keep announcing, and anything already inert is
 * left alone. Returns the undo, which removes only what this call added.
 */
export function isolate(root: Element): () => void {
  const added: Element[] = [];
  for (let node: Element | null = root; node?.parentElement; node = node.parentElement) {
    for (const sibling of Array.from(node.parentElement.children)) {
      if (sibling === node || SKIP.has(sibling.tagName) || sibling.hasAttribute("inert") || sibling.hasAttribute("aria-live")) continue;
      sibling.setAttribute("inert", "");
      added.push(sibling);
    }
    if (node.parentElement.tagName === "BODY") break;
  }
  return () => { for (const el of added) el.removeAttribute("inert"); };
}
