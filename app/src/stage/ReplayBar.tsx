// Live output and Replay, in one strip directly under the 3D stage. Live shows what the model is
// writing. Replay walks a finished answer back through the whole model from values already measured.
import { useContext, useEffect, useId, useMemo, useRef } from "react";
import { chooseWord, piece } from "../state/actions.ts";
import { store, useStore } from "../state/store.ts";
import { chips as describeChips } from "../ui/describe.ts";
import { modelPct, pct, signed } from "../ui/color.ts";
import { FollowControl } from "../ui/FollowControl.tsx";
import { useNarrow } from "../ui/useNarrow.ts";
import { tokenLabel } from "../ui/token-label.ts";
import { Immersive } from "./immersive.ts";
import { rmsLabel } from "./adapters.ts";
import { pushIndex } from "./arch.ts";
import { chosen, towerValues, visibleTokens } from "../ui/word.ts";
import { beatAt, beatLabel, pushCoverage, pushSoFar, runningPush } from "./playback.ts";
import { type Scope, SPEEDS } from "./replay.ts";
import { replayWait, replayWord, runName, session, startReplay, switchReplayRun, useReplay } from "./replay-session.ts";

const text = (id: number) => tokenLabel(piece(id));

const ICONS = {
  play: <path d="M4.5 2.8v10.4L13 8z" fill="currentColor" stroke="none" />,
  pause: <path d="M5 3v10M11 3v10" strokeWidth="2.4" />,
  again: <path d="M13 8a5 5 0 1 1-1.6-3.7M13 2.6v2.6h-2.6" />,
  back: <path d="M10 3.5L5.5 8l4.5 4.5" />,
  forward: <path d="M6 3.5L10.5 8 6 12.5" />,
};
function Icon({ name }: { name: keyof typeof ICONS }) {
  return <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{ICONS[name]}</svg>;
}

