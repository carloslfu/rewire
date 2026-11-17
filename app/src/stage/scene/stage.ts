// The 3D stage: one WebGL renderer drawing the specimen on demand. It renders only when the camera,
// a spring, the replay or the data changed, pauses when hidden, and frees its GPU resources on dispose.
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { type Arch, type Part, partIndex } from "../arch.ts";
import { type Box, declutter, type Inset, placeBox, toolbarInset } from "../labels.ts";
import { advance, beatCount, type Clock, seek } from "../playback.ts";
import type { Theme } from "../theme.ts";
import { Bay, type BaySpec, type PlateHit } from "./bay.ts";
import { MAX_BARS, Specimen } from "./specimen.ts";

export type Tool = "explore" | "grab" | "punch";
export type { BaySpec };

export interface StageOptions {
  /** The stage creates its own canvas here, so a remount always gets a fresh WebGL context. */
  host: HTMLElement;
  labels: HTMLElement;
  tip: HTMLElement;
  arch: Arch;
  theme: Theme;
  reducedMotion: boolean;
  /** Touch-first device: lower pixel ratio and no shadow pass. */
  coarse: boolean;
  onSelect: (part: Part | null) => void;
  /** Run the real edit for a punch. Returns whether it was accepted. */
  onPunch: (part: Part) => boolean;
  describe: (part: Part, tool: Tool) => string;
  onLost: () => void;
  onClock: (clock: Clock) => void;
  /** Number of parts dragged away from their sockets. */
  onArranged: (count: number) => void;
  /** Areas of the view taken by the toolbar and help text, in view pixels. Labels and the framing keep clear of them. */
  reserved?: () => Box[];
  deps?: Partial<StageDeps>;
}

interface Controls {
  enabled: boolean; target: THREE.Vector3;
  minDistance?: number; maxDistance?: number;
  update(): boolean; dispose(): void;
  addEventListener(type: "start" | "change", f: () => void): void;
}

export interface StageDeps {
  renderer: (canvas: HTMLCanvasElement) => THREE.WebGLRenderer;
  controls: (camera: THREE.PerspectiveCamera, element: HTMLElement) => Controls;
  environment: (renderer: THREE.WebGLRenderer) => THREE.Texture | null;
}

const real: StageDeps = {
  renderer: (canvas) => new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true }),
  controls: (camera, element) => {
    const c = new OrbitControls(camera, element);
    c.enableDamping = true; c.dampingFactor = 0.09;
    c.zoomToCursor = true; c.screenSpacePanning = true;
    c.minPolarAngle = 0.08; c.maxPolarAngle = Math.PI * 0.56;
    return c as unknown as Controls;
  },
  environment: (renderer) => {
    const pmrem = new THREE.PMREMGenerator(renderer), room = new RoomEnvironment();
    const texture = pmrem.fromScene(room, 0.04).texture;
    room.dispose(); pmrem.dispose();
    return texture;
  },
};

interface LabelSpec {
  text: string; className: string; at: (out: THREE.Vector3) => void; show?: () => boolean;
  /** Which fraction of the label sits on its point, and a pixel nudge away from it. */
  anchor: [number, number]; nudge?: [number, number];
  /** Higher wins when two labels would touch. */
  priority: number | (() => number);
}
interface Label extends LabelSpec { el: HTMLElement; group: string; width: number; height: number }

const NO_INSET: Inset = { top: 0, bottom: 0, side: 0 };

const VIEW = new THREE.Vector3(0.42, 0.26, 1).normalize();

/**
 * Camera placement that frames a box from a direction, for a vertical field of view and aspect ratio.
 * `inset` keeps fractions of the view clear (the toolbar above, labels at the edges): the box is fitted
 * to what remains and centered there. `span` is the box's half-width as a fraction of half the view.
 */
export function frame(box: THREE.Box3, dir: THREE.Vector3, fovDeg: number, aspect: number, margin = 1.08, inset: Inset = NO_INSET) {
  const center = box.getCenter(new THREE.Vector3());
  const right = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), dir).normalize(), up = new THREE.Vector3().crossVectors(dir, right).normalize();
  let w = 0, h = 0, d = 0;
  const v = new THREE.Vector3();
  for (let i = 0; i < 8; i++) {
    v.set(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z).sub(center);
    w = Math.max(w, Math.abs(v.dot(right))); h = Math.max(h, Math.abs(v.dot(up))); d = Math.max(d, v.dot(dir));
  }
  const tan = Math.tan((fovDeg * Math.PI) / 360), wide = tan * Math.max(0.1, aspect);
  const clearH = Math.max(0.2, 1 - inset.top - inset.bottom), clearW = Math.max(0.2, 1 - 2 * inset.side);
  const distance = Math.max(h / (tan * clearH), w / (wide * clearW)) * margin + d;
  // Aim above the box when more is reserved at the top than the bottom, so the box sits lower in the view.
  const target = center.clone().addScaledVector(up, (inset.top - inset.bottom) * distance * tan);
  return { target, position: target.clone().addScaledVector(dir, distance), span: w / (distance * wide) };
}

