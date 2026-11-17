// The 3D scene without a GPU: Three.js geometry, instancing and ray casting run in Node, and the
// stage's renderer and controls are replaced by recording fakes.
import * as THREE from "three";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { QWEN_INFO, TINY_INFO } from "../src/model/info.ts";
import { plate } from "../src/stage/adapters.ts";
import { type Arch, buildArch, type Part, partIndex } from "../src/stage/arch.ts";
import { poseOf } from "../src/stage/intervene.ts";
import { beatCount } from "../src/stage/playback.ts";
import { Bay, layoutPlates, plateSize } from "../src/stage/scene/bay.ts";
import { Specimen } from "../src/stage/scene/specimen.ts";
import { frame, Stage } from "../src/stage/scene/stage.ts";
import { LIGHT } from "../src/stage/theme.ts";

const settle = (s: Specimen) => { for (let i = 0; i < 2000 && s.step(1 / 60); i++); expect(s.settled).toBe(true); };
const rayAt = (target: THREE.Vector3, from = new THREE.Vector3(0, 0, 40)) => new THREE.Raycaster(target.clone().add(from), from.clone().negate().normalize());
const instanced = (s: Specimen) => s.group.children.filter((o): o is THREE.InstancedMesh => (o as THREE.InstancedMesh).isInstancedMesh);

it("draws the whole model in a fixed, small number of draw calls", () => {
  for (const [model, heads] of [[QWEN_INFO, 448], [TINY_INFO, 16]] as const) {
    const s = new Specimen(buildArch(model), LIGHT, { shadows: false });
    // 448 heads and 28 MLPs are instances, not meshes: the budget does not grow with the model.
    expect(s.drawCalls).toBeLessThanOrEqual(26);
    const counts = instanced(s).map((m) => m.count);
    expect(counts.filter((c) => c === heads).length).toBeGreaterThanOrEqual(2);
    expect(counts).toContain(model.floors);
    expect(counts).toContain(model.floors * model.kvHeads);
    expect(counts.reduce((a, b) => a + b, 0)).toBeLessThan(model.floors * 80 + 400);
    s.dispose();
  }
});

it("picks the part under the pointer, through decoration, for every kind of part", () => {
  const arch = buildArch(QWEN_INFO), s = new Specimen(arch, LIGHT, { shadows: false }), c = new THREE.Vector3();
  const expectPick = (p: Part) => { const i = partIndex(arch, p); expect(arch.parts[s.pick(rayAt(s.center(i, c)))]).toEqual(p); };
  // Straight at the front of a head: its lens is in the way and must not swallow the click.
  for (const p of [{ kind: "head", floor: 0, head: 0 }, { kind: "head", floor: 20, head: 13 }, { kind: "head", floor: 27, head: 15 }, { kind: "mlp", floor: 9 }] as const) expectPick(p);
  // From above and in front, one of the MLP's fins is in the way.
  const mlp = partIndex(arch, { kind: "mlp", floor: 27 }), fin = s.center(mlp, c).clone();
  fin.x += (7 / 13 - 0.5) * arch.m.mlpW * 0.84;
  expect(s.pick(rayAt(fin, new THREE.Vector3(0, 30, 30)))).toBe(mlp);
  // Straight down, the output block covers the top MLP and answers instead.
  expect(s.pick(rayAt(s.center(mlp, c), new THREE.Vector3(0, 30, 0.01)))).toBe(arch.parts.length - 1);
  const deck = partIndex(arch, { kind: "layer", floor: 27 }), edge = s.center(deck, c).clone();
  edge.x = -arch.deckW / 2 + 0.05;
  expect(s.pick(rayAt(edge, new THREE.Vector3(0, 30, 0.01)))).toBe(deck);
  expect(s.pick(rayAt(s.center(0, c), new THREE.Vector3(0, 0.4, 40)))).toBe(0);
  expect(s.pick(rayAt(s.center(arch.parts.length - 1, c)))).toBe(arch.parts.length - 1);
  expect(s.pick(rayAt(new THREE.Vector3(60, 60, 0)))).toBe(-1);
  s.dispose();
});

it("poses parts from the change spec and lets them be picked where they now are", () => {
  const arch = buildArch(QWEN_INFO), s = new Specimen(arch, LIGHT, { shadows: false });
  const head: Part = { kind: "head", floor: 20, head: 13 }, i = partIndex(arch, head), rest = s.center(i, new THREE.Vector3()).clone();
  const pose = (spec: Parameters<typeof poseOf>[0]) => { s.setPoses(arch.parts.map((p) => poseOf(spec, p, QWEN_INFO))); settle(s); return s.center(i, new THREE.Vector3()).clone(); };
  // Knocked out: pushed back out of its socket.
  const out = pose({ heads: [{ floor: 20, head: 13, mult: 0 }] });
  expect(out.z).toBeLessThan(rest.z - arch.m.headD * 0.5);
  expect(arch.parts[s.pick(rayAt(out, new THREE.Vector3(0, 0, -40)))]).toEqual(head);
  // Amplified: taller, still seated. Restored: exactly where it started.
  const loud = pose({ heads: [{ floor: 20, head: 13, mult: 5 }] });
  expect(loud.y).toBeGreaterThan(rest.y);
  expect(loud.z).toBeCloseTo(rest.z, 5);
  expect(pose({}).distanceTo(rest)).toBeLessThan(1e-6);
  // A layer that is off slides back with everything on its deck.
  const cut = pose({ floors: [{ floor: 20, mult: 0 }] });
  expect(cut.z).toBeLessThan(rest.z - arch.m.deckD * 0.5);
  expect(s.center(partIndex(arch, { kind: "head", floor: 19, head: 13 }), new THREE.Vector3()).z).toBeCloseTo(rest.z, 5);
  pose({});
  // The selected layer comes forward like a drawer, with its modules.
  s.setDrawer(20); settle(s);
  expect(s.center(i, new THREE.Vector3()).z).toBeGreaterThan(rest.z + arch.m.deckD * 0.5);
  s.setDrawer(-1); settle(s);
  expect(s.center(i, new THREE.Vector3()).distanceTo(rest)).toBeLessThan(1e-6);
  s.dispose();
});

