// Results that arrive after the question, token or model has changed are dropped, never shown.

/** Hands out claims; only the newest claim is current. */
export class Latest {
  private n = 0;
  /** Start a request. The returned check is true only while no newer request or cancel has happened. */
  claim(): () => boolean {
    const id = ++this.n;
    return () => id === this.n;
  }
  cancel() {
    this.n++;
  }
}

export type Measured<T> =
  | { state: "none" }
  | { state: "loading"; key: string }
  | { state: "ready"; key: string; value: T }
  | { state: "unavailable"; key: string };

/**
 * Run `job` for `key` and deliver its result only if this is still the newest request. A null or failed
 * result is reported as unavailable, so the interface can say so instead of showing an older measurement.
 */
export async function measure<T>(gate: Latest, key: string, job: () => Promise<T | null>, deliver: (m: Measured<T>) => void): Promise<void> {
  const current = gate.claim();
  deliver({ state: "loading", key });
  let value: T | null = null;
  try { value = await job(); } catch { value = null; }
  if (!current()) return;
  deliver(value === null ? { state: "unavailable", key } : { state: "ready", key, value });
}

/**
 * Identity of a measurement: any change to the model, its changes, the sample or the token makes a new
 * key. `mark` names the rewrite of the reply (see replyMark), so a token that comes back with the same
 * id at the same position after a pick is still a different measurement.
 */
export function measurementKey(p: { model: string; version: number; turn: number; side: string; index: number; token: number; length: number; mark?: string }): string {
  return `${p.model}.${p.version}.${p.turn}.${p.side}.${p.index}.${p.token}.${p.length}.${p.mark ?? ""}`;
}