export class Stage {
  readonly specimen: Specimen;
  private readonly canvas: HTMLCanvasElement;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(30, 1, 0.1, 600);
  private readonly controls: Controls;
  private readonly key: THREE.DirectionalLight;
  private readonly fill: THREE.HemisphereLight;
  private readonly env: THREE.Texture | null;
  private readonly ground: THREE.Mesh | null = null;
  private readonly ray = new THREE.Raycaster();
  private readonly resize: ResizeObserver;
  private readonly seen: IntersectionObserver;
  private readonly unlisten: (() => void)[] = [];
  private bay: Bay | null = null;
  private bayMessage = "";
  private labels: Label[] = [];
  private tool: Tool = "explore";
  private clock: Clock = { t: 0, playing: false, speed: 1 };
  private clockMark = -1;
  private raf = 0; private last = 0;
  private dirty = true; private shadowDirty = true;
  private onScreen = true; private width = 0; private height = 0;
  private lost = false; private disposed = false;
  /** True until the visitor moves the camera; a pristine view refits when the stage resizes or the bay opens. */
  private pristine = true;
  private flight: { from: THREE.Vector3; to: THREE.Vector3; fromTarget: THREE.Vector3; toTarget: THREE.Vector3; t: number } | null = null;
  private drag: { part: number; plane: THREE.Plane; start: THREE.Vector3; base: THREE.Vector3; pointer: number } | null = null;
  private down: { x: number; y: number; pointer: number } | null = null;
  private hoverAt: { x: number; y: number } | null = null;
  private selected: Part | null = null;
  private tipPinned = 0;
  private readonly beats: number;
  private readonly shadows: boolean;
  private reduced: boolean;
  private reserved: Box[] = [];
  private theme: Theme;

  constructor(private readonly o: StageOptions) {
    const deps = { ...real, ...o.deps }, a = o.arch;
    this.beats = beatCount(a.model);
    this.theme = o.theme;
    this.reduced = o.reducedMotion;
    this.clock.t = this.beats;
    this.shadows = !o.coarse;
    this.canvas = o.host.ownerDocument.createElement("canvas");
    this.canvas.className = "stage-canvas";
    this.canvas.setAttribute("aria-hidden", "true");
    o.host.prepend(this.canvas);
    try {
      this.renderer = deps.renderer(this.canvas);
    } catch (e) {
      this.canvas.remove();
      throw e;
    }
    const r = this.renderer;
    r.setPixelRatio(Math.min(globalThis.devicePixelRatio || 1, o.coarse ? 1.5 : 2));
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.NeutralToneMapping;
    r.shadowMap.enabled = this.shadows; r.shadowMap.type = THREE.PCFShadowMap; r.shadowMap.autoUpdate = false;
    r.setClearColor(0x000000, 0);

    this.specimen = new Specimen(a, o.theme, { shadows: this.shadows });
    this.specimen.reducedMotion = o.reducedMotion;
    this.scene.add(this.specimen.group);
    this.env = deps.environment(r);
    this.scene.environment = this.env;
    const top = a.bounds.max[1], span = Math.max(a.bounds.max[0] - a.bounds.min[0], top - a.bounds.min[1]);
    this.key = new THREE.DirectionalLight(0xffffff, 2);
    this.key.position.set(span * 0.55, top + span * 0.45, span * 0.9);
    this.key.target.position.set(0, top / 2, 0);
    if (this.shadows) {
      this.key.castShadow = true;
      this.key.shadow.mapSize.set(2048, 2048);
      const cam = this.key.shadow.camera;
      cam.left = -span; cam.right = span; cam.top = span; cam.bottom = -span; cam.near = 0.5; cam.far = span * 4;
      cam.updateProjectionMatrix();
      this.key.shadow.bias = -0.0004; this.key.shadow.normalBias = 0.03;
      const ground = new THREE.Mesh(new THREE.CircleGeometry(span * 2.2, 48).rotateX(-Math.PI / 2), new THREE.ShadowMaterial({ opacity: 0.16 }));
      ground.receiveShadow = true;
      this.ground = ground;
      this.scene.add(ground);
    }
    this.fill = new THREE.HemisphereLight(0xffffff, 0x444444, 0.35);
    this.scene.add(this.key, this.key.target, this.fill);
    // Our pointer handlers run before the orbit controls', so a grab can claim the drag first.
    const on = (type: string, f: (e: never) => void, options?: AddEventListenerOptions) => {
      this.canvas.addEventListener(type, f as EventListener, options);
      this.unlisten.push(() => this.canvas.removeEventListener(type, f as EventListener, options));
    };
    on("pointerdown", this.pointerDown, { capture: true });
    on("pointermove", this.pointerMove);
    on("pointerup", this.pointerUp);
    on("pointercancel", this.pointerUp);
    on("pointerleave", this.pointerLeave);
    on("dblclick", this.doubleClick);
    on("webglcontextlost", this.contextLost);
    const doc = o.host.ownerDocument, visibility = () => this.wake();
    doc.addEventListener("visibilitychange", visibility);
    this.unlisten.push(() => doc.removeEventListener("visibilitychange", visibility));

    this.controls = deps.controls(this.camera, this.canvas);
    // Close enough to read one head, never so far that the model is lost.
    this.controls.minDistance = a.m.headW * 2.5;
    this.controls.maxDistance = span * 7;
    this.controls.addEventListener("start", () => { this.pristine = false; this.flight = null; });
    this.controls.addEventListener("change", () => this.invalidate());

    this.resize = new ResizeObserver(() => this.measure());
    this.resize.observe(o.host);
    this.seen = new IntersectionObserver((entries) => { this.onScreen = entries[entries.length - 1]?.isIntersecting ?? true; this.wake(); });
    this.seen.observe(o.host);
    this.staticLabels();
    this.setTheme(o.theme);
    this.measure();
  }