it("opens the tower above a layer for the detail bay and closes it again", () => {
  const arch = buildArch(QWEN_INFO), s = new Specimen(arch, LIGHT, { shadows: false }), v = new THREE.Vector3();
  const y = (p: Part) => s.center(partIndex(arch, p), v).y;
  const parts: Part[] = [{ kind: "layer", floor: 11 }, { kind: "head", floor: 12, head: 3 }, { kind: "mlp", floor: 12 }, { kind: "layer", floor: 13 }, { kind: "mlp", floor: 27 }, { kind: "norm" }, { kind: "unembed" }, { kind: "embed" }];
  const rest = parts.map(y);
  const glass = s.group.children.find((o) => (o as THREE.Mesh).geometry?.type === "CylinderGeometry" && ((o as THREE.Mesh).material as THREE.Material).transparent) as THREE.Mesh;
  const closed = new THREE.Box3().setFromObject(glass);
  s.setGap(12, 4); settle(s);
  // Layer 13 and everything under it stay; everything above rises by the same amount.
  expect(parts.map(y).map((now, i) => +(now - rest[i]).toFixed(5))).toEqual([0, 0, 0, 4, 4, 4, 4, 0]);
  // The spine still joins the dictionary to the output block.
  const open = new THREE.Box3().setFromObject(glass);
  expect(open.min.y).toBeCloseTo(closed.min.y, 5);
  expect(open.max.y).toBeCloseTo(closed.max.y + 4, 4);
  // The replay marker climbs steadily through the opened tower and ends at the top.
  const pulse = s.group.children.find((o) => (o as THREE.Mesh).geometry?.type === "SphereGeometry") as THREE.Mesh;
  s.setValues(new Float32Array(arch.parts.length), "signed");
  let last = -Infinity;
  for (let t = 0; t < beatCount(QWEN_INFO); t += 0.5) {
    s.setPlayhead(t);
    expect(pulse.position.y).toBeGreaterThanOrEqual(last);
    last = pulse.position.y;
  }
  expect(last).toBeLessThanOrEqual(open.max.y + 1e-4);
  expect(last).toBeGreaterThan(closed.max.y);
  // Below the dictionary's first layer: the whole stack lifts.
  s.setGap(-1, 2); settle(s);
  expect(parts.map(y).map((now, i) => +(now - rest[i]).toFixed(5))).toEqual([2, 2, 2, 2, 2, 2, 2, 0]);
  s.setGap(null); settle(s);
  expect(parts.map(y).map((now, i) => +(now - rest[i]).toFixed(5))).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
  expect(new THREE.Box3().setFromObject(glass).max.y).toBeCloseTo(closed.max.y, 5);
  s.dispose();
});

it("lets parts be rearranged without touching their pose, and puts them back on reset", () => {
  const arch = buildArch(TINY_INFO), s = new Specimen(arch, LIGHT, { shadows: false });
  const i = partIndex(arch, { kind: "mlp", floor: 2 }), rest = s.center(i, new THREE.Vector3()).clone();
  expect(s.movable(i)).toBe(true);
  expect(s.movable(0)).toBe(false);
  expect(s.movable(partIndex(arch, { kind: "kv", floor: 0, group: 0 }))).toBe(false);
  s.arrange(i, new THREE.Vector3(1.5, 2, 0.5)); settle(s);
  expect(s.center(i, new THREE.Vector3()).distanceTo(rest.clone().add(new THREE.Vector3(1.5, 2, 0.5)))).toBeLessThan(1e-5);
  expect(s.arranged()).toBe(1);
  // Dragging a deck carries the parts on it; a fixed part does not move at all.
  const deck = partIndex(arch, { kind: "layer", floor: 0 }), rider = partIndex(arch, { kind: "head", floor: 0, head: 1 }), before = s.center(rider, new THREE.Vector3()).clone();
  s.arrange(deck, new THREE.Vector3(0, 0, 3)); settle(s);
  expect(s.center(rider, new THREE.Vector3()).z).toBeCloseTo(before.z + 3, 5);
  s.arrange(0, new THREE.Vector3(5, 5, 5)); settle(s);
  expect(s.arranged()).toBe(2);
  // A far throw is kept within reach of the specimen.
  s.arrange(i, new THREE.Vector3(500, 0, 0)); settle(s);
  expect(s.center(i, new THREE.Vector3()).x - rest.x).toBeLessThan(10);
  // A real change arriving later composes with the arrangement; reset undoes only the arrangement.
  const knocked = arch.parts.map((p) => poseOf({ memory: [{ floor: 2, mult: 0 }] }, p, TINY_INFO));
  s.setPoses(knocked); s.resetLayout(); settle(s);
  expect(s.arranged()).toBe(0);
  expect(s.center(rider, new THREE.Vector3()).distanceTo(before)).toBeLessThan(1e-6);
  expect(s.center(i, new THREE.Vector3()).z).toBeLessThan(rest.z - arch.m.headD * 0.5);
  s.dispose();
});

