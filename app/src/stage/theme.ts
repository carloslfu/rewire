// The page's colors, handed to the 3D scene as plain numbers so it matches light and dark exactly.

export type RGB = [number, number, number];

export interface Theme {
  dark: boolean;
  bg: RGB; panel: RGB; fg: RGB; muted: RGB; line: RGB;
  neg: RGB; pos: RGB; zero: RGB; changed: RGB;
}

export const LIGHT: Theme = { dark: false, bg: [252, 251, 249], panel: [255, 255, 255], fg: [28, 28, 33], muted: [93, 94, 102], line: [227, 225, 220],
  neg: [42, 104, 178], pos: [207, 95, 18], zero: [228, 226, 222], changed: [170, 40, 107] };
export const DARK: Theme = { dark: true, bg: [19, 19, 22], panel: [27, 27, 31], fg: [236, 236, 241], muted: [169, 170, 179], line: [45, 45, 52],
  neg: [95, 158, 232], pos: [240, 144, 64], zero: [44, 44, 51], changed: [255, 79, 163] };

function parse(c: string, fallback: RGB): RGB {
  const m = /#([0-9a-f]{6})/i.exec(c.trim());
  if (!m) return fallback;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Read the current theme from the page's CSS variables. */
export function readTheme(): Theme {
  const dark = document.documentElement.dataset.theme === "dark" ||
    (!document.documentElement.dataset.theme && matchMedia("(prefers-color-scheme: dark)").matches);
  const base = dark ? DARK : LIGHT, cs = getComputedStyle(document.documentElement);
  const v = (name: string, key: Exclude<keyof Theme, "dark">) => parse(cs.getPropertyValue(name), base[key]);
  return { dark, bg: v("--bg", "bg"), panel: v("--panel", "panel"), fg: v("--fg", "fg"), muted: v("--muted", "muted"), line: v("--line", "line"),
    neg: v("--neg", "neg"), pos: v("--pos", "pos"), zero: v("--zero", "zero"), changed: v("--changed", "changed") };
}

export function mix(a: RGB, b: RGB, t: number): RGB {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

/** Color of an unmeasured module: the page's zero color, lifted a little in dark mode so parts stay visible. */
export const unlit = (t: Theme): RGB => (t.dark ? mix(t.zero, t.fg, 0.28) : t.zero);

/**
 * v in [-1, 1] to a color. Signed values run blue through neutral to orange, with the same curve as the
 * page's own diverging colors. Sizes run from neutral to the change color.
 */
export function ramp(t: Theme, v: number, kind: "signed" | "size"): RGB {
  const zero = unlit(t);
  if (Number.isNaN(v)) return zero;
  const k = Math.min(1, Math.abs(v)) ** 0.7;
  return mix(zero, kind === "size" ? t.changed : v < 0 ? t.neg : t.pos, k);
}
