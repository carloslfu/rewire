// The tower (section 4.2, level 1): every layer for the chosen word, each a row of head cells and one
// MLP, colored by its direct push toward that word. Every cell is a button: tap to see it.
import { useId, useMemo, useRef, useState } from "react";
import type { Focus } from "../model/types.ts";
import { piece, retryComparison, setFocus, setTowerView } from "../state/actions.ts";
import { store, useStore } from "../state/store.ts";
import { S } from "../strings.ts";
import { diverging, signed } from "./color.ts";
import { geometryLabel, multOf } from "./describe.ts";
import { chosen, comparisonTarget, FLOORS, HEADS, hardestFloors, headIndex, maxAbs, memIndex, towerValues } from "./word.ts";

export function Tower({ compact, embedded, onSelect = setFocus }: { compact?: boolean; embedded?: boolean; onSelect?: (focus: Focus) => void }) {
  const [enlarged, setEnlarged] = useState(false);
  const turns = useStore((s) => s.turns);
  const word = useStore((s) => s.word);
  const fork = useStore((s) => s.fork);
  const view = useStore((s) => s.view);
  const chips = useStore((s) => s.chips);
  const focus = useStore((s) => s.focus);
  const model = useStore((s) => s.model);
  const mode = useStore((s) => s.mode);
  const busy = useStore((s) => s.busy);
  const replay = useStore((s) => s.replay);
  const c = useMemo(() => chosen({ turns, word, fork }), [turns, word, fork]);
  const vals = towerValues(c, view);
  const scale = vals ? maxAbs(vals) : 1;
  const w = c ? piece(c.tok.id) : "";
  const wq = w.trim() || JSON.stringify(w);
  const gridRef = useRef<HTMLDivElement>(null);
  const hasDiff = !!comparisonTarget({ turns, word, fork });
  const comparisonTurn = word ? turns[word.turn] : turns.at(-1);
  const changedReply = comparisonTurn?.changed;
  const awaitingReplay = !!replay && (word?.turn ?? turns.length - 1) >= replay.turn && replay.status !== "running";
  const generating = comparisonTurn && (!comparisonTurn.normal.done || (changedReply && !changedReply.done));
  const diffHint = !comparisonTurn ? "Ask a question, then change a model control to compare."
    : !changedReply ? S.diffNone
    : changedReply.stale ? "This reply used earlier settings. Compare the latest reply instead."
    : awaitingReplay ? "Finish the conversation replay to compare this reply."
    : changedReply.comparing ? "Computing change from original…"
    : generating ? "Writing the replies. The comparison will be available when they finish."
    : changedReply.compareError ? `Comparison unavailable: ${changedReply.compareError}`
    : "No comparison is available for this token yet.";
  const diffHintId = useId();
  const canRetry = !!changedReply && !awaitingReplay && !changedReply.stale && !changedReply.comparing && !generating && !hasDiff;

  const visibleTokens = c?.reply.toks.map((t, i) => [151643, 151645].includes(t.id) ? -1 : i).filter((i) => i >= 0) ?? [];
  const tokenAt = c ? visibleTokens.indexOf(c.ref.index) : -1;
  const moveToken = (direction: number) => {
    const index = visibleTokens[tokenAt + direction];
    if (c && index !== undefined) store.set({ word: { ...c.ref, index }, follow: false });
  };

  const isOn = (f: Focus) => JSON.stringify(f) === JSON.stringify(focus);
  const label = (v: number | undefined) => {
    if (v === undefined || !c) return "";
    if (view === "difference") return ` ${signed(v)} change in direct contribution to "${wq}"`;
    return ` ${signed(v)}, ${v === 0 ? "neutral direct contribution to" : `direct contribution ${v < 0 ? "against" : "toward"}`} "${wq}"`;
  };

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
    const zeroedHere = chips.zeroed?.filter((z) => z.floor === L).length ?? 0;
    rows.push(
      <button key={`l${L}`} type="button" className={`lbl${fm !== 1 || conceptHere || zeroedHere ? " row-edit" : ""}${isOn({ kind: "floor", floor: L }) ? " on" : ""}`} data-r={L} data-c={-1}
        tabIndex={L === FLOORS - 1 ? 0 : -1} aria-label={`${S.floorN(L + 1)}${fm !== 1 ? `, ${S.mult(fm)}` : ""}${zeroedHere ? `, ${zeroedHere} weights set to zero` : ""}`}
        title={S.floorN(L + 1)} onClick={() => onSelect({ kind: "floor", floor: L })}>
        {L + 1}{fm !== 1 ? (fm === 0 ? "∅" : "*") : zeroedHere ? "*" : ""}
      </button>,
    );
    for (let h = 0; h < HEADS; h++) {
      const v = vals?.[headIndex(L, h)];
      const m = multOf(chips, "head", L, h);
      const geometry = chips.geometry?.find((g) => g.floor === L && g.head === h);
      rows.push(
        <button key={`h${L}.${h}`} type="button" data-r={L} data-c={h} tabIndex={-1}
          className={`cell${vals ? " flowing" : ""}${m !== 1 || fm !== 1 || geometry ? " edit" : ""}${m === 0 || fm === 0 ? " off" : ""}${isOn({ kind: "head", floor: L, head: h }) ? " on" : ""}`}
          style={{ background: v === undefined ? undefined : diverging(v / scale), animationDelay: `${L * 9}ms` }}
          aria-label={`${S.floorN(L + 1)}, ${S.headN(h + 1)}${m !== 1 ? ` (${S.mult(m)})` : ""}${geometry ? `, ${geometryLabel(geometry)}` : ""}:${label(v)}`}
          title={`${S.headN(h + 1)} · ${S.floorN(L + 1)}`} onClick={() => onSelect({ kind: "head", floor: L, head: h })} />,
      );
    }
    rows.push(<span key={`g${L}`} className="gap" aria-hidden="true" />);
    const v = vals?.[memIndex(L)];
    const mm = multOf(chips, "memory", L);
    const learnedHere = model.id === "qwen" && L === 27 && !!chips.lesson;
    rows.push(
      <button key={`m${L}`} type="button" data-r={L} data-c={HEADS} tabIndex={-1}
        className={`cell mem${vals ? " flowing" : ""}${mm !== 1 || fm !== 1 || learnedHere ? " edit" : ""}${mm === 0 || fm === 0 ? " off" : ""}${isOn({ kind: "memory", floor: L }) ? " on" : ""}`}
        style={{ background: v === undefined ? undefined : diverging(v / scale), animationDelay: `${L * 9}ms` }}
        aria-label={`${S.floorN(L + 1)}, ${S.memoryBlock}${mm !== 1 ? ` (${S.mult(mm)})` : ""}${learnedHere ? ", learned weights" : ""}:${label(v)}`}
        title={`${S.memoryBlock}${learnedHere ? " with learned weights" : ""} · ${S.floorN(L + 1)}`} onClick={() => onSelect({ kind: "memory", floor: L })} />,
    );
  }

  const summary = vals && c ? (() => {
    const [a, b] = hardestFloors(view === "push" ? vals : vals.map(Math.abs) as unknown as Float32Array);
    return view === "push" ? S.summary(a + 1, b + 1, wq) : `The biggest differences are on layers ${a + 1} to ${b + 1}.`;
  })() : null;
  const dictV = vals?.[0];
  const prob = c ? c.tok.cands.find((x) => x.id === c.tok.id)?.p : undefined;

  return (
    <div>
      <div className="tower-head">
        <div className="tower-token">
          {c ? <>
            <div className="token-navigation" role="group" aria-label="Selected token">
              <button className="btn quiet" aria-label="Previous token" disabled={tokenAt <= 0} onClick={() => moveToken(-1)}>‹</button>
              <h3 title={wq}><button className="linkish" aria-label={`Inspect token: ${wq}`} onClick={() => onSelect({ kind: "word" })}>“{wq}”</button></h3>
              <button className="btn quiet" aria-label="Next token" disabled={tokenAt < 0 || tokenAt >= visibleTokens.length - 1} onClick={() => moveToken(1)}>›</button>
            </div>
            <p className="note">{c.ref.side === "normal" ? "Original" : "Changed"} reply · token {c.ref.index + 1}</p>
          </> : <h3>{replay ? "Replaying the conversation…" : busy ? "Writing the reply…" : "Ask anything to light up the model"}</h3>}
        </div>
        <div className="seg" role="group" aria-label="Diagram view">
          <button type="button" aria-pressed={view === "push"} onClick={() => setTowerView("push")}>{S.viewPush}</button>
          <button type="button" aria-pressed={view === "difference"} disabled={!hasDiff} title={hasDiff ? S.diffNote : diffHint} aria-label={S.viewDiff}
            aria-describedby={!hasDiff ? diffHintId : undefined} onClick={() => setTowerView("difference")}>{S.viewDiff}</button>
        </div>
      </div>
      {!hasDiff && <p id={diffHintId} className={comparisonTurn ? "note comparison-status" : "sr-only"} role="status">{!changedReply && comparisonTurn ? "Change a part to compare with the original." : diffHint}
        {canRetry && <> <button type="button" className="linkish" disabled={mode !== "live" || busy} onClick={() => void retryComparison()}>Retry comparison</button></>}
      </p>}
      {view === "difference" && c && c.ref.turn > 0 && <p className="note comparison-status">Includes the effect of earlier regenerated answers.</p>}
      <div className="tower-color-key" aria-label="Diagram colors">
        <span className="legend-negative">Blue: {view === "push" ? <>against<span className="legend-token-label"> the token</span></> : "decreased"}</span>
        <span className="legend-positive">Orange: {view === "push" ? <>toward<span className="legend-token-label"> the token</span></> : "increased"}</span>
        {embedded && HEADS > 8 && <button className="linkish tower-size-control" aria-label={enlarged ? "Fit graph to width" : "Enlarge cells"} aria-pressed={enlarged} onClick={() => setEnlarged(!enlarged)}>{enlarged ? "Fit width" : "Enlarge"}</button>}
      </div>
      {embedded && enlarged && <p className="note tower-pan-hint">Swipe sideways to see all heads.</p>}
      <div className={`tower-scroll${embedded ? " embedded-tower" : ""}${enlarged ? " enlarged" : ""}`}>
      <div className={`tower${compact ? " compact" : ""}`} ref={gridRef} data-small={FLOORS <= 8} onKeyDown={onKey} role="group" aria-label={S.tower}
        inert={compact} aria-hidden={compact || undefined}
        // fixed side columns, so the head cells grow to the 24px target size before anything else takes the space
        style={{ gridTemplateColumns: embedded ? `40px repeat(${HEADS}, minmax(0, 1fr)) 6px 36px` : `40px repeat(${HEADS}, minmax(${compact ? 10 : 24}px, ${HEADS > 8 ? 24 : 48}px)) 8px 36px`,
          minWidth: enlarged && embedded ? 44 + HEADS * 44 + 8 + 44 + HEADS + 2 : compact || embedded ? undefined : 40 + HEADS * 24 + 8 + 36 + HEADS + 2 }}>
        {!embedded && <><span aria-hidden="true" />
        <button type="button" className={`wide${isOn({ kind: "words-out" }) ? " on" : ""}`} onClick={() => onSelect({ kind: "words-out" })}
          aria-label={`${S.wordsOut}${c ? `: "${wq}"${prob !== undefined ? `, ${Math.round(prob * 100)}%` : ""}` : ""}`}>
          <span>{S.wordsOut}</span>
          {c && <span className="num">"{wq}" {prob !== undefined ? `${Math.round(prob * 100)}%` : ""}</span>}
        </button></>}
        <span className="tower-column">Layer</span>
        <span className="tower-column" style={{ gridColumn: `span ${HEADS}` }}>{S.attentionHeads}</span>
        <span aria-hidden="true" />
        <span className="tower-column" title="MLP: feed-forward network">{S.memoryBlock}</span>
        <span aria-hidden="true" />
        {Array.from({ length: HEADS }, (_, h) => <span key={`index${h}`} className="tower-head-index" data-landmark={HEADS <= 4 || h === 0 || (h + 1) % 4 === 0} aria-hidden="true">{h + 1}</span>)}
        <span aria-hidden="true" />
        <span aria-hidden="true" />
        {rows}
        <span aria-hidden="true" />
        <button type="button" className={`wide${isOn({ kind: "dictionary" }) ? " on" : ""}`} onClick={() => onSelect({ kind: "dictionary" })}
          aria-label={`${S.wordsIn}${c ? `: read "${piece(c.input)}"${label(dictV)}` : ""}`}>
          <span>{S.wordsIn}{c ? <span className="num"> "{piece(c.input).replace(/\n/g, "↵")}"</span> : null}</span>
          {dictV !== undefined && <span className="v num" style={{ background: diverging(dictV / scale) }}>{signed(dictV)}</span>}
        </button>
      </div>
      </div>
      <div className="tower-legend" role="group" aria-label="Token contribution color scale">
        <div className="legend-directions">
          <span className="legend-negative">Blue: {view === "push" ? "against" : "lower"}</span>
          <span className="legend-positive">Orange: {view === "push" ? "toward" : "higher"}</span>
        </div>
        <div className="legend-ramp" aria-hidden="true" style={{ background: `linear-gradient(90deg, ${diverging(-1)}, ${diverging(0)}, ${diverging(1)})` }} />
        {vals && <div className="legend-values num" aria-label="Score scale">
          <span>{signed(-scale)}</span><span>0</span><span>{signed(scale)}</span>
        </div>}
        <p className="legend-note">{vals ? "Score units, not percentages. Scale adjusts for each token." : "Select a token to see its scores."}</p>
        <details className="legend-help">
          <summary>How to read this diagram</summary>
          <p>{S.towerAnatomy(model)} Read upward, from input to output.</p>
          {summary && <p>{summary}</p>}
          <p>{view === "push" ? "Pale means little direct contribution. A pale part can still matter through later layers." : "Pale means little change in direct contribution."}</p>
          {view === "push" ? <>
            <p>Each cell shows one part's contribution to the selected token's score relative to the average score across all tokens. Orange adds to that relative score; blue subtracts from it. Stronger color means a larger contribution.</p>
            <p>Blue does not mean an opposite word. A token is a word, part of a word, a character or punctuation.</p>
          </> : <>
            <p>Each cell compares the same part in both models, forcing the original token after each side’s conversation history. Blue means its contribution decreased; orange means it increased.</p>
            <p>On later turns, the changed model reads its own earlier answers. Differences include both the model changes and that changed context.</p>
            <p>An increase can still leave a contribution negative. These colors show the change, not whether the part now supports the token.</p>
          </>}
          <p>The numbers are in logits, the model's score units. The color range rescales to the largest absolute value shown, so use the numbers when comparing different tokens.</p>
          <p>This measures direct contributions with the final normalization scale held fixed. It does not include effects through later layers. Turn a part off and compare outputs to test its effect.</p>
        </details>
      </div>
    </div>
  );
}
