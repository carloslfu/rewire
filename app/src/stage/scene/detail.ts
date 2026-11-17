// The machined detail of each kind of part, built once and instanced: module bodies with bezels, pads
// and windows, heatsinks, drawer fronts, screws. Every shape is in its part's own coordinates, centered
// where the part is centered, so one matrix per part places all of its pieces.
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { Arch, Vec3 } from "../arch.ts";

type Geo = THREE.BufferGeometry;

/** Texture tiles per world unit on metal and ceramic, so grain is the same size on every part. */
const GRAIN = 2;
const BOARD = 0.6;

/** One geometry from several. The inputs are consumed. */
export function merge(parts: Geo[]): Geo {
  const flat = parts.map((g) => {
    const n = g.index ? g.toNonIndexed() : g;
    for (const name of Object.keys(n.attributes)) if (name !== "position" && name !== "normal" && name !== "uv") n.deleteAttribute(name);
    return n;
  });
  const out = mergeGeometries(flat, false);
  for (const g of new Set([...parts, ...flat])) g.dispose();
  if (!out) throw new Error("Shapes could not be merged");
  return out;
}

/** Texture coordinates from position, per face direction, with the first coordinate along the longer run of the face. */
export function worldUV(geo: Geo, density = GRAIN): Geo {
  const p = geo.getAttribute("position"), n = geo.getAttribute("normal"), uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) {
    const ax = Math.abs(n.getX(i)), ay = Math.abs(n.getY(i)), az = Math.abs(n.getZ(i));
    const [u, v] = ay >= ax && ay >= az ? [p.getX(i), p.getZ(i)] : az >= ax ? [p.getX(i), p.getY(i)] : [p.getZ(i), p.getY(i)];
    uv[i * 2] = u * density; uv[i * 2 + 1] = v * density;
  }
  geo.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  return geo;
}

/**
 * Bake a shade into each vertex: 1 in the open, less where the rack itself would block the studio's
 * light. Reflected studio light casts no shadows of its own, so this is what keeps the space between
 * the decks dark. `f` gets a vertex's position and normal.
 */
export function shade(geo: Geo, f: (p: THREE.Vector3, n: THREE.Vector3) => number = () => 1): Geo {
  const position = geo.getAttribute("position"), normal = geo.getAttribute("normal"), colors = new Float32Array(position.count * 3);
  const p = new THREE.Vector3(), n = new THREE.Vector3();
  for (let i = 0; i < position.count; i++) {
    const k = Math.max(0, Math.min(1, f(p.fromBufferAttribute(position, i), n.fromBufferAttribute(normal, i))));
    colors[i * 3] = colors[i * 3 + 1] = colors[i * 3 + 2] = k;
  }
  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  return geo;
}

/** Repeat the insert's segment texture `nx` by `ny` times across a shape. */
export function cells(geo: Geo, nx: number, ny: number): Geo {
  const uv = geo.getAttribute("uv");
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * nx, uv.getY(i) * ny);
  return geo;
}

const smooth = (a: number, b: number, x: number) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/** Shade for a module seated under the next deck: open at the front, closed in above, beside and behind. */
const seated = (h: number) => (p: THREE.Vector3, n: THREE.Vector3) =>
  n.z > 0.5 ? 0.78 + 0.22 * smooth(0, h * 0.3, h / 2 - p.y) : n.y > 0.5 ? 0.7 : n.y < -0.5 ? 0.35 : n.z < -0.5 ? 0.45 : 0.5;

const box = (w: number, h: number, d: number, x = 0, y = 0, z = 0): Geo => new THREE.BoxGeometry(w, h, d).translate(x, y, z);
const rounded = (w: number, h: number, d: number, r: number, high: boolean): Geo => new RoundedBoxGeometry(w, h, d, high ? 2 : 1, Math.min(r, w / 2, h / 2, d / 2) * 0.98);
/** A flat panel facing +z. */
const panel = (w: number, h: number, x: number, y: number, z: number): Geo => new THREE.PlaneGeometry(w, h).translate(x, y, z);

/** Four bars around a window on a +z face, standing `proud` of it. Centered on the origin. */
function bezel(w: number, h: number, bar: number, proud: number): Geo[] {
  const z = proud / 2;
  return [box(w + bar * 2, bar, proud, 0, h / 2 + bar / 2, z), box(w + bar * 2, bar, proud, 0, -h / 2 - bar / 2, z),
    box(bar, h, proud, -w / 2 - bar / 2, 0, z), box(bar, h, proud, w / 2 + bar / 2, 0, z)];
}

/**
 * A socket cap screw head, standing on y = 0: a chamfered cylinder with a hexagonal well. The simple
 * version for small screens is the cylinder alone.
 */
