// Independent samples, each with an editable question and its original/changed pair.
import { Fragment, useEffect, useRef, useState } from "react";
import type { Reply, Side, Turn } from "../model/types.ts";
import { askReplay, contextCap, continueReply, editSample, piece, removeSample, selectWord, undoPick, undoRemoveSample } from "../state/actions.ts";
import { useStore } from "../state/store.ts";
import { S } from "../strings.ts";
import { pct } from "./color.ts";
import { describe } from "./describe.ts";
import { ReplayStatus } from "./ReplayStatus.tsx";
import { replySegments, replyText, STOP, wordGroups } from "./reply-text.ts";
import { comparison, contextFull } from "./word.ts";

const MARKERS: Record<number, string> = { 151644: "<|im_start|>", 151645: "<|im_end|>", 151643: "<|endoftext|>", 151667: "<think>", 151668: "</think>" };

export function Conversation() {
  const turns = useStore((s) => s.turns);
  const mode = useStore((s) => s.mode);
  const removed = useStore((s) => s.removed);
  const busy = useStore((s) => s.busy);
  const replay = useStore((s) => s.replay);
  const end = useRef<HTMLDivElement>(null);
  const undoButton = useRef<HTMLButtonElement>(null);
  const newestSeen = useRef(0);
  const removedId = removed.at(-1)?.sample.id;
  useEffect(() => { if (removedId !== undefined) undoButton.current?.focus(); }, [removedId]);
  useEffect(() => {
    const newest = Math.max(0, ...turns.map((t) => t.id));
    if (newest > newestSeen.current && turns.length > 1) end.current?.scrollIntoView({ block: "nearest" });
    newestSeen.current = Math.max(newestSeen.current, newest);
  }, [turns.length]);
  if (!turns.length && !removed.length) return null;
  const undoAt = Math.min(removed.at(-1)?.index ?? -1, turns.length);
  const undo = removed.length > 0 && <div className="sample-undo" role="status" key="undo-remove">
    <span>Removed: <span className="removed-question">{removed.at(-1)!.sample.user}</span></span>
    <button ref={undoButton} className="btn" disabled={busy || !!replay || mode !== "live"} onClick={() => void undoRemoveSample()} aria-label="Undo remove">Undo</button>
  </div>;
  return (
    <div className="conversation" aria-live="off">
      <ReplayStatus />
      {turns.flatMap((t, k) => [k === undoAt ? undo : null, <TurnView key={t.id} turn={t} k={k} live={mode === "live"} />])}
      {undoAt === turns.length && undo}
      <div ref={end} />
    </div>
  );
}

function TurnView({ turn, k, live }: { turn: Turn; k: number; live: boolean }) {
  const forked = !!turn.changed;
  const busy = useStore((s) => s.busy), replay = useStore((s) => s.replay);
  const model = useStore((s) => s.model);
  const [editing, setEditing] = useState(false), [text, setText] = useState(turn.user);
  const [reads, setReads] = useState(false);
  const locked = busy || !!replay || !live;
  const cancel = () => { setText(turn.user); setEditing(false); };
  const save = async () => { if (!locked && text.trim() && await editSample(turn.id, text)) setEditing(false); };
  return (
    <article className="turn" aria-labelledby={`sample-${turn.id}`}>
      <div className="sample-heading">
        <div className="sample-question"><p className="eyebrow">{model.id === "tiny" ? "Text" : `Sample ${k + 1}`}</p>
          <h3 id={`sample-${turn.id}`}>{turn.user}</h3></div>
        {model.id === "qwen" && <div className="sample-actions">
          <button className="btn" disabled={locked} aria-label={`Edit sample ${k + 1}`} aria-expanded={editing}
            onClick={() => { setText(turn.user); setEditing(true); }}>Edit</button>
          <button className="btn quiet" disabled={locked} aria-label={`Remove sample ${k + 1}`} onClick={() => removeSample(turn.id)}>Remove</button>
        </div>}
      </div>
      {editing && <form className="sample-edit" onSubmit={(e) => { e.preventDefault(); void save(); }}>
        <label htmlFor={`edit-${turn.id}`}>Edit this question</label>
        <textarea id={`edit-${turn.id}`} autoFocus rows={3} value={text} onChange={(e) => setText(e.target.value)}
          disabled={locked} onKeyDown={(e) => { if (e.key === "Escape") cancel(); }} />
        <p className="note">Updating regenerates this sample’s answers. Other samples stay unchanged.</p>
        <div className="sample-edit-actions"><button className="btn primary" disabled={locked || !text.trim()}>Update sample</button>
          <button type="button" className="btn quiet" disabled={busy} onClick={cancel}>Cancel</button></div>
      </form>}
      <div className={`replies${forked ? " forked" : ""}`}>
        <ReplyView reply={turn.normal} k={k} side="normal" turn={turn} live={live} />
        {turn.changed && <ReplyView reply={turn.changed} k={k} side="changed" turn={turn} live={live} />}
      </div>
      <details className="reads-toggle" open={reads} onToggle={(e) => setReads(e.currentTarget.open)}>
        <summary>{S.whatItReads}</summary>
        {reads && <Reads turn={turn} k={k} />}
      </details>
    </article>
  );
}

