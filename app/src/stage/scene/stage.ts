// The 3D stage: one WebGL renderer drawing the specimen in its studio, on demand. It renders only when
// the camera, a spring, the replay or the data changed, pauses when hidden, and frees its GPU resources
// on dispose. It also owns the camera: fitting, focusing, named views, and what a drag or a click means.
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { type Arch, type Part, partIndex } from "../arch.ts";
import { type Box, declutter, dockInset, type Inset, placeBox, toolbarInset } from "../labels.ts";
import { beatAt, beatCount, beatLabel, seek } from "../playback.ts";
import { DARK, type Theme } from "../theme.ts";
import { modelPct } from "../../ui/color.ts";
import { Bay, type BaySpec, type PlateHit } from "./bay.ts";
import { along, ease, frame, type Pose, type ViewName, VIEWS } from "./camera.ts";
import { MAX_BARS, Specimen } from "./specimen.ts";
import { Studio, studioEnvironment } from "./studio.ts";

export type Tool = "explore" | "grab" | "punch";
/** What a plain drag does to the camera. */
export type DragMode = "turn" | "pan";
export type { BaySpec, ViewName };
export { frame };

/**
 * What moves the replay. The stage only lends it its frames: one call per drawn frame while the stage
 * is visible, so a replay stands still whenever the stage is hidden, off screen or gone.
 */
export interface ReplayDriver {
  readonly playing: boolean;
  frame(dtMs: number): void;
}

export interface StageOptions {
  /** The stage creates its own canvas here, so a remount always gets a fresh WebGL context. */
  host: HTMLElement;
  labels: HTMLElement;
  tip: HTMLElement;
  arch: Arch;
  theme: Theme;
  reducedMotion: boolean;
  /** Touch-first device: lower pixel ratio, simpler shapes and materials, and no shadow pass. */
  coarse: boolean;
  onSelect: (part: Part | null) => void;
  /** Run the real edit for a punch. Returns whether it was accepted. */
  onPunch: (part: Part) => boolean;
  describe: (part: Part, tool: Tool) => string;
  onLost: () => void;
  /** The stage stopped drawing: the tab was hidden, the stage scrolled out of sight, or its context was lost. */
  onHidden?: () => void;
  /** Number of parts dragged away from their sockets. */
  onArranged: (count: number) => void;
  /** Areas of the view taken by the toolbar, the help text and the camera dock, in view pixels. Labels and the framing keep clear of them. */
  reserved?: () => Box[];
  deps?: Partial<StageDeps>;
}

interface Controls {
  enabled: boolean; enableRotate: boolean; target: THREE.Vector3;
  minDistance?: number; maxDistance?: number;
  mouseButtons: { LEFT?: number | null }; touches: { ONE?: number | null };
  update(): boolean; dispose(): void;
  addEventListener(type: "start" | "change", f: () => void): void;
}

export interface StageDeps {
  renderer: (canvas: HTMLCanvasElement) => THREE.WebGLRenderer;
  controls: (camera: THREE.PerspectiveCamera, element: HTMLElement) => Controls;
  /** The studio's reflections. The stage owns what it gets and disposes it. */
  environment: (renderer: THREE.WebGLRenderer) => { texture: THREE.Texture; dispose(): void } | null;
}

const real: StageDeps = {
  renderer: (canvas) => new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: "high-performance" }),
  controls: (camera, element) => {
    const c = new OrbitControls(camera, element);
    c.enableDamping = true; c.dampingFactor = 0.1;
    c.zoomToCursor = true; c.screenSpacePanning = true;
    c.rotateSpeed = 0.9; c.zoomSpeed = 1.1;
    c.minPolarAngle = 0.08; c.maxPolarAngle = Math.PI * 0.56;
    return c as unknown as Controls;
  },
  environment: studioEnvironment,
};

interface LabelSpec {
  text: string; className: string; at: (out: THREE.Vector3) => void; show?: () => boolean;
  /** Which fraction of the label sits on its point, and a pixel nudge away from it. */
  anchor: [number, number]; nudge?: [number, number];
  /** Higher wins when two labels would touch. */
  priority: number | (() => number);
}
interface Label extends LabelSpec { el: HTMLElement; group: string; width: number; height: number }

/** The stage is a dark studio under either page theme, so it draws with the colors made for dark surroundings. */
const studioLook = (page: Theme): Theme => (page.dark ? page : { ...DARK });

/** How far, in pixels, a press may travel and still be a click, and how far from a part a click still reaches it. */
const SLOP = { mouse: 5, touch: 12 };
const DOUBLE_MS = 380;
const NOTHING = -1, PLATE = -2;

