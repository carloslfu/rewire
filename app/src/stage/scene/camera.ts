// Where the camera stands: named views, and the placement that frames a box from a direction.
import * as THREE from "three";
import type { Inset } from "../labels.ts";

export type ViewName = "home" | "front" | "side" | "top";

/** Directions from the subject to the camera. Home is the three-quarter view the stage opens in. */
export const VIEWS: Record<ViewName, THREE.Vector3> = {
  home: new THREE.Vector3(0.55, 0.3, 1).normalize(),
  front: new THREE.Vector3(0, 0.06, 1).normalize(),
  side: new THREE.Vector3(1, 0.1, 0.04).normalize(),
  top: new THREE.Vector3(0, 1, 0.1).normalize(),
};

const NO_INSET: Inset = { top: 0, bottom: 0, side: 0 };

/**
 * Camera placement that frames a box from a direction, for a vertical field of view and aspect ratio.
 * `inset` keeps fractions of the view clear (the toolbar above, the dock below, labels at the edges,
 * a panel over the left or right): the box is fitted to what remains and centered there. `span` is
 * the box's half-width as a fraction of half the view.
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
  const coverL = inset.left ?? 0, coverR = inset.right ?? 0;
  const clearH = Math.max(0.2, 1 - inset.top - inset.bottom), clearW = Math.max(0.2, 1 - 2 * inset.side - coverL - coverR);
  const distance = Math.max(h / (tan * clearH), w / (wide * clearW)) * margin + d;
  // Aim above the box when more is reserved at the top than the bottom, so the box sits lower in the view,
  // and to the side of it when a panel covers one edge, so the box sits in what stays clear.
  const target = center.clone().addScaledVector(up, (inset.top - inset.bottom) * distance * tan).addScaledVector(right, (coverR - coverL) * distance * wide);
  return { target, position: target.clone().addScaledVector(dir, distance), span: w / (distance * wide), distance };
}

/** The part of a camera's state a flight moves between. */
export interface Pose { position: THREE.Vector3; target: THREE.Vector3 }

/** Ease in and out, for camera flights. */
export const ease = (t: number) => (t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2);

/**
 * A camera pose part of the way along a flight. The pivot moves in a straight line while the camera
 * swings around it on an arc and changes distance evenly, so a flight to another view turns around the
 * model instead of cutting through it.
 */
export function along(from: Pose, to: Pose, k: number, out: Pose): Pose {
  out.target.lerpVectors(from.target, to.target, k);
  const a = new THREE.Spherical().setFromVector3(from.position.clone().sub(from.target)), b = new THREE.Spherical().setFromVector3(to.position.clone().sub(to.target));
  // Take the short way round.
  let turn = b.theta - a.theta;
  if (turn > Math.PI) turn -= 2 * Math.PI; else if (turn < -Math.PI) turn += 2 * Math.PI;
  const s = new THREE.Spherical(a.radius + (b.radius - a.radius) * k, a.phi + (b.phi - a.phi) * k, a.theta + turn * k);
  out.position.setFromSpherical(s).add(out.target);
  return out;
}
