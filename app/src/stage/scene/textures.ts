// Surface detail made in code: small, deterministic textures for brushed metal, ceramic grain,
// circuit traces, engraved nameplates and the studio floor. Nothing is fetched.
import * as THREE from "three";

/** A seeded generator, so every visit draws the same surfaces. */
export function seeded(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const byte = (v: number) => Math.max(0, Math.min(255, Math.round(v * 255)));

/**
 * Brushed metal. Each row is one pass of the abrasive: its own depth, drifting slowly along the stroke,
 * with an occasional deeper scratch. Red is height (for the bump), green scales roughness, blue leaves
 * metalness alone. Tiles in both directions.
 */
export function brushedPixels(size = 256, seed = 7): Uint8Array {
  const rnd = seeded(seed), out = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    const level = rnd(), knots = 3 + Math.floor(rnd() * 4), k = Array.from({ length: knots }, () => rnd());
    const scratch = rnd() < 0.05 ? 0.4 + rnd() * 0.6 : 0;
    for (let x = 0; x < size; x++) {
      const u = (x / size) * knots, i = Math.floor(u), s = (1 - Math.cos((u - i) * Math.PI)) / 2;
      const drift = k[i % knots] * (1 - s) + k[(i + 1) % knots] * s;
      const h = Math.max(0, Math.min(1, 0.5 + (level - 0.5) * 0.6 + (drift - 0.5) * 0.3 - scratch * 0.35)), o = (y * size + x) * 4;
      out[o] = byte(h); out[o + 1] = byte(0.5 + 0.5 * h); out[o + 2] = 255; out[o + 3] = 255;
    }
  }
  return out;
}

/** Fine even grain for ceramic and bead-blasted anodizing: softened noise, same channels as the brushed texture. */
export function grainPixels(size = 128, seed = 11): Uint8Array {
  const rnd = seeded(seed), noise = Float32Array.from({ length: size * size }, () => rnd()), out = new Uint8Array(size * size * 4);
  const at = (x: number, y: number) => noise[((y + size) % size) * size + ((x + size) % size)];
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const h = (at(x, y) * 4 + at(x - 1, y) + at(x + 1, y) + at(x, y - 1) + at(x, y + 1)) / 8, o = (y * size + x) * 4;
    out[o] = byte(h); out[o + 1] = byte(0.78 + 0.22 * h); out[o + 2] = 255; out[o + 3] = 255;
  }
  return out;
}

/**
 * A circuit board: matte solder mask, traces showing faintly through it, and bare gold only at pads
 * and vias. Returns the color image and a second image whose green is roughness and blue is metalness.
 * The routing is decoration and wraps at the edges; it does not picture any real connection.
 */
export function tracePixels(size = 256, seed = 23): { color: Uint8Array; surface: Uint8Array } {
  const rnd = seeded(seed), color = new Uint8Array(size * size * 4), surface = new Uint8Array(size * size * 4);
  const MASK = [15, 21, 20], TRACE = [27, 39, 35], GOLD = [214, 170, 92];
  const put = (x: number, y: number, c: number[], rough: number, metal: number) => {
    const o = ((((y % size) + size) % size) * size + (((x % size) + size) % size)) * 4;
    color[o] = c[0]; color[o + 1] = c[1]; color[o + 2] = c[2]; color[o + 3] = 255;
    surface[o] = 255; surface[o + 1] = byte(rough); surface[o + 2] = byte(metal); surface[o + 3] = 255;
  };
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) put(x, y, MASK, 0.62, 0);
  const disc = (cx: number, cy: number, r: number, c: number[], rough: number, metal: number) => {
    for (let y = -r; y <= r; y++) for (let x = -r; x <= r; x++) if (x * x + y * y <= r * r) put(cx + x, cy + y, c, rough, metal);
  };
  const STEPS = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
  for (let n = 0; n < 34; n++) {
    let x = Math.floor(rnd() * (size / 8)) * 8, y = Math.floor(rnd() * (size / 8)) * 8, dir = Math.floor(rnd() * 4) * 2;
    disc(x, y, 3, GOLD, 0.3, 1); disc(x, y, 1, MASK, 0.62, 0);
    for (let leg = 0, legs = 2 + Math.floor(rnd() * 4); leg < legs; leg++) {
      const [dx, dy] = STEPS[dir], length = 8 * (1 + Math.floor(rnd() * 6));
      for (let i = 0; i < length; i++) { x += dx; y += dy; put(x, y, TRACE, 0.5, 0); put(x + (dy ? 1 : 0), y + (dy ? 0 : 1), TRACE, 0.5, 0); }
      dir = (dir + (rnd() < 0.5 ? 1 : 7)) % 8;
    }
    disc(x, y, 3, GOLD, 0.3, 1); disc(x, y, 1, MASK, 0.62, 0);
  }
  // Pairs of bare pads, as left for small parts.
  for (let n = 0; n < 26; n++) {
    const x = Math.floor(rnd() * size), y = Math.floor(rnd() * size), wide = rnd() < 0.5;
    for (const side of [0, 1]) for (let j = 0; j < 4; j++) for (let i = 0; i < 6; i++) {
      put(x + (wide ? i + side * 9 : j), y + (wide ? j : i + side * 9), GOLD, 0.32, 1);
    }
  }
  return { color, surface };
}