export class Stage {
  readonly specimen: Specimen;
  private readonly canvas: HTMLCanvasElement;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(30, 1, 0.1, 600);
  private readonly controls: Controls;
  private readonly studio: Studio;
  private readonly env: { texture: THREE.Texture; dispose(): void } | null;
  private readonly ray = new THREE.Raycaster();
  private readonly resize: ResizeObserver;
  private readonly seen: IntersectionObserver;
  private readonly unlisten: (() => void)[] = [];
  private bay: Bay | null = null;
  private bayMessage = "";
  private labels: Label[] = [];
  private tool: Tool = "explore";
  private dragMode: DragMode = "turn";
  /** Space is held: a drag pans for as long as it is. */
  private panHeld = false;
  private driver: ReplayDriver | null = null;
  /** The playhead as drawn, in steps, and where it is heading. Equal except while one step lights up. */
  private shown: number;
  private goal: number;
  private fadeMs = 0;
  /** A replay is on: the step it is at is bracketed and named in the scene. */
  private replaying = false;
  private raf = 0; private last = 0;
  private dirty = true; private shadowDirty = true;
  private onScreen = true; private width = 0; private height = 0;
  private lost = false; private disposed = false;
  /** True while the camera is where the stage last put it. A resize, an opening bay or a spread then reframe; once the visitor moves it, they do not. */
  private auto = true;
  /** The part the camera is centered on, or null for the whole model. */
  private subject: number | null = null;
  /** The direction the stage last framed from. */
  private dir = VIEWS.home.clone();
  private flight: { from: Pose; to: Pose; t: number; ms: number } | null = null;
  private drag: { part: number; plane: THREE.Plane; start: THREE.Vector3; base: THREE.Vector3; pointer: number; moved: boolean } | null = null;
  /** The press in progress. `strayed` once it has travelled past the slop or been joined by another pointer: from then on it is the camera's and can never become a click. */
  private down: { x: number; y: number; pointer: number; strayed: boolean; slop: number } | null = null;
  private readonly pointers = new Set<number>();
  private tap: { x: number; y: number; at: number; part: number } | null = null;
  private hoverAt: { x: number; y: number } | null = null;
  private selected: Part | null = null;
  private tipPinned = 0;
  /** What the tip on show describes: a part's index, PLATE for a tile of the detail bay, or NOTHING. */
  private tipOf = NOTHING;
  private readonly beats: number;
  private readonly shadows: boolean;
  private reduced: boolean;
  private reserved: Box[] = [];
  private look: Theme;

