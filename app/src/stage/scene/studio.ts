// The photo studio around the specimen: softboxes that every surface reflects, a shadowed key light
// with a warm rim and a cool kicker, a seamless backdrop, and a floor the model visibly stands on.
import * as THREE from "three";
import type { Arch, Vec3 } from "../arch.ts";
import type { RGB } from "../theme.ts";
import { backdropPixels, falloffPixels, texture } from "./textures.ts";

export interface Softbox {
  /** Direction from the model to the middle of the panel. The panel faces the model. */
  toward: Vec3;
  /** Width and height, at a distance of `DISTANCE`. */
  size: [number, number];
  /** Linear radiance. Above 1 is brighter than white paper under the same light. */
  radiance: RGB;
}

export const DISTANCE = 8;

/**
 * The lighting plan. A broad key up front and to the left, a bank overhead for the tops, a wall of
 * low fill behind the camera so faces toward it never go black, a glow above the horizon behind for
 * top edges, and two tall strips behind for separation: warm on the right, cool on the left.
 */
export const SOFTBOXES: Softbox[] = [
  { toward: [-0.6, 0.7, 0.75], size: [5, 3.6], radiance: [2.3, 2.26, 2.18] },
  { toward: [0, 1, -0.3], size: [9, 3], radiance: [1.05, 1.05, 1.07] },
  { toward: [0, 0.05, 1], size: [12, 5], radiance: [0.34, 0.34, 0.35] },
  { toward: [0, 0.45, -1], size: [12, 3], radiance: [0.6, 0.6, 0.62] },
  { toward: [0.95, 0.25, -0.6], size: [1.6, 7], radiance: [5, 4.25, 3.4] },
  { toward: [-0.95, 0.15, -0.5], size: [1.4, 7], radiance: [1.8, 2.1, 2.5] },
];

/** The room the softboxes hang in: never black, a little brighter overhead than at the floor. */
export const ROOM = { zenith: 0.14, horizon: 0.07, floor: 0.035 };

/** Where the key light sits, matching the key softbox, so the cast shadows agree with the reflections. */
export const KEY: Vec3 = [-0.5, 0.62, 0.6];

/** The studio as a scene to render into an environment map. The caller disposes it with `disposeScene`. */
export function studioScene(): THREE.Scene {
  const scene = new THREE.Scene();
  const dome = new THREE.SphereGeometry(DISTANCE * 3, 32, 16), p = dome.getAttribute("position"), colors = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i) / (DISTANCE * 3), v = y < 0 ? ROOM.floor : ROOM.horizon + (ROOM.zenith - ROOM.horizon) * y;
    colors[i * 3] = colors[i * 3 + 1] = colors[i * 3 + 2] = v;
  }
  dome.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  scene.add(new THREE.Mesh(dome, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide })));
  for (const box of SOFTBOXES) {
    const panel = new THREE.Mesh(new THREE.PlaneGeometry(...box.size), new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
    (panel.material as THREE.MeshBasicMaterial).color.setRGB(...box.radiance, THREE.LinearSRGBColorSpace);
    panel.position.set(...box.toward).setLength(DISTANCE);
    panel.lookAt(0, 0, 0);
    scene.add(panel);
  }
  return scene;
}

export function disposeScene(scene: THREE.Scene) {
  scene.traverse((o) => {
    const mesh = o as THREE.Mesh;
    mesh.geometry?.dispose();
    (mesh.material as THREE.Material | undefined)?.dispose();
  });
  scene.clear();
}

/**
 * The studio prefiltered for reflections at every roughness. The render target belongs to the caller:
 * `dispose` frees it.
 */
export function studioEnvironment(renderer: THREE.WebGLRenderer): { texture: THREE.Texture; dispose(): void } {
  const pmrem = new THREE.PMREMGenerator(renderer), scene = studioScene();
  const target = pmrem.fromScene(scene, 0.02, 0.1, DISTANCE * 4);
  disposeScene(scene);
  pmrem.dispose();
  return { texture: target.texture, dispose: () => target.dispose() };
}

/** Backdrop and floor tones for the page's theme. Both are a neutral studio; the light page gets the lighter one. */
const TONES = {
  dark: { center: [47, 49, 54], edge: [13, 14, 16], pool: [78, 81, 88] },
  light: { center: [78, 81, 87], edge: [30, 32, 36], pool: [118, 121, 128] },
} satisfies Record<string, { center: RGB; edge: RGB; pool: RGB }>;

export class Studio {
  readonly group = new THREE.Group();
  /** The seamless backdrop, for `scene.background`. Replaced when the theme changes. */
  background: THREE.DataTexture;
  private readonly key = new THREE.DirectionalLight(0xffffff, 2.2);
  private readonly rim = new THREE.DirectionalLight(0xffe2c4, 1.5);
  private readonly kicker = new THREE.DirectionalLight(0xcfe0ff, 0.7);
  private readonly fill = new THREE.HemisphereLight(0xffffff, 0x50525a, 0.16);
  private readonly pool: THREE.Mesh; private readonly contact: THREE.Mesh; private readonly catcher: THREE.Mesh | null = null;
  private readonly falloff: THREE.DataTexture;
  private readonly box = new THREE.Box3();
  private dark: boolean;

