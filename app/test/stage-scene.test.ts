// The 3D scene without a GPU: Three.js geometry, instancing and ray casting run in Node, and the
// stage's renderer and controls are replaced by recording fakes.
import * as THREE from "three";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { QWEN_INFO, TINY_INFO } from "../src/model/info.ts";
import { plate } from "../src/stage/adapters.ts";
import { type Arch, buildArch, type Part, partIndex } from "../src/stage/arch.ts";
import { poseOf } from "../src/stage/intervene.ts";
import { beatCount } from "../src/stage/playback.ts";
import { fadeMs, ReplayController } from "../src/stage/replay.ts";
import { Bay, layoutPlates, plateSize } from "../src/stage/scene/bay.ts";
import { along, VIEWS } from "../src/stage/scene/camera.ts";
import { fasciaHeight } from "../src/stage/scene/detail.ts";
import { Specimen } from "../src/stage/scene/specimen.ts";
import { frame, Stage } from "../src/stage/scene/stage.ts";
import { brushedPixels, nameplatePixels, NAMEPLATES, tracePixels } from "../src/stage/scene/textures.ts";
import { DARK, LIGHT } from "../src/stage/theme.ts";

const settle = (s: Specimen) => { for (let i = 0; i < 2000 && s.step(1 / 60); i++); expect(s.settled).toBe(true); };
const rayAt = (target: THREE.Vector3, from = new THREE.Vector3(0, 0, 40)) => new THREE.Raycaster(target.clone().add(from), from.clone().negate().normalize());
const instanced = (s: Specimen) => s.group.children.filter((o): o is THREE.InstancedMesh => (o as THREE.InstancedMesh).isInstancedMesh);

it("draws the whole model in a fixed, small number of draw calls", () => {
  for (const [model, heads] of [[QWEN_INFO, 448], [TINY_INFO, 16]] as const) {
    const s = new Specimen(buildArch(model), LIGHT, { shadows: false });
    // 448 heads and 28 MLPs are instances, not meshes: the budget does not grow with the model. Each kind of
    // part is a handful of instanced pieces (body, gold, lit insert, cover glass), one draw call apiece.
    expect(s.drawCalls).toBeLessThanOrEqual(50);
    const counts = instanced(s).map((m) => m.count);
    expect(counts.filter((c) => c === heads).length).toBeGreaterThanOrEqual(2);
    expect(counts).toContain(model.floors);
    expect(counts).toContain(model.floors * model.kvHeads);
    expect(counts.reduce((a, b) => a + b, 0)).toBeLessThan(model.floors * 130 + 400);
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

function harness(arch: Arch, options: { hidden?: boolean; width?: number; height?: number; coarse?: boolean; reduced?: boolean; reserved?: { left: number; top: number; width: number; height: number }[]; describe?: () => string } = {}) {
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
      /** How the element was styled each time its size was read, for labels that are measured before they may be seen. */
      measured: [] as string[],
      get offsetWidth() { this.measured.push(`${this.style.visibility ?? ""}|${this.hidden}`); return 0; },
      addEventListener(type: string, f: unknown) { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type)!.add(f); },
      removeEventListener(type: string, f: unknown) { listeners.get(type)?.delete(f); },
      setAttribute() {}, remove() { this.removed = true; }, append(child: unknown) { this.children.push(child); }, prepend(child: unknown) { this.children.unshift(child); },
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 400, height: 600 }), setPointerCapture() {}, releasePointerCapture() {} };
  };
  const canvas = element(), spans: ReturnType<typeof element>[] = [];
  const doc = { ...element(), hidden: options.hidden ?? false, createElement: (tag: string) => { if (tag === "canvas") return canvas; const s = element(); spans.push(s); return s; } };
  const host = { ...element(), ownerDocument: doc, clientWidth: options.width ?? 400, clientHeight: options.height ?? 600 };
  const labels = { ...element(), ownerDocument: doc }, tip = element();
  const renderer = { render: vi.fn(), dispose: vi.fn(), forceContextLoss: vi.fn(), setSize: vi.fn(), setPixelRatio: vi.fn(), setClearColor: vi.fn(), getPixelRatio: () => 1,
    shadowMap: { enabled: false, type: 0, autoUpdate: true, needsUpdate: false }, info: { render: { calls: 0, triangles: 0 } }, outputColorSpace: "", toneMapping: 0 };
  const controls = { enabled: true, enableRotate: true, mouseButtons: { LEFT: THREE.MOUSE.ROTATE as number }, touches: { ONE: THREE.TOUCH.ROTATE as number }, target: new THREE.Vector3(), update: vi.fn(() => false), dispose: vi.fn(),
    addEventListener: vi.fn<(type: string, f: () => void) => void>() };
  const environment = { texture: new THREE.Texture(), dispose: vi.fn() };
  const events = { select: vi.fn(), punch: vi.fn(() => true), lost: vi.fn(), hidden: vi.fn(), arranged: vi.fn() };
  const stage = new Stage({
    host: host as unknown as HTMLElement, labels: labels as unknown as HTMLElement, tip: tip as unknown as HTMLElement, arch, theme: LIGHT, reducedMotion: options.reduced ?? false, coarse: options.coarse ?? false, reserved: () => options.reserved ?? [],
    onSelect: events.select, onPunch: events.punch, describe: options.describe ?? (() => "part"), onLost: events.lost, onHidden: events.hidden, onArranged: events.arranged,
    deps: { renderer: () => renderer as unknown as THREE.WebGLRenderer, controls: () => controls, environment: () => environment },
  });
  let now = 0;
  const run = (n = 1, ms = 16) => { for (let i = 0; i < n; i++) { const pending = [...frames]; frames.clear(); now += ms; for (const [, f] of pending) f(now); } };
  const listening = () => [...canvas.listeners.values()].reduce((n, s) => n + s.size, 0) + [...doc.listeners.values()].reduce((n, s) => n + s.size, 0);
  const inner = stage as unknown as { camera: THREE.PerspectiveCamera; scene: THREE.Scene };
  /** A pointer event on the canvas. A plain left mouse button unless said otherwise. */
  const fire = (type: string, e: Record<string, unknown>) => { for (const f of [...(canvas.listeners.get(type) ?? [])]) (f as (e: unknown) => void)({ isPrimary: true, button: 0, pointerId: 1, pointerType: "mouse", buttons: 0, type, preventDefault() {}, ...e }); };
  const click = (at: { clientX: number; clientY: number }, e: Record<string, unknown> = {}) => { fire("pointerdown", { ...at, ...e }); fire("pointerup", { ...at, ...e }); };
  /** Where a point of the model is on the canvas. */
  const screen = (v: THREE.Vector3) => { inner.camera.updateMatrixWorld(true); const p = v.clone().project(inner.camera); return { clientX: (p.x * 0.5 + 0.5) * 400, clientY: (-p.y * 0.5 + 0.5) * 600 }; };
  /** The visitor takes the camera: what the orbit controls report when a drag, wheel or pinch begins. */
  const takeCamera = () => { for (const [type, f] of controls.addEventListener.mock.calls) if (type === "start") f(); };
  const looking = () => inner.camera.position.clone().sub(controls.target).normalize();
  return { stage, frames, run, renderer, controls, canvas, doc, host, spans, observers, events, listening, tip, environment, camera: inner.camera, scene: inner.scene, fire, click, screen, takeCamera, looking };
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

/** A reply of `tokens` tokens that is finished and stays as it is, for the real replay controller. */
function replayOf(tokens: number, beats: number) {
  let at = 0;
  return new ReplayController({ beats: () => beats, subject: () => ({ epoch: "m", reply: "r", tokens, at, ready: true }), select: (i) => { at = i; } });
}