// Five by seven capitals, one row of bits per line, for the engraved nameplates.
const GLYPHS: Record<string, number[]> = {
  A: [0x0e, 0x11, 0x11, 0x1f, 0x11, 0x11, 0x11], D: [0x1e, 0x11, 0x11, 0x11, 0x11, 0x11, 0x1e], I: [0x0e, 0x04, 0x04, 0x04, 0x04, 0x04, 0x0e],
  L: [0x10, 0x10, 0x10, 0x10, 0x10, 0x10, 0x1f], M: [0x11, 0x1b, 0x15, 0x15, 0x11, 0x11, 0x11], N: [0x11, 0x19, 0x15, 0x13, 0x11, 0x11, 0x11],
  O: [0x0e, 0x11, 0x11, 0x11, 0x11, 0x11, 0x0e], P: [0x1e, 0x11, 0x11, 0x1e, 0x10, 0x10, 0x10], R: [0x1e, 0x11, 0x11, 0x1e, 0x14, 0x12, 0x11],
  S: [0x0f, 0x10, 0x10, 0x0e, 0x01, 0x01, 0x1e], T: [0x1f, 0x04, 0x04, 0x04, 0x04, 0x04, 0x04], U: [0x11, 0x11, 0x11, 0x11, 0x11, 0x11, 0x0e],
  W: [0x11, 0x11, 0x11, 0x15, 0x15, 0x1b, 0x11], " ": [0, 0, 0, 0, 0, 0, 0],
};

export const NAMEPLATES = ["WORDS IN", "WORDS OUT", "MLP"] as const;
export type Nameplate = (typeof NAMEPLATES)[number];

/**
 * One image holding every nameplate: dark anodized plate with the letters cut through to bright metal.
 * `rects` gives each plate's place in the image as [u0, v0, u1, v1], with its width over its height.
 */
export function nameplatePixels(): { color: Uint8Array; width: number; height: number; rects: Record<Nameplate, { uv: [number, number, number, number]; aspect: number }> } {
  const width = 256, height = 128, row = 40, scale = 3, pad = 9, color = new Uint8Array(width * height * 4);
  const rnd = seeded(41);
  for (let i = 0; i < width * height; i++) { const g = 26 + Math.round(rnd() * 6); color[i * 4] = g; color[i * 4 + 1] = g + 1; color[i * 4 + 2] = g + 4; color[i * 4 + 3] = 255; }
  const rects = {} as Record<Nameplate, { uv: [number, number, number, number]; aspect: number }>;
  NAMEPLATES.forEach((text, line) => {
    const top = line * row, wide = pad * 2 + text.length * 6 * scale - scale;
    [...text].forEach((ch, n) => (GLYPHS[ch] ?? GLYPHS[" "]).forEach((bits, gy) => {
      for (let gx = 0; gx < 5; gx++) if (bits & (0x10 >> gx)) for (let sy = 0; sy < scale; sy++) for (let sx = 0; sx < scale; sx++) {
        // A texture's first row is its bottom edge, so the image is stored bottom row first to stand upright.
        const x = pad + n * 6 * scale + gx * scale + sx, y = top + Math.floor((row - 7 * scale) / 2) + gy * scale + sy, o = ((height - 1 - y) * width + x) * 4;
        color[o] = 222; color[o + 1] = 224; color[o + 2] = 228;
      }
    }));
    // Lines are laid out from the top of the image down; texture v runs upward.
    rects[text] = { uv: [0, 1 - (top + row) / height, wide / width, 1 - top / height], aspect: wide / row };
  });
  return { color, width, height, rects };
}

/**
 * One cell of a lit insert: full brightness in the middle, dimmer at its border, so a window reads as
 * a panel of segments behind glass and not as a flat patch. Repeated across each insert.
 */
export function segmentPixels(size = 32): Uint8Array {
  const out = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const edge = Math.min(x, y, size - 1 - x, size - 1 - y), v = byte(0.5 + 0.5 * Math.min(1, edge / 3)), o = (y * size + x) * 4;
    out[o] = out[o + 1] = out[o + 2] = v; out[o + 3] = 255;
  }
  return out;
}

/** White with alpha falling from 1 at the center to 0 at the rim: the light pool and the contact shadow on the floor. */
export function falloffPixels(size = 64, power = 1.6): Uint8Array {
  const out = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const dx = (x + 0.5) / size * 2 - 1, dy = (y + 0.5) / size * 2 - 1, r = Math.min(1, Math.hypot(dx, dy)), o = (y * size + x) * 4;
    out[o] = out[o + 1] = out[o + 2] = 255; out[o + 3] = byte((1 - r * r * (3 - 2 * r)) ** power);
  }
  return out;
}

/** The seamless backdrop: lit behind the model, falling off to the corners, with a little grain against banding. */
export function backdropPixels(center: [number, number, number], edge: [number, number, number], size = 256, seed = 5): Uint8Array {
  const rnd = seeded(seed), out = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const dx = (x + 0.5) / size - 0.5, dy = (y + 0.5) / size - 0.56, r = Math.min(1, Math.hypot(dx * 1.5, dy * 1.9)), k = r * r * (3 - 2 * r), o = (y * size + x) * 4;
    for (let c = 0; c < 3; c++) out[o + c] = Math.max(0, Math.min(255, Math.round(center[c] + (edge[c] - center[c]) * k + (rnd() - 0.5) * 1.6)));
    out[o + 3] = 255;
  }
  return out;
}

/** Wrap generated pixels as a filtered, repeating texture. */
export function texture(data: Uint8Array, width: number, height: number, options: { srgb?: boolean; repeat?: [number, number]; clamp?: boolean } = {}): THREE.DataTexture {
  const t = new THREE.DataTexture(data, width, height, THREE.RGBAFormat);
  t.colorSpace = options.srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.wrapS = t.wrapT = options.clamp ? THREE.ClampToEdgeWrapping : THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true;
  t.anisotropy = 4;
  if (options.repeat) t.repeat.set(...options.repeat);
  t.needsUpdate = true;
  return t;
}
