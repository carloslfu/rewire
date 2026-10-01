// The conversation: each turn's normal reply, and once forked, the changed reply beside it (section 4.3).
import { Fragment, useState } from "react";
import type { Reply, Side, Turn } from "../model/types.ts";
import { continueReply, piece, selectWord, undoPick } from "../state/actions.ts";
import { store, useStore } from "../state/store.ts";
import { S } from "../strings.ts";
import { pct } from "./color.ts";
import { describe } from "./describe.ts";

const STOP = new Set([151645, 151643]);
const MARKERS: Record<number, string> = { 151644: "<|im_start|>", 151645: "<|im_end|>", 151643: "<|endoftext|>", 151667: "<think>", 151668: "</think>" };

export function Conversation() {
  const turns = useStore((s) => s.turns);
  const mode = useStore((s) => s.mode);
  const [reads, setReads] = useState(false);
  if (!turns.length) return null;
  return (
    <div aria-live="off">
      {turns.map((t, k) => <TurnView key={k} turn={t} k={k} last={k === turns.length - 1} live={mode === "live"} />)}
      <div className="reads-toggle">
        <button type="button" className="linkish small" aria-expanded={reads} onClick={() => setReads(!reads)}>
          {reads ? S.hideReads : S.whatItReads}
        </button>
        {reads && <Reads turns={turns} />}
      </div>
    </div>
  );
}

function TurnView({ turn, k, last, live }: { turn: Turn; k: number; last: boolean; live: boolean }) {
  const forked = !!turn.changed;
  return (
    <div className="turn">
      <div className="user"><span className="sr-only">{S.you}: </span>{turn.user}</div>
      <div className={`replies${forked ? " forked" : ""}`}>
        <ReplyView reply={turn.normal} k={k} side="normal" turn={turn} last={last} live={live} />
        {turn.changed && <ReplyView reply={turn.changed} k={k} side="changed" turn={turn} last={last} live={live} />}
      </div>
    </div>
  );
}

function ReplyView({ reply, k, side, turn, last, live }: { reply: Reply; k: number; side: Side; turn: Turn; last: boolean; live: boolean }) {
  const word = useStore((s) => s.word);
  const model = useStore((s) => s.model);
  const compare = side === "normal" ? turn.changed?.compare : undefined;
  const changed = side === "changed";
  const label = !changed ? (turn.changed ? S.normal : null)
    : reply.stale ? S.writtenUnder(describe(reply.changes, turn.normal.read)) : S.changedBy(describe(reply.changes, turn.normal.read));
  const toks = reply.toks;
  const moved = changed && reply.done && !reply.stale ? whatMoved(turn) : null;
  const inspectable = !reply.stale;
  return (
    <div className={`reply${changed ? " changed" : ""}${reply.stale ? " stale" : ""}`}>
      {label && <div className="who">{label}</div>}
      <div className="text">
        {toks.map((t, i) => {
          if (STOP.has(t.id)) return null;
          const sel = word && word.turn === k && word.side === side && word.index === i;
          const pc = compare?.[i] ? Math.exp(compare[i].lp1) : null;
          const pn = Math.exp(t.lp1);
          const under = pc !== null && pc < 0.1 && pc < 0.5 * pn;
          const txt = piece(t.id);
          if (!inspectable) return <Fragment key={i}>{txt}</Fragment>;
          return (
            <button key={i} type="button" className={`tok${sel ? " sel" : ""}${under ? " under" : ""}${t.picked ? " picked" : ""}${reply.featured?.includes(i) ? " featured" : ""}`}
              aria-pressed={!!sel}
              aria-label={under ? `${txt.trim()}: the changed model gives it ${pct(pc!)}` : undefined}
              title={under ? `Normal ${pct(pn)}, changed ${pct(pc!)}` : undefined}
              onClick={() => selectWord({ turn: k, side, index: i })}>
              {txt}
            </button>
          );
        })}
        {!reply.done && <span className="tok cursor" aria-hidden="true" />}
      </div>
      {reply.missing && <p className="note">{S.notRecorded}</p>}
      {moved && <p className="moved">{moved}</p>}
      {compare && toks.some((t, i) => compare[i] && Math.exp(compare[i].lp1) < 0.1 && Math.exp(compare[i].lp1) < 0.5 * Math.exp(t.lp1)) && (
        <p className="note">{S.underlineNote}</p>
      )}
      <div className="foot">
        {reply.pickedAt !== undefined && reply.original && (
          <>
            <span>{S.youPicked}: "{piece(toks[reply.pickedAt]?.id ?? 0).trim()}"</span>
            <button type="button" className="btn quiet" onClick={() => undoPick(k, side)}>{S.undo}</button>
          </>
        )}
        {reply.done && !reply.ended && !reply.stale && last && (
          <>
            <span>{S.stopped(reply.toks.length, model.piece)}</span>
            {live && <button type="button" className="btn" onClick={() => void continueReply()}>{S.cont}</button>}
          </>
        )}
      </div>
    </div>
  );
}

/** When the words come out the same, say what moved instead (section 4.3). */
function whatMoved(turn: Turn): string | null {
  const c = turn.changed;
  if (!c?.compare || !turn.normal.done) return null;
  const a = turn.normal.toks.map((t) => t.id), b = c.toks.map((t) => t.id);
  if (a.length !== b.length || a.some((x, i) => x !== b[i])) return null;
  let best = -1, gap = 0;
  for (let i = 0; i < a.length; i++) {
    if (STOP.has(a[i]) || !c.compare[i]) continue;
    const d = Math.abs(Math.exp(turn.normal.toks[i].lp1) - Math.exp(c.compare[i].lp1));
    if (d > gap) { gap = d; best = i; }
  }
  if (best < 0 || gap < 0.02) return S.sameNumbers;
  const pa = Math.round(Math.exp(turn.normal.toks[best].lp1) * 100), pb = Math.round(Math.exp(c.compare[best].lp1) * 100);
  return S.sameWords(piece(a[best]).trim(), pa, pb);
}

/** What the model actually reads: the full input as word pieces, markers included. */
function Reads({ turns }: { turns: Turn[] }) {
  const chips = useStore((s) => s.chips);
  const hidden = new Set((chips.hidden ?? []).map((h) => h.key));
  let pos = 0;
  const items: { id: number; pos: number; reply: boolean }[] = [];
  for (const t of turns) {
    for (const id of t.normal.read) items.push({ id, pos: pos++, reply: false });
    for (const tk of t.normal.toks) items.push({ id: tk.id, pos: pos++, reply: true });
  }
  return (
    <div className="reads">
      <p className="note">{S.readsNote}</p>
      <p className="note">{S.thinkingOff}</p>
      <div style={{ marginTop: 6 }}>
        {items.map((x) => {
          const m = MARKERS[x.id];
          const txt = m ?? piece(x.id);
          return (
            <button key={x.pos} type="button" className={`piece${m ? " marker" : ""}${hidden.has(x.pos) ? " hidden" : ""}`}
              title={`position ${x.pos}, id ${x.id}`} onClick={() => store.set({ focus: { kind: "words-in", position: x.pos }, sheet: true })}>
              {txt.replace(/\n/g, "↵")}
            </button>
          );
        })}
      </div>
    </div>
  );
}