it("lends the replay its frames: one step at most per frame, drawn only as a step lights up, idle once it ends", () => {
  const arch = buildArch(TINY_INFO), h = harness(arch), beats = beatCount(TINY_INFO), replay = replayOf(2, beats);
  const playhead = () => h.stage.specimen.playheadNow;
  replay.subscribe(() => { const r = replay.get(); h.stage.setPlayhead(r.mode === "replay" ? r.step : null, fadeMs(r.speed)); });
  h.stage.setDriver(replay);
  h.run(4);
  expect(h.frames.size).toBe(0);
  replay.setSpeed("fast");
  expect(replay.enter("answer")).toBe(true);
  // The first step is on screen at once, and the stage is awake without anything else asking for a frame.
  expect(playhead()).toBe(1);
  expect(h.frames.size).toBe(1);
  let frames = 0, most = 0, last = replay.get();
  const drawn = h.renderer.render.mock.calls.length, seen: number[] = [];
  while (replay.get().mode === "replay" && !replay.get().ended && frames < 5000) {
    // Now and then a frame arrives very late, as after a stall. It still moves one step.
    h.run(1, frames % 37 === 36 ? 60_000 : 16);
    frames++;
    const now = replay.get(), moved = now.token === last.token ? now.step - last.step : now.token - last.token;
    most = Math.max(most, moved);
    // A token is only left after it was shown whole.
    if (now.token !== last.token) { expect(last.step).toBe(beats); expect(now.step).toBe(1); }
    seen.push(playhead() ?? beats);
    last = now;
  }
  expect(replay.get()).toMatchObject({ ended: true, playing: false, token: 1, step: beats });
  expect(most).toBe(1);
  // The drawn playhead never runs ahead of the step it was asked for, and reaches every step.
  expect(Math.max(...seen)).toBe(beats);
  for (let n = 2; n < beats; n++) expect(seen).toContain(n);
  // Most frames between steps draw nothing: the GPU is free for the camera.
  const draws = h.renderer.render.mock.calls.length - drawn;
  expect(draws).toBeGreaterThan(2 * beats);
  expect(draws).toBeLessThan(frames * 0.8);
  // Ended: no loop, and no frames left running.
  h.run(5);
  expect(h.frames.size).toBe(0);
  expect(replay.get().ended).toBe(true);
  // A scrub while paused draws and goes idle again.
  const before = h.renderer.render.mock.calls.length;
  replay.seek(3);
  expect(playhead()).toBe(3);
  h.run(5);
  expect(h.renderer.render.mock.calls.length).toBe(before + 1);
  expect(h.frames.size).toBe(0);
  h.stage.dispose();
});

it("lights one step up gradually, never past it, and at once under reduced motion", () => {
  const h = harness(buildArch(TINY_INFO)), playhead = () => h.stage.specimen.playheadNow!;
  h.run(4);
  h.stage.setPlayhead(3);
  expect(playhead()).toBe(3);
  h.stage.setPlayhead(4, 140);
  expect(playhead()).toBe(3);
  const rising: number[] = [];
  for (let i = 0; i < 12; i++) { h.run(); rising.push(playhead()); }
  expect(rising[0]).toBeGreaterThan(3);
  expect(rising[0]).toBeLessThan(4);
  expect(rising).toEqual([...rising].sort((a, b) => a - b));
  expect(rising.at(-1)).toBe(4);
  expect(h.frames.size).toBe(0);
  // Back a step, several steps on, or another token: shown at once.
  h.stage.setPlayhead(3, 140);
  expect(playhead()).toBe(3);
  h.stage.setPlayhead(7, 140);
  expect(playhead()).toBe(7);
  h.stage.setPlayhead(null, 140);
  expect(h.stage.specimen.playheadNow).toBeNull();
  h.stage.setReducedMotion(true);
  h.stage.setPlayhead(2);
  h.stage.setPlayhead(3, 140);
  expect(playhead()).toBe(3);
  h.stage.dispose();
});

it("brackets and names the step a replay is at, as a position only, and keeps selection, guide marks, colors and camera as they were", () => {
  const arch = buildArch(TINY_INFO), h = harness(arch), beats = beatCount(TINY_INFO), sp = h.stage.specimen;
  const inner = sp as unknown as { stepBox: THREE.Object3D; selectBox: THREE.Object3D; markBox: THREE.Object3D; headGlow: THREE.InstancedMesh; mlpGlow: THREE.InstancedMesh };
  const label = () => h.spans.filter((x) => x.className === "stage-label step" && !x.removed).map((x) => x.textContent);
  const box = () => sp.cursorBox(new THREE.Box3())!;
  const at = (part: Part) => sp.center(partIndex(arch, part), new THREE.Vector3());
  const values = Float32Array.from({ length: arch.parts.length }, (_, i) => ((i % 5) - 2) / 2);
  h.stage.setValues(values, "signed");
  h.stage.setSelection({ kind: "mlp", floor: 2 });
  h.stage.setMarked({ kind: "head", floor: 3, head: 1 });
  h.run(60);
  // Live: no bracket and no label.
  expect(sp.cursorNow).toBeNull();
  expect(inner.stepBox.visible).toBe(false);
  expect(label()).toEqual([]);
  const camera = h.camera.position.clone(), colors = () => [...inner.headGlow.instanceColor!.array, ...inner.mlpGlow.instanceColor!.array];

  // First step: the dictionary.
  h.stage.setPlayhead(1);
  expect(sp.cursorNow).toBe(0);
  expect(inner.stepBox.visible).toBe(true);
  expect(label()).toEqual(["Read the token"]);
  expect(box().containsPoint(at({ kind: "embed" }))).toBe(true);
  expect(box().containsPoint(at({ kind: "mlp", floor: 0 }))).toBe(false);
  // A layer's attention step brackets that layer's heads and the sockets they share, and nothing else.
  const floor = 2;
  h.stage.setPlayhead(2 + 2 * floor);
  expect(label()).toEqual([`Layer ${floor + 1} · attention`]);
  for (let head = 0; head < arch.heads; head++) expect(box().containsPoint(at({ kind: "head", floor, head }))).toBe(true);
  expect(box().containsPoint(at({ kind: "mlp", floor }))).toBe(false);
  expect(box().containsPoint(at({ kind: "head", floor: floor + 1, head: 0 }))).toBe(false);
  expect(box().containsPoint(at({ kind: "head", floor: floor - 1, head: 0 }))).toBe(false);
  // Its MLP step brackets the MLP alone.
  h.stage.setPlayhead(3 + 2 * floor);
  expect(label()).toEqual([`Layer ${floor + 1} · MLP`]);
  expect(box().containsPoint(at({ kind: "mlp", floor }))).toBe(true);
  expect(box().containsPoint(at({ kind: "head", floor, head: 0 }))).toBe(false);
  // The bracket is where the replay is, whatever was measured there: the same place with other numbers or none.
  const bracket = box().clone();
  h.stage.setValues(values.map((v) => -v), "signed");
  expect(box().equals(bracket)).toBe(true);
  h.stage.setValues(null, "signed");
  expect(box().equals(bracket)).toBe(true);
  h.stage.setValues(values, "signed");
  // And it lights nothing itself: every window has the color the playhead alone gives it.
  const lit = colors();
  sp.setCursor(null);
  expect(colors()).toEqual(lit);
  sp.setCursor(2 + 2 * floor);
  expect(colors()).toEqual(lit);
  // A step lighting up gradually is bracketed from its first frame.
  h.stage.setPlayhead(4 + 2 * floor, 140);
  expect(sp.playheadNow).toBe(3 + 2 * floor);
  expect(label()).toEqual([`Layer ${floor + 2} · attention`]);
  // The last step: the token is whole, and the bracket stays on the output for as long as the replay holds it.
  h.stage.setPlayhead(beats);
  expect(sp.playheadNow).toBeNull();
  expect(sp.cursorNow).toBe(beats - 1);
  expect(label()).toEqual(["Choose the next token"]);
  expect(box().containsPoint(at({ kind: "unembed" }))).toBe(true);
  // The selection and the guide mark are untouched, and the camera did not move for any of it.
  expect(inner.selectBox.visible).toBe(true);
  expect(inner.markBox.visible).toBe(true);
  h.run(30);
  expect(h.camera.position.distanceTo(camera)).toBeLessThan(1e-9);
  // It follows the drawing when the layers are spread apart.
  h.stage.setPlayhead(2 + 2 * floor);
  const low = box().min.y;
  h.takeCamera();
  h.stage.setSpread(1);
  h.run(400);
  expect(box().min.y).toBeGreaterThan(low + 0.5);
  expect(box().containsPoint(at({ kind: "head", floor, head: 0 }))).toBe(true);
  // Back to live: gone, with its label.
  h.stage.setPlayhead(null);
  expect(inner.stepBox.visible).toBe(false);
  expect(label()).toEqual([]);
  h.stage.dispose();

  // Reduced motion keeps the bracket as a still position cue.
  const still = harness(arch, { reduced: true });
  still.stage.setValues(values, "signed");
  still.stage.setPlayhead(3, 140);
  expect(still.stage.specimen.cursorNow).toBe(2);
  expect((still.stage.specimen as unknown as { stepBox: THREE.Object3D }).stepBox.visible).toBe(true);
  expect(still.spans.filter((x) => x.className === "stage-label step" && !x.removed).map((x) => x.textContent)).toEqual(["Layer 1 · MLP"]);
  still.stage.dispose();
});