  constructor(private readonly o: StageOptions) {
    const deps = { ...real, ...o.deps }, a = o.arch;
    this.beats = beatCount(a.model);
    this.look = studioLook(o.theme);
    this.reduced = o.reducedMotion;
    this.shown = this.goal = this.beats;
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
    // Neutral tone mapping keeps hues where they are, so the lit inserts stay the page's orange and blue.
    r.toneMapping = THREE.NeutralToneMapping; r.toneMappingExposure = 1;
    r.shadowMap.enabled = this.shadows; r.shadowMap.type = THREE.PCFShadowMap; r.shadowMap.autoUpdate = false;
    r.setClearColor(0x0d0e10, 1);

    this.specimen = new Specimen(a, this.look, { shadows: this.shadows, quality: o.coarse ? "lite" : "high" });
    this.specimen.reducedMotion = o.reducedMotion;
    this.studio = new Studio(a, this.shadows, o.theme.dark);
    this.scene.add(this.studio.group, this.specimen.group);
    this.scene.background = this.studio.background;
    this.env = deps.environment(r);
    this.scene.environment = this.env?.texture ?? null;
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
    on("webglcontextlost", this.contextLost);
    const doc = o.host.ownerDocument, visibility = () => this.seenChanged();
    doc.addEventListener("visibilitychange", visibility);
    this.unlisten.push(() => doc.removeEventListener("visibilitychange", visibility));

    this.controls = deps.controls(this.camera, this.canvas);
    // Close enough to read the contacts on one module, never so far that the model is lost.
    const span = Math.max(a.bounds.max[0] - a.bounds.min[0], a.bounds.max[1] - a.bounds.min[1]);
    this.controls.minDistance = a.m.headW * 1.1;
    this.controls.maxDistance = span * 9;
    this.controls.addEventListener("start", () => { this.auto = false; this.flight = null; });
    this.controls.addEventListener("change", () => this.invalidate());

    this.resize = new ResizeObserver(() => this.measure());
    this.resize.observe(o.host);
    this.seen = new IntersectionObserver((entries) => { this.onScreen = entries[entries.length - 1]?.isIntersecting ?? true; this.seenChanged(); });
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

  /** The tab or the stage came into or went out of sight. Out of sight nothing is drawn and no replay moves. */
  private seenChanged() {
    if (this.visible) this.wake();
    else if (!this.disposed) this.o.onHidden?.();
  }

  private tick = (now: number) => {
    this.raf = 0;
    if (!this.visible) return;
    const dt = this.last ? Math.min(100, now - this.last) : 16;
    this.last = now;
    let active = this.dirty;
    this.dirty = false;
    if (this.shown !== this.goal) {
      // One step lighting up. It never runs past the step it was asked for.
      this.shown = this.fadeMs > 0 ? Math.min(this.goal, this.shown + dt / this.fadeMs) : this.goal;
      this.drawPlayhead();
      active = true;
    }
    if (this.flight) {
      const f = this.flight;
      f.t = Math.min(1, f.t + dt / f.ms);
      along(f.from, f.to, ease(f.t), { position: this.camera.position, target: this.controls.target });
      this.camera.lookAt(this.controls.target);
      if (f.t >= 1) this.flight = null;
      active = true;
    }
    if (this.controls.update()) active = true;
    if (this.specimen.step(dt / 1000)) { active = true; this.shadowDirty = true; }
    if (active) {
      this.seatBay();
      this.clip();
      // The shadow map is redrawn only on frames where something that casts a shadow moved.
      if (this.shadowDirty) { this.renderer.shadowMap.needsUpdate = this.shadows; this.shadowDirty = false; }
      this.renderer.render(this.scene, this.camera);
      this.placeLabels();
    }
    // The replay moves on after the frame is drawn, one step at most, so whatever it changes is drawn
    // whole by a later frame. Between steps nothing is redrawn unless the camera or a part is moving.
    const playing = !!this.driver?.playing;
    if (playing) this.driver!.frame(dt);
    if (!active && !playing) { this.last = 0; return; }
    if (!this.raf) this.raf = requestAnimationFrame(this.tick);
  };

  /** Keep the depth range tight around what is in view: close-ups stay crisp and distant surfaces do not flicker. */
  private clip() {
    const d = this.camera.position.distanceTo(this.controls.target), near = Math.max(0.02, d * 0.03), far = d + this.box().getSize(new THREE.Vector3()).length() * 3;
    if (Math.abs(near - this.camera.near) < this.camera.near * 0.02 && Math.abs(far - this.camera.far) < 1) return;
    this.camera.near = near; this.camera.far = far;
    this.camera.updateProjectionMatrix();
  }

  private measure() {
    const w = this.o.host.clientWidth, h = this.o.host.clientHeight;
    if (w === this.width && h === this.height) return;
    this.width = w; this.height = h;
    // Collapsed to nothing, as inside a closed sheet: out of sight like a hidden tab.
    if (!w || !h) { this.o.onHidden?.(); return; }
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.reserved = this.o.reserved?.() ?? [];
    if (this.auto) this.reframe(false);
    this.invalidate();
  }

  // ---------------------------------------------------------------- camera

  /** The whole specimen as it will stand once settled, with the room an open bay or a spread adds. */
  private box(): THREE.Box3 {
    const b = this.o.arch.bounds, box = new THREE.Box3(new THREE.Vector3(...b.min), new THREE.Vector3(...b.max));
    box.max.y += this.specimen.headroom;
    return box;
  }

  private bayBox(): THREE.Box3 {
    const g = this.bay!.group.position, s = this.bay!.size, y = this.bayY(true);
    return new THREE.Box3(new THREE.Vector3(g.x - 0.2, y - s.y - 0.2, g.z - 0.3), new THREE.Vector3(g.x + s.x + 0.2, y + 0.6, g.z + 0.3));
  }

  /** What to frame for one part: the part with enough of its surroundings to place it, and its detail bay when open. */
  private partBox(i: number): THREE.Box3 {
    const a = this.o.arch, m = a.m, part = a.parts[i], c = this.specimen.restCenter(i, new THREE.Vector3()), [w, h, d] = a.size[i];
    const box = new THREE.Box3();
    if (part.kind === "head" || part.kind === "mlp" || part.kind === "kv") {
      const reach = part.kind === "mlp" ? m.mlpW * 0.72 : part.kind === "kv" ? w * 1.3 : m.headW * 2.4;
      box.set(new THREE.Vector3(c.x - reach, c.y - m.pitch * 0.55, c.z - m.headD), new THREE.Vector3(c.x + reach, c.y + m.pitch * 0.7, c.z + m.headD));
    } else if (part.kind === "layer") {
      box.set(new THREE.Vector3(c.x - a.deckW / 2, c.y - m.pitch * 0.6, c.z - m.deckD * 0.6), new THREE.Vector3(c.x + a.deckW / 2, c.y + m.pitch * 1.1, c.z + m.deckD * 0.6));
    } else {
      const pad = part.kind === "norm" ? m.spineR * 6 : m.pitch * 0.5;
      box.set(new THREE.Vector3(c.x - w / 2 - pad, c.y - h / 2 - pad, c.z - d / 2 - pad), new THREE.Vector3(c.x + w / 2 + pad, c.y + h / 2 + pad + (part.kind === "unembed" ? a.barRoom : 0), c.z + d / 2 + pad));
    }
    if (this.bay && part.kind === "layer" && this.bay.spec.floor === part.floor) box.union(this.bayBox());
    return box;
  }

  /** Where the camera should stand to frame a box from a direction, clear of the toolbar above and the dock below. */
  private placement(box: THREE.Box3, dir: THREE.Vector3, margin?: number): Pose {
    // Leave room for token and layer labels at the edges, and for the overlays where they sit over the model.
    const W = this.width, H = this.height, edges: Inset = { top: 0, bottom: Math.min(0.1, 20 / H), side: Math.min(0.08, 16 / W) };
    let placed = frame(box, dir, this.camera.fov, this.camera.aspect, margin, edges);
    const half = (placed.span * W) / 2, top = toolbarInset(this.reserved, W / 2 - half, W / 2 + half, H), bottom = Math.max(edges.bottom, dockInset(this.reserved, W / 2 - half, W / 2 + half, H));
    if (top > 0 || bottom > edges.bottom) placed = frame(box, dir, this.camera.fov, this.camera.aspect, margin, { ...edges, top, bottom });
    return placed;
  }

  private fly(to: Pose, animate: boolean, ms = 520) {
    if (!animate || this.reduced) {
      this.flight = null;
      this.camera.position.copy(to.position); this.controls.target.copy(to.target);
      this.camera.lookAt(to.target);
    } else this.flight = { from: { position: this.camera.position.clone(), target: this.controls.target.clone() }, to, t: 0, ms };
    this.invalidate();
  }

  /** Frame the current subject again from the direction the stage last used. */
  private reframe(animate: boolean) {
    if (!this.width || !this.height) return;
    const whole = this.subject === null;
    this.fly(this.placement(whole ? this.box() : this.partBox(this.subject!), this.dir, whole ? 1.04 : 1.12), animate);
  }

  /** Home: frame the whole specimen (and the open detail bay) from the opening view. */
  resetView() {
    this.subject = null; this.auto = true;
    this.dir.copy(VIEWS.home);
    this.reframe(true);
  }

  /** Bring one part close and make it the pivot, keeping the direction the visitor is looking from. */
  focus(part: Part) {
    const i = partIndex(this.o.arch, part);
    if (i < 0 || !this.width || !this.height) return;
    this.subject = i; this.auto = true;
    this.dir.copy(this.camera.position).sub(this.controls.target).normalize();
    // From straight above or below there is nothing to pivot around; come down to the opening view.
    if (Math.abs(this.dir.y) > 0.9 || !Number.isFinite(this.dir.x)) this.dir.copy(VIEWS.home);
    this.reframe(true);
  }

  focusBay() {
    if (!this.bay || !this.width || !this.height) return;
    this.auto = false;
    this.fly(this.placement(this.bayBox(), VIEWS.front, 1.1), true);
  }

  /** Look at the current subject (the focused part, or the whole model) from a named direction. */
  view(name: ViewName) {
    this.auto = true;
    this.dir.copy(VIEWS[name]);
    this.reframe(true);
  }

  /** The part the camera is centered on, or null when it shows the whole model. */
  get focused(): Part | null { return this.subject === null ? null : this.o.arch.parts[this.subject]; }

  /** Zoom from a button or the keyboard: below 1 moves closer. The pivot stays where it is. */
  zoom(factor: number) {
    const from = this.flight?.to ?? { position: this.camera.position, target: this.controls.target };
    const offset = from.position.clone().sub(from.target);
    offset.setLength(Math.max(this.controls.minDistance ?? 1, Math.min(this.controls.maxDistance ?? 400, offset.length() * factor)));
    this.auto = false;
    this.fly({ position: from.target.clone().add(offset), target: from.target.clone() }, true, 180);
  }

  /** Keyboard orbit, in radians. */
  orbit(azimuth: number, polar: number) {
    const s = new THREE.Spherical().setFromVector3(this.camera.position.clone().sub(this.controls.target));
    s.theta += azimuth; s.phi = Math.max(0.08, Math.min(Math.PI * 0.56, s.phi + polar));
    this.camera.position.copy(this.controls.target).add(new THREE.Vector3().setFromSpherical(s));
    this.auto = false; this.flight = null;
    this.invalidate();
  }

  /** Whether a plain drag turns the model or slides the view. Either way the other is on the right button and on Shift. */
  setDragMode(mode: DragMode) {
    this.dragMode = mode;
    if (mode === "pan") this.cancelDrag();
    this.applyDrag();
  }

  /** Hold to pan: while Space is down a drag slides the view, whatever the tool. */
  holdPan(held: boolean) {
    this.panHeld = held;
    // A press already under way becomes the camera's too.
    if (held && this.down) this.down.strayed = true;
    if (held) this.cancelDrag();
    this.applyDrag();
  }

  private get panning() { return this.panHeld || this.dragMode === "pan"; }

  private applyDrag() {
    const pan = this.panning;
    this.controls.mouseButtons.LEFT = pan ? THREE.MOUSE.PAN : THREE.MOUSE.ROTATE;
    this.controls.touches.ONE = pan ? THREE.TOUCH.PAN : THREE.TOUCH.ROTATE;
    this.idleCursor();
  }

  private idleCursor() {
    this.canvas.style.cursor = this.panning ? "move" : this.tool === "punch" ? "crosshair" : "grab";
  }

  // ---------------------------------------------------------------- data from the page

  /** Follow the page's theme. The studio stays a studio; its backdrop is lighter beside a light page. */
  setTheme(theme: Theme) {
    this.look = studioLook(theme);
    this.specimen.setTheme(this.look);
    this.bay?.setTheme(this.look);
    if (this.studio.setTheme(theme.dark)) this.scene.background = this.studio.background;
    this.invalidate();
  }

  setTool(tool: Tool) {
    this.tool = tool;
    this.cancelDrag();
    this.tap = null;
    this.idleCursor();
    this.hideTip();
    this.overlaysChanged();
  }

  /** The toolbar, help text or dock changed size: measure them again so labels and framing keep clear. */
  overlaysChanged() {
    this.reserved = this.o.reserved?.() ?? [];
    // A flight already under way is steered to the new framing instead of being cut short.
    if (this.auto) this.reframe(!!this.flight);
    this.invalidate();
  }

  /** Follow a change of the reduced-motion preference while the stage is open. */
  setReducedMotion(reduced: boolean) {
    this.reduced = reduced;
    this.specimen.reducedMotion = reduced;
    if (reduced) { this.flight = null; this.shown = this.goal; }
    this.drawPlayhead();
    this.invalidate();
  }

  /**
   * The selection changed. While the camera is on a part it stays with the selection: reframed when the
   * visitor has not moved it, and otherwise carried across by the distance between the two parts, so
   * their own angle and zoom are kept. Showing the whole model, the camera stays where it is.
   */
  setSelection(part: Part | null) {
    const i = part ? partIndex(this.o.arch, part) : -1, before = this.subject === null ? null : this.specimen.restCenter(this.subject, new THREE.Vector3());
    this.selected = part;
    this.specimen.setSelection(i);
    this.specimen.setDrawer(part && "floor" in part ? part.floor : -1);
    if (this.subject !== null && i < 0) { this.subject = null; this.auto = false; }
    else if (this.subject !== null && before) {
      this.subject = i;
      if (this.auto) this.reframe(true);
      else {
        const by = this.specimen.restCenter(i, new THREE.Vector3()).sub(before);
        if (by.lengthSq() > 1e-8) this.fly({ position: this.camera.position.clone().add(by), target: this.controls.target.clone().add(by) }, true, 360);
      }
    }
    this.invalidate();
  }

  setMarked(part: Part | null) {
    this.specimen.setMarked(part ? partIndex(this.o.arch, part) : -1);
    this.invalidate();
  }

  setValues(scaled: Float32Array | null, kind: "signed" | "size") {
    this.specimen.setValues(scaled, kind);
    this.specimen.setPlayhead(this.shown);
    this.refreshTip();
    this.invalidate();
  }

  /**
   * What the tip describes has changed under a pointer that did not move: another token's values,
   * another layer's plates, a changed part. The tip is read again from where the pointer rests, so it
   * never keeps a number that is no longer under it. A tip pinned by a tap has no pointer to read
   * from: one about a part is written again for that part, and one about a tile is taken away when
   * the plates change.
   */
  private refreshTip(plates = false) {
    if (this.o.tip.hidden) return;
    if (this.hoverAt) this.invalidateHover();
    else if (this.tipOf === PLATE) { if (plates) this.hideTip(); }
    else if (this.tipOf >= 0) this.o.tip.textContent = this.o.describe(this.o.arch.parts[this.tipOf], this.tool);
  }

  setPoses(poses: Parameters<Specimen["setPoses"]>[0]) {
    this.specimen.setPoses(poses);
    this.shadowDirty = true;
    this.refreshTip();
    this.invalidate();
  }

  /**
   * Spread the layers apart for a look between them, from 0 (assembled) to 1. This moves the drawing
   * only: every part stays selectable and tethered, and the model is not touched.
   */
  setSpread(amount: number) {
    this.specimen.setSpread(amount);
    this.opened();
  }

  get spread() { return this.specimen.spread; }

  /** The tower changed height (a bay, a spread, a reset): fit the shadow to it, and the view when the visitor has not moved it. */
  private opened() {
    this.studio.frame(this.box());
    this.shadowDirty = true;
    if (this.auto) this.reframe(true);
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
    // A replay shows the result where the model produces it: after the last step. Before that neither a
    // bar nor a word is on the output, the written one included, and a plain note stands in their place.
    const out = () => this.specimen.outputShown;
    this.replaceLabels("bar", [...shown.map((c, i): LabelSpec => ({
      text: `${c.label} ${modelPct(c.p)}`, className: `stage-label bar${c.chosen ? " current" : ""}`, at: (v) => { this.specimen.barTop(i, v); },
      anchor: [0.5, 1], nudge: [0, -3], priority: c.chosen ? 90 : 60,
      show: () => out() && (c.chosen || this.spacing("bar") >= 46),
    })), ...(shown.length ? [{ text: "Not chosen yet", className: "stage-label bar pending", at: (v) => { this.specimen.barTop((shown.length - 1) / 2, v); },
      anchor: [0.5, 1], nudge: [0, -3], priority: 88, show: () => !out() } satisfies LabelSpec] : [])]);
    this.invalidate();
  }

  /**
   * Open, update or close the detail bay. The tower opens above the bay's layer, the decks above rise,
   * and the plates stand in the gap, so the detail stays where it belongs in the model.
   */
  setBay(spec: BaySpec | null) {
    const message = spec?.message ?? "";
    this.refreshTip(true);
    if (spec && this.bay && this.bay.spec.key === spec.key && message === this.bayMessage && this.bay.update(spec.plates)) { this.bay.reveal(this.specimen.playheadNow); this.invalidate(); return; }
    if (this.bay) { this.scene.remove(this.bay.group); this.bay.dispose(); this.bay = null; }
    this.bayMessage = message;
    if (spec) {
      const a = this.o.arch, bay = new Bay(spec, this.look, a.deckW);
      bay.group.position.x = -bay.size.x / 2;
      this.bay = bay;
      this.seatBay(true);
      bay.reveal(this.specimen.playheadNow);
      this.scene.add(bay.group);
      this.specimen.setGap(this.bayFloor, bay.size.y + 0.75);
    } else this.specimen.setGap(null);
    const bay = this.bay, plates = bay?.labels() ?? [];
    this.replaceLabels("plate", [
      ...plates.map((l): LabelSpec => ({ text: l.text, className: "stage-label plate", at: (out) => { out.copy(l.at).add(bay!.group.position); }, anchor: [0.5, 1], nudge: [0, -2], priority: 50,
        show: () => this.pixels(l.at.clone().add(bay!.group.position), l.width) >= 72 })),
      ...(bay && message ? [{ text: message, className: "stage-label message", anchor: [0.5, 0.5], priority: 100,
        at: (out) => { const g = bay.group.position, s = bay.size; out.set(g.x + s.x / 2, g.y - s.y / 2, g.z); } } satisfies LabelSpec] : []),
    ]);
    this.opened();
  }

  /** The layer the bay stands above, kept inside the model; -1 is the dictionary. */
  private get bayFloor() {
    return Math.max(-1, Math.min(this.o.arch.floors - 1, this.bay?.spec.floor ?? -1));
  }

  /** Top of the bay: just above the modules of its layer, wherever an opening or spreading tower has carried them. */
  private bayY(settled = false): number {
    const s = this.specimen;
    return s.moduleTop(this.bayFloor, settled) + 0.3 + this.bay!.size.y;
  }

  private seatBay(settled = false) {
    if (this.bay) this.bay.group.position.y = this.bayY(settled);
  }

  get hasBay() { return !!this.bay; }

  /**
   * The replay is on a token whose candidates have not been handed over yet. The output stays empty
   * until they arrive with setCandidates, so another token's result is never shown as this one's.
   * Live output is never held.
   */
  holdOutput(held = true) {
    held &&= this.replaying;
    if (held === this.specimen.held) return;
    this.specimen.holdOutput(held);
    this.hideOutput();
    this.invalidate();
  }

  /** Hand the stage a replay to move with its frames, or take it away. */
  setDriver(driver: ReplayDriver | null) {
    this.driver = driver;
    if (driver?.playing) this.wake();
  }

  /**
   * How much of the selected token is lit, in steps; null lights all of it. With `fadeMs`, moving on
   * by one step lights that step up over that time, and its plates come up in order. Anything else
   * (a scrub, a step back, another token, reduced motion) is shown at once.
   */
  setPlayhead(t: number | null, fadeMs = 0) {
    const goal = t === null ? this.beats : seek(t, this.beats), ahead = goal - this.shown;
    this.goal = goal; this.fadeMs = fadeMs; this.replaying = t !== null;
    if (t === null) this.specimen.holdOutput(false);
    if (!(fadeMs > 0 && !this.reduced && ahead > 0 && ahead <= 1)) this.shown = goal;
    this.drawPlayhead();
    this.hideOutput();
    this.invalidate();
  }

  private drawPlayhead() {
    this.specimen.setPlayhead(this.shown);
    this.bay?.reveal(this.specimen.playheadNow);
    // The step being lit, from its first frame: a position in the replay, not a measurement. Live has none.
    const step = this.replaying ? Math.max(0, Math.min(this.beats - 1, Math.ceil(this.goal) - 1)) : null;
    if (step === this.specimen.cursorNow) return;
    this.specimen.setCursor(step);
    this.replaceLabels("step", step === null ? [] : [{ text: beatLabel(beatAt(this.o.arch.model, step)), className: "stage-label step", anchor: [0, 0.5], nudge: [8, 0], priority: 96,
      at: (out) => { this.specimen.cursorAnchor(out); } }]);
  }

  /** Put dragged parts back and close the spread. The model and the camera's angle are left alone. */
  resetLayout() {
    this.cancelDrag();
    this.specimen.resetLayout();
    this.o.onArranged(0);
    this.opened();
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
        at: (out) => { this.specimen.center(i, out); out.x -= a.deckW / 2 + 0.36 * (m.headH / 0.3); out.z += front; },
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
      // Measured once, laid out but not painted, so placing labels each frame never forces a layout.
      // It then stays hidden until a drawn frame has placed it: a new label is never seen at the corner
      // of the stage, or before its own `show` has had a say.
      el.style.visibility = "hidden";
      this.o.labels.append(el);
      const width = el.offsetWidth || item.text.length * 6.2 + 8, height = el.offsetHeight || 14;
      el.hidden = true;
      el.style.visibility = "";
      this.labels.push({ ...item, el, group, width, height });
    }
  }