it("moves instantly under reduced motion and ignores kicks", () => {
  const arch = buildArch(TINY_INFO), s = new Specimen(arch, LIGHT, { shadows: false });
  s.reducedMotion = true;
  const i = partIndex(arch, { kind: "head", floor: 1, head: 0 }), rest = s.center(i, new THREE.Vector3()).clone();
  s.setPoses(arch.parts.map((p) => poseOf({ heads: [{ floor: 1, head: 0, mult: 0 }] }, p, TINY_INFO)));
  expect(s.settled).toBe(true);
  expect(s.center(i, new THREE.Vector3()).z).toBeLessThan(rest.z - 0.5);
  s.kick(i); s.refuse(i);
  expect(s.settled).toBe(true);
  // With motion allowed, a kick moves the part and it comes back to the same place.
  s.reducedMotion = false;
  const at = s.center(i, new THREE.Vector3()).clone();
  s.kick(i);
  expect(s.settled).toBe(false);
  s.step(1 / 60);
  expect(s.center(i, new THREE.Vector3()).distanceTo(at)).toBeGreaterThan(0.01);
  settle(s);
  expect(s.center(i, new THREE.Vector3()).distanceTo(at)).toBeLessThan(1e-5);
  s.dispose();
});

it("frees every geometry and material it created", () => {
  const s = new Specimen(buildArch(TINY_INFO), LIGHT, { shadows: false });
  s.setTray([0.6, 0.3, 0.1], 2, 5);
  s.setArcs(partIndex(TINY_INFO, { kind: "head", floor: 2, head: 1 }), [0.6, 0.3, 0.1]);
  s.setCandidates([{ p: 0.7, chosen: true }, { p: 0.2, chosen: false }]);
  const geometries = new Set<THREE.BufferGeometry>(), materials = new Set<THREE.Material>();
  s.group.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.geometry) geometries.add(m.geometry);
    if (m.material) for (const mat of [m.material].flat()) materials.add(mat);
  });
  expect(geometries.size).toBeGreaterThan(15);
  let freed = 0;
  for (const x of [...geometries, ...materials]) x.addEventListener("dispose", () => { freed++; });
  s.dispose();
  expect(freed).toBe(geometries.size + materials.size);
  expect(s.group.children).toHaveLength(0);
});

it("lays plates out in reading order and reads back the exact tile under the pointer", () => {
  const values = Float32Array.from({ length: 4 * 6 }, (_, i) => i - 10);
  const make = (id: string, band: number, rows = 4, cols = 6, data: ArrayLike<number> = values) => plate({ id, title: id, band, rows, cols, data });
  const plates = [make("a", 0), make("b", 0), make("c", 0), make("d", 1), make("e", 1, 1, 8, new Float32Array(8))];
  const wide = layoutPlates(plates, 14), narrow = layoutPlates(plates, 3.9);
  // Wide: one line per band. Narrow: a band wraps instead of running off.
  expect(new Set(wide.at.slice(0, 3).map((p) => p.y)).size).toBe(1);
  expect(wide.at[3].y).toBeLessThan(wide.at[0].y);
  expect(wide.at[3].x).toBeCloseTo(wide.at[0].x, 6);
  expect(narrow.at[2].y).toBeLessThan(narrow.at[1].y);
  expect(narrow.width).toBeLessThanOrEqual(3.9);
  for (const l of [wide, narrow]) for (let i = 1; i < 3; i++) if (l.at[i].y === l.at[i - 1].y) expect(l.at[i].x - l.at[i].w / 2).toBeGreaterThan(l.at[i - 1].x + l.at[i - 1].w / 2);
  expect(plateSize({ id: "x", rows: 1, cols: 64 })[1]).toBeLessThan(plateSize({ id: "x", rows: 64, cols: 64 })[1]);
  expect(plateSize({ id: "x", rows: 8, cols: 1 }, { x: [0.3, 1.3] })).toEqual([0.3, 1.3]);

  const bay = new Bay({ key: "k", floor: 0, plates }, LIGHT, 14);
  bay.group.updateMatrixWorld(true);
  const { x, y, w, h } = wide.at[1];
  // Row 0 is the top row of the plate; column 0 is its left edge.
  const tile = (r: number, c: number) => new THREE.Vector3(x - w / 2 + ((c + 0.5) / 6) * w, y + h / 2 - ((r + 0.5) / 4) * h, 0);
  for (const [r, c] of [[0, 0], [3, 5], [1, 4], [2, 0]]) {
    const hit = bay.pick(rayAt(tile(r, c)))!;
    expect([hit.plate.id, hit.row, hit.col]).toEqual(["b", r, c]);
    expect(hit.plate.describe(hit.row, hit.col)).toContain(Math.abs(r * 6 + c - 10).toFixed(3));
  }
  expect(bay.pick(rayAt(new THREE.Vector3(-30, 30, 0)))).toBeNull();
  expect(bay.labels().map((l) => l.id)).toEqual(["a", "b", "c", "d", "e"]);
  // New numbers of the same shape repaint in place; a different shape asks for a rebuild.
  const texture = ((bay.group.children.find((o) => (o as THREE.Mesh).material && ((o as THREE.Mesh).material as THREE.MeshBasicMaterial).map) as THREE.Mesh).material as THREE.MeshBasicMaterial).map as THREE.DataTexture;
  const before = Array.from(texture.image.data as Uint8Array);
  expect(bay.update(plates.map((p, i) => (i === 0 ? make("a", 0, 4, 6, values.map((v) => -v)) : p)))).toBe(true);
  expect(Array.from(texture.image.data as Uint8Array)).not.toEqual(before);
  // The texture's bottom row holds the data's last row.
  const first = make("a", 0, 4, 6, values.map((v) => -v));
  expect((texture.image.data as Uint8Array)[3 * 6 * 4]).toBe(Math.round(LIGHT.zero[0] + (LIGHT.pos[0] - LIGHT.zero[0]) * (Math.abs(first.values[0]) / first.scale) ** 0.7));
  expect(bay.update(plates.slice(0, 4))).toBe(false);
  expect(bay.update([...plates.slice(0, 4), make("e", 1, 2, 4, new Float32Array(8))])).toBe(false);
  let freed = 0;
  texture.addEventListener("dispose", () => { freed++; });
  bay.dispose();
  expect(freed).toBe(1);
});

