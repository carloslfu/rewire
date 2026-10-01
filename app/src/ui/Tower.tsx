// The tower (section 4.2, level 1): every floor for the chosen word, each a row of head cells and one
// memory block, colored by its direct push toward that word. Every cell is a button: tap to see it.
import { useMemo, useRef } from "react";
import type { Focus } from "../model/types.ts";
import { pathData, piece, setFocus } from "../state/actions.ts";
import { store, useStore } from "../state/store.ts";
import { S } from "../strings.ts";
import { diverging, signed } from "./color.ts";
import { multOf } from "./describe.ts";
import { chosen, FLOORS, HEADS, hardestFloors, headIndex, maxAbs, memIndex, towerValues } from "./word.ts";

export function Tower({ compact }: { compact?: boolean }) {
  const turns = useStore((s) => s.turns);
  const word = useStore((s) => s.word);
  const fork = useStore((s) => s.fork);
  const view = useStore((s) => s.view);
  const chips = useStore((s) => s.chips);
  const focus = useStore((s) => s.focus);
  const model = useStore((s) => s.model);
  const c = useMemo(() => chosen({ turns, word, fork }), [turns, word, fork]);
  const vals = towerValues(c, view);
  const scale = vals ? maxAbs(vals) : 1;
  const w = c ? piece(c.tok.id) : "";
  const wq = w.trim() || w;
  const atlas = useMemo(() => {
    const a = pathData()?.atlas;
    const m = new Map<string, string>();
    for (const [f, h] of a?.copying ?? []) m.set(`${f}.${h}`, "copying head");
    for (const [f, h] of a?.start_marker ?? []) if (!m.has(`${f}.${h}`)) m.set(`${f}.${h}`, "rests on the start marker");
    for (const [f, h] of a?.answer_heads ?? []) if (!m.has(`${f}.${h}`)) m.set(`${f}.${h}`, "answer pusher");
    return m;
  }, []);
  const gridRef = useRef<HTMLDivElement>(null);
  const flowKey = c ? `${c.ref.turn}.${c.ref.side}.${c.ref.index}.${view}` : "none";
  const hasDiff = !!c?.forced;
  const bits = chips.bits ?? 4;

  const isOn = (f: Focus) => JSON.stringify(f) === JSON.stringify(focus);
  const label = (v: number | undefined) => (v === undefined || !c ? "" : ` ${signed(v)} ${view === "difference" ? "difference" : "toward"} "${wq}"`);

  const onKey = (e: React.KeyboardEvent) => {
    const t = e.target as HTMLElement;
    const r = Number(t.dataset.r), col = Number(t.dataset.c);
    if (Number.isNaN(r)) return;
    let nr = r, nc = col;
    if (e.key === "ArrowUp") nr = Math.min(FLOORS - 1, r + 1);
    else if (e.key === "ArrowDown") nr = Math.max(0, r - 1);
    else if (e.key === "ArrowLeft") nc = Math.max(-1, col - 1);
    else if (e.key === "ArrowRight") nc = Math.min(HEADS, col + 1);
    else return;
    e.preventDefault();
    gridRef.current?.querySelector<HTMLElement>(`[data-r="${nr}"][data-c="${nc}"]`)?.focus();
  };

  const rows = [];
  for (let L = FLOORS - 1; L >= 0; L--) {
    const fm = multOf(chips, "floor", L);
    const conceptHere = chips.concept && chips.concept.strength !== 0 && chips.concept.floor === L;
    rows.push(
      <button key={`l${L}`} type="button" className={`lbl${fm !== 1 || conceptHere ? " row-edit" : ""}`} data-r={L} data-c={-1}
        tabIndex={L === FLOORS - 1 ? 0 : -1} aria-label={`${S.floorN(L + 1)}${fm !== 1 ? `, ${S.mult(fm)}` : ""}`}
        onClick={() => setFocus({ kind: "floor", floor: L })}>
        {L + 1}{fm !== 1 ? (fm === 0 ? "∅" : "*") : ""}
      </button>,
    );
    for (let h = 0; h < HEADS; h++) {
      const v = vals?.[headIndex(L, h)];
      const m = multOf(chips, "head", L, h);
      const at = atlas.get(`${L}.${h}`);
      rows.push(
        <button key={`${flowKey}-h${L}.${h}`} type="button" data-r={L} data-c={h} tabIndex={-1}
          className={`cell${vals ? " flowing" : ""}${m !== 1 || fm !== 1 ? " edit" : ""}${m === 0 || fm === 0 ? " off" : ""}${at ? " atlas" : ""}${isOn({ kind: "head", floor: L, head: h }) ? " on" : ""}`}
          style={{ background: v === undefined ? undefined : diverging(v / scale), animationDelay: `${L * 9}ms` }}
          aria-label={`${S.floorN(L + 1)}, ${S.headN(h + 1)}${m !== 1 ? ` (${S.mult(m)})` : ""}${at ? `, ${at}, ${S.foundByTesting}` : ""}:${label(v)}`}
          onClick={() => setFocus({ kind: "head", floor: L, head: h })} />,
      );
    }
    rows.push(<span key={`g${L}`} className="gap" aria-hidden="true" />);
    const v = vals?.[memIndex(L)];
    const mm = multOf(chips, "memory", L);
    rows.push(
      <button key={`${flowKey}-m${L}`} type="button" data-r={L} data-c={HEADS} tabIndex={-1}
        className={`cell mem${vals ? " flowing" : ""}${mm !== 1 || fm !== 1 ? " edit" : ""}${mm === 0 || fm === 0 ? " off" : ""}${isOn({ kind: "memory", floor: L }) ? " on" : ""}`}
        style={{ background: v === undefined ? undefined : diverging(v / scale), animationDelay: `${L * 9}ms` }}
        aria-label={`${S.floorN(L + 1)}, ${S.memoryBlock}${mm !== 1 ? ` (${S.mult(mm)})` : ""}:${label(v)}`}
        onClick={() => setFocus({ kind: "memory", floor: L })} />,
    );
  }

  const summary = vals && c ? (() => {
    const [a, b] = hardestFloors(view === "push" ? vals : vals.map(Math.abs) as unknown as Float32Array);
    return view === "push" ? S.summary(a + 1, b + 1, wq) : `The biggest differences are on floors ${a + 1} to ${b + 1}.`;
  })() : null;
  const dictV = vals?.[0];
  const prob = c ? c.tok.cands.find((x) => x.id === c.tok.id)?.p : undefined;

  return (
    <div>
      <div className="tower-head">
        <h2>{c ? (view === "push" ? S.towerFor(wq) : `${S.viewDiff}: "${wq}"`) : S.tower}</h2>
        {model.id === "qwen" ? (
          <button type="button" className={`bits-label${bits !== 4 ? " edit" : ""}`} onClick={() => setFocus({ kind: "bits" })}>
            {S.bitsLabel(bits)}
          </button>
        ) : <span className="note">32-bit weights</span>}
        <div className="seg" role="group" aria-label="Tower lighting">
          <button type="button" aria-pressed={view === "push"} onClick={() => store.set({ view: "push" })}>{S.viewPush}</button>
          <button type="button" aria-pressed={view === "difference"} disabled={!hasDiff} title={hasDiff ? S.diffNote : S.diffNone}
            onClick={() => store.set({ view: "difference" })}>{S.viewDiff}</button>
        </div>
      </div>
      {summary && <p className="note" style={{ marginBottom: 8 }}>{summary}</p>}
      {!c && <p className="note" style={{ marginBottom: 8 }}>{S.towerNone}</p>}
      {view === "difference" && <p className="note" style={{ marginBottom: 8 }}>{S.diffNote}</p>}
      <div className={`tower${compact ? " compact" : ""}`} ref={gridRef} onKeyDown={onKey} role="group" aria-label={S.tower}
        // fixed side columns, so the head cells grow to the 24px target size before anything else takes the space
        style={{ gridTemplateColumns: `32px repeat(${HEADS}, minmax(10px, ${HEADS > 8 ? 24 : 48}px)) 8px 36px` }}>
        <span aria-hidden="true" />
        <button type="button" className={`wide${isOn({ kind: "words-out" }) ? " on" : ""}`} onClick={() => setFocus({ kind: "words-out" })}>
          <span>{S.wordsOut}</span>
          {c && <span className="num">"{wq}" {prob !== undefined ? `${Math.round(prob * 100)}%` : ""}</span>}
        </button>
        {rows}
        <span aria-hidden="true" />
        <button type="button" className={`wide${isOn({ kind: "dictionary" }) ? " on" : ""}`} onClick={() => setFocus({ kind: "dictionary" })}
          aria-label={`${S.wordsIn}${c ? `: read "${piece(c.input)}"${label(dictV)}` : ""}`}>
          <span>{S.wordsIn}{c ? <span className="num"> "{piece(c.input).replace(/\n/g, "↵")}"</span> : null}</span>
          {dictV !== undefined && <span className="v num" style={{ background: diverging(dictV / scale) }}>{signed(dictV)}</span>}
        </button>
      </div>
      <div className="legend" aria-hidden="true">
        <span className="num">{signed(-scale)}</span>
        <span className="ramp" style={{ background: `linear-gradient(90deg, ${diverging(-1)}, ${diverging(0)}, ${diverging(1)})` }} />
        <span className="num">{signed(scale)}</span>
        <span>{view === "push" ? "push toward the word" : "changed minus normal"}</span>
      </div>
      <p className="caption">{S.towerCaption(model)}</p>
    </div>
  );
}
