// The model as an engineered specimen: one deck per layer carrying its attention heads (paired on
// their shared key/value base), its MLP and its two add junctions on the residual spine, with the
// dictionary below and the output above. Shapes are a drawing. Counts, colors and poses are data.
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { type Arch, layerChildren, partIndex } from "../arch.ts";
import type { Pose } from "../intervene.ts";
import { spring } from "../motion.ts";
import { beatCount, beatOf, lit } from "../playback.ts";
import { mix, ramp, type RGB, type Theme, unlit } from "../theme.ts";

const OX = 0, OY = 1, OZ = 2, ROLL = 3, TILT = 4, GROW = 5, CH = 6;
const FINS = 14;
export const TRAY_SLOTS = 16;
export const MAX_BARS = 5;
const MAX_ARCS = 8;
const REACH = 9;

export class Specimen {
  readonly group = new THREE.Group();
  /** Meshes the pointer can hit. */
  private readonly pickable: THREE.Object3D[] = [];
  private readonly decks: THREE.InstancedMesh; private readonly saddles: THREE.InstancedMesh; private readonly heads: THREE.InstancedMesh;
  private readonly lenses: THREE.InstancedMesh; private readonly stems: THREE.InstancedMesh; private readonly mlps: THREE.InstancedMesh;
  private readonly fins: THREE.InstancedMesh; private readonly rings: THREE.InstancedMesh; private readonly buses: THREE.InstancedMesh;
  private readonly tiles: THREE.InstancedMesh; private readonly tokens: THREE.InstancedMesh; private readonly bars: THREE.InstancedMesh;
  private readonly belts: THREE.InstancedMesh;
  private readonly plinth: THREE.Mesh; private readonly crown: THREE.Mesh; private readonly normRing: THREE.Mesh;
  private readonly glass: THREE.Mesh; private readonly core: THREE.Mesh; private readonly flow: THREE.Mesh; private readonly pulse: THREE.Mesh;
  private readonly selectBox: THREE.LineSegments; private readonly hoverBox: THREE.LineSegments; private readonly markBox: THREE.LineSegments;
  private readonly tethers: THREE.LineSegments;
  private readonly arcs = new THREE.Group();
  private readonly structure: THREE.MeshStandardMaterial; private readonly dark: THREE.MeshStandardMaterial;
  private readonly arcMaterial: THREE.MeshBasicMaterial;

  private readonly n: number;
  private readonly cur: Float32Array; private readonly vel: Float32Array; private readonly tgt: Float32Array;
  /** Where the visitor has dragged each part. Presentation only. */
  private readonly user: Float32Array;
  private readonly active = new Set<number>();
  private poses: Pose[] = [];
  private values: Float32Array | null = null;
  private rampKind: "signed" | "size" = "signed";
  private frozen: boolean[] | null = null;
  private drawer = -1;
  /** Everything above this layer is lifted by `height` to make room for the detail bay. -2 means closed. */
  private gap = { floor: -2, height: 0 };
  private playhead: number | null = null;
  private selected = -1; private hovered = -1; private marked = -1;
  private slots: number[] = []; private currentSlot = -1;
  private candidates: { p: number; chosen: boolean }[] = [];
  private arcSpec: { target: number; weights: number[] } | null = null;
  private lookup: number | null = null;
  private readonly spineY: [number, number];
  /** Height of the spine with the tower closed. */
  private tall = 1;
  private readonly anchors: Float32Array;
  private readonly u: number;
  private readonly finLocal: THREE.Matrix4[] = [];
  private readonly lensLocal = new THREE.Matrix4(); private readonly stemLocal = new THREE.Matrix4(); private readonly mlpStemLocal = new THREE.Matrix4();
  private readonly M = new THREE.Matrix4(); private readonly M2 = new THREE.Matrix4(); private readonly M3 = new THREE.Matrix4();
  private readonly Q = new THREE.Quaternion(); private readonly E = new THREE.Euler(); private readonly V = new THREE.Vector3(); private readonly S = new THREE.Vector3();
  private readonly C = new THREE.Color();
  reducedMotion = false;