function ReplyView({ reply, k, side, turn, live }: { reply: Reply; k: number; side: Side; turn: Turn; live: boolean }) {
  const word = useStore((s) => s.word);
  const inspecting = useStore((s) => s.sheet);
  const busy = useStore((s) => s.busy);
  const replay = useStore((s) => s.replay);
  const model = useStore((s) => s.model);
  const stage3d = useStore((s) => s.stage3d);
  // Only a comparison measured on these very tokens. One left from another version of this reply is not read by position.
  const compare = side === "normal" ? comparison(turn) : undefined;
  const full = useStore((s) => contextFull(reply, contextCap(s)));
  const pickedPiece = reply.pickedAt === undefined ? undefined : reply.toks[reply.pickedAt];
  const changed = side === "changed";
  const label = !changed ? (model.id === "tiny" ? "Your tiny model" : "Original")
    : reply.stale ? S.writtenUnder(describe(reply.changes, turn.normal.read)) : S.changedBy(describe(reply.changes, turn.normal.read));
  const toks = reply.toks;
  const pending = changed && replay && k >= replay.turn;
  const queued = pending && k > replay.turn;
  const moved = changed && reply.done && !reply.stale && !pending ? whatMoved(turn) : null;
  const inspectable = !reply.stale;
  // One Tab stop per reply; arrow keys move between its words (roving tabindex, like the tower).
  const textRef = useRef<HTMLDivElement>(null);
  const [cursor, setCursor] = useState(-1);
  const segments = replySegments(reply);
  const shown = segments.map((s) => s.from);
  const selHere = word && word.turn === k && word.side === side ? word.index : -1;
  const selected = segments.find((s) => s.from <= selHere && selHere < s.to)?.from;
  const roving = selected ?? (shown.includes(cursor) ? cursor : shown[0]);
  // screen readers get the reply as one sentence on the group; the pieces stay buttons for inspecting
  const plain = segments.map((s) => s.text).join("").trim();
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
        {wordGroups(segments).map((group) => <span className="token-word" key={group[0].from}>{group.map(({ text: txt, from: i, to }) => {
          const members = toks.slice(i, to);
          const sel = word && word.turn === k && word.side === side && i <= word.index && word.index < to;
          const under = members.some((t, j) => compare?.[i + j] && Math.exp(compare[i + j].lp1) < 0.1 && Math.exp(compare[i + j].lp1) < 0.5 * Math.exp(t.lp1));
          const pc = compare?.[i] ? Math.exp(compare[i].lp1) : null;
          const spanNote = to - i > 1 ? `Spans tokens ${i + 1} to ${to}. Select individual parts in Word piece.` : undefined;
          const spoken = txt.trim() || (txt.includes("\n") ? "Line break" : "Space");
          if (!inspectable) return <Fragment key={i}>{txt}</Fragment>;
          return (
            <button key={i} type="button" className={`tok${sel ? " sel" : ""}${under ? " under" : ""}${members.some((t) => t.picked) ? " picked" : ""}`}
              data-i={i} tabIndex={i === roving ? 0 : -1} aria-pressed={!!sel && inspecting}
              aria-label={spanNote ? `${spoken}. ${spanNote}` : under ? `${spoken}: the changed model gives it ${pct(pc!)}` : !txt.trim() ? spoken : undefined}
              title={spanNote ?? (under ? `Normal ${pct(Math.exp(toks[i].lp1))}, changed ${pct(pc!)}` : undefined)}
              onClick={() => selectWord({ turn: k, side, index: i })}>
              {txt}
            </button>
          );
        })}</span>)}
        {!reply.done && !queued && <span className="tok cursor" aria-hidden="true" />}
      </div>
      {queued && <p className="note">{replay.status === "running" ? "Waiting to update this sample…" : "Not updated yet."}</p>}
      {pending && !queued && replay.status !== "running" && <p className="note">Update interrupted here.</p>}
      {moved && <p className="moved">{moved}</p>}
      <div className="foot">
        {reply.pickedAt !== undefined && reply.original && (
          <>
            {/* Until the picked piece arrives the reply is still being written; only a finished reply without it was stopped. */}
            {(pickedPiece || reply.done) && <span>{pickedPiece ? `${S.youPicked}: "${piece(pickedPiece.id).trim() || JSON.stringify(piece(pickedPiece.id)).slice(1, -1)}"` : S.pickStopped}</span>}
            <button type="button" className="btn quiet" disabled={busy || !!replay} onClick={() => undoPick(k, side)}>{S.undo}</button>
          </>
        )}
        {reply.done && !reply.ended && !reply.stale && !replay && (full ? <span>{S.contextLimit(reply.toks.length, model.piece)}</span> : (
          <>
            <span>{S.stopped(reply.toks.length, model.piece)}</span>
            {live && <button type="button" className="btn" disabled={busy} onClick={() => void continueReply(k)}>{S.cont}</button>}
          </>
        ))}
        {reply.done && !reply.stale && !busy && !replay && stage3d && segments.length > 0 && (
          <button type="button" className="linkish reply-replay" title={S.replayIn3dTitle} onClick={() => askReplay(turn.id, side)}>{S.replayIn3d}</button>
        )}
      </div>
    </div>
  );
}