it("frames a box completely for tall, square and wide stages", () => {
  const arch = buildArch(QWEN_INFO), box = new THREE.Box3(new THREE.Vector3(...arch.bounds.min), new THREE.Vector3(...arch.bounds.max));
  const dir = new THREE.Vector3(0.42, 0.26, 1).normalize(), v = new THREE.Vector3();
  for (const aspect of [0.55, 1, 1.6, 2.4]) {
    const { target, position } = frame(box, dir, 30, aspect);
    const camera = new THREE.PerspectiveCamera(30, aspect, 0.1, 600);
    camera.position.copy(position); camera.lookAt(target); camera.updateMatrixWorld(true); camera.updateProjectionMatrix();
    let extent = 0;
    for (let i = 0; i < 8; i++) {
      v.set(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z).project(camera);
      expect(Math.abs(v.x)).toBeLessThanOrEqual(1);
      expect(Math.abs(v.y)).toBeLessThanOrEqual(1);
      extent = Math.max(extent, Math.abs(v.x), Math.abs(v.y));
    }
    // And it is not framed from needlessly far away.
    expect(extent).toBeGreaterThan(0.7);
  }
});

it("frames the model inside the clear part of the view when the toolbar and labels take the rest", () => {
  const arch = buildArch(QWEN_INFO), box = new THREE.Box3(new THREE.Vector3(...arch.bounds.min), new THREE.Vector3(...arch.bounds.max));
  const dir = new THREE.Vector3(0.42, 0.26, 1).normalize(), v = new THREE.Vector3();
  for (const [aspect, inset] of [[1.3, { top: 0.3, bottom: 0.06, side: 0.04 }], [0.8, { top: 0.38, bottom: 0, side: 0.06 }], [2.2, { top: 0, bottom: 0.1, side: 0 }]] as const) {
    const { target, position, span } = frame(box, dir, 30, aspect, 1.08, inset);
    const camera = new THREE.PerspectiveCamera(30, aspect, 0.1, 600);
    camera.position.copy(position); camera.lookAt(target); camera.updateMatrixWorld(true); camera.updateProjectionMatrix();
    let top = -1, bottom = 1, side = 0;
    for (let i = 0; i < 8; i++) {
      v.set(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z).project(camera);
      top = Math.max(top, v.y); bottom = Math.min(bottom, v.y); side = Math.max(side, Math.abs(v.x));
    }
    // In view coordinates the top edge is +1: nothing of the model enters the reserved bands.
    expect(top).toBeLessThanOrEqual(1 - 2 * inset.top + 1e-6);
    expect(bottom).toBeGreaterThanOrEqual(-1 + 2 * inset.bottom - 1e-6);
    expect(side).toBeLessThanOrEqual(1 - 2 * inset.side + 1e-6);
    // The clear area is used, not just avoided, and the reported width matches what is drawn.
    expect(Math.max((top - bottom) / (2 - 2 * inset.top - 2 * inset.bottom), side / (1 - 2 * inset.side))).toBeGreaterThan(0.7);
    expect(span).toBeGreaterThan(side * 0.8);
    expect(span).toBeLessThanOrEqual(side + 1e-6);
  }
});

// ------------------------------------------------------------------ stage lifecycle with a fake renderer

