// One screen (section 5.2): conversation on the left, the tower in the middle, the detail panel on the right.
// On phones: conversation on top, the tower as a compact strip that expands, details in a bottom sheet.
import { lazy, Suspense, useEffect, useState, useSyncExternalStore } from "react";
import { onPieces } from "../state/actions.ts";
import { store, useStore } from "../state/store.ts";
import { S } from "../strings.ts";
import { Conversation } from "./Conversation.tsx";
import { Detail } from "./Detail.tsx";
import { Chips, Composer, DeviceBar, PathList, StepCard, WhatsReal } from "./Panels.tsx";
import { Tower } from "./Tower.tsx";

const Tiny = lazy(() => import("../tiny/TinyView.tsx"));

function usePhone() {
  return useSyncExternalStore(
    (f) => { const m = matchMedia("(max-width: 899px)"); m.addEventListener("change", f); return () => m.removeEventListener("change", f); },
    () => matchMedia("(max-width: 899px)").matches,
  );
}

export function App() {
  const mode = useStore((s) => s.mode);
  const tiny = useStore((s) => s.tiny);
  const sheet = useStore((s) => s.sheet);
  const announce = useStore((s) => s.announce);
  const busy = useStore((s) => s.busy);
  const phone = usePhone();
  const [, setTick] = useState(0);
  const [towerOpen, setTowerOpen] = useState(false);
  useEffect(() => onPieces(() => setTick((t) => t + 1)), []);

  return (
    <>
      <a className="skip" href="#conversation">{S.skip}</a>
      <header className="top">
        <span className="name">{S.title}</span>
        <span className="orient">{S.orientation}</span>
        <span className={`mode ${mode}`} title={mode === "live" ? S.liveHint : S.replayHint}>{mode === "live" ? S.live : S.replay}</span>
        <div className="top-actions">
          <button type="button" className="btn" onClick={() => store.set({ pathOpen: true })}>{S.howItWorks}</button>
        </div>
      </header>
      <DeviceBar />
      <div className="sr-only" aria-live="polite">{busy ? "" : announce}</div>
      {tiny ? (
        <Suspense fallback={<p className="col">…</p>}><Tiny /></Suspense>
      ) : (
        <main className="grid">
          <section className="col" id="conversation" aria-label="Conversation">
            <StepCard />
            <Chips />
            <Conversation />
            <Composer />
            <WhatsReal />
          </section>
          <section className="col" aria-label={S.tower}>
            {phone && (
              <button type="button" className="btn quiet" style={{ marginBottom: 6 }} aria-expanded={towerOpen} onClick={() => setTowerOpen(!towerOpen)}>
                {towerOpen ? "Shrink the tower" : "Expand the tower"}
              </button>
            )}
            <Tower compact={phone && !towerOpen} />
          </section>
          {phone ? (
            <aside className={`col detail sheet${sheet ? "" : " sheet-closed"}`} aria-label="Details">
              <div className="grab">
                <span className="small muted">Details</span>
                <button type="button" className="btn quiet" onClick={() => store.set({ sheet: false })}>{S.close}</button>
              </div>
              <Detail />
            </aside>
          ) : (
            <aside className="col detail" aria-label="Details"><Detail /></aside>
          )}
        </main>
      )}
      <PathList />
    </>
  );
}