it("shows the output of a replayed token only after its last step: no bar, no word and no number before it", () => {
  for (const info of [TINY_INFO, QWEN_INFO]) {
    const arch = buildArch(info), h = harness(arch), beats = beatCount(info), sp = h.stage.specimen;
    const bars = () => (sp as unknown as { bars: THREE.InstancedMesh }).bars.count;
    /** Output labels on screen after a drawn frame: the candidate words with their numbers, or the waiting note. The fake renderer does not update the camera, so the test does. */
    const labels = () => h.spans.filter((x) => x.className.startsWith("stage-label bar") && !x.removed && !x.hidden).map((x) => x.textContent);
    const output = () => { h.camera.updateMatrixWorld(true); h.stage.invalidate(); h.run(2); return labels(); };
    const first = [{ label: "Paris", p: 0.62, chosen: true }, { label: "London", p: 0.2, chosen: false }, { label: "Rome", p: 0.004, chosen: false }];
    const second = [{ label: "is", p: 0.99996, chosen: true }, { label: "was", p: 0.00002, chosen: false }];
    h.run(120);
    // Live: the result is on show the moment its data arrives, with the model's probabilities as given.
    h.stage.setCandidates(first);
    expect(bars()).toBe(3);
    // Before any frame is drawn: each new label was measured laid out but unpainted, and is hidden until a frame places it.
    const fresh = h.spans.filter((x) => x.className.startsWith("stage-label bar") && !x.removed);
    expect(fresh.map((x) => x.textContent)).toEqual(["Paris 62.00%", "London 20.00%", "Rome 0.40%", "Not chosen yet"]);
    for (const x of fresh) {
      expect(x.measured).toEqual(["hidden|false"]);
      expect(x.hidden).toBe(true);
      expect(x.style.visibility).toBe("");
    }
    expect(labels()).toEqual([]);
    expect(output()).toContain("Paris 62.00%");
    expect(output()).not.toContain("Not chosen yet");
    // A replay starts: every step before the last shows nothing of the result, the written word included.
    for (const step of [1, 2, Math.floor(beats / 2), beats - 1]) {
      h.stage.setPlayhead(step);
      expect(bars()).toBe(0);
      expect(output()).toEqual(["Not chosen yet"]);
    }
    // The last step lighting up: still nothing, at any point of it. No bar grows toward its value.
    h.stage.setPlayhead(beats, 140);
    expect(sp.playheadNow).toBe(beats - 1);
    expect(bars()).toBe(0);
    for (let i = 0; i < 6; i++) {
      h.run();
      if (sp.playheadNow !== null) { expect(bars()).toBe(0); expect(labels()).toEqual(["Not chosen yet"]); }
    }
    // Done: the exact result, whole, with its real numbers.
    h.run(20);
    expect(sp.playheadNow).toBeNull();
    expect(bars()).toBe(3);
    expect(output()).toContain("Paris 62.00%");
    expect(output()).not.toContain("Not chosen yet");
    const top = sp.barTop(0, new THREE.Vector3()).y, base = sp.barTop(1, new THREE.Vector3()).y;
    expect(top - base).toBeCloseTo((0.62 - 0.2) * arch.barRoom, 4);
    // Scrubbing back hides it again at once, and forward to the end shows it again.
    expect(labels()).toContain("Paris 62.00%");
    h.stage.setPlayhead(beats - 3);
    // In the same call, before any frame: the words and numbers are already off.
    expect(labels().filter((t) => t !== "Not chosen yet")).toEqual([]);
    expect(bars()).toBe(0);
    expect(output()).toEqual(["Not chosen yet"]);
    h.stage.setPlayhead(beats);
    expect(bars()).toBe(3);
    // The replay goes on to the next token: back to its first step, and that token's data arrives afterwards. Nothing of either shows.
    h.stage.setPlayhead(1);
    h.stage.holdOutput();
    h.stage.setCandidates(second);
    expect(bars()).toBe(0);
    expect(output()).toEqual(["Not chosen yet"]);
    h.stage.setPlayhead(beats);
    expect(output()).toContain("is >99.99%");
    // A token chosen by hand is shown whole. Until its own data arrives the previous token's result is not passed off as its result.
    expect(labels()).toContain("is >99.99%");
    h.stage.holdOutput();
    // Again at once, with no frame in between.
    expect(labels().filter((t) => t !== "Not chosen yet")).toEqual([]);
    expect(bars()).toBe(0);
    expect(output()).toEqual(["Not chosen yet"]);
    h.stage.setCandidates(first);
    expect(bars()).toBe(3);
    // The new labels do not flash before their first frame either, and the old ones are gone.
    expect(labels()).toEqual([]);
    expect(output()).toContain("Paris 62.00%");
    // Released without new data (the replay came back to the token whose data is already there): shown again.
    h.stage.holdOutput();
    h.stage.holdOutput(false);
    expect(bars()).toBe(3);
    expect(output()).toContain("Paris 62.00%");
    // Back to live while waiting: live output is never held.
    h.stage.holdOutput();
    h.stage.setPlayhead(null);
    expect(bars()).toBe(3);
    expect(output()).toContain("Paris 62.00%");
    h.stage.holdOutput();
    expect(bars()).toBe(3);
    // No output at all: no bars, and no note about one.
    h.stage.setCandidates([]);
    h.stage.setPlayhead(2);
    expect(output()).toEqual([]);
    h.stage.dispose();
  }
});

it("stops lending frames to a replay while hidden, off screen or lost, and says so", () => {
  const arch = buildArch(TINY_INFO), h = harness(arch), beats = beatCount(TINY_INFO), replay = replayOf(3, beats);
  h.events.hidden.mockClear();
  h.stage.setDriver(replay);
  h.run(4);
  replay.enter("answer");
  h.stage.setPlayhead(1);
  h.run(30);
  const reached = replay.get().step;
  expect(reached).toBeGreaterThan(1);
  // The tab goes to the background: the stage reports it, and a replay left playing still cannot move.
  h.doc.hidden = true;
  for (const f of h.doc.listeners.get("visibilitychange")!) (f as () => void)();
  expect(h.events.hidden).toHaveBeenCalledTimes(1);
  h.run(200, 1000);
  expect(replay.get().step).toBe(reached);
  expect(h.frames.size).toBe(0);
  // Back in view after a long time: it goes on from where it was, one step, with no jump.
  h.doc.hidden = false;
  for (const f of h.doc.listeners.get("visibilitychange")!) (f as () => void)();
  h.run(1, 600_000);
  expect(replay.get().step).toBeLessThanOrEqual(reached + 1);
  // Scrolled out of sight is the same as hidden.
  h.observers[1].callback([{ isIntersecting: false }]);
  expect(h.events.hidden).toHaveBeenCalledTimes(2);
  const off = replay.get().step;
  h.run(100, 1000);
  expect(replay.get().step).toBe(off);
  h.observers[1].callback([{ isIntersecting: true }]);
  // A lost context reports hidden before lost, and nothing runs afterwards.
  for (const f of h.canvas.listeners.get("webglcontextlost")!) (f as (e: unknown) => void)({ preventDefault() {} });
  expect(h.events.hidden).toHaveBeenCalledTimes(3);
  expect(h.events.lost).toHaveBeenCalledTimes(1);
  const lost = replay.get().step;
  h.run(100, 1000);
  expect(replay.get().step).toBe(lost);
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
    for (const need of ["Words in", "Words out", "token15", "Paris 80.00%"]) expect(boxes.map((b) => b.text)).toContain(need);
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
  h.stage.setPlayhead(1 + 2 * floor);
  expect(levels()).toEqual([0.2, 0.2, 0.2, 0.2, 0.2, 0.2]);
  // Half way through attention: the first two of its four plates, in order. The MLP has not started.
  h.stage.setPlayhead(1 + 2 * floor + 0.5);
  expect(levels()).toEqual([1, 1, 0.2, 0.2, 0.2, 0.2]);
  h.stage.setPlayhead(2 + 2 * floor + 0.5);
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
  h.stage.setPlayhead(null);
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
  const arch = buildArch(TINY_INFO), h = harness(arch), { fire } = h;
  h.run(4);
  const part: Part = { kind: "head", floor: 2, head: 1 }, i = partIndex(arch, part);
  const at = h.screen(h.stage.specimen.center(i, new THREE.Vector3()));
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
  // Grab moves the part with the pointer and never calls the model. The controls stay on, so the wheel and a
  // second finger still zoom, but they stop turning the model under the part.
  h.events.punch.mockClear();
  h.stage.setTool("grab");
  fire("pointerdown", at);
  expect(h.controls.enabled).toBe(true);
  expect(h.controls.enableRotate).toBe(false);
  fire("pointermove", { clientX: at.clientX + 60, clientY: at.clientY - 30, buttons: 1 });
  fire("pointerup", { clientX: at.clientX + 60, clientY: at.clientY - 30 });
  expect(h.controls.enableRotate).toBe(true);
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
  h.stage.setPlayhead(0);
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
  expect(h.environment.dispose).toHaveBeenCalledTimes(1);
});

