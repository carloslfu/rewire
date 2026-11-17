import { store, useStore } from "../state/store.ts";

/** One switch for all three benches: the flat diagrams or the 3D model. */
export function ViewToggle() {
  const view = useStore((s) => s.scopeView);
  const available = useStore((s) => s.stage3d);
  return <div className="seg view-toggle" role="group" aria-label="Model view">
    <button type="button" aria-pressed={view === "2d"} onClick={() => store.set({ scopeView: "2d" })}>2D</button>
    <button type="button" aria-pressed={view === "3d"} disabled={!available}
      title={available ? "Open the 3D model" : "The 3D view could not start in this browser"} onClick={() => store.set({ scopeView: "3d" })}>3D</button>
  </div>;
}