  // ---------------------------------------------------------------- loop

  private get visible() {
    return !this.disposed && !this.lost && this.onScreen && this.width > 0 && this.height > 0 && !this.o.host.ownerDocument.hidden;
  }

  /** Ask for a frame. Nothing renders unless something asked. */
  invalidate() {
    this.dirty = true;
    this.wake();
  }

  private wake() {
    if (!this.raf && this.visible) this.raf = requestAnimationFrame(this.tick);
  }

  private tick = (now: number) => {
    this.raf = 0;
    if (!this.visible) return;
    const dt = this.last ? Math.min(100, now - this.last) : 16;
    this.last = now;
    let active = this.dirty;
    this.dirty = false;
    if (this.clock.playing) {
      this.clock = advance(this.clock, dt, this.beats);
      this.specimen.setPlayhead(this.clock.t);
      this.bay?.reveal(this.specimen.playheadNow);
      const mark = Math.floor(this.clock.t * 8);
      if (mark !== this.clockMark || !this.clock.playing) { this.clockMark = mark; this.o.onClock(this.clock); }
      active = true;
    }
    if (this.flight) {
      const f = this.flight;
      f.t = Math.min(1, f.t + dt / 520);
      const k = f.t < 0.5 ? 4 * f.t ** 3 : 1 - (-2 * f.t + 2) ** 3 / 2;
      this.camera.position.lerpVectors(f.from, f.to, k);
      this.controls.target.lerpVectors(f.fromTarget, f.toTarget, k);
      this.camera.lookAt(this.controls.target);
      if (f.t >= 1) this.flight = null;
      active = true;
    }
    if (this.controls.update()) active = true;
    if (this.specimen.step(dt / 1000)) { active = true; this.shadowDirty = true; }
    if (!active) { this.last = 0; return; }
    // The shadow map is redrawn only on frames where something that casts a shadow moved.
    if (this.shadowDirty) { this.renderer.shadowMap.needsUpdate = this.shadows; this.shadowDirty = false; }
    this.renderer.render(this.scene, this.camera);
    this.placeLabels();
    this.raf = requestAnimationFrame(this.tick);
  };

  private measure() {
    const w = this.o.host.clientWidth, h = this.o.host.clientHeight;
    if (w === this.width && h === this.height) return;
    this.width = w; this.height = h;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.reserved = this.o.reserved?.() ?? [];
    if (this.pristine) this.fit(false);
    this.invalidate();
  }

  // ---------------------------------------------------------------- camera

  private box(withBay: boolean): THREE.Box3 {
    const b = this.o.arch.bounds, box = new THREE.Box3(new THREE.Vector3(...b.min), new THREE.Vector3(...b.max));
    // An open bay lifts everything above it.
    if (withBay && this.bay) box.max.y += this.room;
    return box;
  }