it("frees the studio, its reflections and every generated texture, and replaces the backdrop only when the theme changes", () => {
  const h = harness(buildArch(TINY_INFO));
  const freed = new Set<THREE.Texture>(), watch = (t: THREE.Texture) => { t.addEventListener("dispose", () => freed.add(t)); return t; };
  const surfaces = h.stage.specimen.textures.map(watch), first = watch(h.scene.background as THREE.Texture);
  expect(surfaces.length).toBeGreaterThanOrEqual(5);
  expect(h.scene.environment).toBe(h.environment.texture);
  // The same theme again keeps the backdrop it has.
  h.stage.setTheme(LIGHT);
  expect(h.scene.background).toBe(first);
  h.stage.setTheme(DARK);
  const second = watch(h.scene.background as THREE.Texture);
  expect(second).not.toBe(first);
  expect(freed.has(first)).toBe(true);
  expect(freed.has(second)).toBe(false);
  // Lights, floor and shadow catcher go with the stage.
  const studio = h.scene.children[0], floor = studio.children.filter((o): o is THREE.Mesh => (o as THREE.Mesh).isMesh);
  expect(floor.length).toBeGreaterThanOrEqual(3);
  let gone = 0;
  for (const mesh of floor) { mesh.geometry.addEventListener("dispose", () => { gone++; }); (mesh.material as THREE.Material).addEventListener("dispose", () => { gone++; }); }
  h.stage.dispose();
  expect(gone).toBe(floor.length * 2);
  for (const t of [...surfaces, second]) expect(freed.has(t)).toBe(true);
  expect(h.environment.dispose).toHaveBeenCalledTimes(1);
  expect(h.scene.background).toBeNull();
  expect(h.scene.environment).toBeNull();
  expect(h.scene.children).toHaveLength(0);
});

it("refuses to start without WebGL, leaving nothing behind", () => {
  const frames: unknown[] = [];
  vi.stubGlobal("requestAnimationFrame", (f: unknown) => frames.push(f));
  const canvas = { removed: false, className: "", setAttribute() {}, remove() { this.removed = true; } };
  const host = { ownerDocument: { createElement: () => canvas }, prepend() {} };
  expect(() => new Stage({ host: host as unknown as HTMLElement, labels: host as unknown as HTMLElement, tip: host as unknown as HTMLElement, arch: buildArch(TINY_INFO), theme: LIGHT,
    reducedMotion: false, coarse: false, onSelect() {}, onPunch: () => false, describe: () => "", onLost() {}, onArranged() {},
    deps: { renderer: () => { throw new Error("Error creating WebGL context."); } } })).toThrow(/WebGL/);
  expect(canvas.removed).toBe(true);
  expect(frames).toHaveLength(0);
});

// ------------------------------------------------------------------ the instrument: inserts, spread, detail

const triangles = (s: Specimen) => {
  let n = 0;
  s.group.traverse((o) => {
    const m = o as THREE.InstancedMesh;
    if (!m.isMesh || !m.geometry.getAttribute("normal")) return;
    n += ((m.geometry.index?.count ?? m.geometry.getAttribute("position").count) / 3) * (m.isInstancedMesh ? m.count : 1);
  });
  return n;
};
const colorAt = (mesh: THREE.InstancedMesh, i: number) => { const c = new THREE.Color(); mesh.getColorAt(i, c); return [c.r, c.g, c.b].map((v) => +v.toFixed(4)); };

it("lights an insert only for a measurement and leaves the chassis its own material", () => {
  const arch = buildArch(TINY_INFO), s = new Specimen(arch, DARK, { shadows: false });
  const heads = instanced(s).filter((m) => m.count === 16), glow = heads.find((m) => (m.material as THREE.MeshBasicMaterial).isMeshBasicMaterial)!;
  const body = heads.find((m) => (m.material as THREE.MeshPhysicalMaterial).isMeshPhysicalMaterial && m.instanceColor)!;
  const tile = s.group.children.find((o) => (o as THREE.Mesh).isMesh && !(o as THREE.InstancedMesh).isInstancedMesh && ((o as THREE.Mesh).material as THREE.MeshBasicMaterial).isMeshBasicMaterial && (o as THREE.Mesh).geometry.type === "BoxGeometry")!;
  // Nothing measured: every window is the same dark glass, and nothing on the dictionary is lit.
  const off = colorAt(glow, 0);
  for (let i = 0; i < 16; i++) { expect(colorAt(glow, i)).toEqual(off); expect(colorAt(body, i)).toEqual([1, 1, 1]); }
  expect(Math.max(...off)).toBeLessThan(0.06);
  s.setTray([0.5, 0.5], 1, 3);
  expect(tile.visible).toBe(false);
  // One head pushed for the token, one against, one measured at zero; the rest were not measured.
  const values = new Float32Array(arch.parts.length).fill(NaN), at = (floor: number, head: number) => partIndex(arch, { kind: "head", floor, head });
  values[at(1, 0)] = 1; values[at(1, 1)] = -1; values[at(1, 2)] = 0; values[0] = 0.5;
  s.setValues(values, "signed");
  const toward = colorAt(glow, 4), against = colorAt(glow, 5);
  expect(toward[0]).toBeGreaterThan(toward[2] * 2);
  expect(against[2]).toBeGreaterThan(against[0] * 2);
  expect(colorAt(glow, 6)).toEqual(off);
  expect(colorAt(glow, 7)).toEqual(off);
  expect(tile.visible).toBe(true);
  // The module bodies never take the data's color.
  for (let i = 0; i < 16; i++) expect(colorAt(body, i)).toEqual([1, 1, 1]);
  // Before the replay reaches a head its window is still dark.
  s.setPlayhead(0);
  expect(colorAt(glow, 4)).toEqual(off);
  s.setPlayhead(null);
  // A part that is switched off dims its body and its window; the measurement does not keep it lit.
  s.setPoses(arch.parts.map((p) => poseOf({ heads: [{ floor: 1, head: 0, mult: 0 }] }, p, TINY_INFO)));
  expect(colorAt(body, 4)[0]).toBeLessThan(0.5);
  expect(colorAt(glow, 4)[0]).toBeLessThan(toward[0] * 0.5);
  s.dispose();
});