/** Screen readers hear finished replies, not each streamed word (section 5.5). */
export function FinishedReplies() {
  const turns = useStore((s) => s.turns);
  const busy = useStore((s) => s.busy);
  const replay = useStore((s) => s.replay);
  let text = "";
  const t = turns[turns.length - 1];
  if (!busy && !replay && t) {
    const words = (r: Reply) => replyText(r).trim();
    const parts: string[] = [];
    if (t.normal.done) parts.push(t.changed ? `${S.normal}: ${words(t.normal)}` : words(t.normal));
    if (t.changed?.done && !t.changed.stale) parts.push(`${S.changedBy(describe(t.changed.changes, t.normal.read))}. ${words(t.changed)}`);
    text = parts.join(" ");
  }
  return <div className="sr-only" aria-live="polite">{text}</div>;
}

/** When the words come out the same, say what moved instead (section 4.3). */
function whatMoved(turn: Turn): string | null {
  const c = turn.changed, measured = comparison(turn);
  if (!c || !measured || !turn.normal.done) return null;
  const a = turn.normal.toks.map((t) => t.id), b = c.toks.map((t) => t.id);
  if (a.length !== b.length || a.some((x, i) => x !== b[i])) return null;
  let best = -1, gap = 0;
  for (let i = 0; i < a.length; i++) {
    if (STOP.has(a[i])) continue;
    const d = Math.abs(Math.exp(turn.normal.toks[i].lp1) - Math.exp(measured[i].lp1));
    if (d > gap) { gap = d; best = i; }
  }
  if (best < 0 || gap < 0.02) return S.sameNumbers;
  const pa = Math.round(Math.exp(turn.normal.toks[best].lp1) * 100), pb = Math.round(Math.exp(measured[best].lp1) * 100);
  const segment = replySegments(turn.normal).find((s) => s.from <= best && best < s.to);
  if (segment && segment.to - segment.from > 1) return `Same text. Token ${best + 1} (${piece(a[best])}) changed from ${pa}% to ${pb}%.`;
  return S.sameWords(piece(a[best]).trim(), pa, pb);
}

/** What the model actually reads: the full input as word pieces, markers included. */
function Reads({ turn, k }: { turn: Turn; k: number }) {
  const chips = useStore((s) => s.chips);
  const [side, setSide] = useState<Side>("normal");
  const forked = !!turn.changed;
  const changed = forked && side === "changed";
  const hidden = new Set((chips.hidden ?? []).map((h) => h.key));
  let pos = 0;
  const items: { id: number; pos: number; reply: boolean }[] = [];
  const r = changed ? turn.changed! : turn.normal;
  for (const id of r.read) items.push({ id, pos: pos++, reply: false });
  for (const tk of r.toks) items.push({ id: tk.id, pos: pos++, reply: true });
  return (
    <div className="reads">
      {forked && <div className="seg" role="group" aria-label="Sample input and output">
        <button aria-pressed={!changed} onClick={() => setSide("normal")}>Original</button>
        <button aria-pressed={changed} onClick={() => setSide("changed")}>Changed</button>
      </div>}
      <p className="note">Only this question’s prompt and reply are shown. Other samples are never included.</p>
      <p className="note">{S.readsNote}</p>
      <p className="note">{S.thinkingOff}</p>
      <div style={{ marginTop: 6 }}>
        {items.map((x) => {
          const m = MARKERS[x.id];
          const txt = m ?? piece(x.id);
          return (
            <button key={x.pos} type="button" className={`piece${m ? " marker" : ""}${hidden.has(x.pos) ? " hidden" : ""}`}
              title={`position ${x.pos}, id ${x.id}`} aria-label={!txt.trim() ? txt.includes("\n") ? "Line break" : "Space" : undefined} onClick={() => selectWord({ turn: k, side: changed ? "changed" : "normal", index: 0 }, { kind: "words-in", position: x.pos, side: changed ? "changed" : "normal" })}>
              {txt.replace(/\n/g, "↵")}
            </button>
          );
        })}
      </div>
    </div>
  );
}
