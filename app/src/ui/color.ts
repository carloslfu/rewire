// Numbers drawn as color (section 5.3): a diverging, colorblind-safe palette, blue for negative and orange
// for positive, gray near zero. The changed color is used for nothing else.

type RGB = [number, number, number];

function parse(c: string): RGB {
  const m = /#([0-9a-f]{6})/i.exec(c.trim());
  if (m) {
    const n = parseInt(m[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  const r = /rgba?\(([^)]+)\)/.exec(c);
  if (r) {
    const [a, b, d] = r[1].split(/[ ,]+/).map(Number);
    return [a, b, d];
  }
  return [128, 128, 128];
}

let cache: { neg: RGB; pos: RGB; zero: RGB; dark: boolean } | null = null;

export function palette() {
  const dark = document.documentElement.dataset.theme === "dark" ||
    (!document.documentElement.dataset.theme && matchMedia("(prefers-color-scheme: dark)").matches);
  if (cache && cache.dark === dark) return cache;
  const cs = getComputedStyle(document.documentElement);
  cache = { neg: parse(cs.getPropertyValue("--neg")), pos: parse(cs.getPropertyValue("--pos")), zero: parse(cs.getPropertyValue("--zero")), dark };
  return cache;
}

export function onThemeChange(f: () => void) {
  const m = matchMedia("(prefers-color-scheme: dark)");
  const h = () => {
    cache = null;
    f();
  };
  m.addEventListener("change", h);
  return () => m.removeEventListener("change", h);
}

/** v in [-1, 1] (already scaled) to an rgb() string. A gentle curve keeps small values visible. */
export function diverging(v: number): string {
  const [r, g, b] = divergingRGB(v);
  return `rgb(${r},${g},${b})`;
}

export function divergingRGB(v: number): RGB {
  const p = palette();
  const t = Math.min(1, Math.abs(v)) ** 0.7;
  const to = v < 0 ? p.neg : p.pos;
  return [
    Math.round(p.zero[0] + (to[0] - p.zero[0]) * t),
    Math.round(p.zero[1] + (to[1] - p.zero[1]) * t),
    Math.round(p.zero[2] + (to[2] - p.zero[2]) * t),
  ];
}

/** Text color that stays readable on a diverging cell. */
export function ink(v: number): string {
  return Math.abs(v) > 0.55 ? "#fff" : "var(--fg)";
}

export function fmt(v: number, digits = 2): string {
  if (!Number.isFinite(v)) return String(v);
  const s = Math.abs(v).toFixed(digits);
  return v < 0 ? `−${s}` : s;
}

export function signed(v: number, digits = 2): string {
  return v >= 0 ? `+${Math.abs(v).toFixed(digits)}` : `−${Math.abs(v).toFixed(digits)}`;
}

export function pct(p: number): string {
  const x = p * 100;
  if (x >= 99.5 && x < 100) return ">99%";
  if (x > 0 && x < 0.5) return "<1%";
  return `${Math.round(x)}%`;
}
