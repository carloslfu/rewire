// How the engine shares the GPU with the 3D view. Inference and the 3D drawing run on the same GPU.
// With no 3D view open the engine keeps a few steps queued ahead, which is fastest. With one open it
// waits for each step to finish before queuing the next, and after a short stretch of work leaves its
// queue empty for about one frame. That gives the browser room to draw; it cannot promise that it
// will, because the browser and the GPU driver decide the order. The numbers computed are the same
// either way: only when a step is queued changes, never what it computes.

export interface Pace {
  /** Steps that may be queued beyond the one whose result is awaited. */
  ahead: number;
  /** Queue work for at most about this long in a row before resting. */
  workMs: number;
  /** How long the queue is then left empty. 0 never rests. */
  restMs: number;
}

/** No 3D view: results are read two steps behind the GPU. */
export const FULL: Pace = { ahead: 2, workMs: 0, restMs: 0 };
/** A 3D view is open: one step at a time, and about one frame of rest after every stretch of work. */
export const SHARED: Pace = { ahead: 0, workMs: 24, restMs: 16 };

export const paceFor = (stageOpen: boolean): Pace => (stageOpen ? SHARED : FULL);

export interface Units {
  /** At most this many units run. */
  count: number;
  /** Results can wait in this many slots, so fewer than this are ever queued at once. */
  ring: number;
  /** Queue unit `i` on the GPU. */
  submit(i: number): void;
  /** Wait for the result of queued unit `i`, in order. True means the work is complete and nothing more is queued. */
  take(i: number): Promise<boolean>;
  /** Wait for a unit that was queued past the end, without using its result. */
  drain?(i: number): Promise<unknown>;
  /** The job was cancelled or replaced. Asked before every unit, so also after every rest. */
  stale(): boolean;
  /** Asked before every unit: the 3D view can open or close while a reply is being written. */
  pace(): Pace;
  rest?: (ms: number) => Promise<void>;
  now?: () => number;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Run units of GPU work in order under the current pace. Every queued unit is waited for before this
 * returns, cancelled or not, so the caller always knows exactly what the model has read.
 */
export async function runUnits(u: Units): Promise<{ submitted: number; cancelled: boolean }> {
  const now = u.now ?? (() => performance.now()), rest = u.rest ?? sleep;
  let submitted = 0, received = 0, ended = false, cancelled = false, since = now();
  for (let i = 0; i < u.count && !ended; i++) {
    if (u.stale()) { cancelled = true; break; }
    const pace = u.pace(), ahead = Math.max(0, Math.min(pace.ahead, u.ring - 1));
    u.submit(i);
    submitted++;
    while (!ended && submitted - received > ahead) ended = await u.take(received++);
    if (pace.restMs > 0 && !ended && i + 1 < u.count && now() - since >= pace.workMs) {
      await rest(pace.restMs);
      since = now();
    }
  }
  while (received < submitted && !ended) ended = await u.take(received++);
  while (received < submitted) await (u.drain ?? u.take)(received++);
  return { submitted, cancelled };
}