it("spreads the layers apart with every part still pickable and tethered, and resets the arrangement without undoing a real change", () => {
  const arch = buildArch(QWEN_INFO), s = new Specimen(arch, LIGHT, { shadows: false }), v = new THREE.Vector3(), m = arch.m;
  const at = (p: Part) => s.center(partIndex(arch, p), v).clone();
  const head: Part = { kind: "head", floor: 20, head: 13 }, parts: Part[] = [{ kind: "layer", floor: 0 }, { kind: "layer", floor: 1 }, { kind: "layer", floor: 20 }, { kind: "layer", floor: 27 }, { kind: "unembed" }, { kind: "embed" }];
  const rest = parts.map(at), seated = at(head).y - at({ kind: "layer", floor: 20 }).y;
  const glass = s.group.children.find((o) => (o as THREE.Mesh).geometry?.type === "CylinderGeometry" && ((o as THREE.Mesh).material as THREE.Material).transparent) as THREE.Mesh;
  const closed = new THREE.Box3().setFromObject(glass).max.y;
  expect(s.tetherCount).toBe(0);
  s.setSpread(1); settle(s);
  // Each layer rises in proportion to its place in the stack, by more than a whole pitch per layer; the dictionary stays.
  const rise = parts.map((p, i) => at(p).y - rest[i].y), step = rise[1];
  expect(step).toBeGreaterThan(m.pitch);
  expect(rise.slice(0, 4).map((r) => +(r / step).toFixed(4))).toEqual([0, 1, 20, 27]);
  expect(rise[4]).toBeGreaterThan(rise[3]);
  expect(rise[5]).toBe(0);
  // Modules lift clear of their sockets, each on a tether back to it, and the stream still reaches the output.
  expect(at(head).y - at({ kind: "layer", floor: 20 }).y).toBeGreaterThan(seated + m.headH * 0.5);
  expect(s.tetherCount).toBe(arch.floors * (arch.heads + 1));
  expect(new THREE.Box3().setFromObject(glass).max.y).toBeCloseTo(closed + rise[4], 3);
  expect(s.headroom).toBeCloseTo(rise[4], 5);
  // Everything is picked where it now is: a head, an MLP, a socket, and a layer by its drawer front.
  for (const p of [head, { kind: "mlp", floor: 9 }, { kind: "kv", floor: 27, group: 7 }] as Part[]) expect(arch.parts[s.pick(rayAt(at(p)))]).toEqual(p);
  const front = at({ kind: "layer", floor: 12 });
  front.y -= m.deckT / 2 + fasciaHeight(arch) / 2; front.x = -arch.deckW / 2 + 0.6;
  expect(arch.parts[s.pick(rayAt(front))]).toEqual({ kind: "layer", floor: 12 });
  // Halfway is half as far.
  s.setSpread(0.5); settle(s);
  expect(at({ kind: "layer", floor: 20 }).y - rest[2].y).toBeCloseTo(rise[2] / 2, 4);
  // A real change and a dragged deck, then Reset layout: the spread and the drag go, the knocked-out head stays out.
  s.setSpread(0); settle(s);
  const before = at(head), home = at({ kind: "head", floor: 3, head: 0 });
  s.setSpread(1);
  s.setPoses(arch.parts.map((p) => poseOf({ heads: [{ floor: 20, head: 13, mult: 0 }] }, p, QWEN_INFO)));
  s.arrange(partIndex(arch, { kind: "layer", floor: 3 }), new THREE.Vector3(2, 0, 1)); settle(s);
  s.resetLayout(); settle(s);
  expect(s.spread).toBe(0);
  expect(s.arranged()).toBe(0);
  expect(s.tetherCount).toBe(0);
  expect(at({ kind: "head", floor: 3, head: 0 }).distanceTo(home)).toBeLessThan(1e-5);
  expect(parts.map((p, i) => at(p).distanceTo(rest[i])).every((d) => d < 1e-5)).toBe(true);
  expect(at(head).z).toBeLessThan(before.z - m.headD * 0.5);
  s.dispose();
});

it("draws a lighter specimen for touch devices with the same parts in the same places", () => {
  const arch = buildArch(QWEN_INFO), high = new Specimen(arch, LIGHT, { shadows: false }), lite = new Specimen(arch, LIGHT, { shadows: false, quality: "lite" });
  expect(triangles(lite)).toBeLessThan(triangles(high) * 0.55);
  expect(lite.drawCalls).toBeLessThan(high.drawCalls);
  const c = new THREE.Vector3();
  for (const p of [{ kind: "head", floor: 20, head: 13 }, { kind: "mlp", floor: 9 }, { kind: "layer", floor: 27 }] as Part[]) {
    const i = partIndex(arch, p);
    expect(lite.center(i, c).distanceTo(high.center(i, new THREE.Vector3()))).toBe(0);
  }
  expect(lite.pick(rayAt(lite.center(partIndex(arch, { kind: "head", floor: 20, head: 13 }), c)))).toBe(partIndex(arch, { kind: "head", floor: 20, head: 13 }));
  // Every shape drawn with a material that reads a baked shade has one; without it the shape would draw black.
  for (const s of [high, lite]) s.group.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh && (mesh.material as THREE.Material).vertexColors) expect(mesh.geometry.getAttribute("color")).toBeTruthy();
  });
  high.dispose(); lite.dispose();
});

it("engraves each nameplate upright, in its own part of the image, and generates the same surfaces every time", () => {
  const { color, width, height, rects } = nameplatePixels();
  // A texture's first row is the bottom of the picture. Read a plate back through its own coordinates, top row first.
  const read = (name: (typeof NAMEPLATES)[number]) => {
    const [u0, v0, u1, v1] = rects[name].uv, rows: string[] = [];
    for (let y = Math.round(v1 * height) - 1; y >= Math.round(v0 * height); y--) {
      let line = "";
      for (let x = Math.round(u0 * width); x < Math.round(u1 * width); x++) line += color[(y * width + x) * 4] > 128 ? "#" : ".";
      rows.push(line);
    }
    return rows.filter((r) => r.includes("#"));
  };
  for (const name of NAMEPLATES) {
    const [u0, v0, u1, v1] = rects[name].uv;
    expect(u0).toBeGreaterThanOrEqual(0); expect(v0).toBeGreaterThanOrEqual(0); expect(u1).toBeLessThanOrEqual(1); expect(v1).toBeLessThanOrEqual(1);
    expect(rects[name].aspect).toBeCloseTo(((u1 - u0) * width) / ((v1 - v0) * height), 5);
    const rows = read(name), cell = rows.length / 7, glyph = (n: number) => rows.map((r) => r.slice(Math.round((3 + n * 6) * cell), Math.round((3 + n * 6 + 5) * cell)));
    // Seven rows of cells per letter, and one letter's width of ink per character.
    expect(Number.isInteger(cell)).toBe(true);
    const letters = [...name];
    // Shapes that only read one way up: L's foot and P's bowl. T's bar is at the top; U's bowl is at the bottom.
    const full = (r: string) => !r.includes("."), first = (g: string[]) => g[0], last = (g: string[]) => g[g.length - 1];
    letters.forEach((ch, n) => {
      const g = glyph(n);
      if (ch === "L") { expect(full(last(g))).toBe(true); expect(full(first(g))).toBe(false); }
      if (ch === "T") { expect(full(first(g))).toBe(true); expect(full(last(g))).toBe(false); }
      if (ch === "P") { expect(first(g).startsWith("#")).toBe(true); expect(last(g).endsWith(".")).toBe(true); expect(last(g).startsWith("#")).toBe(true); }
      if (ch === "M" || ch === "W") expect(g.filter((r) => r.includes("#")).length).toBe(g.length);
      if (ch === " ") expect(g.some((r) => r.includes("#"))).toBe(false);
    });
    // M and W are each other upside down: the middle of M is inked high, the middle of W low.
    const middle = (g: string[], from: number, to: number) => g.slice(from, to).filter((r) => r[Math.floor(r.length / 2)] === "#").length;
    letters.forEach((ch, n) => {
      const g = glyph(n), third = Math.round(g.length / 3);
      if (ch === "M") expect(middle(g, 0, third * 2)).toBeGreaterThan(middle(g, third * 2, g.length));
      if (ch === "W") expect(middle(g, third, g.length)).toBeGreaterThan(middle(g, 0, third));
    });
  }
  // Longer text is a wider plate, and no two plates share a row of the image.
  expect(rects["WORDS OUT"].aspect).toBeGreaterThan(rects["WORDS IN"].aspect);
  expect(rects["WORDS IN"].aspect).toBeGreaterThan(rects.MLP.aspect);
  const bands = NAMEPLATES.map((n) => [rects[n].uv[1], rects[n].uv[3]]).sort((a, b) => a[0] - b[0]);
  for (let i = 1; i < bands.length; i++) expect(bands[i][0]).toBeGreaterThanOrEqual(bands[i - 1][1]);
  expect(Array.from(brushedPixels(64))).toEqual(Array.from(brushedPixels(64)));
  expect(Array.from(tracePixels(64).color)).toEqual(Array.from(tracePixels(64).color));
  // The board's bare pads are metal and its mask is not.
  const surface = tracePixels(64).surface, metal = Array.from({ length: 64 * 64 }, (_, i) => surface[i * 4 + 2]);
  expect(metal.some((v) => v === 255)).toBe(true);
  expect(metal.filter((v) => v === 0).length).toBeGreaterThan(metal.length / 2);
});

