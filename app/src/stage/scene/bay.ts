// The detail bay: a selected layer's real tensors or weight matrices as upright plates, in the order
// the computation uses them. Every tile is a number from the model; hovering reads it back.
import * as THREE from "three";
import { paint, type Plate } from "../adapters.ts";
import { plateLit } from "../playback.ts";
import { mix, ramp, type Theme } from "../theme.ts";

export interface BaySpec {
  /** Changes when the bay shows something different (another layer, another kind of content). */
  key: string;
  /** The layer the bay stands above; -1 places it between the dictionary and the first layer. */
  floor: number;
  plates: Plate[];
  /** Shown in place of plates when there is nothing measured to draw. */
  message?: string;
  /** Fixed plate sizes for plates that must line up (the adapter's three matrices). */
  sizes?: Record<string, [number, number]>;
}

export interface PlateHit { plate: Plate; row: number; col: number }

const PLATE_W = 1.7, PLATE_H = 1.25, MIN_H = 0.62, GAP = 0.28, LABEL = 0.42;

/**
 * Physical size of a plate. Wide tensors keep a readable height, so their tiles are taller than they
 * are wide; the numbers are unchanged.
 */
export function plateSize(p: Pick<Plate, "rows" | "cols" | "id">, sizes?: BaySpec["sizes"]): [number, number] {
  const fixed = sizes?.[p.id];
  if (fixed) return fixed;
  const aspect = p.cols / p.rows;
  return aspect >= PLATE_W / PLATE_H ? [PLATE_W, Math.max(MIN_H, PLATE_W / aspect)] : [Math.max(0.3, PLATE_H * aspect), PLATE_H];
}

/**
 * Lay plates out in reading order: each band starts a new line and a line wraps at `maxWidth`. Lines
 * are as tall as their tallest plate, with room above for titles. Positions are plate centers.
 */
export function layoutPlates(plates: Plate[], maxWidth: number, sizes?: BaySpec["sizes"]) {
  const lines: { w: number; h: number; x: number }[][] = [];
  let x = 0, band = plates[0]?.band ?? 0;
  for (const p of plates) {
    const [w, h] = plateSize(p, sizes);
    if (!lines.length || p.band !== band || (x > 0 && x + w > maxWidth)) { lines.push([]); x = 0; band = p.band; }
    lines[lines.length - 1].push({ w, h, x: x + w / 2 });
    x += w + GAP;
  }
  const at: { x: number; y: number; w: number; h: number }[] = [];
  let y = 0, width = 0;
  for (const line of lines) {
    const tall = Math.max(...line.map((p) => p.h));
    y -= LABEL;
    // Plates on a line share a baseline.
    for (const p of line) at.push({ x: p.x, y: y - tall + p.h / 2, w: p.w, h: p.h });
    y -= tall;
    width = Math.max(width, line[line.length - 1].x + line[line.length - 1].w / 2);
  }
  return { at, width, height: -y };
}

export class Bay {
  readonly group = new THREE.Group();
  readonly size = new THREE.Vector2();
  private plates: { plate: Plate; mesh: THREE.Mesh; texture: THREE.DataTexture; rows: number; cols: number }[] = [];
  private readonly frame: THREE.MeshStandardMaterial;
  private readonly lines: THREE.LineSegments;