  private bayBox(): THREE.Box3 {
    const g = this.bay!.group.position, s = this.bay!.size;
    return new THREE.Box3(new THREE.Vector3(g.x - 0.2, g.y - s.y - 0.2, g.z - 0.3), new THREE.Vector3(g.x + s.x + 0.2, g.y + 0.6, g.z + 0.3));
  }

  private fly(box: THREE.Box3, animate: boolean, margin?: number) {
    if (!this.width || !this.height) return;
    // Leave room for token and layer labels at the edges, and for the toolbar where it sits above the model.
    const W = this.width, H = this.height, edges: Inset = { top: 0, bottom: Math.min(0.12, 24 / H), side: Math.min(0.1, 20 / W) };
    let placed = frame(box, VIEW, this.camera.fov, this.camera.aspect, margin, edges);
    const half = (placed.span * W) / 2, top = toolbarInset(this.reserved, W / 2 - half, W / 2 + half, H);
    if (top > 0) placed = frame(box, VIEW, this.camera.fov, this.camera.aspect, margin, { ...edges, top });
    const { target, position } = placed;
    if (!animate || this.reduced) {
      this.flight = null;
      this.camera.position.copy(position); this.controls.target.copy(target);
      this.camera.lookAt(target);
    } else this.flight = { from: this.camera.position.clone(), to: position, fromTarget: this.controls.target.clone(), toTarget: target, t: 0 };
    this.invalidate();
  }

  private fit(animate: boolean) {
    this.fly(this.box(true), animate);
  }

  /** Frame the whole specimen (and the open detail bay) again. */
  resetView() {
    this.pristine = true;
    this.fit(true);
  }

  /** Bring one part, and its detail bay when open, close. */
  focus(part: Part) {
    const i = partIndex(this.o.arch, part);
    if (i < 0) return;
    const a = this.o.arch, c = this.specimen.center(i, new THREE.Vector3());
    const reach = part.kind === "layer" || part.kind === "embed" || part.kind === "unembed" ? a.deckW / 2 : a.m.headW * 4;
    const box = new THREE.Box3(new THREE.Vector3(c.x - reach, c.y - a.m.pitch * 1.4, c.z - a.m.deckD), new THREE.Vector3(c.x + reach, c.y + a.m.pitch * 1.6, c.z + a.m.deckD));
    if (this.bay && "floor" in part && this.bay.spec.floor === part.floor) box.union(this.bayBox());
    this.pristine = false;
    this.fly(box, true, 1.15);
  }

  focusBay() {
    if (!this.bay) return;
    this.pristine = false;
    this.fly(this.bayBox(), true, 1.12);
  }

  /** Keyboard zoom: below 1 moves closer. */
  zoom(factor: number) {
    const offset = this.camera.position.clone().sub(this.controls.target), span = this.o.arch.bounds.max[1];
    offset.setLength(Math.max(this.controls.minDistance ?? 1, Math.min(this.controls.maxDistance ?? span * 7, offset.length() * factor)));
    this.camera.position.copy(this.controls.target).add(offset);
    this.pristine = false; this.flight = null;
    this.invalidate();
  }

  /** Keyboard orbit, in radians. */
  orbit(azimuth: number, polar: number) {
    const s = new THREE.Spherical().setFromVector3(this.camera.position.clone().sub(this.controls.target));
    s.theta += azimuth; s.phi = Math.max(0.08, Math.min(Math.PI * 0.56, s.phi + polar));
    this.camera.position.copy(this.controls.target).add(new THREE.Vector3().setFromSpherical(s));
    this.pristine = false; this.flight = null;
    this.invalidate();
  }

  // ---------------------------------------------------------------- data from the page

  setTheme(theme: Theme) {
    this.theme = theme;
    this.specimen.setTheme(theme);
    this.bay?.setTheme(theme);
    this.scene.environmentIntensity = theme.dark ? 0.6 : 0.95;
    this.key.intensity = theme.dark ? 1.5 : 2.1;
    this.fill.intensity = theme.dark ? 0.2 : 0.4;
    if (this.ground) (this.ground.material as THREE.ShadowMaterial).opacity = theme.dark ? 0.35 : 0.16;
    this.invalidate();
  }

  setTool(tool: Tool) {
    this.tool = tool;
    this.canvas.style.cursor = tool === "punch" ? "crosshair" : "grab";
    this.hideTip();
    // The help text under the toolbar changes height with the tool.
    this.reserved = this.o.reserved?.() ?? [];
    this.invalidate();
  }