// ------------------------------------------------------------------ navigation

it("turns around the pivot on a flight between views instead of cutting through the model", () => {
  const pose = (x: number, y: number, z: number, t = new THREE.Vector3(1, 2, 3)) => ({ position: new THREE.Vector3(x, y, z).add(t), target: t.clone() });
  const out = { position: new THREE.Vector3(), target: new THREE.Vector3() };
  // Front to back: halfway there the camera is beside the model, still its full distance away.
  along(pose(0, 0, 10), pose(0, 0, -10), 0.5, out);
  expect(out.position.distanceTo(out.target)).toBeCloseTo(10, 5);
  expect(Math.abs(out.position.x - 1)).toBeCloseTo(10, 5);
  // The short way round, across the back, not the long way across the front.
  const a = pose(Math.sin(3), 0, Math.cos(3)), b = pose(Math.sin(-3), 0, Math.cos(-3));
  expect(along(a, b, 0.5, out).position.z - 3).toBeLessThan(-0.99);
  // A flight ends exactly where it was sent, and a moving pivot is carried in a straight line.
  const to = pose(4, 3, -2, new THREE.Vector3(-5, 0, 2));
  along(pose(0, 1, 6), to, 1, out);
  expect(out.position.distanceTo(to.position)).toBeLessThan(1e-6);
  expect(along(pose(0, 1, 6), to, 0.5, out).target.distanceTo(new THREE.Vector3(-2, 1, 2.5))).toBeLessThan(1e-9);
});

it("focuses on a part as the pivot from the visitor's own angle, turns to named views around it, and comes home", () => {
  const arch = buildArch(QWEN_INFO), h = harness(arch), { camera } = h, part: Part = { kind: "head", floor: 20, head: 13 }, i = partIndex(arch, part);
  h.run(4);
  const home = { position: camera.position.clone(), target: h.controls.target.clone() }, far = home.position.distanceTo(home.target);
  // Selecting from the overview leaves the camera where it is.
  h.stage.setSelection(part); h.run(400);
  expect(camera.position.distanceTo(home.position)).toBeLessThan(1e-9);
  expect(h.stage.focused).toBeNull();
  h.stage.orbit(-0.5, -0.1);
  const angle = h.looking();
  h.stage.focus(part); h.run(400);
  const center = h.stage.specimen.restCenter(i, new THREE.Vector3());
  expect(h.stage.focused).toEqual(part);
  expect(h.controls.target.distanceTo(center)).toBeLessThan(arch.m.pitch * 0.5);
  expect(camera.position.distanceTo(h.controls.target)).toBeLessThan(far / 5);
  expect(h.looking().angleTo(angle)).toBeLessThan(1e-4);
  // The part is in view, with neighbors for context.
  const p = h.screen(center);
  expect(Math.abs(p.clientX - 200)).toBeLessThan(60);
  expect(Math.abs(p.clientY - 300)).toBeLessThan(90);
  // A named view turns around the same part.
  h.stage.view("front"); h.run(400);
  expect(h.looking().angleTo(VIEWS.front)).toBeLessThan(1e-4);
  expect(h.controls.target.distanceTo(center)).toBeLessThan(arch.m.pitch * 0.5);
  h.stage.view("top"); h.run(400);
  expect(h.looking().y).toBeGreaterThan(0.95);
  // Buttons zoom about the pivot.
  const near = camera.position.distanceTo(h.controls.target), pivot = h.controls.target.clone();
  h.stage.zoom(2); h.run(100);
  expect(camera.position.distanceTo(h.controls.target)).toBeCloseTo(near * 2, 4);
  expect(h.controls.target.distanceTo(pivot)).toBeLessThan(1e-9);
  // Home is the whole model from the opening view, exactly as it started.
  h.stage.resetView(); h.run(400);
  expect(h.stage.focused).toBeNull();
  expect(camera.position.distanceTo(home.position)).toBeLessThan(1e-4);
  expect(h.controls.target.distanceTo(home.target)).toBeLessThan(1e-4);
  h.stage.dispose();
});

it("carries the camera with the selection once focused, and never moves a camera the visitor has placed when data arrives", () => {
  const arch = buildArch(QWEN_INFO), h = harness(arch), { camera } = h, rest = (p: Part) => h.stage.specimen.restCenter(partIndex(arch, p), new THREE.Vector3());
  const a: Part = { kind: "head", floor: 20, head: 13 }, b: Part = { kind: "head", floor: 21, head: 13 };
  const plates = [plate({ id: "a", title: "A", band: 0, rows: 2, cols: 2, data: [1, 2, 3, 4] })];
  h.run(4);
  h.stage.setSelection(a); h.stage.focus(a); h.run(400);
  // Untouched since the focus: stepping to the next layer frames that part the same way.
  h.stage.setSelection(b); h.run(400);
  expect(h.controls.target.distanceTo(rest(b))).toBeLessThan(arch.m.pitch * 0.5);
  // The visitor turns and zooms; stepping back then moves the camera by exactly the distance between the parts.
  h.takeCamera();
  camera.position.add(new THREE.Vector3(0.7, 0.2, -0.4));
  const before = { position: camera.position.clone(), target: h.controls.target.clone() }, from = rest(b);
  h.stage.setSelection(a); h.run(400);
  const by = rest(a).sub(from);
  expect(by.length()).toBeGreaterThan(arch.m.pitch * 0.9);
  expect(camera.position.distanceTo(before.position.clone().add(by))).toBeLessThan(1e-4);
  expect(h.controls.target.distanceTo(before.target.clone().add(by))).toBeLessThan(1e-4);
  // Measurements, a detail bay, a spread and a resize all leave that camera alone.
  const placed = { position: camera.position.clone(), target: h.controls.target.clone() };
  h.stage.setValues(new Float32Array(arch.parts.length), "signed");
  h.stage.setBay({ key: "k", floor: 20, plates });
  h.stage.setSpread(0.6);
  h.stage.overlaysChanged();
  h.run(600);
  expect(camera.position.distanceTo(placed.position)).toBeLessThan(1e-9);
  expect(h.controls.target.distanceTo(placed.target)).toBeLessThan(1e-9);
  // Deselecting keeps the view too.
  h.stage.setSelection(null); h.run(100);
  expect(camera.position.distanceTo(placed.position)).toBeLessThan(1e-9);
  h.stage.dispose();
  // A camera nobody has moved does follow the model as it grows: the bay and the spread stay in frame.
  const fresh = harness(arch), v = new THREE.Vector3();
  fresh.run(4);
  const start = fresh.camera.position.distanceTo(fresh.controls.target);
  fresh.stage.setSelection({ kind: "layer", floor: 20 });
  fresh.stage.setBay({ key: "k", floor: 20, plates });
  fresh.stage.setSpread(1);
  fresh.run(900);
  expect(fresh.camera.position.distanceTo(fresh.controls.target)).toBeGreaterThan(start * 1.5);
  fresh.camera.updateMatrixWorld(true);
  const top = fresh.stage.specimen.center(arch.parts.length - 1, v).project(fresh.camera);
  expect(Math.abs(top.y)).toBeLessThan(1);
  // The bay rides with its layer.
  const bay = (fresh.stage as unknown as { bay: Bay }).bay.group.position.y;
  expect(bay).toBeGreaterThan(fresh.stage.specimen.center(partIndex(arch, { kind: "layer", floor: 20 }), v).y);
  expect(bay).toBeLessThan(fresh.stage.specimen.center(partIndex(arch, { kind: "layer", floor: 21 }), v).y);
  fresh.stage.dispose();
});

