// The tiny model (section 4.5). Filled in by Phase 4.
import { store } from "../state/store.ts";
import { S } from "../strings.ts";

export default function TinyView() {
  return (
    <main className="col tiny">
      <h2>{S.tiny.title}</h2>
      <p className="note">{S.tiny.intro}</p>
      <button type="button" className="btn" onClick={() => store.set({ tiny: false })}>{S.tiny.back}</button>
    </main>
  );
}
