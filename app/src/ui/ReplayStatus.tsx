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
      <p role="status">{running ? `Updating sample ${replay.turn + 1} of ${count}…`
        : `${replay.status === "error" ? "Update interrupted" : "Update stopped"} at sample ${replay.turn + 1} of ${count}.`}</p>
      {running ? <button className="btn quiet" onClick={stopReply}>Stop update</button>
        : <button className="btn" disabled={!ready || full} onClick={() => void restartReplay()}>Retry sample update</button>}
    </div>
    {!compact && <p className="note">{running ? "Each question is tested separately. Original answers stay alongside for comparison."
      : "Retry the update or restore the originals before testing another question."}</p>}
    {!running && <button className="linkish" disabled={!ready} onClick={() => void applyChips({})}>Restore original answers</button>}
  </div>;
}