  /** Follow a change of the reduced-motion preference while the stage is open. */
  setReducedMotion(reduced: boolean) {
    this.reduced = reduced;
    this.specimen.reducedMotion = reduced;
    if (reduced) this.flight = null;
    this.specimen.setPlayhead(this.clock.t);
    this.bay?.reveal(this.specimen.playheadNow);
    this.invalidate();
  }

  setSelection(part: Part | null) {
    this.selected = part;
    this.specimen.setSelection(part ? partIndex(this.o.arch, part) : -1);
    this.specimen.setDrawer(part && "floor" in part ? part.floor : -1);
    this.invalidate();
  }

  setMarked(part: Part | null) {
    this.specimen.setMarked(part ? partIndex(this.o.arch, part) : -1);
    this.invalidate();
  }

  setValues(scaled: Float32Array | null, kind: "signed" | "size") {
    this.specimen.setValues(scaled, kind);
    this.specimen.setPlayhead(this.clock.t);
    this.invalidate();
  }

  setPoses(poses: Parameters<Specimen["setPoses"]>[0]) {
    this.specimen.setPoses(poses);
    this.shadowDirty = true;
    this.invalidate();
  }

  setFrozen(frozen: boolean[] | null) {
    this.specimen.setFrozen(frozen);
    this.invalidate();
  }

  /** The context the model read: a label and attention weight per tray slot, the slot just read, and its token id. */
  setTray(slots: { label: string; weight: number }[], current: number, lookup: number | null, arcsTo: Part | null) {
    this.specimen.setTray(slots.map((s) => s.weight), current, lookup);
    this.specimen.setArcs(arcsTo ? partIndex(this.o.arch, arcsTo) : -1, slots.map((s) => (Number.isNaN(s.weight) ? 0 : s.weight)));
    this.replaceLabels("token", slots.map((s, i) => ({
      text: s.label, className: `stage-label token${i === current ? " current" : ""}`, at: (out: THREE.Vector3) => { this.specimen.slotPosition(i, out); },
      anchor: [0.5, 0] as [number, number], nudge: [0, 5] as [number, number], priority: i === current ? 90 : 30,
      show: () => i === current || this.spacing("token") >= 34,
    })));
    this.invalidate();
  }

  /** Real candidate probabilities for the selected token, drawn as bars with their words. */
  setCandidates(list: { label: string; p: number; chosen: boolean }[]) {
    const shown = list.slice(0, MAX_BARS);
    this.specimen.setCandidates(shown);
    this.replaceLabels("bar", shown.map((c, i) => ({
      text: `${c.label} ${Math.round(c.p * 100)}%`, className: `stage-label bar${c.chosen ? " current" : ""}`, at: (out: THREE.Vector3) => { this.specimen.barTop(i, out); },
      anchor: [0.5, 1] as [number, number], nudge: [0, -3] as [number, number], priority: c.chosen ? 90 : 60,
      show: () => c.chosen || this.spacing("bar") >= 46,
    })));
    this.invalidate();
  }

  /**
   * Open, update or close the detail bay. The tower opens above the bay's layer, the decks above rise,
   * and the plates stand in the gap, so the detail stays where it belongs in the model.
   */
  setBay(spec: BaySpec | null) {
    const message = spec?.message ?? "";
    if (spec && this.bay && this.bay.spec.key === spec.key && message === this.bayMessage && this.bay.update(spec.plates)) { this.bay.reveal(this.specimen.playheadNow); this.invalidate(); return; }
    if (this.bay) { this.scene.remove(this.bay.group); this.bay.dispose(); this.bay = null; }
    this.bayMessage = message;
    this.room = 0;
    if (spec) {
      const a = this.o.arch, m = a.m, bay = new Bay(spec, this.theme, a.deckW), floor = Math.max(-1, Math.min(a.floors - 1, spec.floor));
      const below = floor < 0 ? m.plinthH : a.pos[partIndex(a, { kind: "layer", floor })][1] + m.deckT / 2 + m.saddleH + m.headH;
      this.room = bay.size.y + 0.75;
      bay.group.position.set(-bay.size.x / 2, below + 0.3 + bay.size.y, 0);
      this.bay = bay;
      bay.reveal(this.specimen.playheadNow);
      this.scene.add(bay.group);
      this.specimen.setGap(floor, this.room);
    } else this.specimen.setGap(null);
    const plates = this.bay?.labels() ?? [];
    this.replaceLabels("plate", [
      ...plates.map((l): LabelSpec => ({ text: l.text, className: "stage-label plate", at: (out) => { out.copy(l.at); }, anchor: [0.5, 1], nudge: [0, -2], priority: 50,
        show: () => this.pixels(l.at, l.width) >= 72 })),
      ...(this.bay && message ? [{ text: message, className: "stage-label message", anchor: [0.5, 0.5], priority: 100,
        at: (out) => { const g = this.bay!.group.position, s = this.bay!.size; out.set(g.x + s.x / 2, g.y - s.y / 2, g.z); } } satisfies LabelSpec] : []),
    ]);
    this.shadowDirty = true;
    if (this.pristine) this.fit(true);
    this.invalidate();
  }

