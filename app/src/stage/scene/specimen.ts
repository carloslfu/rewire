// The model as an engineered specimen: one deck per layer carrying its attention heads (paired on
// their shared key/value socket), its MLP and its two add junctions on the residual stream, with the
// dictionary below and the output above. Shapes and materials are a drawing. Counts, the colors of the
// lit inserts and the poses are data: the chassis keeps its material whatever was measured.
import * as THREE from "three";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import { LineSegments2 } from "three/examples/jsm/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/examples/jsm/lines/LineSegmentsGeometry.js";
import { type Arch, layerChildren, partIndex } from "../arch.ts";
import type { Pose } from "../intervene.ts";
import { spring } from "../motion.ts";
import { beatCount, beatOf, lit } from "../playback.ts";
import { mix, type RGB, type Theme } from "../theme.ts";
import { box, cells, cornerScrews, deckShapes, headShapes, merge, mlpShapes, nameplate, rounded, shade, socketShapes, worldUV } from "./detail.ts";
import { createKit, type Kit, type Quality } from "./materials.ts";

const OX = 0, OY = 1, OZ = 2, ROLL = 3, TILT = 4, GROW = 5, CH = 6;
export const TRAY_SLOTS = 16;
export const MAX_BARS = 5;
const MAX_ARCS = 8;
const REACH = 9;
/** Extra room between layers at full spread, in pitches. */
const SPREAD = 1.25;
/** How far a module rises off its socket at full spread, in module heights. */
const UNSEAT = 0.8;

/** An insert with nothing measured: dark glass. Measured values run from here to the page's colors. */
const OFF: RGB = [42, 45, 54];
const GONE: RGB = [15, 16, 19];
/** Tints on the chassis: untouched, switched off, and frozen while teaching. */
const WHITE: RGB = [255, 255, 255], DULL: RGB = [104, 106, 112], DIM: RGB = [172, 174, 180];

export class Specimen {
  readonly group = new THREE.Group();
  private readonly kit: Kit;
  /** Meshes the pointer can hit. */
  private readonly pickable: THREE.Object3D[] = [];
  // Every instanced piece of one kind of part shares that part's matrix.
  private readonly headParts: THREE.InstancedMesh[]; private readonly mlpParts: THREE.InstancedMesh[];
  private readonly deckParts: THREE.InstancedMesh[]; private readonly socketParts: THREE.InstancedMesh[];
  private readonly decks: THREE.InstancedMesh; private readonly fascias: THREE.InstancedMesh; private readonly boards: THREE.InstancedMesh;
  private readonly saddles: THREE.InstancedMesh; private readonly saddleGlow: THREE.InstancedMesh;
  private readonly heads: THREE.InstancedMesh; private readonly headGlow: THREE.InstancedMesh;
  private readonly mlps: THREE.InstancedMesh; private readonly mlpGlow: THREE.InstancedMesh; private readonly sinks: THREE.InstancedMesh;
  private readonly stems: THREE.InstancedMesh; private readonly rings: THREE.InstancedMesh; private readonly collars: THREE.InstancedMesh;
  private readonly buses: THREE.InstancedMesh; private readonly posts: THREE.InstancedMesh;
  private readonly tokens: THREE.InstancedMesh; private readonly bars: THREE.InstancedMesh; private readonly belts: THREE.InstancedMesh;
  private readonly plinth: THREE.Mesh; private readonly crown: THREE.Mesh; private readonly crownGroup = new THREE.Group(); private readonly normRing: THREE.Mesh;
  private readonly lookupTile: THREE.Mesh;
  private readonly tubes: THREE.Mesh[]; private readonly flow: THREE.Mesh; private readonly pulse: THREE.Mesh;
  private readonly selectBox: LineSegments2; private readonly hoverBox: LineSegments2; private readonly markBox: LineSegments2;
  private readonly tethers: THREE.LineSegments;
  private readonly arcs = new THREE.Group();
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
  /** 0 to 1: how far the layers are spread apart for a look between them. Presentation only. */
  private spreadBy = 0;
  private playhead: number | null = null;
  private selected = -1; private hovered = -1; private marked = -1;
  private slots: number[] = []; private currentSlot = -1;
  private candidates: { p: number; chosen: boolean }[] = [];
  private arcSpec: { target: number; weights: number[] } | null = null;
  private lookup: number | null = null;
  private readonly spineY: [number, number];
  /** Height of the stream with the tower closed. */
  private tall = 1;
  private readonly rails: { x: number; z: number; height: number };
  private readonly tileAt: (i: number, out: THREE.Vector3) => THREE.Vector3;
  private readonly tileCount: number;
  private readonly anchors: Float32Array;
  private readonly u: number;
  private readonly stemLocal = new THREE.Matrix4(); private readonly mlpStemLocal = new THREE.Matrix4();
  private readonly M = new THREE.Matrix4(); private readonly M2 = new THREE.Matrix4(); private readonly M3 = new THREE.Matrix4();
  private readonly Q = new THREE.Quaternion(); private readonly E = new THREE.Euler(); private readonly V = new THREE.Vector3(); private readonly S = new THREE.Vector3();
  private readonly C = new THREE.Color();
  reducedMotion = false;

