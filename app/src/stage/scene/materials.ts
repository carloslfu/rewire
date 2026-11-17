// The materials the specimen is made of. One shared set per stage: the chassis keeps these physical
// surfaces whatever the data says, and only the `glow` inserts carry measured values.
import * as THREE from "three";
import { brushedPixels, grainPixels, type Nameplate, nameplatePixels, segmentPixels, texture, tracePixels } from "./textures.ts";

/** `lite` is for touch-first devices: no anisotropy or clearcoat, and the simpler geometry that goes with it. */
export type Quality = "high" | "lite";

export interface Kit {
  /** Brushed natural aluminum: decks, fascias, plinth, crown, heatsink fins. */
  aluminum: THREE.MeshPhysicalMaterial;
  /** Bead-blasted dark anodizing: sockets, rails, inlays. */
  graphite: THREE.MeshStandardMaterial;
  /** Dark ceramic module bodies. */
  ceramic: THREE.MeshPhysicalMaterial;
  gold: THREE.MeshStandardMaterial;
  copper: THREE.MeshStandardMaterial;
  steel: THREE.MeshStandardMaterial;
  /** Polished steel for the collar on the stream. */
  chrome: THREE.MeshStandardMaterial;
  /** The circuit board on each deck. */
  board: THREE.MeshStandardMaterial;
  /** Engraved nameplates. */
  plate: THREE.MeshStandardMaterial;
  /** Unlit inserts colored per instance by a measurement. Never tone mapped, so the hues match the page. */
  glow: THREE.MeshBasicMaterial;
  /** Reflections only, added over whatever is behind: the cover glass on the inserts and the tube's shine. */
  glass: THREE.MeshPhysicalMaterial;
  /** The faint body of the glass tube. */
  tube: THREE.MeshStandardMaterial;
  nameplates: Record<Nameplate, { uv: [number, number, number, number]; aspect: number }>;
  /** Everything to dispose with the stage. */
  materials: THREE.Material[];
  textures: THREE.Texture[];
}

const linear = (r: number, g: number, b: number) => new THREE.Color().setRGB(r, g, b, THREE.LinearSRGBColorSpace);

export function createKit(quality: Quality): Kit {
  const high = quality === "high";
  const brushed = texture(brushedPixels(), 256, 256), grain = texture(grainPixels(), 128, 128);
  const traces = tracePixels(), boardColor = texture(traces.color, 256, 256, { srgb: true }), boardSurface = texture(traces.surface, 256, 256);
  const plates = nameplatePixels(), plateColor = texture(plates.color, plates.width, plates.height, { srgb: true, clamp: true });
  const segments = texture(segmentPixels(), 32, 32, { srgb: true });
  const textures = [brushed, grain, boardColor, boardSurface, plateColor, segments];

  // Satin, not mirror: a mid-grey anodized stock whose brushing varies its roughness, so a softbox falls
  // off across a face instead of filling it with white.
  const aluminum = new THREE.MeshPhysicalMaterial({ color: 0xa3a7ae, metalness: 1, roughness: 0.58, roughnessMap: brushed, bumpMap: brushed, bumpScale: 0.45 });
  // The grooves run along the surface's u direction, so the highlight stretches across them, along v.
  if (high) { aluminum.anisotropy = 0.7; aluminum.anisotropyRotation = Math.PI / 2; }
  const graphite = new THREE.MeshStandardMaterial({ color: 0x2b2d33, metalness: 0.85, roughness: 0.56, roughnessMap: grain });
  const ceramic = new THREE.MeshPhysicalMaterial({ color: 0x33353b, metalness: 0, roughness: 0.52, roughnessMap: grain, bumpMap: grain, bumpScale: 0.2 });
  if (high) { ceramic.clearcoat = 0.55; ceramic.clearcoatRoughness = 0.22; }
  const gold = new THREE.MeshStandardMaterial({ color: linear(1, 0.72, 0.3), metalness: 1, roughness: 0.26 });
  const copper = new THREE.MeshStandardMaterial({ color: linear(0.95, 0.56, 0.4), metalness: 1, roughness: 0.34 });
  const steel = new THREE.MeshStandardMaterial({ color: linear(0.62, 0.63, 0.65), metalness: 1, roughness: 0.3 });
  const chrome = new THREE.MeshStandardMaterial({ color: linear(0.78, 0.79, 0.8), metalness: 1, roughness: 0.1 });
  const board = new THREE.MeshStandardMaterial({ map: boardColor, roughnessMap: boardSurface, metalnessMap: boardSurface, metalness: 1, roughness: 1 });
  const plate = new THREE.MeshStandardMaterial({ map: plateColor, metalness: 0.8, roughness: 0.42 });
  const glow = new THREE.MeshBasicMaterial({ map: segments, toneMapped: false });
  // Black with a dielectric's reflection, blended additively: it adds the studio's highlights and nothing else.
  const glass = new THREE.MeshPhysicalMaterial({ color: 0x000000, metalness: 0, roughness: 0.04, ior: 1.7, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
  const tube = new THREE.MeshStandardMaterial({ color: 0xa9bdd6, metalness: 0, roughness: 0.1, transparent: true, opacity: 0.16, depthWrite: false });
  // Inserts, boards and nameplates lie a hair above the face they sit on; this keeps them from flickering against it at a distance.
  for (const m of [glow, board, plate]) { m.polygonOffset = true; m.polygonOffsetFactor = -1; m.polygonOffsetUnits = -2; }
  // These carry a baked shade per vertex (see `shade`): every geometry drawn with them has a color attribute.
  for (const m of [aluminum, graphite, ceramic, board]) m.vertexColors = true;
  const materials = [aluminum, graphite, ceramic, gold, copper, steel, chrome, board, plate, glow, glass, tube];
  return { aluminum, graphite, ceramic, gold, copper, steel, chrome, board, plate, glow, glass, tube, nameplates: plates.rects, materials, textures };
}