  /** Height the tower is opened by for the bay. */
  private room = 0;

  get hasBay() { return !!this.bay; }

  setClock(clock: Clock) {
    this.clock = { ...clock, t: seek(clock.t, this.beats) };
    if (this.clock.playing && this.clock.t >= this.beats) this.clock.t = 0;
    this.specimen.setPlayhead(this.clock.t);
    this.bay?.reveal(this.specimen.playheadNow);
    this.invalidate();
  }

  resetLayout() {
    this.specimen.resetLayout();
    this.o.onArranged(0);
    this.shadowDirty = true;
    this.invalidate();
  }

  /** Play the hit or the refusal of a punch made from the keyboard or a button. */
  react(part: Part, accepted: boolean) {
    const i = partIndex(this.o.arch, part);
    if (accepted) this.specimen.kick(i); else this.specimen.refuse(i);
    this.invalidate();
  }

  /** Renderer statistics from the last frame. */
  info() {
    return { calls: this.renderer.info.render.calls, triangles: this.renderer.info.render.triangles, pixelRatio: this.renderer.getPixelRatio() };
  }

  // ---------------------------------------------------------------- labels

  private staticLabels() {
    const a = this.o.arch, m = a.m, front = m.deckD / 2, list: LabelSpec[] = [];
    const chosen = (L: number) => this.selected !== null && "floor" in this.selected && this.selected.floor === L;
    for (let L = 0; L < a.floors; L++) {
      const i = partIndex(a, { kind: "layer", floor: L });
      list.push({ text: String(L + 1), className: "stage-label layer", anchor: [1, 0.5], nudge: [-3, 0], priority: () => (chosen(L) ? 80 : 40),
        at: (out) => { this.specimen.center(i, out); out.x -= a.deckW / 2 + 0.16; out.z += front; },
        show: () => { const step = this.layerStep(); return L === 0 || (L + 1) % step === 0 || chosen(L); } });
    }
    const y = m.plinthH + 0.2;
    list.push({ text: `Attention heads · ${a.heads} per layer`, className: "stage-label caption", anchor: [0.5, 0], nudge: [0, 2], priority: 70,
      at: (out) => { out.set(a.bankX + (a.spineX - m.spineSlot / 2 - a.bankX) / 2, y, front); } });
    list.push({ text: "MLP", className: "stage-label caption", anchor: [0.5, 0], nudge: [0, 2], priority: 72, at: (out) => { out.set(a.mlpX, y, front); } });
    list.push({ text: "Words in", className: "stage-label caption", anchor: [0, 1], nudge: [0, -2], priority: 74, at: (out) => { out.set(-a.deckW / 2 - 0.3, m.plinthH, front + 0.62); } });
    list.push({ text: "Words out", className: "stage-label caption", anchor: [1, 0.5], nudge: [-6, 0], priority: 74,
      at: (out) => { const n = a.parts.length - 1; this.specimen.center(n, out); out.x -= a.size[n][0] / 2 + 0.2; } });
    this.replaceLabels("static", list);
  }

  private replaceLabels(group: string, list: LabelSpec[]) {
    this.labels = this.labels.filter((l) => { if (l.group === group) l.el.remove(); return l.group !== group; });
    for (const item of list) {
      const el = this.o.labels.ownerDocument.createElement("span");
      el.className = item.className; el.textContent = item.text;
      this.o.labels.append(el);
      // Measured once, while it is visible, so placing labels each frame never forces a layout.
      this.labels.push({ ...item, el, group, width: el.offsetWidth || item.text.length * 6.2 + 8, height: el.offsetHeight || 14 });
    }
  }

  private project(v: THREE.Vector3): boolean {
    v.project(this.camera);
    const ok = v.z > -1 && v.z < 1;
    v.set((v.x * 0.5 + 0.5) * this.width, (-v.y * 0.5 + 0.5) * this.height, v.z);
    return ok;
  }