it("focuses on a double click, goes home on a double click of the backdrop, and never doubles in Punch", () => {
  const arch = buildArch(TINY_INFO), h = harness(arch), part: Part = { kind: "head", floor: 2, head: 1 };
  let t = 1000;
  vi.spyOn(performance, "now").mockImplementation(() => t);
  h.run(4);
  const at = h.screen(h.stage.specimen.center(partIndex(arch, part), new THREE.Vector3())), empty = { clientX: 200, clientY: 6 };
  // Two slow clicks are two selections.
  h.click(at); t += 900; h.click(at);
  expect(h.events.select).toHaveBeenCalledTimes(2);
  expect(h.stage.focused).toBeNull();
  t += 900; h.click(at); t += 150; h.click(at);
  expect(h.stage.focused).toEqual(part);
  h.run(400);
  // The backdrop: one click deselects, a second one fits the whole model.
  t += 900; h.click(empty);
  expect(h.events.select).toHaveBeenLastCalledWith(null);
  h.stage.setSelection(part); h.stage.focus(part); h.run(400);
  t += 900; h.click(empty); t += 150; h.click(empty); h.run(400);
  expect(h.stage.focused).toBeNull();
  // In Punch every click is an edit, so two quick ones are two edits and no camera move.
  h.stage.setTool("punch");
  const again = h.screen(h.stage.specimen.center(partIndex(arch, part), new THREE.Vector3())), pose = h.camera.position.clone();
  t += 900; h.click(again); t += 100; h.click(again); h.run(400);
  expect(h.events.punch).toHaveBeenCalledTimes(2);
  expect(h.stage.focused).toBeNull();
  expect(h.camera.position.distanceTo(pose)).toBeLessThan(1e-9);
  h.stage.dispose();
  vi.restoreAllMocks();
});

it("reaches a part from a few pixels beside it and nothing from farther away", () => {
  const arch = buildArch(TINY_INFO), h = harness(arch);
  h.run(4);
  // The output block's left end, against the backdrop: step off it to the left until the ray misses.
  const crown = arch.parts.length - 1, edge = h.stage.specimen.center(crown, new THREE.Vector3());
  edge.x -= arch.size[crown][0] / 2; edge.y += arch.size[crown][1] * 0.2; edge.z += arch.size[crown][2] / 2;
  const on = h.screen(edge), ray = new THREE.Raycaster(), miss = (dx: number) => {
    ray.setFromCamera(new THREE.Vector2(((on.clientX + dx) / 400) * 2 - 1, -(on.clientY / 600) * 2 + 1), h.camera);
    return h.stage.specimen.pick(ray) < 0;
  };
  let off = -1;
  while (!miss(off) && off > -40) off--;
  expect(miss(off - 3)).toBe(true);
  h.click({ clientX: on.clientX + off - 3, clientY: on.clientY });
  expect(h.events.select).toHaveBeenLastCalledWith({ kind: "unembed" });
  // A finger is given more room than a mouse.
  h.click({ clientX: on.clientX + off - 9, clientY: on.clientY });
  expect(h.events.select).toHaveBeenLastCalledWith(null);
  h.click({ clientX: on.clientX + off - 9, clientY: on.clientY }, { pointerType: "touch" });
  expect(h.events.select).toHaveBeenLastCalledWith({ kind: "unembed" });
  expect(miss(off - 30)).toBe(true);
  h.click({ clientX: on.clientX + off - 30, clientY: on.clientY }, { pointerType: "touch" });
  expect(h.events.select).toHaveBeenLastCalledWith(null);
  h.stage.dispose();
});

it("never turns a camera gesture into an edit: Pan, Space, modifiers, drags that return, and second fingers", () => {
  const arch = buildArch(TINY_INFO), h = harness(arch), { fire, click } = h, part: Part = { kind: "head", floor: 2, head: 1 }, i = partIndex(arch, part);
  h.run(4);
  const at = h.screen(h.stage.specimen.center(i, new THREE.Vector3())), away = { clientX: at.clientX + 50, clientY: at.clientY + 20 };
  const quiet = () => { expect(h.events.punch).not.toHaveBeenCalled(); expect(h.events.select).not.toHaveBeenCalled(); };
  h.stage.setTool("punch");
  // Pan is on: a plain click on a head selects nothing and punches nothing, with a mouse or a finger.
  h.stage.setDragMode("pan");
  expect(h.controls.mouseButtons.LEFT).toBe(THREE.MOUSE.PAN);
  expect(h.controls.touches.ONE).toBe(THREE.TOUCH.PAN);
  click(at); click(at, { pointerType: "touch" });
  quiet();
  h.stage.setDragMode("turn");
  expect(h.controls.mouseButtons.LEFT).toBe(THREE.MOUSE.ROTATE);
  expect(h.controls.touches.ONE).toBe(THREE.TOUCH.ROTATE);
  // Space held, before the press or during it, and Shift, Control or Command: the camera's.
  h.stage.holdPan(true); click(at); h.stage.holdPan(false);
  fire("pointerdown", at); h.stage.holdPan(true); fire("pointerup", at); h.stage.holdPan(false);
  for (const key of ["shiftKey", "ctrlKey", "metaKey"]) click(at, { [key]: true });
  quiet();
  // A drag that wanders off and comes back to where it started was a drag, on a desktop and on a phone.
  for (const pointerType of ["mouse", "touch"]) {
    fire("pointerdown", { ...at, pointerType });
    fire("pointermove", { ...away, pointerType, buttons: 1 });
    fire("pointermove", { ...at, pointerType, buttons: 1 });
    fire("pointerup", { ...at, pointerType });
  }
  quiet();
  // A pinch: the second finger makes it a camera gesture whichever finger lifts first, and a cancelled press is nothing.
  for (const first of [1, 2]) {
    fire("pointerdown", { ...at, pointerType: "touch", pointerId: 1 });
    fire("pointerdown", { ...away, pointerType: "touch", pointerId: 2, isPrimary: false });
    fire("pointerup", { ...(first === 1 ? at : away), pointerType: "touch", pointerId: first, isPrimary: first === 1 });
    fire("pointerup", { ...(first === 1 ? away : at), pointerType: "touch", pointerId: 3 - first, isPrimary: first === 2 });
  }
  fire("pointerdown", { ...at, pointerType: "touch" }); fire("pointercancel", { ...at, pointerType: "touch" });
  fire("pointerdown", { ...at, button: 2 }); fire("pointerup", { ...at, button: 2 });
  quiet();
  // And a deliberate click still punches, once, with a small tremor allowed.
  fire("pointerdown", at); fire("pointermove", { clientX: at.clientX + 2, clientY: at.clientY - 2, buttons: 1 }); fire("pointerup", { clientX: at.clientX + 2, clientY: at.clientY - 2 });
  expect(h.events.punch).toHaveBeenCalledTimes(1);
  expect(h.events.punch).toHaveBeenCalledWith(part);
  click(at, { pointerType: "touch" });
  expect(h.events.punch).toHaveBeenCalledTimes(2);
  h.run(400);

  // Grab: a second finger lets go of the part and puts it back, and Pan keeps parts where they are.
  h.events.select.mockClear(); h.events.arranged.mockClear();
  h.stage.setTool("grab");
  const rest = h.stage.specimen.center(i, new THREE.Vector3()).clone(), grip = h.screen(rest);
  fire("pointerdown", { ...grip, pointerType: "touch", pointerId: 1 });
  expect(h.controls.enableRotate).toBe(false);
  fire("pointermove", { clientX: grip.clientX + 60, clientY: grip.clientY - 30, pointerType: "touch", pointerId: 1 });
  h.run(400);
  expect(h.stage.specimen.center(i, new THREE.Vector3()).distanceTo(rest)).toBeGreaterThan(0.2);
  fire("pointerdown", { ...away, pointerType: "touch", pointerId: 2, isPrimary: false });
  expect(h.controls.enableRotate).toBe(true);
  fire("pointermove", { clientX: grip.clientX + 90, clientY: grip.clientY, pointerType: "touch", pointerId: 1 });
  fire("pointerup", { ...away, pointerType: "touch", pointerId: 2, isPrimary: false });
  fire("pointerup", { clientX: grip.clientX + 90, clientY: grip.clientY, pointerType: "touch", pointerId: 1 });
  h.run(400);
  expect(h.stage.specimen.center(i, new THREE.Vector3()).distanceTo(rest)).toBeLessThan(1e-5);
  expect(h.events.arranged).toHaveBeenLastCalledWith(0);
  h.stage.setDragMode("pan");
  fire("pointerdown", grip); fire("pointermove", { clientX: grip.clientX + 60, clientY: grip.clientY, buttons: 1 }); fire("pointerup", { clientX: grip.clientX + 60, clientY: grip.clientY });
  h.run(400);
  expect(h.controls.enableRotate).toBe(true);
  expect(h.stage.specimen.center(i, new THREE.Vector3()).distanceTo(rest)).toBeLessThan(1e-5);
  expect(h.stage.specimen.arranged()).toBe(0);
  expect(h.events.punch).toHaveBeenCalledTimes(2);
  h.stage.dispose();
});