  constructor(arch: Arch, private readonly shadows: boolean, dark: boolean) {
    this.dark = dark;
    const b = arch.bounds, span = Math.max(b.max[0] - b.min[0], b.max[1] - b.min[1]), [fw, , fd] = arch.size[0], [fx, , fz] = arch.pos[0];
    this.falloff = texture(falloffPixels(), 64, 64, { srgb: true, clamp: true });
    const flat = (geo: THREE.BufferGeometry, y: number, order: number, opacity: number) => {
      const mesh = new THREE.Mesh(geo.rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: this.falloff, transparent: true, opacity, depthWrite: false, toneMapped: false }));
      mesh.position.y = y; mesh.renderOrder = order;
      this.group.add(mesh);
      return mesh;
    };
    // A pool of light on the floor around the model, and the soft dark it presses into the floor where it stands.
    this.pool = flat(new THREE.CircleGeometry(span * 2.6, 48), 0, -3, 1);
    this.contact = flat(new THREE.PlaneGeometry(fw * 1.45, fd * 2), 0.002, -2, 0.62);
    this.contact.position.set(fx, 0.002, fz);
    (this.contact.material as THREE.MeshBasicMaterial).color.setRGB(0, 0, 0);
    if (shadows) {
      this.key.castShadow = true;
      this.key.shadow.mapSize.set(2048, 2048);
      this.key.shadow.bias = -0.0004; this.key.shadow.normalBias = 0.03; this.key.shadow.radius = 2.5;
      const catcher = new THREE.Mesh(new THREE.CircleGeometry(span * 2.6, 48).rotateX(-Math.PI / 2), new THREE.ShadowMaterial({ opacity: 0.42, depthWrite: false }));
      catcher.position.y = 0.004; catcher.renderOrder = -1; catcher.receiveShadow = true;
      this.catcher = catcher;
      this.group.add(catcher);
    }
    this.rim.position.set(0.95, 0.5, -0.7); this.kicker.position.set(-0.95, 0.3, -0.55);
    this.group.add(this.key, this.key.target, this.rim, this.kicker, this.fill);
    this.background = this.backdrop(dark);
    this.tone();
    this.frame(new THREE.Box3(new THREE.Vector3(...b.min), new THREE.Vector3(...b.max)));
  }

  private backdrop(dark: boolean): THREE.DataTexture {
    const tone = dark ? TONES.dark : TONES.light;
    return texture(backdropPixels(tone.center as RGB, tone.edge as RGB), 256, 256, { srgb: true, clamp: true });
  }

  /** Follow the page's theme. Returns true when the backdrop was replaced and must be assigned again. */
  setTheme(dark: boolean): boolean {
    if (dark === this.dark) return false;
    this.dark = dark;
    this.background.dispose();
    this.background = this.backdrop(dark);
    this.tone();
    return true;
  }

  private tone() {
    const tone = this.dark ? TONES.dark : TONES.light;
    (this.pool.material as THREE.MeshBasicMaterial).color.setRGB(tone.pool[0] / 255, tone.pool[1] / 255, tone.pool[2] / 255, THREE.SRGBColorSpace);
  }

  /**
   * Aim the key light at a box and fit its shadow to it, so the shadow map's texels are spent on the
   * model and nothing else. Called again when the tower opens or spreads.
   */
  frame(box: THREE.Box3) {
    if (box.equals(this.box)) return;
    this.box.copy(box);
    const center = box.getCenter(new THREE.Vector3()), dir = new THREE.Vector3(...KEY).normalize(), reach = box.getSize(new THREE.Vector3()).length();
    this.key.target.position.copy(center);
    this.key.position.copy(center).addScaledVector(dir, reach);
    this.key.target.updateMatrixWorld();
    if (!this.shadows) return;
    const right = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), dir).normalize(), up = new THREE.Vector3().crossVectors(dir, right);
    let w = 0, h = 0, d = 0;
    const v = new THREE.Vector3();
    for (let i = 0; i < 8; i++) {
      v.set(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z).sub(center);
      w = Math.max(w, Math.abs(v.dot(right))); h = Math.max(h, Math.abs(v.dot(up))); d = Math.max(d, Math.abs(v.dot(dir)));
    }
    const cam = this.key.shadow.camera, pad = 1.04;
    cam.left = -w * pad; cam.right = w * pad; cam.top = h * pad; cam.bottom = -h * pad; cam.near = Math.max(0.1, reach - d * pad); cam.far = reach + d * pad;
    cam.updateProjectionMatrix();
  }

  dispose() {
    for (const mesh of [this.pool, this.contact, this.catcher]) if (mesh) { mesh.geometry.dispose(); (mesh.material as THREE.Material).dispose(); }
    this.falloff.dispose();
    this.background.dispose();
    this.key.shadow.map?.dispose();
    for (const light of [this.key, this.rim, this.kicker, this.fill]) light.dispose();
    this.group.clear();
  }
}