function harness(arch: Arch, options: { hidden?: boolean; width?: number; coarse?: boolean; reduced?: boolean; reserved?: { left: number; top: number; width: number; height: number }[] } = {}) {
  const frames = new Map<number, (t: number) => void>();
  let id = 0;
  vi.stubGlobal("requestAnimationFrame", (f: (t: number) => void) => { frames.set(++id, f); return id; });
  vi.stubGlobal("cancelAnimationFrame", (k: number) => { frames.delete(k); });
  const observers: { disconnected: boolean; callback: (entries: unknown[]) => void }[] = [];
  class Observer { disconnected = false; constructor(public callback: (entries: unknown[]) => void) { observers.push(this); } observe() {} disconnect() { this.disconnected = true; } }
  vi.stubGlobal("ResizeObserver", Observer);
  vi.stubGlobal("IntersectionObserver", Observer);
  const element = () => {
    const listeners = new Map<string, Set<unknown>>();
    return { listeners, style: {} as Record<string, string>, className: "", textContent: "", hidden: false, removed: false, children: [] as unknown[],
      addEventListener(type: string, f: unknown) { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type)!.add(f); },
      removeEventListener(type: string, f: unknown) { listeners.get(type)?.delete(f); },
      setAttribute() {}, remove() { this.removed = true; }, append(child: unknown) { this.children.push(child); }, prepend(child: unknown) { this.children.unshift(child); },
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 400, height: 600 }), setPointerCapture() {}, releasePointerCapture() {} };
  };
  const canvas = element(), spans: ReturnType<typeof element>[] = [];
  const doc = { ...element(), hidden: options.hidden ?? false, createElement: (tag: string) => { if (tag === "canvas") return canvas; const s = element(); spans.push(s); return s; } };
  const host = { ...element(), ownerDocument: doc, clientWidth: options.width ?? 400, clientHeight: 600 };
  const labels = { ...element(), ownerDocument: doc }, tip = element();
  const renderer = { render: vi.fn(), dispose: vi.fn(), forceContextLoss: vi.fn(), setSize: vi.fn(), setPixelRatio: vi.fn(), setClearColor: vi.fn(), getPixelRatio: () => 1,
    shadowMap: { enabled: false, type: 0, autoUpdate: true, needsUpdate: false }, info: { render: { calls: 0, triangles: 0 } }, outputColorSpace: "", toneMapping: 0 };
  const controls = { enabled: true, target: new THREE.Vector3(), update: vi.fn(() => false), dispose: vi.fn(), addEventListener: vi.fn() };
  const events = { select: vi.fn(), punch: vi.fn(() => true), lost: vi.fn(), clock: vi.fn(), arranged: vi.fn() };
  const stage = new Stage({
    host: host as unknown as HTMLElement, labels: labels as unknown as HTMLElement, tip: tip as unknown as HTMLElement, arch, theme: LIGHT, reducedMotion: options.reduced ?? false, coarse: options.coarse ?? false, reserved: () => options.reserved ?? [],
    onSelect: events.select, onPunch: events.punch, describe: () => "part", onLost: events.lost, onClock: events.clock, onArranged: events.arranged,
    deps: { renderer: () => renderer as unknown as THREE.WebGLRenderer, controls: () => controls, environment: () => null },
  });
  let now = 0;
  const run = (n = 1) => { for (let i = 0; i < n; i++) { const pending = [...frames]; frames.clear(); now += 16; for (const [, f] of pending) f(now); } };
  const listening = () => [...canvas.listeners.values()].reduce((n, s) => n + s.size, 0) + [...doc.listeners.values()].reduce((n, s) => n + s.size, 0);
  return { stage, frames, run, renderer, controls, canvas, doc, host, spans, observers, events, listening, tip };
}

beforeEach(() => { vi.stubGlobal("devicePixelRatio", 3); });
afterEach(() => vi.unstubAllGlobals());

it("renders only when something changed, and stops asking for frames when idle", () => {
  const h = harness(buildArch(TINY_INFO));
  expect(h.renderer.setPixelRatio).toHaveBeenCalledWith(2);
  // The shadow filter is one this Three.js release still has.
  expect(h.renderer.shadowMap.type).toBe(THREE.PCFShadowMap);
  expect(THREE.PCFShadowMap).not.toBe(THREE.PCFSoftShadowMap);
  expect(h.frames.size).toBe(1);
  h.run(6);
  const first = h.renderer.render.mock.calls.length;
  expect(first).toBeGreaterThan(0);
  expect(h.frames.size).toBe(0);
  // Idle: no frames are scheduled and nothing is drawn, however long we wait.
  h.run(50);
  expect(h.renderer.render.mock.calls.length).toBe(first);
  // New data asks for exactly as many frames as it takes to draw it.
  h.stage.setValues(null, "signed");
  expect(h.frames.size).toBe(1);
  h.run(4);
  expect(h.renderer.render.mock.calls.length).toBe(first + 1);
  expect(h.frames.size).toBe(0);
  // A real change animates until its spring settles, then stops.
  h.stage.setPoses(buildArch(TINY_INFO).parts.map((p) => poseOf({ floors: [{ floor: 1, mult: 0 }] }, p, TINY_INFO)));
  h.run(400);
  expect(h.renderer.render.mock.calls.length).toBeGreaterThan(first + 10);
  expect(h.frames.size).toBe(0);
  expect(h.stage.specimen.settled).toBe(true);
  h.stage.dispose();
  // A phone skips the shadow pass and gets a lower pixel ratio; it must go idle just the same.
  const phone = harness(buildArch(TINY_INFO), { coarse: true });
  expect(phone.renderer.setPixelRatio).toHaveBeenCalledWith(1.5);
  expect(phone.renderer.shadowMap.enabled).toBe(false);
  phone.run(6);
  phone.stage.setBay({ key: "k", floor: 0, plates: [], message: "Waiting" });
  phone.run(400);
  expect(phone.frames.size).toBe(0);
  expect(phone.stage.specimen.settled).toBe(true);
  expect(phone.renderer.shadowMap.needsUpdate).toBe(false);
  const drawn = phone.renderer.render.mock.calls.length;
  phone.run(40);
  expect(phone.renderer.render.mock.calls.length).toBe(drawn);
  phone.stage.dispose();
});

