// A damped spring per channel: parts lag behind the hand and settle without ringing for long.

export const STIFFNESS = 190;
export const DAMPING = 21;
const REST = 1e-3;

/**
 * Advance one channel. Long frames are split so a background tab coming back cannot make a part
 * overshoot into nonsense. Returns true once position and velocity have both come to rest.
 */
export function spring(cur: Float32Array, vel: Float32Array, target: Float32Array, i: number, dt: number, k = STIFFNESS, c = DAMPING): boolean {
  let x = cur[i], v = vel[i];
  const goal = target[i];
  let left = Math.max(0, Math.min(0.1, dt));
  while (left > 0) {
    const h = Math.min(left, 1 / 120);
    v += (-k * (x - goal) - c * v) * h;
    x += v * h;
    left -= h;
  }
  if (!Number.isFinite(x) || !Number.isFinite(v) || (Math.abs(x - goal) < REST && Math.abs(v) < REST * 10)) {
    cur[i] = goal; vel[i] = 0;
    return true;
  }
  cur[i] = x; vel[i] = v;
  return false;
}
