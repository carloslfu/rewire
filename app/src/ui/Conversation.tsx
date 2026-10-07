// The conversation: each turn's normal reply, and once forked, the changed reply beside it (section 4.3).
import { Fragment, useEffect, useRef, useState } from "react";
import type { Reply, Side, Tok, Turn } from "../model/types.ts";
import { continueReply, piece, selectWord, setFocus, undoPick } from "../state/actions.ts";
import { useStore } from "../state/store.ts";
import { S } from "../strings.ts";
import { pct } from "./color.ts";
import { describe } from "./describe.ts";
import { ReplayStatus } from "./ReplayStatus.tsx";

const STOP = new Set([151645, 151643]);
const MARKERS: Record<number, string> = { 151644: "<|im_start|>", 151645: "<|im_end|>", 151643: "<|endoftext|>", 151667: "<think>", 151668: "</think>" };

export function Conversation() {
  const turns = useStore((s) => s.turns);
  const mode = useStore((s) => s.mode);
  const end = useRef<HTMLDivElement>(null);
  const [reads, setReads] = useState(false);
  useEffect(() => {
    if (turns.length > 1 && turns[turns.length - 1]?.normal.source === "live") end.current?.scrollIntoView({ block: "nearest" });
  }, [turns.length]);
  if (!turns.length) return null;
  return (
    <div className="conversation" aria-live="off">
      <ReplayStatus />
      {turns.map((t, k) => <TurnView key={k} turn={t} k={k} last={k === turns.length - 1} live={mode === "live"} />)}
      <div ref={end} />
      <details className="reads-toggle" open={reads} onToggle={(e) => setReads(e.currentTarget.open)}>
        <summary>{S.whatItReads}</summary>
        {reads && <Reads turns={turns} />}
      </details>
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
  const inspecting = useStore((s) => s.sheet);
  const busy = useStore((s) => s.busy);
  const replay = useStore((s) => s.replay);
  const model = useStore((s) => s.model);
  const compare = side === "normal" ? turn.changed?.compare : undefined;
  const changed = side === "changed";
  const label = !changed ? (turn.changed ? "Original" : model.id === "tiny" ? "Your tiny model" : "Rewire")
    : reply.stale ? S.writtenUnder(describe(reply.changes, turn.normal.read)) : S.changedBy(describe(reply.changes, turn.normal.read));
  const toks = reply.toks;
  const pending = changed && replay && k >= replay.turn;
  const queued = pending && k > replay.turn;
  const moved = changed && reply.done && !reply.stale && !pending ? whatMoved(turn) : null;
  const inspectable = !reply.stale;
  // One Tab stop per reply; arrow keys move between its words (roving tabindex, like the tower).
  const textRef = useRef<HTMLDivElement>(null);
  const [cursor, setCursor] = useState(-1);
  const shown = toks.map((t, i) => (STOP.has(t.id) ? -1 : i)).filter((i) => i >= 0);
  const selHere = word && word.turn === k && word.side === side ? word.index : -1;
  const roving = shown.includes(selHere) ? selHere : shown.includes(cursor) ? cursor : shown[0];
  // screen readers get the reply as one sentence on the group; the pieces stay buttons for inspecting
  const plain = shown.map((i) => piece(toks[i].id)).join("").trim();
  const onKey = (e: React.KeyboardEvent) => {
    const btns = [...(textRef.current?.querySelectorAll<HTMLButtonElement>("button.tok") ?? [])];
    const at = btns.indexOf(document.activeElement as HTMLButtonElement);
    if (at < 0) return;
    let j = at;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") j = Math.min(btns.length - 1, at + 1);
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") j = Math.max(0, at - 1);
    else if (e.key === "Home") j = 0;
    else if (e.key === "End") j = btns.length - 1;
    else return;
    e.preventDefault();
    btns[j].focus();
    setCursor(Number(btns[j].dataset.i));
  };
  return (
    <div className={`reply${changed ? " changed" : ""}${reply.stale ? " stale" : ""}`}>
      <div className="reply-heading"><span className="who">{label}</span><span className="provenance">On this device</span></div>
      <div className="text" ref={textRef} onKeyDown={inspectable ? onKey : undefined}
        role={inspectable ? "group" : undefined} aria-label={inspectable ? `${label ?? S.reply}: ${plain}` : undefined}
        aria-description={inspectable ? S.replyWords : undefined}>
        {wordGroups(toks).map((group) => <span className="token-word" key={group[0].i}>{group.map(({ t, i }) => {
          if (STOP.has(t.id)) return null;
          const sel = word && word.turn === k && word.side === side && word.index === i;
          const pc = compare?.[i] ? Math.exp(compare[i].lp1) : null;
          const pn = Math.exp(t.lp1);
          const under = pc !== null && pc < 0.1 && pc < 0.5 * pn;
          const txt = piece(t.id);
          const spoken = txt.trim() || (txt.includes("\n") ? "Line break" : "Space");
          if (!inspectable) return <Fragment key={i}>{txt}</Fragment>;
          return (
            <button key={i} type="button" className={`tok${sel ? " sel" : ""}${under ? " under" : ""}${t.picked ? " picked" : ""}`}
              data-i={i} tabIndex={i === roving ? 0 : -1} aria-pressed={!!sel && inspecting}
              aria-label={under ? `${spoken}: the changed model gives it ${pct(pc!)}` : !txt.trim() ? spoken : undefined}
              title={under ? `Normal ${pct(pn)}, changed ${pct(pc!)}` : undefined}
              onClick={() => selectWord({ turn: k, side, index: i })}>
              {txt}
            </button>
          );
        })}</span>)}
        {!reply.done && !queued && <span className="tok cursor" aria-hidden="true" />}
      </div>
      {queued && <p className="note">{replay.status === "running" ? "Waiting for earlier replies…" : "Not replayed yet."}</p>}
      {pending && !queued && replay.status !== "running" && <p className="note">Replay interrupted here.</p>}
      {moved && <p className="moved">{moved}</p>}
      <div className="foot">
        {reply.pickedAt !== undefined && reply.original && (
          <>
            <span>{S.youPicked}: "{piece(toks[reply.pickedAt]?.id ?? 0).trim()}"</span>
            <button type="button" className="btn quiet" disabled={busy || !!replay} onClick={() => undoPick(k, side)}>{S.undo}</button>
          </>
        )}
        {reply.done && !reply.ended && !reply.stale && last && !replay && (
          <>
            <span>{S.stopped(reply.toks.length, model.piece)}</span>
            {live && <button type="button" className="btn" disabled={busy} onClick={() => void continueReply()}>{S.cont}</button>}
          </>
        )}
      </div>
    </div>
  );
}

/** Keep adjacent pieces of one word together when a narrow reply wraps. */
function wordGroups(toks: Tok[]) {
  const groups: { t: Tok; i: number }[][] = [];
  toks.forEach((t, i) => {
    if (STOP.has(t.id)) return;
    const txt = piece(t.id), previous = groups.at(-1)?.at(-1);
    if (!previous || /^\s/.test(txt) || /\s$/.test(piece(previous.t.id))) groups.push([]);
    groups[groups.length - 1].push({ t, i });
  });
  return groups;
}

/** Screen readers hear finished replies, not each streamed word (section 5.5). */
export function FinishedReplies() {
  const turns = useStore((s) => s.turns);
  const busy = useStore((s) => s.busy);
  const replay = useStore((s) => s.replay);
  let text = "";
  const t = turns[turns.length - 1];
  if (!busy && !replay && t) {
    const words = (r: Reply) => r.toks.filter((x) => !STOP.has(x.id)).map((x) => piece(x.id)).join("").trim();
    const parts: string[] = [];
    if (t.normal.done) parts.push(t.changed ? `${S.normal}: ${words(t.normal)}` : words(t.normal));
    if (t.changed?.done && !t.changed.stale) parts.push(`${S.changedBy(describe(t.changed.changes, t.normal.read))}. ${words(t.changed)}`);
    text = parts.join(" ");
  }
  return <div className="sr-only" aria-live="polite">{text}</div>;
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
  const [side, setSide] = useState<Side>("normal");
  const forked = turns.some((t) => t.changed);
  const changed = forked && side === "changed";
  const hidden = new Set((chips.hidden ?? []).map((h) => h.key));
  let pos = 0;
  const items: { id: number; pos: number; reply: boolean }[] = [];
  for (const t of turns) {
    const r = changed ? t.changed : t.normal;
    if (!r) break;
    for (const id of r.read) items.push({ id, pos: pos++, reply: false });
    for (const tk of r.toks) items.push({ id: tk.id, pos: pos++, reply: true });
  }
  return (
    <div className="reads">
      {forked && <div className="seg" role="group" aria-label="Conversation history">
        <button aria-pressed={!changed} onClick={() => setSide("normal")}>Original history</button>
        <button aria-pressed={changed} onClick={() => setSide("changed")}>Changed history</button>
      </div>}
      {changed && <p className="note">The replay uses these regenerated answers as context. Unreplayed turns are not included.</p>}
      <p className="note">{S.readsNote}</p>
      <p className="note">{S.thinkingOff}</p>
      <div style={{ marginTop: 6 }}>
        {items.map((x) => {
          const m = MARKERS[x.id];
          const txt = m ?? piece(x.id);
          return (
            <button key={x.pos} type="button" className={`piece${m ? " marker" : ""}${hidden.has(x.pos) ? " hidden" : ""}`}
              title={`position ${x.pos}, id ${x.id}`} aria-label={!txt.trim() ? txt.includes("\n") ? "Line break" : "Space" : undefined} onClick={() => setFocus({ kind: "words-in", position: x.pos, side: changed ? "changed" : "normal" })}>
              {txt.replace(/\n/g, "↵")}
            </button>
          );
        })}
      </div>
    </div>
  );
}
