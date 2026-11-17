// How the engine worker shares the GPU with an open 3D view: the same units of work in the same
// order with the same results, queued one at a time with bounded rests, and stopped for real.
import { expect, it } from "vitest";
import { FULL, type Pace, paceFor, runUnits, SHARED } from "../src/live/pace.ts";

/** A fake GPU queue: each unit takes `unitMs` once queued, and the log records everything in order. */
function gpu(options: { count: number; unitMs?: number; endAt?: number; pace?: () => Pace; ring?: number; staleAt?: (log: string[]) => boolean }) {
  const log: string[] = [], results: number[] = [];
  let now = 0, queued = 0, deepest = 0;
  const done = new Set<number>();
  const units = {
    count: options.count, ring: options.ring ?? 4,
    pace: options.pace ?? (() => FULL),
    stale: () => options.staleAt?.(log) ?? false,
    submit: (i: number) => { log.push(`submit ${i}`); queued++; deepest = Math.max(deepest, queued); },
    take: async (i: number) => { now += options.unitMs ?? 40; queued--; done.add(i); results.push(i * i); log.push(`take ${i}`); return i === options.endAt; },
    drain: async (i: number) => { now += options.unitMs ?? 40; queued--; done.add(i); log.push(`drain ${i}`); },
    rest: async (ms: number) => { log.push(`rest ${ms}`); expect(queued).toBe(0); now += ms; },
    now: () => now,
  };
  return { units, log, results, done, deepest: () => deepest, queued: () => queued, clock: () => now };
}

it("keeps the fast path as it was when no 3D view is open: three steps in flight, no rests", async () => {
  expect(paceFor(false)).toBe(FULL);
  expect(FULL).toEqual({ ahead: 2, workMs: 0, restMs: 0 });
  const g = gpu({ count: 6 });
  expect(await runUnits(g.units)).toEqual({ submitted: 6, cancelled: false });
  expect(g.log).toEqual(["submit 0", "submit 1", "submit 2", "take 0", "submit 3", "take 1", "submit 4", "take 2", "submit 5", "take 3", "take 4", "take 5"]);
  expect(g.deepest()).toBe(3);
  expect(g.log.some((l) => l.startsWith("rest"))).toBe(false);
});

it("with a 3D view open, waits for each step and then leaves the queue empty for a bounded moment", async () => {
  expect(paceFor(true)).toBe(SHARED);
  expect(SHARED.ahead).toBe(0);
  expect(SHARED.restMs).toBeGreaterThanOrEqual(8);
  expect(SHARED.restMs).toBeLessThanOrEqual(34);
  const g = gpu({ count: 4, pace: () => SHARED });
  expect(await runUnits(g.units)).toEqual({ submitted: 4, cancelled: false });
  // Nothing is ever queued behind the step being computed, every rest starts with an empty queue, and no rest follows the last step.
  expect(g.log).toEqual(["submit 0", "take 0", `rest ${SHARED.restMs}`, "submit 1", "take 1", `rest ${SHARED.restMs}`, "submit 2", "take 2", `rest ${SHARED.restMs}`, "submit 3", "take 3"]);
  expect(g.deepest()).toBe(1);
  // Bounded: the rests add at most one per step.
  expect(g.clock()).toBe(4 * 40 + 3 * SHARED.restMs);
});

it("computes exactly the same units with the same results at either pace", async () => {
  const fast = gpu({ count: 9, endAt: 6 }), shared = gpu({ count: 9, endAt: 6, pace: () => SHARED });
  await runUnits(fast.units); await runUnits(shared.units);
  expect(shared.results).toEqual(fast.results);
  expect(shared.results).toEqual([0, 1, 4, 9, 16, 25, 36]);
  // The fast path had queued two steps past the stop and waits for them without using them; the shared path queued none.
  expect(fast.log.filter((l) => l.startsWith("drain"))).toEqual(["drain 7", "drain 8"]);
  expect(shared.log.filter((l) => l.startsWith("drain"))).toEqual([]);
  expect(fast.queued()).toBe(0);
  expect(shared.queued()).toBe(0);
});

it("rests after a stretch of work, not after every small step", async () => {
  // The tiny model: steps of a few milliseconds. Several run back to back before the queue is left empty.
  const g = gpu({ count: 40, unitMs: 3, pace: () => SHARED });
  await runUnits(g.units);
  const rests = g.log.filter((l) => l.startsWith("rest")).length;
  expect(rests).toBeGreaterThanOrEqual(3);
  expect(rests).toBeLessThanOrEqual(Math.ceil((40 * 3) / SHARED.workMs));
  // Between two rests the work never runs longer than the budget plus one step.
  let stretch = 0;
  for (const l of g.log) {
    if (l.startsWith("rest")) stretch = 0;
    else if (l.startsWith("take")) { stretch += 3; expect(stretch).toBeLessThanOrEqual(SHARED.workMs + 3); }
  }
});

it("stops for real when cancelled or replaced: nothing is queued after a rest, and what was queued is waited for", async () => {
  // Cancelled during the rest after the second step.
  const paced = gpu({ count: 50, pace: () => SHARED, staleAt: (log) => log.filter((l) => l.startsWith("rest")).length >= 2 });
  expect(await runUnits(paced.units)).toEqual({ submitted: 2, cancelled: true });
  expect(paced.log.at(-1)).toBe(`rest ${SHARED.restMs}`);
  expect(paced.queued()).toBe(0);
  // Cancelled on the fast path with steps in flight: no more are queued, and every queued one is received.
  const fast = gpu({ count: 50, staleAt: (log) => log.includes("take 1") });
  expect(await runUnits(fast.units)).toEqual({ submitted: 4, cancelled: true });
  expect([...fast.done].sort()).toEqual([0, 1, 2, 3]);
  expect(fast.queued()).toBe(0);
  // Already stale: nothing runs at all.
  const never = gpu({ count: 5, staleAt: () => true });
  expect(await runUnits(never.units)).toEqual({ submitted: 0, cancelled: true });
  expect(never.log).toEqual([]);
});

it("follows the 3D view opening and closing in the middle of a reply, and never overfills the result ring", async () => {
  let open = false;
  const g = gpu({ count: 8, pace: () => paceFor(open), staleAt: (log) => { open = log.includes("take 2") && !log.includes("take 5"); return false; } });
  await runUnits(g.units);
  expect(g.results).toEqual([0, 1, 4, 9, 16, 25, 36, 49]);
  const rests = g.log.filter((l) => l.startsWith("rest")).length;
  expect(rests).toBeGreaterThanOrEqual(1);
  expect(rests).toBeLessThanOrEqual(4);
  // A pace asking for more steps ahead than the ring can hold is capped below the ring.
  const deep = gpu({ count: 12, ring: 4, pace: () => ({ ahead: 99, workMs: 0, restMs: 0 }) });
  await runUnits(deep.units);
  expect(deep.deepest()).toBe(4);
  const narrow = gpu({ count: 12, ring: 2, pace: () => FULL });
  await runUnits(narrow.units);
  expect(narrow.deepest()).toBe(2);
});