export function capScrew(r: number, h: number, high: boolean): Geo {
  if (!high) return new THREE.CylinderGeometry(r, r, h, 10).translate(0, h / 2, 0);
  const sides = 18, chamfer = r * 0.16, well = r * 0.55, deep = h * 0.55, position: number[] = [];
  const ring = (radius: number, n: number, y: number) => Array.from({ length: n }, (_, i) => { const a = (i / n) * Math.PI * 2; return [Math.cos(a) * radius, y, Math.sin(a) * radius]; });
  // Counter-clockwise seen from outside.
  const tri = (a: number[], b: number[], c: number[]) => position.push(...a, ...b, ...c);
  const base = ring(r, sides, 0), shoulder = ring(r, sides, h - chamfer), lip = ring(r - chamfer, sides, h), hex = ring(well, 6, h), floor = ring(well, 6, h - deep);
  for (let i = 0; i < sides; i++) {
    const j = (i + 1) % sides, k = Math.floor((i + 0.5) / (sides / 6)) % 6, corner = (i + 1) % (sides / 6) === 0;
    tri(base[i], shoulder[i], shoulder[j]); tri(base[i], shoulder[j], base[j]);
    tri(shoulder[i], lip[i], lip[j]); tri(shoulder[i], lip[j], shoulder[j]);
    // The top face runs from the round lip in to the hexagon.
    tri(lip[i], hex[k], lip[j]);
    if (corner) tri(lip[j], hex[k], hex[(k + 1) % 6]);
  }
  for (let k = 0; k < 6; k++) {
    const n = (k + 1) % 6;
    tri(hex[k], floor[k], floor[n]); tri(hex[k], floor[n], hex[n]);
    tri(floor[k], [0, h - deep, 0], floor[n]);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(position), 3));
  geo.computeVertexNormals();
  geo.setAttribute("uv", new THREE.BufferAttribute(new Float32Array((position.length / 3) * 2), 2));
  return geo;
}

/** An attention head: a ceramic module with a framed window on its face, a round window on its lid, and gold contacts. */
export function headShapes([w, h, d]: Vec3, u: number, high: boolean) {
  const front = d / 2, top = h / 2, ww = w * 0.72, wh = h * 0.42, wy = h * 0.1, bar = 0.016 * u, proud = 0.012 * u, lid = Math.min(w, d) * 0.29;
  const trim = bezel(ww, wh, bar, proud).map((g) => g.translate(0, wy, front));
  for (let i = 0; i < 5; i++) trim.push(box(w * 0.09, h * 0.15, 0.008 * u, (i - 2) * w * 0.17, -top + h * 0.13, front + 0.003 * u));
  trim.push(new THREE.TorusGeometry(lid, 0.012 * u, high ? 6 : 4, high ? 24 : 14).rotateX(Math.PI / 2).translate(0, top, 0));
  if (high) {
    for (const side of [-1, 1]) for (let i = 0; i < 4; i++) trim.push(box(0.014 * u, h * 0.3, d * 0.08, side * (w / 2 + 0.005 * u), -top + h * 0.15, (i - 1.5) * d * 0.2));
    // The orientation dot every such package carries.
    trim.push(new THREE.CylinderGeometry(0.014 * u, 0.014 * u, 0.006 * u, 10).translate(-w * 0.36, top + 0.002 * u, d * 0.38));
  }
  const disc = (y: number) => new THREE.CircleGeometry(lid - 0.004 * u, high ? 24 : 14).rotateX(-Math.PI / 2).translate(0, y, 0);
  return {
    body: shade(worldUV(rounded(w, h, d, Math.min(w, h) * 0.07, high)), seated(h)),
    trim: merge(trim),
    glow: merge([cells(panel(ww, wh, 0, wy, front + 0.004 * u), 6, 3), cells(disc(top + 0.004 * u), 4, 4)]),
    glass: merge([panel(ww, wh, 0, wy, front + proud * 0.8), disc(top + 0.009 * u)]),
  };
}

/** The shared keys and values under a pair of heads: a socket with one indicator strip. */
export function socketShapes([w, h, d]: Vec3, u: number, high: boolean) {
  return { body: shade(worldUV(rounded(w, h, d, h * 0.3, high)), (_, n) => (n.z > 0.5 ? 1 : 0.5)), glow: cells(panel(w * 0.5, h * 0.5, 0, 0, d / 2 + 0.004 * u), 8, 1) };
}