it("runs the replay clock to the end, reports it, and then goes idle", () => {
  const arch = buildArch(TINY_INFO), h = harness(arch), beats = beatCount(TINY_INFO);
  h.run(4);
  h.stage.setClock({ t: 0, playing: true, speed: 4 });
  h.run(2000);
  const last = h.events.clock.mock.calls.at(-1)![0];
  expect(last).toEqual({ t: beats, playing: false, speed: 4 });
  expect(h.events.clock.mock.calls.length).toBeGreaterThan(beats);
  expect(h.events.clock.mock.calls.map((c) => c[0].t)).toEqual([...h.events.clock.mock.calls.map((c) => c[0].t)].sort((a, b) => a - b));
  expect(h.frames.size).toBe(0);
  // Scrubbing while paused draws one frame and emits nothing.
  h.events.clock.mockClear();
  h.stage.setClock({ t: 3.5, playing: false, speed: 1 });
  h.run(5);
  expect(h.events.clock).not.toHaveBeenCalled();
  expect(h.frames.size).toBe(0);
  h.stage.dispose();
});

it("keeps every label it shows inside the view, off the toolbar and apart from the others", () => {
  const reserved = [{ left: 8, top: 8, width: 190, height: 40 }, { left: 122, top: 8, width: 190, height: 40 }, { left: 8, top: 54, width: 304, height: 46 }];
  for (const [arch, width] of [[buildArch(QWEN_INFO), 320], [buildArch(QWEN_INFO), 520], [buildArch(TINY_INFO), 390]] as const) {
    const h = harness(arch, { width, reserved });
    h.stage.setTray(Array.from({ length: 16 }, (_, i) => ({ label: `token${i}`, weight: 0.05 })), 15, 9, null);
    h.stage.setCandidates([{ label: "Paris", p: 0.8, chosen: true }, { label: "London", p: 0.1, chosen: false }, { label: "Rome", p: 0.05, chosen: false }]);
    h.stage.setSelection({ kind: "layer", floor: 2 });
    h.stage.setBay({ key: "k", floor: 2, plates: [], message: "Measuring every step for this token…" });
    h.run(400);
    const boxes = h.spans.filter((s) => !s.removed && !s.hidden && s.style.transform).map((s) => {
      const [, x, y] = /translate\(([-\d.]+)px, ([-\d.]+)px\)/.exec(s.style.transform)!;
      return { text: s.textContent, left: Number(x), top: Number(y), width: s.textContent.length * 6.2 + 8, height: 14 };
    });
    // The words that matter are among them.
    for (const need of ["Words in", "Words out", "token15", "Paris 80%"]) expect(boxes.map((b) => b.text)).toContain(need);
    for (const a of boxes) {
      expect(a.left).toBeGreaterThanOrEqual(0);
      expect(a.left + a.width).toBeLessThanOrEqual(width);
      expect(a.top).toBeGreaterThanOrEqual(0);
      expect(a.top + a.height).toBeLessThanOrEqual(600);
      for (const r of reserved) expect(a.left < r.left + r.width && r.left < a.left + a.width && a.top < r.top + r.height && r.top < a.top + a.height).toBe(false);
      for (const b of boxes) if (a !== b) expect(a.left < b.left + b.width && b.left < a.left + a.width && a.top < b.top + b.height && b.top < a.top + a.height).toBe(false);
    }
    // The toolbar covers the top of this narrow stage, so the model itself is framed below it.
    const camera = (h.stage as unknown as { camera: THREE.PerspectiveCamera }).camera, v = new THREE.Vector3();
    camera.updateMatrixWorld(true);
    let highest = Infinity;
    for (let i = 0; i < 8; i++) {
      v.set(i & 1 ? arch.bounds.max[0] : arch.bounds.min[0], i & 2 ? arch.bounds.max[1] : arch.bounds.min[1], i & 4 ? arch.bounds.max[2] : arch.bounds.min[2]).project(camera);
      highest = Math.min(highest, (-v.y * 0.5 + 0.5) * 600);
    }
    expect(highest).toBeGreaterThanOrEqual(100);
    h.stage.dispose();
  }
});