  /** Take the output's labels off at once when they may no longer be shown, without waiting for the next frame. */
  private hideOutput() {
    for (const l of this.labels) if (l.group === "bar" && l.show && !l.show()) l.el.hidden = true;
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

  private aim(x: number, y: number) {
    const r = this.canvas.getBoundingClientRect();
    this.ray.setFromCamera(new THREE.Vector2(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1), this.camera);
    return r;
  }

  /**
   * The part at a point of the view. A pointer just beside a part still reaches it, nearest first,
   * so small modules are not a test of aim; a pointer on a part always gets that part.
   */
  private partAt(x: number, y: number, slop: number): number {
    this.aim(x, y);
    let i = this.specimen.pick(this.ray);
    for (let ring = 1; i < 0 && ring <= 2; ring++) for (let k = 0; i < 0 && k < 8; k++) {
      const a = (k / 8) * Math.PI * 2, r = (slop * ring) / 2;
      this.aim(x + Math.cos(a) * r, y + Math.sin(a) * r);
      i = this.specimen.pick(this.ray);
    }
    return i;
  }

  private pointerDown = (e: PointerEvent) => {
    this.hideTip();
    // A primary pointer starts a new gesture; anything still listed from an interrupted one is stale.
    if (e.isPrimary) this.pointers.clear();
    this.pointers.add(e.pointerId);
    // A second finger makes this a camera gesture: it is not a click, and it lets go of a part being dragged.
    if (this.pointers.size > 1) { this.down = null; this.tap = null; this.cancelDrag(); return; }
    if (e.button !== 0) return;
    // Shift, Control or Command with a press is the camera's, and so is every press while Pan is on or Space is
    // held: Pan is for moving the view, so its clicks select nothing and change nothing.
    const aside = e.shiftKey || e.ctrlKey || e.metaKey || this.panning;
    this.down = { x: e.clientX, y: e.clientY, pointer: e.pointerId, strayed: aside, slop: e.pointerType === "touch" ? SLOP.touch : SLOP.mouse };
    if (this.tool !== "grab" || aside) return;
    this.aim(e.clientX, e.clientY);
    const i = this.specimen.pick(this.ray);
    if (i < 0 || !this.specimen.movable(i)) return;
    const center = this.specimen.center(i, new THREE.Vector3()), start = new THREE.Vector3();
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(this.camera.getWorldDirection(new THREE.Vector3()), center);
    if (!this.ray.ray.intersectPlane(plane, start)) return;
    this.drag = { part: i, plane, start, base: this.specimen.userOffset(i, new THREE.Vector3()), pointer: e.pointerId, moved: false };
    // The controls keep following the pointer, so a second finger can still pinch, but one finger no longer turns the model.
    this.controls.enableRotate = false;
    this.canvas.setPointerCapture?.(e.pointerId);
    this.canvas.style.cursor = "grabbing";
    this.o.onSelect(this.o.arch.parts[i]);
  };

  /** Let go of a part being dragged and put it back where the drag found it. */
  private cancelDrag() {
    if (!this.drag) return;
    this.specimen.arrange(this.drag.part, this.drag.base);
    this.endDrag();
  }

  private endDrag() {
    this.drag = null;
    this.controls.enableRotate = true;
    this.idleCursor();
    this.shadowDirty = true;
    this.o.onArranged(this.specimen.arranged());
    this.invalidate();
  }

  private pointerMove = (e: PointerEvent) => {
    // Where the pointer ends up does not matter: a drag that comes back to its start was still a drag.
    const down = this.down;
    if (down && e.pointerId === down.pointer && Math.hypot(e.clientX - down.x, e.clientY - down.y) > down.slop) down.strayed = true;
    if (this.drag && e.pointerId === this.drag.pointer) {
      // A press that has not travelled is still a click on the part. The part moves only once it has,
      // so a hand that trembles by a pixel does not leave it off its socket.
      if (!this.drag.moved && !down?.strayed) return;
      this.aim(e.clientX, e.clientY);
      const at = new THREE.Vector3();
      if (this.ray.ray.intersectPlane(this.drag.plane, at)) {
        this.drag.moved = true;
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
      const rect = this.aim(this.hoverAt.x, this.hoverAt.y);
      const plate = this.bay?.pick(this.ray);
      const i = plate || this.panning ? -1 : this.partAt(this.hoverAt.x, this.hoverAt.y, SLOP.mouse);
      this.specimen.setHover(i);
      if (plate) this.showTip(this.plateTip(plate), this.hoverAt.x - rect.left, this.hoverAt.y - rect.top, false, PLATE);
      else if (i >= 0) this.showTip(this.o.describe(this.o.arch.parts[i], this.tool), this.hoverAt.x - rect.left, this.hoverAt.y - rect.top, false, i);
      else if (!this.tipPinned) this.hideTip();
      if (i >= 0 && this.tool === "explore" && !this.panning) this.canvas.style.cursor = "pointer"; else this.idleCursor();
      this.invalidate();
    });
  }

  private pointerUp = (e: PointerEvent) => {
    this.pointers.delete(e.pointerId);
    const down = this.down;
    this.down = null;
    if (this.drag && e.pointerId === this.drag.pointer) {
      const { part, moved } = this.drag;
      if (e.type !== "pointerup") { this.cancelDrag(); return; }
      this.endDrag();
      // A press on a part that never moved it is a click on it: twice looks closer.
      if (!moved && !down?.strayed && this.twice(e, part)) this.focus(this.o.arch.parts[part]);
      return;
    }
    const touch = e.pointerType === "touch";
    if (e.type !== "pointerup" || !down || down.pointer !== e.pointerId || down.strayed || Math.hypot(e.clientX - down.x, e.clientY - down.y) > down.slop) return;
    const rect = this.aim(e.clientX, e.clientY);
    const plate = this.bay?.pick(this.ray);
    if (plate) {
      if (this.twice(e, -2)) this.focusBay();
      else this.showTip(this.plateTip(plate), e.clientX - rect.left, e.clientY - rect.top, touch, PLATE);
      return;
    }
    const i = this.partAt(e.clientX, e.clientY, touch ? SLOP.touch : SLOP.mouse), again = this.twice(e, i);
    if (i < 0) {
      // Twice on the backdrop is the way home.
      if (again) this.resetView(); else this.o.onSelect(null);
      return;
    }
    const part = this.o.arch.parts[i];
    if (this.tool === "punch") {
      if (this.o.onPunch(part)) this.specimen.kick(i); else this.specimen.refuse(i);
      this.invalidate();
    }
    this.o.onSelect(part);
    if (again && this.tool !== "punch") this.focus(part);
    else if (touch) this.showTip(this.o.describe(part, this.tool), e.clientX - rect.left, e.clientY - rect.top, true, i);
  };

  /** Whether this click is the second of a double click on the same thing. Punch never doubles: each of its clicks is an edit. */
  private twice(e: PointerEvent, part: number): boolean {
    const now = performance.now(), before = this.tap;
    const again = !!before && this.tool !== "punch" && before.part === part && now - before.at < DOUBLE_MS && Math.hypot(e.clientX - before.x, e.clientY - before.y) < 24;
    this.tap = again ? null : { x: e.clientX, y: e.clientY, at: now, part };
    return again;
  }

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

  private contextLost = (e: Event) => {
    e.preventDefault();
    this.lost = true;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.o.onHidden?.();
    this.o.onLost();
  };

  private showTip(text: string, x: number, y: number, pin = false, about = NOTHING) {
    const tip = this.o.tip;
    this.tipOf = about;
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
    this.tipOf = NOTHING;
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
    this.studio.dispose();
    // The environment's render target is ours to free.
    this.env?.dispose();
    this.scene.environment = null; this.scene.background = null;
    this.scene.clear();
    this.renderer.dispose();
    // Browsers cap live WebGL contexts; release this one now instead of waiting for garbage collection.
    this.renderer.forceContextLoss();
    this.canvas.remove();
  }
}