/** An MLP: a wide ceramic module with a long window, a finned heatsink, four screws and its nameplate. */
export function mlpShapes([w, h, d]: Vec3, u: number, high: boolean, finH: number, plate: { uv: [number, number, number, number]; aspect: number }) {
  const front = d / 2, top = h / 2, ww = w * 0.6, wh = h * 0.4, wx = w * 0.1, wy = h * 0.08, bar = 0.016 * u, proud = 0.012 * u;
  const trim = bezel(ww, wh, bar, proud).map((g) => g.translate(wx, wy, front));
  const pads = high ? 18 : 9;
  for (let i = 0; i < pads; i++) trim.push(box((w * 0.9) / pads * 0.55, h * 0.13, 0.008 * u, ((i + 0.5) / pads - 0.5) * w * 0.9, -top + h * 0.12, front + 0.003 * u));
  const fins = high ? 18 : 10, sink = [box(w * 0.84, 0.012 * u, d * 0.8, 0, top + 0.006 * u, 0)];
  for (let k = 0; k < fins; k++) sink.push(box(0.02 * u, finH, d * 0.78, (k / (fins - 1) - 0.5) * w * 0.8, top + finH / 2, 0));
  const steel = [-1, 1].flatMap((sx) => [-1, 1].map((sz) => capScrew(0.02 * u, 0.016 * u, high).translate(sx * w * 0.465, top, sz * d * 0.36)));
  const bh = h * 0.34, bw = bh * plate.aspect, badge = panel(bw, bh, -w / 2 + 0.07 * u + bw / 2, wy, front + 0.003 * u), [u0, v0, u1, v1] = plate.uv;
  badge.setAttribute("uv", new THREE.BufferAttribute(new Float32Array([u0, v1, u1, v1, u0, v0, u1, v0]), 2));
  return {
    body: shade(worldUV(rounded(w, h, d, h * 0.07, high)), seated(h)),
    trim: merge(trim),
    // Fins stand in the gap under the next deck: darker at their roots.
    sink: shade(worldUV(merge(sink)), (p) => 0.5 + 0.4 * smooth(top, top + finH, p.y)),
    steel: merge(steel),
    glow: cells(panel(ww, wh, wx, wy, front + 0.004 * u), 24, 3),
    glass: panel(ww, wh, wx, wy, front + proud * 0.8),
    badge,
  };
}

/** Height of the drawer front that hangs below each deck, sized to the clearance over the layer beneath. */
export function fasciaHeight(a: Arch): number {
  const m = a.m;
  return Math.min((m.pitch - m.deckT - m.saddleH - m.headH) * 0.6, m.headH * 0.5);
}

/** A layer's deck: the plate, its circuit board, the drawer front below its front edge, and the steel on both. */
export function deckShapes(a: Arch, u: number, high: boolean) {
  const m = a.m, top = m.deckT / 2, front = m.deckD / 2, fh = fasciaHeight(a), ft = 0.05 * u, fy = -top - fh / 2 + 0.004 * u, inset = 0.15 * u;
  const along = (r: number, length: number, sides: number) => new THREE.CylinderGeometry(r, r, length, sides).rotateX(Math.PI / 2);
  const steel: Geo[] = [];
  // Knurled thumbscrews at the ends of the drawer front, and a pull where the residual stream passes.
  for (const side of [-1, 1]) steel.push(along(fh * 0.24, 0.05 * u, high ? 14 : 8).translate(side * (a.deckW / 2 - 0.3 * u), fy, front + 0.025 * u));
  const pull = m.spineSlot * 0.62, reach = 0.07 * u;
  steel.push(new THREE.CylinderGeometry(0.02 * u, 0.02 * u, pull, high ? 10 : 6).rotateZ(Math.PI / 2).translate(a.spineX, fy, front + reach));
  for (const side of [-1, 1]) steel.push(along(0.014 * u, reach, 8).translate(a.spineX + side * pull * 0.42, fy, front + reach / 2));
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) steel.push(capScrew(0.03 * u, 0.02 * u, high).translate(sx * (a.deckW / 2 - inset * 0.55), top, sz * (front - inset * 0.55)));
  return {
    // Under the next deck the plate and its board fall into shade toward the back; the front edge stays in the light.
    plate: shade(worldUV(rounded(a.deckW, m.deckT, m.deckD, m.deckT * 0.4, high)), (p, n) =>
      n.z > 0.5 ? 1 : n.y > 0.5 ? 0.55 + 0.45 * smooth(front - m.headD, front, p.z) : n.y < -0.5 ? 0.35 : Math.abs(n.x) > 0.5 ? 0.85 : 0.6),
    board: shade(worldUV(new THREE.PlaneGeometry(a.deckW - inset * 2, m.deckD - inset * 2, 1, 4).rotateX(-Math.PI / 2).translate(0, top + 0.002 * u, 0), BOARD), (p) => 0.5 + 0.45 * smooth(-front, front, p.z)),
    fascia: shade(worldUV(rounded(a.deckW, fh, ft, ft * 0.3, high).translate(0, fy, front - ft / 2)), (_, n) => (n.z > 0.5 ? 1 : n.z < -0.5 ? 0.4 : n.y < -0.5 ? 0.55 : 0.7)),
    steel: merge(steel),
  };
}

/** A nameplate facing +z, `height` tall, with its left edge at x. */
export function nameplate(plate: { uv: [number, number, number, number]; aspect: number }, height: number, x: number, y: number, z: number): Geo {
  const width = height * plate.aspect, geo = panel(width, height, x + width / 2, y, z), [u0, v0, u1, v1] = plate.uv;
  geo.setAttribute("uv", new THREE.BufferAttribute(new Float32Array([u0, v1, u1, v1, u0, v0, u1, v0]), 2));
  return geo;
}

/** Four cap screws at the top corners of a block of the given size, centered on the origin. */
export function cornerScrews([w, h, d]: Vec3, r: number, inset: number, high: boolean): Geo {
  return merge([-1, 1].flatMap((sx) => [-1, 1].map((sz) => capScrew(r, r * 0.55, high).translate(sx * (w / 2 - inset), h / 2, sz * (d / 2 - inset)))));
}

export { box, rounded };