  /** Pixels between the first two labels of a group, used to thin crowded labels. */
  private spacing(group: string): number {
    const [a, b] = this.labels.filter((l) => l.group === group);
    if (!a || !b) return Infinity;
    const p = new THREE.Vector3(), q = new THREE.Vector3();
    a.at(p); b.at(q); this.project(p); this.project(q);
    return Math.hypot(p.x - q.x, p.y - q.y);
  }

  private pixels(at: THREE.Vector3, width: number): number {
    const p = at.clone(), q = at.clone();
    q.x += width; this.project(p); this.project(q);
    return Math.hypot(p.x - q.x, p.y - q.y);
  }

  private layerStep(): number {
    const d = this.layerPixels;
    return d >= 13 ? 1 : d >= 6.5 ? 2 : d >= 3.4 ? 4 : 7;
  }

  private layerPixels = 20;

  private placeLabels() {
    const a = this.o.arch, p = new THREE.Vector3(), q = new THREE.Vector3();
    p.set(...a.pos[partIndex(a, { kind: "layer", floor: 0 })]); q.copy(p); q.y += a.m.pitch;
    this.project(p); this.project(q);
    this.layerPixels = Math.hypot(p.x - q.x, p.y - q.y);
    // Labels stay inside the view, clear of the toolbar, and give way to more important ones instead of overlapping.
    const W = this.width, H = this.height, placed: { label: Label; box: Box; priority: number }[] = [];
    for (const l of this.labels) {
      l.at(p);
      if (!this.project(p) || (l.show && !l.show()) || p.x < -8 || p.x > W + 8 || p.y < -8 || p.y > H + 8) { l.el.hidden = true; continue; }
      placed.push({ label: l, priority: typeof l.priority === "number" ? l.priority : l.priority(),
        box: placeBox(p.x + (l.nudge?.[0] ?? 0), p.y + (l.nudge?.[1] ?? 0), l.width, l.height, l.anchor[0], l.anchor[1], W, H) });
    }
    const shown = declutter(placed, this.reserved);
    placed.forEach(({ label, box }, i) => {
      label.el.hidden = !shown[i];
      if (shown[i]) label.el.style.transform = `translate(${box.left.toFixed(1)}px, ${box.top.toFixed(1)}px)`;
    });
  }

  // ---------------------------------------------------------------- pointer