it("leaves a part on its socket when a press in Grab trembles, and moves it when the press really travels", () => {
  const arch = buildArch(TINY_INFO), h = harness(arch), { fire } = h, part: Part = { kind: "head", floor: 2, head: 1 }, i = partIndex(arch, part);
  h.run(4);
  h.stage.setTool("grab");
  // The presses are seconds apart, so none of them is the second half of a double click.
  let t = 0;
  vi.spyOn(performance, "now").mockImplementation(() => t);
  const rest = h.stage.specimen.center(i, new THREE.Vector3()).clone(), grip = h.screen(rest);
  // A click with a pixel or two of tremor, with a mouse and with a finger: the part is selected and nothing has been arranged.
  for (const [pointerType, dx, dy] of [["mouse", 2, -1], ["mouse", -3, 3], ["touch", 6, -7]] as const) {
    t += 2000;
    fire("pointerdown", { ...grip, pointerType });
    fire("pointermove", { clientX: grip.clientX + dx, clientY: grip.clientY + dy, pointerType, buttons: 1 });
    fire("pointerup", { clientX: grip.clientX + dx, clientY: grip.clientY + dy, pointerType });
    h.run(400);
    expect(h.stage.specimen.center(i, new THREE.Vector3()).distanceTo(rest)).toBeLessThan(1e-6);
    expect(h.stage.specimen.arranged()).toBe(0);
    expect(h.stage.specimen.tetherCount).toBe(0);
    expect(h.events.arranged).toHaveBeenLastCalledWith(0);
  }
  expect(h.events.select).toHaveBeenLastCalledWith(part);
  // A press that travels is a drag: the part follows it and Reset layout has something to reset.
  t += 2000;
  fire("pointerdown", grip);
  fire("pointermove", { clientX: grip.clientX + 30, clientY: grip.clientY - 10, buttons: 1 });
  fire("pointermove", { clientX: grip.clientX + 60, clientY: grip.clientY - 30, buttons: 1 });
  fire("pointerup", { clientX: grip.clientX + 60, clientY: grip.clientY - 30 });
  h.run(400);
  expect(h.stage.specimen.center(i, new THREE.Vector3()).distanceTo(rest)).toBeGreaterThan(0.2);
  expect(h.stage.specimen.arranged()).toBe(1);
  expect(h.events.arranged).toHaveBeenLastCalledWith(1);
  vi.restoreAllMocks();
  h.stage.dispose();
});

it("reads the tip again when what it describes changes under a pointer that has not moved", () => {
  const arch = buildArch(TINY_INFO), part: Part = { kind: "mlp", floor: 2 }, i = partIndex(arch, part);
  let said = "+0.40 direct push for “Paris”";
  const h = harness(arch, { describe: () => said }), { fire } = h;
  h.run(4);
  const at = h.screen(h.stage.specimen.center(i, new THREE.Vector3()));
  fire("pointermove", at); h.run(1);
  expect(h.tip.hidden).toBe(false);
  expect(h.tip.textContent).toBe("+0.40 direct push for “Paris”");
  // Another token is selected while the pointer rests there: new values arrive, and the tip is of them.
  said = "−0.12 direct push for “is”";
  h.stage.setValues(new Float32Array(arch.parts.length), "signed"); h.run(1);
  expect(h.tip.textContent).toBe("−0.12 direct push for “is”");
  // A changed part is read again too.
  said = "Signal off";
  h.stage.setPoses(arch.parts.map((p) => poseOf({ memory: [{ floor: 2, mult: 0 }] }, p, TINY_INFO))); h.run(400);
  expect(h.tip.textContent).toBe("Signal off");

  // A tile of the detail bay: its number is replaced when the plates are, and gone when the bay is.
  const tiles = (v: number) => [plate({ id: "x", title: "Stream in", band: 0, rows: 2, cols: 2, data: new Float32Array(4).fill(v) })];
  h.stage.setBay({ key: "tiny.layer.1", floor: 1, plates: tiles(0.25) });
  h.run(400);
  const bay = (h.stage as unknown as { bay: Bay }).bay, mesh = bay.group.children.find((o) => ((o as THREE.Mesh).material as THREE.MeshBasicMaterial | undefined)?.map) as THREE.Mesh;
  h.scene.updateMatrixWorld(true);
  const tile = h.screen(mesh.getWorldPosition(new THREE.Vector3()));
  fire("pointermove", tile); h.run(1);
  expect(h.tip.textContent).toContain("Stream in");
  expect(h.tip.textContent).toContain("0.250");
  h.stage.setBay({ key: "tiny.layer.1", floor: 1, plates: tiles(0.75) }); h.run(1);
  expect(h.tip.textContent).toContain("0.750");
  expect(h.tip.textContent).not.toContain("0.250");
  h.stage.setBay(null); h.run(400);
  expect(h.tip.hidden || !String(h.tip.textContent).includes("0.750")).toBe(true);

  // A tip pinned by a tap has no pointer to read from. About a part it is written again; about a tile it goes with the plates.
  fire("pointerleave", {}); h.run(1);
  expect(h.tip.hidden).toBe(true);
  said = "first";
  h.click(h.screen(h.stage.specimen.center(i, new THREE.Vector3())), { pointerType: "touch" });
  expect(h.tip.hidden).toBe(false);
  expect(h.tip.textContent).toBe("first");
  said = "second";
  h.stage.setValues(new Float32Array(arch.parts.length), "signed");
  expect(h.tip.hidden).toBe(false);
  expect(h.tip.textContent).toBe("second");
  h.stage.setBay({ key: "tiny.layer.1", floor: 1, plates: tiles(0.25) }); h.run(400);
  h.scene.updateMatrixWorld(true);
  const again = (h.stage as unknown as { bay: Bay }).bay.group.children.find((o) => ((o as THREE.Mesh).material as THREE.MeshBasicMaterial | undefined)?.map) as THREE.Mesh;
  h.click(h.screen(again.getWorldPosition(new THREE.Vector3())), { pointerType: "touch" });
  expect(h.tip.textContent).toContain("0.250");
  h.stage.setBay({ key: "tiny.layer.1", floor: 1, plates: tiles(0.75) });
  expect(h.tip.hidden).toBe(true);
  h.stage.dispose();
});

it("keeps the current input and output labels in a compact docked pane, and no label on another", () => {
  // The docked desktop pane at its smallest: 520 by 369, with the toolbar, the help text, the breadcrumb and the camera dock over the stage.
  const reserved = [{ left: 12, top: 11, width: 182, height: 32 }, { left: 414, top: 11, width: 93, height: 32 }, { left: 12, top: 50, width: 400, height: 43 }, { left: 12, top: 321, width: 133, height: 36 }, { left: 204, top: 321, width: 303, height: 36 }];
  const h = harness(buildArch(QWEN_INFO), { width: 520, height: 369, reserved });
  h.stage.setTray(Array.from({ length: 16 }, (_, i) => ({ label: i === 15 ? "Paris" : `tok${i}`, weight: NaN })), 15, 9, null);
  h.stage.setCandidates([{ label: ".", p: 0.9999, chosen: true }]);
  h.run(400);
  h.camera.updateMatrixWorld(true); h.stage.invalidate(); h.run(3);
  const boxes = h.spans.filter((s) => !s.removed && !s.hidden && s.style.transform).map((s) => {
    const [, x, y] = /translate\(([-\d.]+)px, ([-\d.]+)px\)/.exec(s.style.transform)!;
    return { text: s.textContent, left: Number(x), top: Number(y), width: s.textContent.length * 6.2 + 8, height: 14 };
  });
  // What the model read and what it wrote are always named. Structural captions are shown where they have room.
  for (const need of ["Paris", ". 99.99%", "Words in", "Words out"]) expect(boxes.map((b) => b.text)).toContain(need);
  const apart = (a: typeof boxes[number], b: { left: number; top: number; width: number; height: number }) => !(a.left < b.left + b.width && b.left < a.left + a.width && a.top < b.top + b.height && b.top < a.top + a.height);
  for (const a of boxes) {
    for (const r of reserved) expect(apart(a, r)).toBe(true);
    for (const b of boxes) if (a !== b) expect(apart(a, b)).toBe(true);
  }
  h.stage.dispose();
});