  constructor(readonly arch: Arch, private theme: Theme, opts: { shadows: boolean; quality?: Quality }) {
    const a = arch, m = a.m, F = a.floors, H = a.heads, KV = a.kvHeads, high = opts.quality !== "lite";
    const kit = this.kit = createKit(high ? "high" : "lite");
    this.n = a.parts.length;
    this.u = m.headH / 0.3;
    const u = this.u;
    this.cur = new Float32Array(this.n * CH); this.vel = new Float32Array(this.n * CH); this.tgt = new Float32Array(this.n * CH);
    this.user = new Float32Array(this.n * 3);
    this.poses = a.parts.map(() => ({ mult: 1, off: false, edited: false, roll: 0 }));

    const inst = (geo: THREE.BufferGeometry, mat: THREE.Material, count: number, o: { cast?: boolean; receive?: boolean; tint?: boolean; parent?: THREE.Object3D } = {}) => {
      const mesh = new THREE.InstancedMesh(this.shaded(geo, mat), mat, Math.max(1, count));
      mesh.count = count;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.frustumCulled = false;
      mesh.castShadow = !!o.cast && opts.shadows; mesh.receiveShadow = !!o.receive && opts.shadows;
      if (o.tint) for (let i = 0; i < Math.max(1, count); i++) mesh.setColorAt(i, this.C.setRGB(1, 1, 1));
      (o.parent ?? this.group).add(mesh);
      return mesh;
    };
    const solid = { cast: true, receive: true, tint: true };
    const head = a.size[partIndex(a, { kind: "head", floor: 0, head: 0 })], kv = a.size[partIndex(a, { kind: "kv", floor: 0, group: 0 })];
    const mlp = a.size[partIndex(a, { kind: "mlp", floor: 0 })], headZ = a.pos[partIndex(a, { kind: "head", floor: 0, head: 0 })][2];

    // ---- one deck per layer: plate, circuit board, drawer front and its steel
    const deck = deckShapes(a, u, high);
    this.decks = inst(deck.plate, kit.aluminum, F, solid);
    this.fascias = inst(deck.fascia, kit.aluminum, F, solid);
    this.boards = inst(deck.board, kit.board, F, { receive: true, tint: true });
    this.deckParts = [this.decks, this.fascias, this.boards, inst(deck.steel, kit.steel, F)];

    // ---- sockets and the modules seated in them
    const socket = socketShapes(kv, u, high);
    this.saddles = inst(socket.body, kit.graphite, F * KV, solid);
    this.saddleGlow = inst(socket.glow, kit.glow, F * KV, { tint: true });
    this.socketParts = [this.saddles, this.saddleGlow];
    const headShape = headShapes(head, u, high);
    this.heads = inst(headShape.body, kit.ceramic, F * H, solid);
    this.headGlow = inst(headShape.glow, kit.glow, F * H, { tint: true });
    this.headParts = [this.heads, inst(headShape.trim, kit.gold, F * H), this.headGlow];
    const mlpShape = mlpShapes(mlp, u, high, head[1] * 0.26, kit.nameplates.MLP);
    this.mlps = inst(mlpShape.body, kit.ceramic, F, solid);
    this.mlpGlow = inst(mlpShape.glow, kit.glow, F, { tint: true });
    this.sinks = inst(mlpShape.sink, kit.aluminum, F, { cast: true, tint: true });
    this.mlpParts = [this.mlps, inst(mlpShape.trim, kit.gold, F), this.mlpGlow, this.sinks, inst(mlpShape.steel, kit.steel, F), inst(mlpShape.badge, kit.plate, F)];
    // Cover glass over the lit inserts: reflections only, and only where the GPU budget allows.
    if (high) { this.headParts.push(inst(headShape.glass, kit.glass, F * H)); this.mlpParts.push(inst(mlpShape.glass, kit.glass, F)); }
    else { headShape.glass.dispose(); mlpShape.glass.dispose(); }

    // ---- copper: a tap from every module back to the bus that runs to the stream
    const barH = 0.035 * u, barY = 0.04 * u, stemLen = Math.max(0.02, headZ - head[2] / 2 - a.spineZ - 0.025 * u);
    this.stems = inst(box(0.045 * u, barH, stemLen), kit.copper, F * H + F);
    this.stemLocal.makeTranslation(0, barY - m.saddleH - head[1] / 2, -head[2] / 2 - stemLen / 2);
    this.mlpStemLocal.makeTranslation(0, barY - mlp[1] / 2, -mlp[2] / 2 - stemLen / 2);
    this.buses = inst(box(1, barH, 0.05 * u), kit.copper, F * 2);

    // ---- the residual stream: a glass tube with a lit ring and steel collar where each layer adds to it
    this.rings = inst(cells(new THREE.TorusGeometry(m.spineR * 1.6, m.spineR * 0.3, high ? 10 : 6, high ? 32 : 18), 16, 1).rotateX(Math.PI / 2), kit.glow, F * 2, { tint: true });
    const washer = (y: number) => new THREE.CylinderGeometry(m.spineR * 1.3, m.spineR * 1.3, 0.025 * u, high ? 24 : 12).translate(0, y, 0);
    this.collars = inst(merge([washer(m.spineR * 0.36), washer(-m.spineR * 0.36)]), kit.steel, F * 2);
    const crown = a.size[this.n - 1];
    this.spineY = [m.plinthH, a.pos[this.n - 1][1] - crown[1] / 2];
    const tall = this.spineY[1] - this.spineY[0], tube = new THREE.CylinderGeometry(m.spineR, m.spineR, tall, high ? 32 : 18, 1, true);
    this.tubes = [this.mesh(tube, kit.tube, false), this.mesh(new THREE.CylinderGeometry(m.spineR * 0.14, m.spineR * 0.14, tall, 8), kit.steel, false)];
    if (high) this.tubes.push(this.mesh(tube, kit.glass, false));
    this.flow = this.mesh(new THREE.CylinderGeometry(m.spineR * 0.5, m.spineR * 0.5, 1, 16).translate(0, 0.5, 0), new THREE.MeshBasicMaterial({ toneMapped: false }), false);
    this.flow.position.set(a.spineX, this.spineY[0], a.spineZ);
    this.pulse = this.mesh(new THREE.SphereGeometry(m.spineR * 0.95, 24, 16), new THREE.MeshBasicMaterial({ toneMapped: false }), false);
    this.pulse.visible = false;
    const ferrule = () => new THREE.CylinderGeometry(m.spineR * 1.35, m.spineR * 1.35, 0.08 * u, high ? 24 : 12);
    this.mesh(ferrule().translate(a.spineX, m.plinthH + 0.04 * u, a.spineZ), kit.gold, false);

    // ---- the dictionary: a machined base with its contact field, the context rail and a nameplate
    const embed = a.size[0], [ex, , ez] = a.pos[0], front = m.deckD / 2;
    this.plinth = this.mesh(worldUV(rounded(embed[0], embed[1], embed[2], 0.045 * u, high)), kit.aluminum, opts.shadows);
    this.plinth.position.set(...a.pos[0]);
    const trayW = a.deckW - 0.3, slotZ = front + 0.95, tokenD = Math.min(0.3 * u, 0.5);
    this.mesh(worldUV(merge([
      box(embed[0] - 0.3 * u, 0.012 * u, embed[2] - 0.3 * u, ex, m.plinthH + 0.004 * u, ez),
      box(trayW + 0.12 * u, 0.03 * u, tokenD + 0.1 * u, 0, m.plinthH + 0.015 * u, slotZ),
      box(embed[0] + 0.06 * u, 0.07 * u, embed[2] + 0.06 * u, ex, 0.035 * u, ez),
    ])), kit.graphite, opts.shadows);
    this.mesh(cornerScrews(embed, 0.07 * u, 0.2 * u, high).translate(...a.pos[0]), kit.steel, false);
    this.mesh(nameplate(kit.nameplates["WORDS IN"], m.plinthH * 0.36, -embed[0] / 2 + 0.3 * u, m.plinthH / 2, ez + embed[2] / 2 + 0.003 * u), kit.plate, false);
    const tileCols = F > 8 ? 48 : 24, tileW = trayW / tileCols, tileH = 0.04 * u;
    this.tileAt = (i, out) => out.set(-trayW / 2 + tileW * ((i % tileCols) + 0.5), m.plinthH + 0.01 * u + tileH / 2, front + 0.18 + Math.floor(i / tileCols) * 0.14);
    this.tileCount = tileCols * 3;
    const tiles = inst(box(tileW * 0.8, tileH, 0.1), kit.gold, this.tileCount, { receive: true });
    for (let i = 0; i < this.tileCount; i++) tiles.setMatrixAt(i, this.M.identity().setPosition(this.tileAt(i, this.V)));
    this.lookupTile = this.mesh(box(tileW * 0.8 + 0.012, tileH + 0.012, 0.112), new THREE.MeshBasicMaterial({ toneMapped: false }), false);
    this.lookupTile.visible = false;
    this.tokens = inst(box((trayW / TRAY_SLOTS) * 0.82, 0.12 * u, tokenD), kit.glow, TRAY_SLOTS, { tint: true });
    this.tokens.count = 0;

    // ---- the output: a block hung from the rack's top beam, with the final normalization below it
    this.group.add(this.crownGroup);
    this.crown = new THREE.Mesh(shade(worldUV(rounded(crown[0], crown[1], crown[2], 0.045 * u, high)), (_, n) => (n.y < -0.5 ? 0.5 : 1)), kit.aluminum);
    // Four posts outside the decks carry a frame at the top, and the output block hangs in it. The decks
    // slide out between the front posts.
    const post = 0.16 * u, px = a.deckW / 2 + Math.min(0.14 * u, (embed[0] - a.deckW) / 2 - post / 2 - 0.02), pz = front - 0.12 * u, beam = 0.14 * u;
    this.rails = { x: px, z: pz, height: a.pos[this.n - 1][1] + beam / 2 - m.plinthH };
    this.posts = inst(shade(worldUV(box(post, 1, post)), () => 0.92), kit.aluminum, 4, { cast: true });
    const hung: [THREE.BufferGeometry, THREE.Material][] = [
      [shade(worldUV(merge([box(px * 2 + post, beam, post, -a.spineX, 0, pz), box(px * 2 + post, beam, post, -a.spineX, 0, -pz), box(post, beam, pz * 2 - post, -a.spineX - px, 0, 0), box(post, beam, pz * 2 - post, -a.spineX + px, 0, 0)])), () => 0.92), kit.aluminum],
      [worldUV(box(crown[0] - 0.3 * u, 0.012 * u, crown[2] - 0.3 * u, 0, crown[1] / 2 + 0.004 * u, 0)), kit.graphite],
      [cornerScrews(crown, 0.05 * u, 0.16 * u, high), kit.steel],
      [nameplate(kit.nameplates["WORDS OUT"], crown[1] * 0.5, -crown[0] / 2 + 0.2 * u, 0, crown[2] / 2 + 0.003 * u), kit.plate],
      [ferrule().translate(0, -crown[1] / 2 - 0.04 * u, a.spineZ), kit.gold],
    ];
    for (const part of [this.crown, ...hung.map(([geo, mat]) => new THREE.Mesh(this.shaded(geo, mat), mat))]) { part.castShadow = part.receiveShadow = opts.shadows; this.crownGroup.add(part); }
    this.bars = inst(box(1, 1, 1, 0, 0.5, 0), kit.glow, MAX_BARS, { tint: true });
    this.bars.count = 0;
    this.normRing = this.mesh(new THREE.TorusGeometry(m.spineR * 2.6, m.spineR * 0.36, 12, 40).rotateX(Math.PI / 2), kit.chrome, opts.shadows);
    this.normRing.position.set(...a.pos[this.n - 2]);

    // ---- markers: bands on changed parts, outlines, tethers and attention arcs
    this.belts = inst(box(1, 1, 1), new THREE.MeshBasicMaterial({ toneMapped: false }), F * (H + 2) + 2);
    this.belts.count = 0;
    const cube = new THREE.BoxGeometry(1, 1, 1), edges = new THREE.EdgesGeometry(cube), outline = new LineSegmentsGeometry().fromEdgesGeometry(edges);
    cube.dispose(); edges.dispose();
    const line = (width: number, opacity: number, dashed = false) => {
      const l = new LineSegments2(outline, new LineMaterial({ linewidth: width, transparent: true, opacity, depthTest: false, toneMapped: false, dashed, dashSize: 0.09, gapSize: 0.06 }));
      if (dashed) l.computeLineDistances();
      l.matrixAutoUpdate = false; l.visible = false; l.renderOrder = 5; l.frustumCulled = false;
      this.group.add(l);
      return l;
    };
    this.selectBox = line(2.5, 1); this.hoverBox = line(1.5, 0.75); this.markBox = line(2.5, 1, true);
    const tether = new THREE.BufferGeometry();
    tether.setAttribute("position", new THREE.BufferAttribute(new Float32Array(F * (H + 2) * 6), 3).setUsage(THREE.DynamicDrawUsage));
    tether.setDrawRange(0, 0);
    this.tethers = new THREE.LineSegments(tether, new THREE.LineBasicMaterial({ transparent: true, opacity: 0.8, toneMapped: false }));
    this.tethers.frustumCulled = false;
    this.arcMaterial = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.85, toneMapped: false, depthWrite: false });
    this.group.add(this.tethers, this.arcs);

    // The replay marker climbs the stream through one anchor per beat boundary.
    const beats = beatCount(a.model);
    this.anchors = new Float32Array(beats + 1);
    this.anchors[0] = m.plinthH;
    for (let L = 0; L < F; L++) {
      this.anchors[1 + 2 * L] = this.ringY(L, 0);
      this.anchors[2 + 2 * L] = this.ringY(L, 1);
    }
    this.anchors[beats - 1] = a.pos[this.n - 2][1];
    this.anchors[beats] = this.spineY[1];

    this.pickable.push(this.heads, this.mlps, this.saddles, this.decks, this.fascias, this.plinth, this.crown, this.normRing);
    this.tall = tall;
    for (let i = 0; i < this.n; i++) this.apply(i);
    this.setTheme(theme);
    this.flush();
    this.refreshBounds();
    // Fixed meshes are placed once; picking must work before the first frame is drawn.
    this.group.updateMatrixWorld(true);
  }

  /** A material that reads a baked shade needs one on every geometry; a shape built without one is fully lit. */
  private shaded(geo: THREE.BufferGeometry, mat: THREE.Material): THREE.BufferGeometry {
    return mat.vertexColors && !geo.getAttribute("color") ? shade(geo) : geo;
  }

  private mesh(geo: THREE.BufferGeometry, mat: THREE.Material, shadows: boolean) {
    const mesh = new THREE.Mesh(this.shaded(geo, mat), mat);
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

  /** The part's placement from one set of channels: rest position, its deck's offset, its own offset and its pose. */
  private compose(i: number, c: Float32Array, out: THREE.Matrix4): THREE.Matrix4 {
    const [rx, ry, rz] = this.arch.pos[i], o = i * CH, d = this.layerOf(i);
    let x = rx + c[o + OX], y = ry + c[o + OY], z = rz + c[o + OZ];
    if (d >= 0) { x += c[d * CH + OX]; y += c[d * CH + OY]; z += c[d * CH + OZ]; }
    const grow = c[o + GROW];
    this.Q.setFromEuler(this.E.set(c[o + TILT], 0, c[o + ROLL]));
    return out.compose(this.V.set(x, y + grow * this.arch.size[i][1] / 2, z), this.Q, this.S.set(1, 1 + grow, 1));
  }

  /** Where the part is drawn right now. */
  private place(i: number, out = this.M): THREE.Matrix4 {
    return this.compose(i, this.cur, out);
  }

  /** Where the part's socket is: its place if it had never been dragged, lifted or changed. */
  private socket(i: number, out: THREE.Vector3): THREE.Vector3 {
    const [rx, ry, rz] = this.arch.pos[i], d = this.layerOf(i), c = this.cur;
    out.set(rx, ry, rz);
    if (d >= 0) out.set(rx + c[d * CH + OX], ry + c[d * CH + OY], rz + c[d * CH + OZ]);
    return out;
  }

  center(i: number, out: THREE.Vector3): THREE.Vector3 {
    return out.setFromMatrixPosition(this.place(i, this.M3));
  }

  /** Where the part will be once every spring has settled: what the camera should aim at. */
  restCenter(i: number, out: THREE.Vector3): THREE.Vector3 {
    return out.setFromMatrixPosition(this.compose(i, this.tgt, this.M3));
  }

  private apply(i: number) {
    const a = this.arch, p = a.parts[i], H = a.heads, KV = a.kvHeads;
    if (p.kind === "head") {
      const k = p.floor * H + p.head, M = this.place(i);
      for (const mesh of this.headParts) mesh.setMatrixAt(k, M);
      this.stems.setMatrixAt(k, this.M2.multiplyMatrices(M, this.stemLocal));
    } else if (p.kind === "mlp") {
      const M = this.place(i);
      for (const mesh of this.mlpParts) mesh.setMatrixAt(p.floor, M);
      this.stems.setMatrixAt(a.floors * H + p.floor, this.M2.multiplyMatrices(M, this.mlpStemLocal));
    } else if (p.kind === "kv") {
      const M = this.place(i);
      for (const mesh of this.socketParts) mesh.setMatrixAt(p.floor * KV + p.group, M);
    } else if (p.kind === "layer") {
      const c = this.cur, o = i * CH, m = a.m, M = this.place(i);
      for (const mesh of this.deckParts) mesh.setMatrixAt(p.floor, M);
      const busY = a.pos[i][1] + m.deckT / 2 + 0.04 * this.u + c[o + OY];
      for (const which of [0, 1] as const) {
        const x0 = which ? a.spineX : a.bankX, x1 = which ? a.mlpX : a.spineX;
        this.M.makeTranslation(a.spineX + c[o + OX], this.ringY(p.floor, which) + c[o + OY], a.spineZ + c[o + OZ]);
        this.rings.setMatrixAt(p.floor * 2 + which, this.M);
        this.collars.setMatrixAt(p.floor * 2 + which, this.M);
        this.buses.setMatrixAt(p.floor * 2 + which, this.M.compose(this.V.set((x0 + x1) / 2 + c[o + OX], busY, a.spineZ + c[o + OZ]), this.Q.identity(), this.S.set(x1 - x0, 1, 1)));
      }
      for (const child of layerChildren(a, p.floor)) this.apply(child);
    } else if (p.kind === "norm") {
      this.normRing.position.setFromMatrixPosition(this.place(i));
      this.normRing.updateMatrixWorld();
    } else if (p.kind === "unembed") {
      this.crownGroup.position.setFromMatrixPosition(this.place(i));
      this.crownGroup.updateMatrixWorld(true);
      this.stretch();
    }
  }

  /** How far the output block is currently lifted. */
  private get lift() { return this.cur[(this.n - 1) * CH + OY]; }

  /** The stream and the rack's posts reach from the dictionary to the output block, however far the tower is opened. */
  private stretch() {
    const a = this.arch, tall = this.tall + this.lift, k = tall / this.tall;
    for (const tube of this.tubes) { tube.scale.y = k; tube.position.set(a.spineX, this.spineY[0] + tall / 2, a.spineZ); }
    const high = this.rails.height + this.lift;
    for (let k = 0; k < 4; k++) this.posts.setMatrixAt(k, this.M.compose(this.V.set((k & 1 ? 1 : -1) * this.rails.x, a.m.plinthH + high / 2, (k & 2 ? 1 : -1) * this.rails.z), this.Q.identity(), this.S.set(1, high, 1)));
    this.posts.instanceMatrix.needsUpdate = true;
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
    for (const mesh of [...this.deckParts, ...this.socketParts, ...this.headParts, ...this.mlpParts, this.stems, this.rings, this.collars, this.buses]) mesh.instanceMatrix.needsUpdate = true;
    this.decorate();
  }

  private refreshBounds() {
    for (const mesh of [this.heads, this.mlps, this.saddles, this.decks, this.fascias]) { mesh.computeBoundingBox(); mesh.computeBoundingSphere(); }
  }

  // ---------------------------------------------------------------- state from the page

  setTheme(theme: Theme) {
    this.theme = theme;
    const set = (mat: { color: THREE.Color }, c: RGB) => mat.color.setRGB(c[0] / 255, c[1] / 255, c[2] / 255, THREE.SRGBColorSpace);
    set(this.flow.material as THREE.MeshBasicMaterial, theme.fg);
    set(this.pulse.material as THREE.MeshBasicMaterial, theme.fg);
    set(this.belts.material as THREE.MeshBasicMaterial, theme.changed);
    set(this.selectBox.material, theme.fg);
    set(this.hoverBox.material, theme.fg);
    set(this.markBox.material, theme.changed);
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

  /**
   * Spread the layers apart and lift the modules off their sockets, from 0 (assembled) to 1. Every
   * part stays where the pointer can reach it and tethered to its socket. The model is not touched.
   */
  setSpread(amount: number) {
    const next = Number.isFinite(amount) ? Math.max(0, Math.min(1, amount)) : 0;
    if (next === this.spreadBy) return;
    this.spreadBy = next;
    this.retarget();
  }

  get spread() { return this.spreadBy; }

  /**
   * How far the structure at a level is lifted once settled, by the open bay and the spread. Layers
   * are levels 0 and up, the final normalization half a level above the last, and the output one above.
   */
  private rise(level: number): number {
    return (this.gap.floor > -2 && level > this.gap.floor ? this.gap.height : 0) + this.spreadBy * SPREAD * this.arch.m.pitch * Math.max(0, level);
  }

  /** That lift as drawn right now, while the springs are still moving. Drags do not count. */
  lifted(level: number): number {
    const top = this.rise(this.arch.floors);
    return top > 1e-6 ? this.rise(level) * Math.max(0, Math.min(1, this.lift / top)) : 0;
  }

  /** Height of the tops of a layer's modules (of the dictionary for -1), wherever the bay and the spread have carried them, now or once settled. */
  moduleTop(floor: number, settled = false): number {
    const a = this.arch, m = a.m;
    if (floor < 0) return m.plinthH;
    return a.pos[partIndex(a, { kind: "layer", floor })][1] + m.deckT / 2 + m.saddleH + m.headH * (1 + this.spreadBy * UNSEAT) + (settled ? this.rise(floor) : this.lifted(floor));
  }

  /** How much taller the settled specimen is than the closed one. */
  get headroom(): number { return this.rise(this.arch.floors); }

  setPlayhead(t: number | null) {
    const n = beatCount(this.arch.model);
    this.playhead = t === null || t >= n ? null : this.reducedMotion ? Math.floor(t) : t;
    this.placeMarker();
    this.recolor();
    this.layoutBars();
  }

  /** The playhead as drawn: null when the replay is complete, whole steps under reduced motion. */
  get playheadNow(): number | null { return this.playhead; }

  /** Fraction of the stream reached at time t, passing each layer's junctions in order. */
  private height(t: number): number {
    const F = this.arch.floors, last = this.anchors.length - 1;
    const i = Math.max(0, Math.min(last - 1, Math.floor(t))), f = Math.max(0, Math.min(1, t - i));
    // Junctions rise with their decks when the tower is opened or spread.
    const at = (k: number) => this.anchors[k] + (k <= 0 ? 0 : this.lifted(k >= last ? F : k === last - 1 ? F - 0.5 : Math.floor((k - 1) / 2)));
    return (at(i) + (at(i + 1) - at(i)) * f - this.spineY[0]) / (this.tall + this.lift);
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
      this.tokens.setMatrixAt(i, this.M.compose(this.V.set(this.V.x, a.m.plinthH + 0.03 * this.u + 0.06 * this.u * tall, this.V.z), this.Q.identity(), this.S.set(1, tall, 1)));
    }
    this.tokens.instanceMatrix.needsUpdate = true;
    this.recolor();
  }

  slotPosition(i: number, out: THREE.Vector3): THREE.Vector3 {
    const a = this.arch, n = Math.max(1, this.slots.length), pitch = (a.deckW - 0.3) / TRAY_SLOTS;
    return out.set((i - (n - 1) / 2) * pitch, a.m.plinthH + 0.17 * this.u, a.m.deckD / 2 + 0.95);
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
    const a = this.arch, m = a.m, F = a.floors;
    for (let i = 0; i < this.n; i++) {
      const p = a.parts[i], pose = this.poses[i], o = i * CH;
      let x = this.user[i * 3], y = this.user[i * 3 + 1], z = this.user[i * 3 + 2], roll = 0, tilt = 0, grow = 0;
      if (p.kind === "head" || p.kind === "mlp") {
        const own = pose.mult === 0;
        if (own) { z -= m.headD * 0.85; tilt = -0.38; }
        roll = (pose.roll * Math.PI) / 180;
        grow = Math.abs(pose.mult) > 1 ? 0.2 * Math.log2(Math.abs(pose.mult)) : 0;
        y += this.spreadBy * UNSEAT * m.headH;
      } else if (p.kind === "layer") {
        if (p.floor === this.drawer) z += m.deckD * 0.9;
        else if (pose.off) z -= m.deckD * 0.8;
        y += this.rise(p.floor);
      } else if (p.kind === "norm") y += this.rise(F - 0.5);
      else if (p.kind === "unembed") y += this.rise(F);
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

  /** Put every dragged part back and close the spread. Poses that come from real changes stay. */
  resetLayout() {
    this.user.fill(0);
    this.spreadBy = 0;
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

  /** A measurement as the color of an insert: dark when unmeasured, toward the page's color as it grows. */
  private tint(v: number, k = 1): RGB {
    if (Number.isNaN(v)) return OFF;
    const th = this.theme, c = this.rampKind === "size" ? th.changed : v < 0 ? th.neg : th.pos;
    return mix(OFF, c, Math.min(1, Math.abs(v)) ** 0.7 * k);
  }

  private recolor() {
    const a = this.arch, th = this.theme, H = a.heads, KV = a.kvHeads;
    const t = this.playhead, model = a.model;
    const attention = new Float32Array(a.floors).fill(NaN);
    for (let i = 0; i < this.n; i++) {
      const p = a.parts[i], v = this.values ? this.values[i] : NaN, pose = this.poses[i];
      const k = Number.isNaN(v) ? 0 : lit(beatOf(model, p), t);
      const frozen = "floor" in p && !!this.frozen?.[p.floor];
      // The chassis only dims for a part that is off or frozen. Measured values color the inserts.
      const body = pose.off ? DULL : frozen ? DIM : WHITE;
      const insert = (c: RGB) => { let out = c; if (pose.off) out = mix(out, GONE, 0.82); if (frozen) out = mix(out, GONE, 0.5); return out; };
      if (p.kind === "head") {
        const at = p.floor * H + p.head;
        this.paint(this.heads, at, body);
        this.paint(this.headGlow, at, insert(this.tint(v, k)));
        if (!Number.isNaN(v)) attention[p.floor] = (Number.isNaN(attention[p.floor]) ? 0 : attention[p.floor]) + v * k;
      } else if (p.kind === "mlp") {
        this.paint(this.mlps, p.floor, body);
        this.paint(this.sinks, p.floor, body);
        this.paint(this.mlpGlow, p.floor, insert(this.tint(v, k)));
        this.paint(this.rings, p.floor * 2 + 1, insert(this.tint(v, k)));
      } else if (p.kind === "kv") {
        const at = p.floor * KV + p.group;
        this.paint(this.saddles, at, body);
        this.paint(this.saddleGlow, at, insert(this.tint(v, k)));
      } else if (p.kind === "layer") {
        for (const mesh of [this.decks, this.fascias, this.boards]) this.paint(mesh, p.floor, body);
      }
    }
    for (let L = 0; L < a.floors; L++) {
      const off = this.poses[partIndex(a, { kind: "layer", floor: L })].off, frozen = !!this.frozen?.[L], v = attention[L];
      let c = this.tint(Number.isNaN(v) ? NaN : Math.max(-1, Math.min(1, v)));
      if (off) c = mix(c, GONE, 0.82);
      if (frozen) c = mix(c, GONE, 0.5);
      this.paint(this.rings, L * 2, c);
    }
    // The dictionary row the model looked up lights only when its push was measured.
    const embed = this.values ? this.values[0] : NaN, tiles = this.lookupTile;
    tiles.visible = this.lookup !== null && !Number.isNaN(embed);
    if (tiles.visible) {
      const c = this.tint(embed, lit(0, t));
      (tiles.material as THREE.MeshBasicMaterial).color.setRGB(c[0] / 255, c[1] / 255, c[2] / 255, THREE.SRGBColorSpace);
      this.tileAt(this.lookup! % this.tileCount, tiles.position);
    }
    for (let i = 0; i < this.slots.length; i++) {
      const w = this.slots[i];
      this.paint(this.tokens, i, i === this.currentSlot ? mix(OFF, th.fg, 0.75) : Number.isNaN(w) ? mix(OFF, th.fg, 0.12) : mix(OFF, th.pos, Math.min(1, w) ** 0.7));
    }
    for (let i = 0; i < this.candidates.length; i++) this.paint(this.bars, i, this.candidates[i].chosen ? th.fg : mix(OFF, th.fg, 0.35));
    for (const mesh of [this.decks, this.fascias, this.boards, this.saddles, this.saddleGlow, this.heads, this.headGlow, this.mlps, this.mlpGlow, this.sinks, this.rings, this.tokens, this.bars]) {
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
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

  /** Bands on changed parts, tethers to parts away from their sockets, and the selection, hover and example outlines. */
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
      if (!this.movable(i) || (tethers + 1) * 6 > position.array.length) continue;
      const dragged = Math.hypot(this.user[i * 3], this.user[i * 3 + 1], this.user[i * 3 + 2]) > 0.05, lifted = p.kind !== "layer" && this.spreadBy > 0.02;
      if (dragged || lifted) {
        this.socket(i, from); this.center(i, at);
        position.setXYZ(tethers * 2, from.x, from.y, from.z); position.setXYZ(tethers * 2 + 1, at.x, at.y, at.z);
        tethers++;
      }
    }
    this.belts.count = belts;
    this.belts.instanceMatrix.needsUpdate = true;
    position.needsUpdate = true;
    this.tethers.geometry.setDrawRange(0, tethers * 2);
    const outline = (line: LineSegments2, i: number, pad: number) => {
      line.visible = i >= 0 && i < this.n;
      if (line.visible) { this.envelope(i, line.matrix, pad * this.u); line.matrixWorldNeedsUpdate = true; }
    };
    outline(this.selectBox, this.selected, 0.07);
    outline(this.hoverBox, this.hovered === this.selected ? -1 : this.hovered, 0.05);
    outline(this.markBox, this.marked, 0.11);
  }

  /** Tethers drawn right now, for the dragged and the lifted. */
  get tetherCount(): number { return this.tethers.geometry.drawRange.count / 2; }

  // ---------------------------------------------------------------- picking and cleanup

  /** The part under a ray, or -1. Trim, glass and fins are not pickable, so the module behind them answers. */
  pick(ray: THREE.Raycaster): number {
    const a = this.arch;
    for (const hit of ray.intersectObjects(this.pickable, false)) {
      const k = hit.instanceId ?? 0;
      if (hit.object === this.heads) return partIndex(a, { kind: "head", floor: Math.floor(k / a.heads), head: k % a.heads });
      if (hit.object === this.mlps) return partIndex(a, { kind: "mlp", floor: k });
      if (hit.object === this.saddles) return partIndex(a, { kind: "kv", floor: Math.floor(k / a.kvHeads), group: k % a.kvHeads });
      if (hit.object === this.decks || hit.object === this.fascias) return partIndex(a, { kind: "layer", floor: k });
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

  /** Textures generated for the materials, for the stage's accounting. */
  get textures(): THREE.Texture[] { return this.kit.textures; }

  dispose() {
    const geometries = new Set<THREE.BufferGeometry>(), materials = new Set<THREE.Material>(this.kit.materials);
    this.group.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.geometry) geometries.add(mesh.geometry);
      for (const mat of Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : []) materials.add(mat);
      if ((o as THREE.InstancedMesh).isInstancedMesh) (o as THREE.InstancedMesh).dispose();
    });
    materials.add(this.arcMaterial);
    for (const g of geometries) g.dispose();
    for (const mat of materials) mat.dispose();
    for (const t of this.kit.textures) t.dispose();
    this.crownGroup.clear();
    this.group.clear();
    this.active.clear();
  }
}