  private aim(e: { clientX: number; clientY: number }) {
    const r = this.canvas.getBoundingClientRect();
    this.ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), this.camera);
    return r;
  }

  private pointerDown = (e: PointerEvent) => {
    this.hideTip();
    if (!e.isPrimary || e.button !== 0) return;
    this.down = { x: e.clientX, y: e.clientY, pointer: e.pointerId };
    if (this.tool !== "grab") return;
    this.aim(e);
    const i = this.specimen.pick(this.ray);
    if (i < 0 || !this.specimen.movable(i)) return;
    const center = this.specimen.center(i, new THREE.Vector3()), start = new THREE.Vector3();
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(this.camera.getWorldDirection(new THREE.Vector3()), center);
    if (!this.ray.ray.intersectPlane(plane, start)) return;
    this.drag = { part: i, plane, start, base: this.specimen.userOffset(i, new THREE.Vector3()), pointer: e.pointerId };
    this.controls.enabled = false;
    this.canvas.setPointerCapture?.(e.pointerId);
    this.canvas.style.cursor = "grabbing";
    this.o.onSelect(this.o.arch.parts[i]);
  };

  private pointerMove = (e: PointerEvent) => {
    if (this.drag && e.pointerId === this.drag.pointer) {
      this.aim(e);
      const at = new THREE.Vector3();
      if (this.ray.ray.intersectPlane(this.drag.plane, at)) {
        this.specimen.arrange(this.drag.part, at.sub(this.drag.start).add(this.drag.base));
        this.shadowDirty = true;
        this.invalidate();
      }
      return;
    }
    if (e.pointerType === "touch" || e.buttons) return;
    this.hoverAt = { x: e.clientX, y: e.clientY };
    this.invalidateHover();
  };

  private hoverFrame = 0;
  private invalidateHover() {
    if (this.hoverFrame) return;
    this.hoverFrame = requestAnimationFrame(() => {
      this.hoverFrame = 0;
      if (!this.hoverAt || this.disposed || !this.visible) return;
      const rect = this.aim({ clientX: this.hoverAt.x, clientY: this.hoverAt.y });
      const plate = this.bay?.pick(this.ray);
      const i = plate ? -1 : this.specimen.pick(this.ray);
      this.specimen.setHover(i);
      if (plate) this.showTip(this.plateTip(plate), this.hoverAt.x - rect.left, this.hoverAt.y - rect.top);
      else if (i >= 0) this.showTip(this.o.describe(this.o.arch.parts[i], this.tool), this.hoverAt.x - rect.left, this.hoverAt.y - rect.top);
      else if (!this.tipPinned) this.hideTip();
      this.canvas.style.cursor = this.tool === "punch" ? "crosshair" : i >= 0 && this.tool === "explore" ? "pointer" : "grab";
      this.invalidate();
    });
  }

  private pointerUp = (e: PointerEvent) => {
    const down = this.down;
    this.down = null;
    if (this.drag && e.pointerId === this.drag.pointer) {
      this.drag = null;
      this.controls.enabled = true;
      this.canvas.releasePointerCapture?.(e.pointerId);
      this.canvas.style.cursor = "grab";
      this.o.onArranged(this.specimen.arranged());
      return;
    }
    if (e.type !== "pointerup" || !down || down.pointer !== e.pointerId || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 6) return;
    const rect = this.aim(e);
    const plate = this.bay?.pick(this.ray);
    if (plate) {
      this.showTip(this.plateTip(plate), e.clientX - rect.left, e.clientY - rect.top, e.pointerType === "touch");
      return;
    }
    const i = this.specimen.pick(this.ray);
    if (i < 0) { this.o.onSelect(null); return; }
    const part = this.o.arch.parts[i];
    if (this.tool === "punch") {
      if (this.o.onPunch(part)) this.specimen.kick(i); else this.specimen.refuse(i);
      this.invalidate();
    }
    this.o.onSelect(part);
    if (e.pointerType === "touch") this.showTip(this.o.describe(part, this.tool), e.clientX - rect.left, e.clientY - rect.top, true);
  };

  /** A tile's readout: what the plate is, its shape, and the real number under the pointer. */
  private plateTip(hit: PlateHit): string {
    const p = hit.plate;
    return `${p.title} · ${p.shape}${p.formula ? `\n${p.formula}` : ""}\n${p.describe(hit.row, hit.col)}`;
  }

  private pointerLeave = () => {
    this.hoverAt = null;
    this.specimen.setHover(-1);
    if (!this.tipPinned) this.hideTip();
    this.invalidate();
  };

  private doubleClick = (e: MouseEvent) => {
    if (this.tool !== "explore") return;
    this.aim(e);
    if (this.bay?.pick(this.ray)) { this.focusBay(); return; }
    const i = this.specimen.pick(this.ray);
    if (i >= 0) this.focus(this.o.arch.parts[i]);
  };

  private contextLost = (e: Event) => {
    e.preventDefault();
    this.lost = true;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.o.onLost();
  };

  private showTip(text: string, x: number, y: number, pin = false) {
    const tip = this.o.tip;
    tip.textContent = text;
    tip.hidden = false;
    const left = Math.max(8, Math.min(this.width - 8 - Math.min(260, this.width - 16), x + 14));
    tip.style.transform = `translate(${left.toFixed(0)}px, ${Math.max(8, Math.min(this.height - 70, y + 16)).toFixed(0)}px)`;
    clearTimeout(this.tipPinned);
    this.tipPinned = pin ? (setTimeout(() => { this.tipPinned = 0; this.hideTip(); }, 3200) as unknown as number) : 0;
  }

  private hideTip() {
    clearTimeout(this.tipPinned);
    this.tipPinned = 0;
    this.o.tip.hidden = true;
  }

  // ---------------------------------------------------------------- cleanup

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    if (this.raf) cancelAnimationFrame(this.raf);
    if (this.hoverFrame) cancelAnimationFrame(this.hoverFrame);
    this.raf = 0; this.hoverFrame = 0;
    clearTimeout(this.tipPinned);
    for (const off of this.unlisten) off();
    this.unlisten.length = 0;
    this.resize.disconnect();
    this.seen.disconnect();
    this.controls.dispose();
    for (const l of this.labels) l.el.remove();
    this.labels = [];
    this.o.tip.hidden = true;
    this.bay?.dispose();
    this.bay = null;
    this.specimen.dispose();
    if (this.ground) { this.ground.geometry.dispose(); (this.ground.material as THREE.Material).dispose(); }
    this.key.shadow.map?.dispose();
    this.key.dispose(); this.fill.dispose();
    this.env?.dispose();
    this.scene.environment = null;
    this.scene.clear();
    this.renderer.dispose();
    // Browsers cap live WebGL contexts; release this one now instead of waiting for garbage collection.
    this.renderer.forceContextLoss();
    this.canvas.remove();
  }
}