it("follows the replay through the selected layer's plates and a reduced-motion change made while open", () => {
  const arch = buildArch(TINY_INFO), h = harness(arch), floor = 1;
  const make = (id: string, phase: "attention" | "mlp") => ({ ...plate({ id, title: id, band: phase === "mlp" ? 1 : 0, rows: 2, cols: 2, data: [1, 2, 3, 4] }), phase });
  const plates = [make("x", "attention"), make("q", "attention"), make("probs", "attention"), make("o", "attention"), make("gate", "mlp"), make("mem", "mlp")];
  h.stage.setBay({ key: "layer", floor, plates });
  const levels = () => (h.stage as unknown as { bay: Bay }).bay.levels().map((v) => +v.toFixed(3));
  // Complete replay: every measured plate is shown.
  expect(levels()).toEqual([1, 1, 1, 1, 1, 1]);
  // Before this layer's attention beat nothing of it has been computed.
  h.stage.setClock({ t: 1 + 2 * floor, playing: false, speed: 1 });
  expect(levels()).toEqual([0.2, 0.2, 0.2, 0.2, 0.2, 0.2]);
  // Half way through attention: the first two of its four plates, in order. The MLP has not started.
  h.stage.setClock({ t: 1 + 2 * floor + 0.5, playing: false, speed: 1 });
  expect(levels()).toEqual([1, 1, 0.2, 0.2, 0.2, 0.2]);
  h.stage.setClock({ t: 2 + 2 * floor + 0.5, playing: false, speed: 1 });
  expect(levels()).toEqual([1, 1, 1, 1, 1, 0.2]);
  // New numbers for the same plates keep their place in the replay.
  h.stage.setBay({ key: "layer", floor, plates: plates.map((p) => ({ ...p })) });
  expect(levels()).toEqual([1, 1, 1, 1, 1, 0.2]);
  // Reduced motion switched on mid-replay: whole steps from now on, and parts stop springing.
  h.stage.setReducedMotion(true);
  expect(levels()).toEqual([1, 1, 1, 1, 0.2, 0.2]);
  const i = partIndex(arch, { kind: "head", floor: 0, head: 0 }), rest = h.stage.specimen.center(i, new THREE.Vector3()).clone();
  h.stage.setPoses(arch.parts.map((p) => poseOf({ heads: [{ floor: 0, head: 0, mult: 0 }] }, p, TINY_INFO)));
  expect(h.stage.specimen.center(i, new THREE.Vector3()).z).toBeLessThan(rest.z - 0.5);
  expect(h.stage.specimen.settled).toBe(true);
  // And switched off again: the next change animates.
  h.stage.setReducedMotion(false);
  h.stage.setPoses(arch.parts.map((p) => poseOf({}, p, TINY_INFO)));
  expect(h.stage.specimen.settled).toBe(false);
  h.stage.setClock({ t: beatCount(TINY_INFO), playing: false, speed: 1 });
  expect(levels()).toEqual([1, 1, 1, 1, 1, 1]);
  h.stage.dispose();
});

it("does not draw while hidden or collapsed to nothing", () => {
  const hidden = harness(buildArch(TINY_INFO), { hidden: true });
  hidden.stage.setValues(null, "signed");
  hidden.run(10);
  expect(hidden.renderer.render).not.toHaveBeenCalled();
  // Coming back draws again.
  hidden.doc.hidden = false;
  for (const f of hidden.doc.listeners.get("visibilitychange")!) (f as () => void)();
  hidden.run(3);
  expect(hidden.renderer.render).toHaveBeenCalled();
  hidden.stage.dispose();
  const empty = harness(buildArch(TINY_INFO), { width: 0 });
  empty.stage.invalidate();
  empty.run(10);
  expect(empty.renderer.render).not.toHaveBeenCalled();
  expect(empty.renderer.setSize).not.toHaveBeenCalled();
  empty.stage.dispose();
});