  constructor(readonly spec: BaySpec, private theme: Theme, maxWidth: number) {
    this.frame = new THREE.MeshStandardMaterial({ metalness: 0.5, roughness: 0.45 });
    const { at, width, height } = layoutPlates(spec.plates, maxWidth, spec.sizes);
    this.size.set(Math.max(width, 2.4), Math.max(height, 1));
    const links: number[] = [];
    spec.plates.forEach((plate, i) => {
      const { x, y, w, h } = at[i];
      const texture = new THREE.DataTexture(new Uint8Array(plate.rows * plate.cols * 4), plate.cols, plate.rows, THREE.RGBAFormat);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.magFilter = THREE.NearestFilter; texture.minFilter = THREE.LinearFilter;
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: texture, toneMapped: false }));
      mesh.position.set(x, y, 0.035);
      const back = new THREE.Mesh(new THREE.BoxGeometry(w + 0.08, h + 0.08, 0.06), this.frame);
      back.position.set(x, y, 0);
      this.group.add(back, mesh);
      this.plates.push({ plate, mesh, texture, rows: plate.rows, cols: plate.cols });
      const next = at[i + 1];
      if (next && Math.abs(next.y - y) < 1e-6) links.push(x + w / 2 + 0.04, y, 0, next.x - next.w / 2 - 0.04, next.y, 0);
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(links), 3));
    this.lines = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ toneMapped: false }));
    this.group.add(this.lines);
    this.setTheme(theme);
  }

  setTheme(theme: Theme) {
    this.theme = theme;
    const c = mix(theme.panel, theme.fg, theme.dark ? 0.14 : 0.3);
    this.frame.color.setRGB(c[0] / 255, c[1] / 255, c[2] / 255, THREE.SRGBColorSpace);
    (this.lines.material as THREE.LineBasicMaterial).color.setRGB(theme.muted[0] / 255, theme.muted[1] / 255, theme.muted[2] / 255, THREE.SRGBColorSpace);
    this.repaint();
  }

  /** Same plates, new numbers (a training snapshot). Returns false when the shapes differ and the bay must be rebuilt. */
  update(plates: Plate[]): boolean {
    if (plates.length !== this.plates.length || plates.some((p, i) => p.id !== this.plates[i].plate.id || p.rows !== this.plates[i].rows || p.cols !== this.plates[i].cols)) return false;
    plates.forEach((p, i) => { this.plates[i].plate = p; });
    this.repaint();
    return true;
  }

  private repaint() {
    for (const { plate, texture, rows, cols } of this.plates) {
      const bytes = paint(plate, (v, kind) => {
        const [r, g, b] = ramp(this.theme, v, kind);
        return [Math.round(r), Math.round(g), Math.round(b)];
      });
      // Row 0 of the data is drawn at the top of the plate.
      const out = texture.image.data as Uint8Array;
      for (let r = 0; r < rows; r++) out.set(bytes.subarray(r * cols * 4, (r + 1) * cols * 4), (rows - 1 - r) * cols * 4);
      texture.needsUpdate = true;
    }
  }

  /**
   * Follow the replay: plates of the layer's attention and MLP beats come up in computation order as
   * the playhead crosses them, and plates not yet computed stay dim. Null shows everything.
   */
  reveal(playhead: number | null) {
    const count = { attention: 0, mlp: 0 }, seen = { attention: 0, mlp: 0 };
    for (const { plate } of this.plates) if (plate.phase) count[plate.phase]++;
    for (const { plate, mesh } of this.plates) {
      const k = plate.phase ? plateLit(this.spec.floor, plate.phase, seen[plate.phase]++, count[plate.phase], playhead) : 1;
      (mesh.material as THREE.MeshBasicMaterial).color.setScalar(0.2 + 0.8 * k);
    }
  }

  /** How lit each plate currently is, from 0.2 (not yet computed) to 1. */
  levels(): number[] {
    return this.plates.map(({ mesh }) => (mesh.material as THREE.MeshBasicMaterial).color.r);
  }

  /** The tile under a ray: which plate, and which row and column of its numbers. */
  pick(ray: THREE.Raycaster): PlateHit | null {
    const hit = ray.intersectObjects(this.plates.map((p) => p.mesh), false)[0];
    if (!hit?.uv) return null;
    const p = this.plates.find((x) => x.mesh === hit.object)!;
    return { plate: p.plate, row: Math.min(p.rows - 1, Math.max(0, Math.floor((1 - hit.uv.y) * p.rows))), col: Math.min(p.cols - 1, Math.max(0, Math.floor(hit.uv.x * p.cols))) };
  }

  /** Title anchors, just above each plate, in world space. */
  labels(): { id: string; text: string; at: THREE.Vector3; width: number }[] {
    this.group.updateMatrixWorld(true);
    return this.plates.map(({ plate, mesh }) => {
      const h = (mesh.geometry as THREE.PlaneGeometry).parameters.height, w = (mesh.geometry as THREE.PlaneGeometry).parameters.width;
      return { id: plate.id, text: plate.title, at: mesh.localToWorld(new THREE.Vector3(0, h / 2 + 0.07, 0)), width: w };
    });
  }

  dispose() {
    this.group.traverse((o) => {
      const mesh = o as THREE.Mesh;
      mesh.geometry?.dispose();
      const mat = mesh.material as THREE.Material | undefined;
      if (mat && mat !== this.frame) mat.dispose();
    });
    for (const p of this.plates) p.texture.dispose();
    this.frame.dispose();
    this.plates = [];
    this.group.clear();
  }
}
