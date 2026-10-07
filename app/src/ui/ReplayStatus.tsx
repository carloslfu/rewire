import { applyChips, restartReplay, stopReply } from "../state/actions.ts";
import { useStore } from "../state/store.ts";

export function ReplayStatus({ compact = false }: { compact?: boolean }) {
  const replay = useStore((s) => s.replay);
  const count = useStore((s) => s.turns.length);
  const ready = useStore((s) => s.mode === "live");
  const full = useStore((s) => s.full);
  if (!replay) return null;
  const running = replay.status === "running";
  return <div className="replay-status">
    <div className="replay-row">
      <p role="status">{running ? `Replaying reply ${replay.turn + 1} of ${count}…`
        : `${replay.status === "error" ? "Replay interrupted" : "Replay stopped"} at reply ${replay.turn + 1} of ${count}.`}</p>
      {running ? <button className="btn quiet" onClick={stopReply}>Stop replay</button>
        : <button className="btn" disabled={!ready || full} onClick={() => void restartReplay()}>Replay conversation</button>}
    </div>
    {!compact && <p className="note">{running ? "Your questions stay the same. Each new answer feeds into the next; originals stay alongside."
      : "Finish the replay or restore the originals before sending another message."}</p>}
    {!running && <button className="linkish" disabled={!ready} onClick={() => void applyChips({})}>Restore original conversation</button>}
  </div>;
}