it("selects on click, punches once per click in Punch, and reports a refused punch without moving the model", () => {
  const arch = buildArch(TINY_INFO), h = harness(arch);
  h.run(4);
  const fire = (type: string, e: Record<string, unknown>) => { for (const f of [...(h.canvas.listeners.get(type) ?? [])]) (f as (e: unknown) => void)({ isPrimary: true, button: 0, pointerId: 1, pointerType: "mouse", buttons: 0, type, preventDefault() {}, ...e }); };
  // The centre of the canvas looks at the middle of the specimen; find a head by projecting it.
  const part: Part = { kind: "head", floor: 2, head: 1 }, i = partIndex(arch, part);
  const camera = (h.stage as unknown as { camera: THREE.PerspectiveCamera }).camera;
  camera.updateMatrixWorld(true);
  const p = h.stage.specimen.center(i, new THREE.Vector3()).project(camera);
  const at = { clientX: (p.x * 0.5 + 0.5) * 400, clientY: (-p.y * 0.5 + 0.5) * 600 };
  fire("pointerdown", at); fire("pointerup", at);
  expect(h.events.select).toHaveBeenLastCalledWith(part);
  expect(h.events.punch).not.toHaveBeenCalled();
  // A drag is the camera's, not a click.
  h.events.select.mockClear();
  fire("pointerdown", at); fire("pointerup", { clientX: at.clientX + 40, clientY: at.clientY });
  expect(h.events.select).not.toHaveBeenCalled();
  h.stage.setTool("punch");
  fire("pointerdown", at); fire("pointerup", at);
  expect(h.events.punch).toHaveBeenCalledTimes(1);
  expect(h.events.punch).toHaveBeenCalledWith(part);
  expect(h.stage.specimen.settled).toBe(false);
  h.run(400);
  // The page refused (model busy): the part shakes and returns to exactly where it was.
  const rest = h.stage.specimen.center(i, new THREE.Vector3()).clone();
  h.events.punch.mockReturnValueOnce(false);
  fire("pointerdown", at); fire("pointerup", at);
  h.run(400);
  expect(h.stage.specimen.center(i, new THREE.Vector3()).distanceTo(rest)).toBeLessThan(1e-5);
  // Grab moves the part with the pointer and never calls the model.
  h.events.punch.mockClear();
  h.stage.setTool("grab");
  fire("pointerdown", at);
  expect(h.controls.enabled).toBe(false);
  fire("pointermove", { clientX: at.clientX + 60, clientY: at.clientY - 30, buttons: 1 });
  fire("pointerup", { clientX: at.clientX + 60, clientY: at.clientY - 30 });
  expect(h.controls.enabled).toBe(true);
  expect(h.events.arranged).toHaveBeenLastCalledWith(1);
  expect(h.events.punch).not.toHaveBeenCalled();
  h.run(400);
  expect(h.stage.specimen.center(i, new THREE.Vector3()).distanceTo(rest)).toBeGreaterThan(0.2);
  h.stage.resetLayout();
  h.run(400);
  expect(h.events.arranged).toHaveBeenLastCalledWith(0);
  expect(h.stage.specimen.center(i, new THREE.Vector3()).distanceTo(rest)).toBeLessThan(1e-5);
  h.stage.dispose();
});

it("stops cleanly when the WebGL context is lost", () => {
  const h = harness(buildArch(TINY_INFO));
  h.run(3);
  h.stage.setValues(null, "signed");
  const prevented = vi.fn();
  for (const f of h.canvas.listeners.get("webglcontextlost")!) (f as (e: unknown) => void)({ preventDefault: prevented });
  expect(prevented).toHaveBeenCalled();
  expect(h.events.lost).toHaveBeenCalledTimes(1);
  expect(h.frames.size).toBe(0);
  const drawn = h.renderer.render.mock.calls.length;
  h.stage.invalidate();
  h.run(10);
  expect(h.renderer.render.mock.calls.length).toBe(drawn);
  expect(() => h.stage.dispose()).not.toThrow();
});

it("releases its listeners, observers, frames, DOM and GPU context on dispose", () => {
  const arch = buildArch(TINY_INFO), h = harness(arch);
  h.stage.setTray([{ label: "a", weight: 0.5 }, { label: "b", weight: 0.5 }], 1, 7, { kind: "head", floor: 0, head: 0 });
  h.stage.setCandidates([{ label: "x", p: 0.9, chosen: true }]);
  h.stage.setBay({ key: "k", floor: 1, plates: [plate({ id: "a", title: "A", band: 0, rows: 2, cols: 2, data: [1, 2, 3, 4] })] });
  h.stage.setClock({ t: 0, playing: true, speed: 1 });
  expect(h.listening()).toBeGreaterThanOrEqual(7);
  expect(h.frames.size).toBe(1);
  expect(h.spans.length).toBeGreaterThan(arch.floors + 4);
  expect(h.host.children[0]).toBe(h.canvas);
  h.stage.dispose();
  expect(h.listening()).toBe(0);
  expect(h.frames.size).toBe(0);
  expect(h.observers).toHaveLength(2);
  expect(h.observers.every((o) => o.disconnected)).toBe(true);
  expect(h.controls.dispose).toHaveBeenCalledTimes(1);
  expect(h.renderer.dispose).toHaveBeenCalledTimes(1);
  expect(h.renderer.forceContextLoss).toHaveBeenCalledTimes(1);
  expect(h.canvas.removed).toBe(true);
  expect(h.spans.every((s) => s.removed)).toBe(true);
  expect(h.tip.hidden).toBe(true);
  expect(h.stage.specimen.group.children).toHaveLength(0);
  // A second dispose, or late calls from a finished effect, do nothing.
  h.stage.dispose();
  h.stage.invalidate();
  expect(h.frames.size).toBe(0);
  expect(h.renderer.dispose).toHaveBeenCalledTimes(1);
});

it("refuses to start without WebGL, leaving nothing behind", () => {
  const frames: unknown[] = [];
  vi.stubGlobal("requestAnimationFrame", (f: unknown) => frames.push(f));
  const canvas = { removed: false, className: "", setAttribute() {}, remove() { this.removed = true; } };
  const host = { ownerDocument: { createElement: () => canvas }, prepend() {} };
  expect(() => new Stage({ host: host as unknown as HTMLElement, labels: host as unknown as HTMLElement, tip: host as unknown as HTMLElement, arch: buildArch(TINY_INFO), theme: LIGHT,
    reducedMotion: false, coarse: false, onSelect() {}, onPunch: () => false, describe: () => "", onLost() {}, onClock() {}, onArranged() {},
    deps: { renderer: () => { throw new Error("Error creating WebGL context."); } } })).toThrow(/WebGL/);
  expect(canvas.removed).toBe(true);
  expect(frames).toHaveLength(0);
});
