// Where the stage's text labels go: inside the view, clear of the toolbar, and never on top of each other.

export interface Box { left: number; top: number; width: number; height: number }

/**
 * The box of a label for an anchor point. `ax` and `ay` say which fraction of the label sits on the
 * point (0.5, 1 centers it above). The box is moved the least distance that keeps it inside the view.
 */
export function placeBox(x: number, y: number, width: number, height: number, ax: number, ay: number, viewWidth: number, viewHeight: number, pad = 3): Box {
  const clamp = (v: number, size: number, view: number) => Math.max(pad, Math.min(Math.max(pad, view - size - pad), v));
  return { left: clamp(x - ax * width, width, viewWidth), top: clamp(y - ay * height, height, viewHeight), width, height };
}

export function overlaps(a: Box, b: Box, gap = 2): boolean {
  return a.left < b.left + b.width + gap && b.left < a.left + a.width + gap && a.top < b.top + b.height + gap && b.top < a.top + a.height + gap;
}

/**
 * Decide which labels to show. Higher priority labels are placed first; a label that would touch a
 * reserved area or a label already shown is left out rather than drawn over it. Ties keep their order.
 */
export function declutter(labels: { box: Box; priority: number }[], reserved: Box[] = []): boolean[] {
  const shown = new Array<boolean>(labels.length).fill(false), taken = [...reserved];
  const order = labels.map((_, i) => i).sort((a, b) => labels[b].priority - labels[a].priority || a - b);
  for (const i of order) {
    const box = labels[i].box;
    if (taken.some((t) => overlaps(box, t))) continue;
    shown[i] = true;
    taken.push(box);
  }
  return shown;
}

/** Fractions of the view kept clear when framing the model: under the toolbar, and for labels at the edges. */
export interface Inset { top: number; bottom: number; side: number }

/**
 * How much of the top of the view the toolbar and help text take from the model. Only the pieces that
 * sit above the model's own width count: in a wide stage the toolbar is in the corners and costs nothing.
 */
export function toolbarInset(reserved: Box[], modelLeft: number, modelRight: number, viewHeight: number, most = 0.38): number {
  let bottom = 0;
  for (const r of reserved) if (r.top + r.height / 2 < viewHeight / 2 && r.left < modelRight && r.left + r.width > modelLeft) bottom = Math.max(bottom, r.top + r.height);
  return viewHeight > 0 ? Math.min(most, (bottom ? bottom + 8 : 0) / viewHeight) : 0;
}

/** The same for the camera dock and the breadcrumb at the bottom of the view. */
export function dockInset(reserved: Box[], modelLeft: number, modelRight: number, viewHeight: number, most = 0.3): number {
  let top = viewHeight;
  for (const r of reserved) if (r.top + r.height / 2 >= viewHeight / 2 && r.left < modelRight && r.left + r.width > modelLeft) top = Math.min(top, r.top);
  return viewHeight > 0 ? Math.min(most, (top < viewHeight ? viewHeight - top + 8 : 0) / viewHeight) : 0;
}