  constructor(readonly arch: Arch, private theme: Theme, opts: { shadows: boolean }) {
    const a = arch, m = a.m, F = a.floors, H = a.heads, KV = a.kvHeads;
    this.n = a.parts.length;
    this.u = m.headH / 0.3;
    const u = this.u;
    this.cur = new Float32Array(this.n * CH); this.vel = new Float32Array(this.n * CH); this.tgt = new Float32Array(this.n * CH);
    this.user = new Float32Array(this.n * 3);
    this.poses = a.parts.map(() => ({ mult: 1, off: false, edited: false, roll: 0 }));

    this.structure = new THREE.MeshStandardMaterial({ metalness: 0.55, roughness: 0.42 });
    this.dark = new THREE.MeshStandardMaterial({ metalness: 0.85, roughness: 0.22 });
    const body = new THREE.MeshStandardMaterial({ metalness: 0.08, roughness: 0.5 });
    const plate = new THREE.MeshStandardMaterial({ metalness: 0.5, roughness: 0.45 });
    const inst = (geo: THREE.BufferGeometry, mat: THREE.Material, count: number, cast = true, receive = false) => {
      const mesh = new THREE.InstancedMesh(geo, mat, Math.max(1, count));
      mesh.count = count;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.frustumCulled = false;
      mesh.castShadow = cast && opts.shadows; mesh.receiveShadow = receive && opts.shadows;
      for (let i = 0; i < Math.max(1, count); i++) mesh.setColorAt(i, this.C.setRGB(1, 1, 1));
      this.group.add(mesh);
      return mesh;
    };
    const head = a.size[partIndex(a, { kind: "head", floor: 0, head: 0 })], kv = a.size[partIndex(a, { kind: "kv", floor: 0, group: 0 })];
    const mlp = a.size[partIndex(a, { kind: "mlp", floor: 0 })], headZ = a.pos[partIndex(a, { kind: "head", floor: 0, head: 0 })][2];
    this.decks = inst(new RoundedBoxGeometry(a.deckW, m.deckT, m.deckD, 2, m.deckT * 0.4), plate, F, true, true);
    this.saddles = inst(new THREE.BoxGeometry(kv[0], kv[1], kv[2]), plate, F * KV);
    this.heads = inst(new RoundedBoxGeometry(head[0], head[1], head[2], 2, Math.min(head[0], head[1]) * 0.12), body, F * H);
    const lensR = Math.min(head[0], head[1]) * 0.27, lensT = 0.03 * u;
    this.lenses = inst(new THREE.CylinderGeometry(lensR, lensR, lensT, 24).rotateX(Math.PI / 2), this.dark, F * H, false);
    this.lensLocal.makeTranslation(0, head[1] * 0.12, head[2] / 2 + lensT / 2 - 0.002);
    const busT = 0.07 * u, stemLen = Math.max(0.02, headZ - head[2] / 2 - a.spineZ - busT / 2);
    this.stems = inst(new THREE.BoxGeometry(0.07 * u, 0.07 * u, stemLen), this.dark, F * H + F, false);
    this.stemLocal.makeTranslation(0, -head[1] * 0.12, -head[2] / 2 - stemLen / 2);
    this.mlpStemLocal.makeTranslation(0, -mlp[1] * 0.12, -mlp[2] / 2 - stemLen / 2);
    this.mlps = inst(new RoundedBoxGeometry(mlp[0], mlp[1], mlp[2], 2, mlp[1] * 0.12), body, F);
    const finH = head[1] * 0.26;
    this.fins = inst(new THREE.BoxGeometry(0.035 * u, finH, mlp[2] * 0.78), this.dark, F * FINS, false);
    for (let k = 0; k < FINS; k++) this.finLocal.push(new THREE.Matrix4().makeTranslation((k / (FINS - 1) - 0.5) * mlp[0] * 0.84, mlp[1] / 2 + finH / 2 - 0.004, 0));
    this.rings = inst(new THREE.TorusGeometry(m.spineR * 1.7, m.spineR * 0.24, 10, 32).rotateX(Math.PI / 2), body, F * 2, false);
    this.buses = inst(new THREE.BoxGeometry(1, 1, 1), this.dark, F * 2, false);
    const embed = a.size[0];
    this.plinth = this.mesh(new RoundedBoxGeometry(embed[0], embed[1], embed[2], 2, 0.05 * u), this.structure, opts.shadows);
    this.plinth.position.set(...a.pos[0]);
    const tileCols = F > 8 ? 48 : 24, tileW = (a.deckW - 0.3) / tileCols;
    this.tiles = inst(new THREE.BoxGeometry(tileW * 0.8, 0.03 * u, 0.1), body, tileCols * 3, false);
    this.tiles.receiveShadow = opts.shadows;
    this.tokens = inst(new THREE.BoxGeometry((a.deckW - 0.3) / TRAY_SLOTS * 0.82, 0.12 * u, Math.min(0.3 * u, 0.5)), body, TRAY_SLOTS);
    const crown = a.size[this.n - 1];
    this.crown = this.mesh(new RoundedBoxGeometry(crown[0], crown[1], crown[2], 2, 0.05 * u), this.structure, opts.shadows);
    this.crown.position.set(...a.pos[this.n - 1]);
    this.bars = inst(new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0), body, MAX_BARS);
    this.normRing = this.mesh(new THREE.TorusGeometry(m.spineR * 2.6, m.spineR * 0.36, 12, 40).rotateX(Math.PI / 2), this.dark, opts.shadows);
    this.normRing.position.set(...a.pos[this.n - 2]);
    this.spineY = [m.plinthH, a.pos[this.n - 1][1] - crown[1] / 2];
    const tall = this.spineY[1] - this.spineY[0];
    const glass = new THREE.MeshStandardMaterial({ transparent: true, opacity: 0.22, metalness: 0.2, roughness: 0.08, depthWrite: false });
    this.glass = this.mesh(new THREE.CylinderGeometry(m.spineR, m.spineR, tall, 28, 1, true), glass, false);
    this.glass.position.set(a.spineX, this.spineY[0] + tall / 2, a.spineZ);
    this.core = this.mesh(new THREE.CylinderGeometry(m.spineR * 0.3, m.spineR * 0.3, tall, 12), this.dark, false);
    this.core.position.copy(this.glass.position);
    this.flow = this.mesh(new THREE.CylinderGeometry(m.spineR * 0.5, m.spineR * 0.5, 1, 16).translate(0, 0.5, 0), new THREE.MeshBasicMaterial({ toneMapped: false }), false);
    this.flow.position.set(a.spineX, this.spineY[0], a.spineZ);
    this.pulse = this.mesh(new THREE.SphereGeometry(m.spineR * 0.95, 24, 16), new THREE.MeshBasicMaterial({ toneMapped: false }), false);
    this.pulse.visible = false;
    this.belts = inst(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ toneMapped: false }), F * (H + 2) + 2, false);
    this.belts.count = 0;

    const edges = new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1));
    const line = (dashed: boolean, opacity: number) => {
      const mat = dashed ? new THREE.LineDashedMaterial({ dashSize: 0.09, gapSize: 0.06, transparent: true, depthTest: false, toneMapped: false })
        : new THREE.LineBasicMaterial({ transparent: true, opacity, depthTest: false, toneMapped: false });
      const l = new THREE.LineSegments(edges, mat);
      if (dashed) l.computeLineDistances();
      l.matrixAutoUpdate = false; l.visible = false; l.renderOrder = 5; l.frustumCulled = false;
      this.group.add(l);
      return l;
    };
    this.selectBox = line(false, 1); this.hoverBox = line(false, 0.5); this.markBox = line(true, 1);
    const tether = new THREE.BufferGeometry();
    tether.setAttribute("position", new THREE.BufferAttribute(new Float32Array(F * (H + 2) * 6), 3).setUsage(THREE.DynamicDrawUsage));
    tether.setDrawRange(0, 0);
    this.tethers = new THREE.LineSegments(tether, new THREE.LineBasicMaterial({ transparent: true, opacity: 0.7, toneMapped: false }));
    this.tethers.frustumCulled = false;
    this.arcMaterial = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.85, toneMapped: false, depthWrite: false });
    this.group.add(this.tethers, this.arcs);

    // The replay marker climbs the spine through one anchor per beat boundary.
    const beats = beatCount(a.model);
    this.anchors = new Float32Array(beats + 1);
    this.anchors[0] = m.plinthH;
    for (let L = 0; L < F; L++) {
      this.anchors[1 + 2 * L] = this.ringY(L, 0);
      this.anchors[2 + 2 * L] = this.ringY(L, 1);
    }
    this.anchors[beats - 1] = a.pos[this.n - 2][1];
    this.anchors[beats] = this.spineY[1];

    // Static pieces: dictionary tiles, buses.
    for (let i = 0; i < tileCols * 3; i++) {
      const c = i % tileCols, r = Math.floor(i / tileCols);
      this.tiles.setMatrixAt(i, this.M.makeTranslation(-a.deckW / 2 + 0.15 + tileW * (c + 0.5), m.plinthH + 0.015 * u, m.deckD / 2 + 0.18 + r * 0.14));
    }
    this.pickable.push(this.heads, this.mlps, this.saddles, this.decks, this.plinth, this.crown, this.normRing);
    this.tall = tall;
    for (let i = 0; i < this.n; i++) this.apply(i);
    this.setTheme(theme);
    this.flush();
    this.refreshBounds();
    // Fixed meshes are placed once; picking must work before the first frame is drawn.
    this.group.updateMatrixWorld(true);
  }

  private mesh(geo: THREE.BufferGeometry, mat: THREE.Material, shadows: boolean) {
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = shadows; mesh.receiveShadow = shadows;
    this.group.add(mesh);
    return mesh;
  }

  private ringY(floor: number, which: 0 | 1) {
    const m = this.arch.m, y = this.arch.pos[partIndex(this.arch, { kind: "layer", floor })][1];
    return y + m.deckT / 2 + (m.saddleH + m.headH) * (which ? 0.78 : 0.3);
  }

  private layerOf(i: number): number {
    const p = this.arch.parts[i];
    return p.kind === "head" || p.kind === "mlp" || p.kind === "kv" ? partIndex(this.arch, { kind: "layer", floor: p.floor }) : -1;
  }

  /** The part's current placement: rest position, its deck's offset, its own offset and its pose. */
  private place(i: number, out = this.M): THREE.Matrix4 {
    const [rx, ry, rz] = this.arch.pos[i], c = this.cur, o = i * CH, d = this.layerOf(i);
    let x = rx + c[o + OX], y = ry + c[o + OY], z = rz + c[o + OZ];
    if (d >= 0) { x += c[d * CH + OX]; y += c[d * CH + OY]; z += c[d * CH + OZ]; }
    const grow = c[o + GROW];
    this.Q.setFromEuler(this.E.set(c[o + TILT], 0, c[o + ROLL]));
    return out.compose(this.V.set(x, y + grow * this.arch.size[i][1] / 2, z), this.Q, this.S.set(1, 1 + grow, 1));
  }

  /** Where the part's socket is: its place if it had never been dragged or changed. */
  private socket(i: number, out: THREE.Vector3): THREE.Vector3 {
    const [rx, ry, rz] = this.arch.pos[i], d = this.layerOf(i), c = this.cur;
    out.set(rx, ry, rz);
    if (d >= 0) out.set(rx + c[d * CH + OX], ry + c[d * CH + OY], rz + c[d * CH + OZ]);
    return out;
  }

  center(i: number, out: THREE.Vector3): THREE.Vector3 {
    return out.setFromMatrixPosition(this.place(i, this.M3));
  }

  private apply(i: number) {
    const a = this.arch, p = a.parts[i], H = a.heads, KV = a.kvHeads;
    if (p.kind === "head") {
      const k = p.floor * H + p.head, M = this.place(i);
      this.heads.setMatrixAt(k, M);
      this.lenses.setMatrixAt(k, this.M2.multiplyMatrices(M, this.lensLocal));
      this.stems.setMatrixAt(k, this.M2.multiplyMatrices(M, this.stemLocal));
    } else if (p.kind === "mlp") {
      const M = this.place(i);
      this.mlps.setMatrixAt(p.floor, M);
      this.stems.setMatrixAt(a.floors * H + p.floor, this.M2.multiplyMatrices(M, this.mlpStemLocal));
      for (let k = 0; k < FINS; k++) this.fins.setMatrixAt(p.floor * FINS + k, this.M2.multiplyMatrices(M, this.finLocal[k]));
    } else if (p.kind === "kv") {
      this.saddles.setMatrixAt(p.floor * KV + p.group, this.place(i));
    } else if (p.kind === "layer") {
      const c = this.cur, o = i * CH, m = a.m, busT = 0.07 * this.u;
      this.decks.setMatrixAt(p.floor, this.place(i));
      for (const which of [0, 1] as const) {
        const y = this.ringY(p.floor, which) + c[o + OY], x0 = which ? a.spineX : a.bankX, x1 = which ? a.mlpX : a.spineX;
        this.rings.setMatrixAt(p.floor * 2 + which, this.M.makeTranslation(a.spineX + c[o + OX], y, a.spineZ + c[o + OZ]));
        this.buses.setMatrixAt(p.floor * 2 + which, this.M.compose(this.V.set((x0 + x1) / 2 + c[o + OX], this.ringY(p.floor, 0) - m.headH * 0.12 + c[o + OY], a.spineZ + c[o + OZ]),
          this.Q.identity(), this.S.set(x1 - x0, busT, busT)));
      }
      for (const child of layerChildren(a, p.floor)) this.apply(child);
    } else if (p.kind === "norm") {
      this.normRing.position.setFromMatrixPosition(this.place(i));
      this.normRing.updateMatrixWorld();
    } else if (p.kind === "unembed") {
      this.crown.position.setFromMatrixPosition(this.place(i));
      this.crown.updateMatrixWorld();
      this.stretch();
    }
  }

  /** How far the output block is currently lifted. */
  private get lift() { return this.cur[(this.n - 1) * CH + OY]; }

  /** The spine reaches from the dictionary to the output block, however far the tower is opened. */
  private stretch() {
    const a = this.arch, tall = this.tall + this.lift, k = tall / this.tall;
    for (const tube of [this.glass, this.core]) { tube.scale.y = k; tube.position.set(a.spineX, this.spineY[0] + tall / 2, a.spineZ); }
    this.placeMarker();
    this.layoutBars();
  }

  private placeMarker() {
    const tall = this.tall + this.lift, frac = this.playhead === null ? 1 : this.height(this.playhead);
    this.flow.scale.y = Math.max(1e-4, this.values ? frac * tall : 1e-4);
    this.flow.visible = !!this.values;
    this.pulse.visible = this.playhead !== null && !this.reducedMotion && !!this.values;
    this.pulse.position.set(this.arch.spineX, this.spineY[0] + frac * tall, this.arch.spineZ);
  }

  private flush() {
    for (const mesh of [this.decks, this.saddles, this.heads, this.lenses, this.stems, this.mlps, this.fins, this.rings, this.buses, this.tiles]) mesh.instanceMatrix.needsUpdate = true;
    this.decorate();
  }

  private refreshBounds() {
    for (const mesh of [this.heads, this.mlps, this.saddles, this.decks]) { mesh.computeBoundingBox(); mesh.computeBoundingSphere(); }
  }

  // ---------------------------------------------------------------- state from the page

  setTheme(theme: Theme) {
    this.theme = theme;
    const set = (mat: { color: THREE.Color }, c: RGB) => mat.color.setRGB(c[0] / 255, c[1] / 255, c[2] / 255, THREE.SRGBColorSpace);
    set(this.structure, mix(theme.panel, theme.fg, theme.dark ? 0.14 : 0.3));
    set(this.dark, theme.dark ? [16, 16, 20] : [52, 52, 60]);
    set(this.glass.material as THREE.MeshStandardMaterial, theme.dark ? [150, 170, 200] : [120, 140, 170]);
    set(this.flow.material as THREE.MeshBasicMaterial, theme.fg);
    set(this.pulse.material as THREE.MeshBasicMaterial, theme.fg);
    set(this.belts.material as THREE.MeshBasicMaterial, theme.changed);
    set(this.selectBox.material as THREE.LineBasicMaterial, theme.fg);
    set(this.hoverBox.material as THREE.LineBasicMaterial, theme.fg);
    set(this.markBox.material as THREE.LineDashedMaterial, theme.changed);
    set(this.tethers.material as THREE.LineBasicMaterial, theme.muted);
    set(this.arcMaterial, theme.pos);
    this.recolor();
  }

  /** Scaled values per part (NaN where unmeasured) and the ramp that colors them. */
  setValues(scaled: Float32Array | null, kind: "signed" | "size") {
    this.values = scaled && scaled.length === this.n ? scaled : null;
    this.rampKind = kind;
    this.recolor();
  }

  /** Poses derived from the active changes. Parts spring to them; reduced motion places them at once. */
  setPoses(poses: Pose[]) {
    if (poses.length !== this.n) return;
    this.poses = poses;
    this.retarget();
    this.recolor();
  }

  /** Layers drawn as frozen (Teach trains only the adapter). */
  setFrozen(frozen: boolean[] | null) {
    this.frozen = frozen;
    this.recolor();
  }

  /** The selected layer slides out of the rack like a drawer. */
  setDrawer(floor: number) {
    if (floor === this.drawer) return;
    this.drawer = floor;
    this.retarget();
  }

  /** Open the tower above a layer (-1 opens it above the dictionary) to seat the detail bay, or close it with null. */
  setGap(floor: number | null, height = 0) {
    const next = floor === null ? { floor: -2, height: 0 } : { floor, height };
    if (next.floor === this.gap.floor && next.height === this.gap.height) return;
    this.gap = next;
    this.retarget();
  }

  setPlayhead(t: number | null) {
    const n = beatCount(this.arch.model);
    this.playhead = t === null || t >= n ? null : this.reducedMotion ? Math.floor(t) : t;
    this.placeMarker();
    this.recolor();
    this.layoutBars();
  }

  /** The playhead as drawn: null when the replay is complete, whole steps under reduced motion. */
  get playheadNow(): number | null { return this.playhead; }

  /** Fraction of the spine reached at time t, passing each layer's junctions in order. */
  private height(t: number): number {
    const i = Math.max(0, Math.min(this.anchors.length - 2, Math.floor(t))), f = Math.max(0, Math.min(1, t - i));
    // Junctions above an opened gap have risen with their decks.
    const first = 1 + 2 * (this.gap.floor + 1), lift = this.lift;
    const at = (k: number) => this.anchors[k] + (this.gap.floor > -2 && k >= first ? lift : 0);
    return (at(i) + (at(i + 1) - at(i)) * f - this.spineY[0]) / (this.tall + lift);
  }

  setSelection(i: number) { this.selected = i; this.decorate(); }
  setHover(i: number) { if (i !== this.hovered) { this.hovered = i; this.decorate(); } }
  setMarked(i: number) { this.marked = i; this.decorate(); }

  /** The context tray: attention weight per slot (NaN when unmeasured) and which slot the model just read. */
  setTray(weights: number[], current: number, lookup: number | null) {
    this.slots = weights.slice(0, TRAY_SLOTS);
    this.currentSlot = current;
    this.lookup = lookup;
    const a = this.arch, n = this.slots.length;
    this.tokens.count = n;
    for (let i = 0; i < n; i++) {
      this.slotPosition(i, this.V);
      const tall = i === current ? 1.9 : 1;
      this.tokens.setMatrixAt(i, this.M.compose(this.V.set(this.V.x, a.m.plinthH + 0.06 * this.u * tall, this.V.z), this.Q.identity(), this.S.set(1, tall, 1)));
    }
    this.tokens.instanceMatrix.needsUpdate = true;
    this.recolor();
  }

  slotPosition(i: number, out: THREE.Vector3): THREE.Vector3 {
    const a = this.arch, n = Math.max(1, this.slots.length), pitch = (a.deckW - 0.3) / TRAY_SLOTS;
    return out.set((i - (n - 1) / 2) * pitch, a.m.plinthH + 0.14 * this.u, a.m.deckD / 2 + 0.95);
  }

  /** Real candidate probabilities as bars on the output block. */
  setCandidates(list: { p: number; chosen: boolean }[]) {
    this.candidates = list.slice(0, MAX_BARS);
    this.layoutBars();
    this.recolor();
  }

  private layoutBars() {
    const a = this.arch, n = this.candidates.length, top = a.pos[this.n - 1][1] + a.size[this.n - 1][1] / 2 + this.lift;
    const w = 0.34 * this.u, room = a.barRoom, k = lit(beatCount(a.model) - 1, this.playhead);
    this.bars.count = n;
    for (let i = 0; i < n; i++) {
      const p = Math.max(0, Math.min(1, this.candidates[i].p));
      this.bars.setMatrixAt(i, this.M.compose(this.V.set(a.spineX + (i - (n - 1) / 2) * w * 1.5, top, 0), this.Q.identity(), this.S.set(w, Math.max(0.02, p * room * k), w)));
    }
    this.bars.instanceMatrix.needsUpdate = true;
  }

  barTop(i: number, out: THREE.Vector3): THREE.Vector3 {
    const a = this.arch, n = this.candidates.length, top = a.pos[this.n - 1][1] + a.size[this.n - 1][1] / 2 + this.lift;
    const p = Math.max(0, Math.min(1, this.candidates[i]?.p ?? 0));
    return out.set(a.spineX + (i - (n - 1) / 2) * 0.34 * this.u * 1.5, top + Math.max(0.02, p * a.barRoom * lit(beatCount(a.model) - 1, this.playhead)), 0);
  }

  /** Attention of one head drawn as arcs from the context tray to the head. */
  setArcs(target: number, weights: number[]) {
    this.arcSpec = target >= 0 && weights.some((w) => w >= 0.02) ? { target, weights } : null;
    this.buildArcs();
  }

  private buildArcs() {
    for (const child of [...this.arcs.children]) { (child as THREE.Mesh).geometry.dispose(); this.arcs.remove(child); }
    const spec = this.arcSpec;
    if (!spec || this.active.size) return;
    const to = this.center(spec.target, new THREE.Vector3());
    to.z += this.arch.size[spec.target][2] / 2;
    const top = spec.weights.map((w, i) => ({ w, i })).filter((x) => x.w >= 0.02 && x.i < this.slots.length).sort((x, y) => y.w - x.w).slice(0, MAX_ARCS);
    for (const { w, i } of top) {
      const from = this.slotPosition(i, new THREE.Vector3()), mid = from.clone().lerp(to, 0.5);
      mid.z = Math.max(from.z, to.z) + 0.6 * this.u + 0.08 * Math.abs(to.y - from.y);
      const tube = new THREE.TubeGeometry(new THREE.QuadraticBezierCurve3(from, mid, to), 28, (0.012 + 0.05 * Math.sqrt(Math.min(1, w))) * this.u, 6);
      this.arcs.add(new THREE.Mesh(tube, this.arcMaterial));
    }
  }

  // ---------------------------------------------------------------- arrangement and motion

  private retarget() {
    const a = this.arch, m = a.m;
    for (let i = 0; i < this.n; i++) {
      const p = a.parts[i], pose = this.poses[i], o = i * CH;
      let x = this.user[i * 3], y = this.user[i * 3 + 1], z = this.user[i * 3 + 2], roll = 0, tilt = 0, grow = 0;
      if (p.kind === "head" || p.kind === "mlp") {
        const own = pose.mult === 0;
        if (own) { z -= m.headD * 0.85; tilt = -0.38; }
        roll = (pose.roll * Math.PI) / 180;
        grow = Math.abs(pose.mult) > 1 ? 0.2 * Math.log2(Math.abs(pose.mult)) : 0;
      } else if (p.kind === "layer") {
        if (p.floor === this.drawer) z += m.deckD * 0.9;
        else if (pose.off) z -= m.deckD * 0.8;
        if (this.gap.floor > -2 && p.floor > this.gap.floor) y += this.gap.height;
      } else if ((p.kind === "norm" || p.kind === "unembed") && this.gap.floor > -2) y += this.gap.height;
      const t = this.tgt;
      if (t[o + OX] !== x || t[o + OY] !== y || t[o + OZ] !== z || t[o + ROLL] !== roll || t[o + TILT] !== tilt || t[o + GROW] !== grow) {
        t[o + OX] = x; t[o + OY] = y; t[o + OZ] = z; t[o + ROLL] = roll; t[o + TILT] = tilt; t[o + GROW] = grow;
        this.active.add(i);
      }
    }
    if (this.reducedMotion) this.step(0);
  }

  movable(i: number): boolean {
    const k = this.arch.parts[i]?.kind;
    return k === "head" || k === "mlp" || k === "layer";
  }

  userOffset(i: number, out: THREE.Vector3): THREE.Vector3 {
    return out.set(this.user[i * 3], this.user[i * 3 + 1], this.user[i * 3 + 2]);
  }

  /** Put a part where the visitor dragged it. This rearranges the drawing and nothing else. */
  arrange(i: number, offset: THREE.Vector3) {
    if (!this.movable(i)) return;
    if (offset.length() > REACH) offset.setLength(REACH);
    this.user[i * 3] = offset.x; this.user[i * 3 + 1] = offset.y; this.user[i * 3 + 2] = offset.z;
    this.retarget();
  }

  /** How many parts sit away from their sockets. */
  arranged(): number {
    let n = 0;
    for (let i = 0; i < this.n; i++) if (Math.hypot(this.user[i * 3], this.user[i * 3 + 1], this.user[i * 3 + 2]) > 0.02) n++;
    return n;
  }

  resetLayout() {
    this.user.fill(0);
    this.retarget();
  }

  /** The hit of a punch: the part recoils and its neighbors on the deck jump. The pose that follows comes from the model. */
  kick(i: number) {
    if (this.reducedMotion) return;
    const a = this.arch, p = a.parts[i], o = i * CH;
    this.vel[o + OZ] -= 7 * this.u; this.vel[o + TILT] -= 5;
    this.active.add(i);
    if (p.kind === "layer") { this.vel[o + OY] -= 1.2 * this.u; return; }
    const d = this.layerOf(i);
    if (d < 0) return;
    this.vel[d * CH + OY] -= 0.9 * this.u; this.active.add(d);
    for (const j of layerChildren(a, (p as { floor: number }).floor)) {
      if (j === i || a.parts[j].kind === "kv") continue;
      const dist = Math.abs(a.pos[j][0] - a.pos[i][0]);
      if (dist < 1.6 * this.u) { this.vel[j * CH + OY] += (1.4 * this.u) / (1 + dist * 2); this.active.add(j); }
    }
  }

  /** A punch that could not run: the part shakes and stays where it is. */
  refuse(i: number) {
    if (this.reducedMotion || i < 0) return;
    this.vel[i * CH + OX] += 2.6 * this.u;
    this.active.add(i);
  }

  /** Advance the springs. Returns true while anything is still moving. */
  step(dt: number): boolean {
    if (!this.active.size) return false;
    for (const i of [...this.active]) {
      let rest = true;
      for (let ch = 0; ch < CH; ch++) {
        const k = i * CH + ch;
        if (this.reducedMotion) { this.cur[k] = this.tgt[k]; this.vel[k] = 0; }
        else if (!spring(this.cur, this.vel, this.tgt, k, dt)) rest = false;
      }
      this.apply(i);
      if (rest) this.active.delete(i);
    }
    this.flush();
    if (!this.active.size) { this.refreshBounds(); this.buildArcs(); }
    else if (this.arcs.children.length) this.buildArcs();
    return this.active.size > 0;
  }

  get settled() { return this.active.size === 0; }

  // ---------------------------------------------------------------- color and decoration

  private paint(mesh: THREE.InstancedMesh, i: number, c: RGB) {
    mesh.setColorAt(i, this.C.setRGB(c[0] / 255, c[1] / 255, c[2] / 255, THREE.SRGBColorSpace));
  }

  private recolor() {
    const a = this.arch, th = this.theme, H = a.heads, KV = a.kvHeads, zero = unlit(th);
    // Decks sit a clear step away from unlit modules in both themes, so the rack reads before any data arrives.
    const deck = mix(th.panel, th.fg, th.dark ? 0.09 : 0.36), saddle = mix(th.panel, th.fg, th.dark ? 0.03 : 0.5), gone = mix(th.bg, th.fg, th.dark ? 0.06 : 0.3);
    const t = this.playhead, model = a.model;
    const attention = new Float32Array(a.floors).fill(NaN);
    for (let i = 0; i < this.n; i++) {
      const p = a.parts[i], v = this.values ? this.values[i] : NaN, pose = this.poses[i];
      const k = Number.isNaN(v) ? 0 : lit(beatOf(model, p), t);
      const frozen = "floor" in p && !!this.frozen?.[p.floor];
      const shade = (c: RGB) => { let out = c; if (pose.off) out = mix(out, gone, 0.82); if (frozen) out = mix(out, th.bg, 0.5); return out; };
      if (p.kind === "head") {
        this.paint(this.heads, p.floor * H + p.head, shade(mix(zero, ramp(th, v, this.rampKind), k)));
        if (!Number.isNaN(v)) attention[p.floor] = (Number.isNaN(attention[p.floor]) ? 0 : attention[p.floor]) + v * k;
      } else if (p.kind === "mlp") {
        this.paint(this.mlps, p.floor, shade(mix(zero, ramp(th, v, this.rampKind), k)));
        this.paint(this.rings, p.floor * 2 + 1, shade(Number.isNaN(v) ? saddle : mix(saddle, ramp(th, v, this.rampKind), k)));
      } else if (p.kind === "kv") {
        this.paint(this.saddles, p.floor * KV + p.group, shade(Number.isNaN(v) ? saddle : mix(saddle, ramp(th, v, this.rampKind), k)));
      } else if (p.kind === "layer") {
        this.paint(this.decks, p.floor, shade(deck));
      }
    }
    for (let L = 0; L < a.floors; L++) {
      const off = this.poses[partIndex(a, { kind: "layer", floor: L })].off, frozen = !!this.frozen?.[L], v = attention[L];
      let c = Number.isNaN(v) ? saddle : ramp(th, Math.max(-1, Math.min(1, v)), this.rampKind);
      if (off) c = mix(c, gone, 0.82);
      if (frozen) c = mix(c, th.bg, 0.5);
      this.paint(this.rings, L * 2, c);
    }
    const embed = this.values ? this.values[0] : NaN, tileCount = this.tiles.count;
    const row = this.lookup === null ? -1 : this.lookup % tileCount;
    for (let i = 0; i < tileCount; i++) this.paint(this.tiles, i, i === row ? mix(zero, ramp(th, embed, this.rampKind), Number.isNaN(embed) ? 0 : lit(0, t)) : mix(zero, th.bg, 0.25));
    for (let i = 0; i < this.slots.length; i++) {
      const w = this.slots[i];
      this.paint(this.tokens, i, i === this.currentSlot ? mix(zero, th.fg, 0.75) : Number.isNaN(w) ? mix(zero, th.fg, 0.12) : mix(zero, th.pos, Math.min(1, w) ** 0.7));
    }
    for (let i = 0; i < this.candidates.length; i++) this.paint(this.bars, i, this.candidates[i].chosen ? th.fg : mix(zero, th.fg, 0.35));
    for (const mesh of [this.decks, this.saddles, this.heads, this.mlps, this.rings, this.tiles, this.tokens, this.bars]) if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }

  /** Outline size for a part: a layer is outlined with everything on its deck. */
  private envelope(i: number, out: THREE.Matrix4, pad: number): THREE.Matrix4 {
    const a = this.arch, p = a.parts[i], m = a.m, [w, h, d] = a.size[i], M = this.place(i, out);
    if (p.kind === "layer") {
      const tall = m.deckT + m.saddleH + m.headH;
      return M.multiply(this.M2.compose(this.V.set(0, (m.saddleH + m.headH) / 2, 0), this.Q.identity(), this.S.set(w + pad, tall + pad, d + pad)));
    }
    return M.multiply(this.M2.makeScale(w + pad, h + pad, d + pad));
  }

  /** Belts on changed parts, tethers to dragged ones, and the selection, hover and example outlines. */
  private decorate() {
    const a = this.arch;
    let belts = 0, tethers = 0;
    const position = this.tethers.geometry.getAttribute("position") as THREE.BufferAttribute;
    const at = new THREE.Vector3(), from = new THREE.Vector3();
    for (let i = 0; i < this.n; i++) {
      const p = a.parts[i], [w, h, d] = a.size[i];
      if (this.poses[i].edited && belts < this.belts.instanceMatrix.count) {
        const M = this.place(i, this.M3);
        if (p.kind === "head" || p.kind === "mlp") M.multiply(this.M2.compose(this.V.set(0, -h / 2 + h * 0.1, 0), this.Q.identity(), this.S.set(w + 0.05 * this.u, h * 0.2, d + 0.05 * this.u)));
        else M.multiply(this.M2.compose(this.V.set(0, 0, d / 2), this.Q.identity(), this.S.set(w + 0.03, h + 0.03, 0.07 * this.u)));
        this.belts.setMatrixAt(belts++, M);
      }
      if (this.movable(i) && Math.hypot(this.user[i * 3], this.user[i * 3 + 1], this.user[i * 3 + 2]) > 0.05 && (tethers + 1) * 6 <= position.array.length) {
        this.socket(i, from); this.center(i, at);
        position.setXYZ(tethers * 2, from.x, from.y, from.z); position.setXYZ(tethers * 2 + 1, at.x, at.y, at.z);
        tethers++;
      }
    }
    this.belts.count = belts;
    this.belts.instanceMatrix.needsUpdate = true;
    position.needsUpdate = true;
    this.tethers.geometry.setDrawRange(0, tethers * 2);
    const outline = (line: THREE.LineSegments, i: number, pad: number) => {
      line.visible = i >= 0 && i < this.n;
      if (line.visible) { this.envelope(i, line.matrix, pad * this.u); line.matrixWorldNeedsUpdate = true; }
    };
    outline(this.selectBox, this.selected, 0.07);
    outline(this.hoverBox, this.hovered === this.selected ? -1 : this.hovered, 0.05);
    outline(this.markBox, this.marked, 0.11);
  }

  // ---------------------------------------------------------------- picking and cleanup

  /** The part under a ray, or -1. Detail like lenses and fins is not pickable, so the module behind it answers. */
  pick(ray: THREE.Raycaster): number {
    const a = this.arch;
    for (const hit of ray.intersectObjects(this.pickable, false)) {
      const k = hit.instanceId ?? 0;
      if (hit.object === this.heads) return partIndex(a, { kind: "head", floor: Math.floor(k / a.heads), head: k % a.heads });
      if (hit.object === this.mlps) return partIndex(a, { kind: "mlp", floor: k });
      if (hit.object === this.saddles) return partIndex(a, { kind: "kv", floor: Math.floor(k / a.kvHeads), group: k % a.kvHeads });
      if (hit.object === this.decks) return partIndex(a, { kind: "layer", floor: k });
      if (hit.object === this.plinth) return 0;
      if (hit.object === this.crown) return this.n - 1;
      if (hit.object === this.normRing) return this.n - 2;
    }
    return -1;
  }

  /** Draw calls this specimen issues when everything is visible. */
  get drawCalls(): number {
    let n = 0;
    this.group.traverse((o) => { if ((o as THREE.Mesh).isMesh || (o as THREE.LineSegments).isLineSegments) n++; });
    return n;
  }

  dispose() {
    const geometries = new Set<THREE.BufferGeometry>(), materials = new Set<THREE.Material>();
    this.group.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.geometry) geometries.add(mesh.geometry);
      for (const mat of Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : []) materials.add(mat);
      if ((o as THREE.InstancedMesh).isInstancedMesh) (o as THREE.InstancedMesh).dispose();
    });
    materials.add(this.arcMaterial);
    for (const g of geometries) g.dispose();
    for (const mat of materials) mat.dispose();
    this.group.clear();
    this.active.clear();
  }
}