export function ReplayBar({ activity = false }: { activity?: boolean } = {}) {
  const rp = useReplay((s) => s);
  const model = useStore((s) => s.model);
  const version = useStore((s) => s.version);
  const turns = useStore((s) => s.turns);
  const word = useStore((s) => s.word);
  const fork = useStore((s) => s.fork);
  const view = useStore((s) => s.view);
  const busy = useStore((s) => s.busy);
  const update = useStore((s) => s.replay);
  const mode = useStore((s) => s.mode);
  const stage3d = useStore((s) => s.stage3d);
  const id = useId();
  const narrow = useNarrow();
  const immersive = useContext(Immersive);
  const compact = narrow;
  const main = useRef<HTMLButtonElement>(null);
  /** Set when a button here changes the mode, so the focus goes to the button that took its place. */
  const moved = useRef(false);

  const c = useMemo(() => chosen({ turns, word, fork }), [turns, word, fork]);
  const vals = useMemo(() => towerValues(c, view), [c, view]);
  const running = useMemo(() => (vals ? runningPush(model, vals) : null), [model, vals]);
  const complete = useMemo(() => pushCoverage(model, vals).complete, [model, vals]);
  const wait = replayWait({ model, version, turns, word, fork, busy, stage3d, replay: update });
  const replaying = rp.mode === "replay";
  const visible = useMemo(() => visibleTokens(c?.reply), [c?.reply]);
  const at = c ? visible.indexOf(c.ref.index) : -1;
  const wq = c ? text(c.tok.id) : "";
  const launch = !wait && !replaying ? replayWord({ turns, word }) : null;
  const launchesChanged = launch?.side === "changed";
  const mappedToken = launchesChanged && c ? visibleTokens(c.turn.changed).indexOf(launch.index) + 1 : 0;
  const paired = useMemo(() => !!replayWord({ turns, word }, "normal") && !!replayWord({ turns, word }, "changed"), [turns, word]);
  const replayedEdits = replaying && c?.ref.side === "changed" ? c.reply : undefined;
  const edits = useMemo(() => replayedEdits ? describeChips(replayedEdits.changes, replayedEdits.read) : [], [replayedEdits]);

  useEffect(() => {
    if (moved.current) main.current?.focus();
    moved.current = false;
  }, [replaying]);

  const enter = (scope: Scope) => { moved.current = true; if (!startReplay(scope)) moved.current = false; };
  const back = () => { moved.current = true; session.exit("live"); store.set({ announce: "Live output. Following the newest token." }); };
  const move = (d: 1 | -1) => {
    if (replaying) { session.toToken(at + d); return; }
    const index = visible[at + d];
    if (c && index !== undefined) chooseWord({ ...c.ref, index });
  };

  const waitingForOutput = replaying && rp.step < rp.beats;
  const token = c ? <div className="token-navigation" role="group" aria-label={replaying ? "Token in the replay" : "Selected token"}>
    <button type="button" className="btn quiet" aria-label="Previous token" title={replaying ? "Previous token. Pauses the replay." : "Previous token"} disabled={at <= 0} onClick={() => move(-1)}>‹</button>
    <strong title={waitingForOutput ? "Awaiting output" : wq}>{waitingForOutput ? "…" : `“${wq}”`}</strong>
    {replaying && <span className="replay-token-position num" aria-hidden="true">{at + 1}/{visible.length}</span>}
    <button type="button" className="btn quiet" aria-label="Next token" title={replaying ? "Next token. Pauses the replay." : "Next token"} disabled={at < 0 || at >= visible.length - 1} onClick={() => move(1)}>›</button>
    <span className="note">Token {at + 1} of {visible.length} · {c.ref.side === "normal" ? (model.id === "tiny" ? "Reply" : "Original reply") : "Changed reply"}</span>
  </div> : <p className="note replay-empty">{update ? "Updating samples…" : busy ? "Writing the reply…" : mode === "live" ? "Ask a question to light up the model." : "The model lights up once it is ready and you ask a question."}</p>;

  const playAnswer = <button ref={main} type="button" className="btn primary replay-enter" disabled={!!wait} aria-describedby={`${id}-how`}
    title={wait || "Play from the first token through the whole model"} onClick={() => enter("answer")}><Icon name="play" />{launchesChanged ? "Replay changed answer" : "Replay answer"}</button>;
  const liveControls = <>
    <div className="replay-follow"><FollowControl /></div>
    <p className="note replay-how" id={`${id}-how`}>{wait || <><span className="replay-what">Walks {launchesChanged ? "the changed reply" : "this reply"} through the whole model, token by token.</span> <button type="button" className="linkish" onClick={() => enter("token")}>{launchesChanged && c?.ref.side !== "changed" ? `Replay changed token ${mappedToken}` : "Replay only this token"}</button></>}</p>
  </>;
  if (!replaying) {
    if (narrow && !immersive) return <section className="live-mobile" aria-label="Live output and replay">
      <details><summary>Live output{c && <small>Token {at + 1} of {visible.length}</small>}</summary>
        <div className="mobile-live-options">{token}{liveControls}</div>
      </details>{playAnswer}
    </section>;
    return <section className="replay-bar" aria-label="Live output and replay">
      <div className="replay-head"><span className="replay-mode live">Live output</span>{token}{playAnswer}</div>
      {liveControls}
    </section>;
  }

  const activeRun = c ? runName(c.ref.side) : "Original";
  const editDescription = edits.length === 1 ? edits[0].label : edits.length ? `${edits.length} model edits` : "";
  const whole = rp.step >= rp.beats, beat = beatAt(model, rp.step - 1);
  const probability = whole && c ? Math.exp(c.tok.lp1) : NaN;
  // A total is given only when every push is a number. Otherwise the readout says the measurement is incomplete.
  const total = running && complete ? signed(running[running.length - 1]) : "";
  const partial = running && !complete ? " Some direct pushes are unavailable for this token, so no total is given." : "";
  let activityText = "";
  if (activity && !whole && beat.kind !== "output") {
    const readings = c?.tok.activity;
    if (beat.kind === "attention") {
      const at = pushIndex(model, { kind: "head", floor: beat.floor, head: 0 });
      const sizes = readings?.subarray(at, at + model.heads).filter((v) => Number.isFinite(v) && v >= 0);
      activityText = ` Largest measured head output · ${sizes?.length ? rmsLabel(Math.max(...sizes)) : "Unavailable"}.`;
    } else {
      const size = readings?.[pushIndex(model, beat)];
      activityText = ` ${beat.kind === "mlp" ? "MLP output" : "Embedding size"} · ${rmsLabel(size)}.`;
    }
  }
  // The last projection reads the same final state as Words out. Show it only at the output step.
  const guess = beat.kind === "mlp" && beat.floor < model.floors - 1 ? c?.tok.guesses?.[beat.floor]?.[0] : undefined;
  const where = `Token ${rp.token + 1} of ${rp.tokens}, step ${rp.step} of ${rp.beats}`;
  const spoken = rp.playing ? `Replay playing: ${rp.scope === "answer" ? "the whole answer" : "this token"}.`
    : rp.ended ? `Replay finished at token ${rp.token + 1} of ${rp.tokens}.` : `Replay paused. ${where}, ${whole ? "token complete" : beatLabel(beat)}.`;
  const label = rp.playing ? "Pause" : rp.ended ? "Replay again" : rp.picked ? (rp.scope === "answer" ? "Play from this token" : "Play this token") : "Resume";
  const started = rp.token > 0 || rp.step > 1;
  const state = rp.playing ? "playing" : rp.ended ? "ended" : "paused";
  // Progress matches the scope: one token from its first step to its last, or the whole answer.
  const whollyAnswer = rp.scope === "answer";
  const span = (whollyAnswer ? rp.tokens * rp.beats : rp.beats) - 1, done = (whollyAnswer ? rp.token * rp.beats : 0) + rp.step - 1;

  const options = <div className="replay-options">
      <div className="replay-option"><span id={`${id}-scope`}>Play</span>
        <div className="seg" role="group" aria-labelledby={`${id}-scope`}>
          <button type="button" aria-pressed={rp.scope === "answer"} title="Play every token of the answer, one after another" onClick={() => session.setScope("answer")}>Whole answer</button>
          <button type="button" aria-pressed={rp.scope === "token"} title="Play this token and stop" onClick={() => session.setScope("token")}>This token</button>
        </div></div>
      <div className="replay-option"><span id={`${id}-speed`}>Speed</span>
        <div className="seg" role="group" aria-labelledby={`${id}-speed`}>
          {SPEEDS.map((v) => <button key={v.id} type="button" aria-pressed={rp.speed === v.id} onClick={() => session.setSpeed(v.id)}>{v.label}</button>)}
        </div></div>
      {!rp.ended && started && <button type="button" className="linkish replay-restart" onClick={() => session.restart()}>{rp.scope === "answer" ? "Start over" : "Start this token over"}</button>}
    </div>;

  return <section className="replay-bar replaying" aria-label="Replay of this answer">
    <p className="sr-only" aria-live="polite">{`${spoken} ${activeRun} run.`}</p>
    <div className="replay-run">
      <div className="replay-run-sample">
        <span id={`${id}-run`}>Replay run</span>
        {c && <span className="replay-sample-number" title={c.turn.user}>{model.id === "tiny" ? "Text" : `Sample ${c.ref.turn + 1}`}</span>}
      </div>
      {paired ? <div className="seg" role="group" aria-labelledby={`${id}-run`}>
        {(["normal", "changed"] as const).map((side) => <button key={side} type="button" aria-pressed={c?.ref.side === side}
          title={`Show the ${runName(side).toLowerCase()} reply at this token position and pause`}
          onClick={() => switchReplayRun(side)}>{runName(side)}</button>)}
      </div> : <strong>{activeRun}</strong>}
      {editDescription && <span className="replay-run-edits" title={edits.map(e => e.label).join(", ")}>{editDescription}</span>}
    </div>
    <div className="replay-head">
      <span className={`replay-mode on ${state}`}>{rp.playing ? "Replaying" : rp.ended ? (compact ? "Finished" : "Replay finished") : (compact ? "Paused" : "Replay paused")}</span>
      {token}
      <button type="button" className="btn replay-exit" title="End the replay and show the newest output again" onClick={back}>Back to live</button>
    </div>
    <progress className={`replay-progress ${state}`} max={Math.max(1, span)} value={Math.min(done, Math.max(1, span))}
      aria-label={whollyAnswer ? `Replay progress through the whole answer: ${where}` : `Replay progress through this token: step ${rp.step} of ${rp.beats}`} />
    <div className="replay-transport" role="group" aria-label="Replay controls">
      <button ref={main} type="button" className="btn primary replay-main" onClick={() => (rp.playing ? session.pause() : session.play())}>
        <Icon name={rp.playing ? "pause" : rp.ended ? "again" : "play"} /><span className="replay-word">{label}</span></button>
      <div className="replay-steps" role="group" aria-label="Step through the model">
        <button type="button" className="btn replay-step" title="Back one step through the model. Pauses the replay."
          disabled={rp.step <= 1 && (rp.scope !== "answer" || rp.token <= 0)} onClick={() => session.stepBy(-1)}><Icon name="back" /><span className="replay-word">Back a step</span></button>
        <button type="button" className="btn replay-step" title="Forward one step through the model. Pauses the replay."
          disabled={whole && (rp.scope !== "answer" || rp.token >= rp.tokens - 1)} onClick={() => session.stepBy(1)}><span className="replay-word">Next step</span><Icon name="forward" /></button>
      </div>
      <label className="replay-scrub" htmlFor={`${id}-steps`}>
        <span className="replay-scrub-name">Steps for this token</span>
        <input id={`${id}-steps`} type="range" min={1} max={rp.beats} step={1} value={rp.step}
          aria-valuetext={`Step ${rp.step} of ${rp.beats}: ${whole ? "token complete" : beatLabel(beat)}`} onChange={(e) => session.seek(Number(e.target.value))} />
        <span className="num replay-count">Step {rp.step} of {rp.beats}</span>
      </label>
    </div>
    <p className="replay-readout">
      {!c ? "" : whole ? <><strong>“{wq}”</strong>{Number.isFinite(probability) ? <> · <strong className="num">{modelPct(Math.min(1, probability))}</strong> model probability.</> : " · Probability unavailable."}{!activity && (total ? ` Direct push total ${total}.` : partial)}</>
        : <><strong>{beatLabel(beat)}.</strong>{activity ? activityText : total ? ` Direct pushes so far: ${signed(pushSoFar(running!, rp.step))} of ${total}.` : partial}
          {guess ? ` Top candidate at this layer “${text(guess.id)}” (${pct(guess.p)}).` : ""}</>}
    </p>
    {compact ? <details className="replay-settings" onKeyDown={(event) => {
      if (event.key !== "Escape" || !event.currentTarget.open) return;
      event.preventDefault();
      event.currentTarget.open = false;
      event.currentTarget.querySelector("summary")?.focus();
    }}>
      <summary aria-label="Replay options">Options</summary>
      {options}
    </details> : options}
  </section>;
}
