import { blocked } from "../stage/intervene.ts";
import { useStore } from "../state/store.ts";

/**
 * Why the model cannot be changed right now, or null when a change will run. Every control that
 * writes a change, on the 3D bench, on its chips and in the inspector, is enabled by this one rule, the
 * same one applying a change checks: so no control is live in one view and dead in another.
 */
export function useEditBlocked(): string | null {
  const mode = useStore((s) => s.mode), busy = useStore((s) => s.busy), replay = useStore((s) => s.replay), teachingBusy = useStore((s) => s.teachingBusy);
  return blocked({ mode, busy, replay, teachingBusy });
}
