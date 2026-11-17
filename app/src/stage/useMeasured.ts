// A measurement for the 3D view, as React state. While nothing can be measured this hook sets no
// state at all. That matters: tokens can arrive faster than React finishes its deferred work (the
// tiny model writes 160 in a burst), and a state update made after every one of them, even to the
// same "nothing", is counted by React as an update loop and thrown as "Maximum update depth exceeded".
import { useEffect, useRef, useState } from "react";
import { Latest, measure, type Measured } from "./latest.ts";

const NONE: Measured<never> = { state: "none" };

/**
 * The measurement for `key`, requested when `enabled`. With `hold`, nothing new is requested and a
 * finished measurement is kept only while it is of this very key. A result for an older key is dropped.
 */
export function useMeasured<T>(key: string, enabled: boolean, hold: boolean, job: () => Promise<T | null>): Measured<T> {
  const [detail, setDetail] = useState<Measured<T>>(NONE);
  const gate = useRef<Latest>(null);
  gate.current ??= new Latest();
  /** What was last put into state, so "nothing" is never set over "nothing". */
  const held = useRef<Measured<T>>(NONE);
  const latest = useRef(job);
  latest.current = job;
  useEffect(() => {
    const requests = gate.current!;
    const put = (m: Measured<T>) => {
      if (m.state === "none" && held.current.state === "none") return;
      held.current = m;
      setDetail(m);
    };
    if (!enabled) { requests.cancel(); put(NONE); return; }
    if (hold) {
      requests.cancel();
      if (!(held.current.state === "ready" && held.current.key === key)) put(NONE);
      return;
    }
    void measure(requests, key, () => latest.current(), put);
    return () => requests.cancel();
  }, [key, enabled, hold]);
  return detail;
}
