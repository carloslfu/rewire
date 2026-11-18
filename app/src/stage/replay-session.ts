// The one visual replay of the page, bound to the store. It watches every state change itself, so a
// replay can never run on into output that was removed, rewritten or measured under other settings.
import { useSyncExternalStore } from "react";
import type { Reply, Side, WordRef } from "../model/types.ts";
import { setFollowing } from "../state/actions.ts";
import { type State, store } from "../state/store.ts";
import { chosen, replyMark, visibleTokens } from "../ui/word.ts";
import { beatCount } from "./playback.ts";
import { fadeMs, ReplayController, type Scope, type Snapshot, type Subject } from "./replay.ts";
import type { Stage } from "./scene/stage.ts";

type Live = Pick<State, "model" | "version" | "turns" | "word" | "fork" | "busy" | "replay" | "stage3d">;
type Selection = Pick<Live, "turns" | "word">;
type ReadingState = Pick<State, "model" | "version" | "turns" | "word" | "fork" | "view">;
type Run = { sample: number; side: Side };
export const runName = (side: Side) => side === "changed" ? "Changed" : "Original";

const replayableTokens = (reply: Reply | undefined) => reply?.done ? visibleTokens(reply) : [];

/** Move by visible token position. The two runs can generate different words and lengths. */
export function replayWord(s: Selection, side?: Side): WordRef | null {
  if (!s.word) return null;
  const { turn, index, side: current } = s.word, sample = s.turns[turn];
  if (!sample) return null;
  const changed = replayableTokens(sample.changed);
  side ??= changed.length ? "changed" : "normal";
  const tokens = side === "changed" ? changed : replayableTokens(sample.normal);
  if (!tokens.length) return null;
  const from = visibleTokens(current === "changed" ? sample.changed : sample.normal).indexOf(index);
  if (from < 0) return null;
  if (side === current) return s.word;
  return { turn, side, index: tokens[Math.min(from, tokens.length - 1)] };
}

/** The selected reply as the replay sees it. Null when no token of a reply is selected. */
export function replaySubject(s: Live): Subject | null {
  const c = chosen(s);
  if (!c) return null;
  const visible = visibleTokens(c.reply), at = visible.indexOf(c.ref.index);
  if (at < 0) return null;
  return {
    epoch: `${s.model.id}.${s.version}`,
    reply: `${c.turn.id}.${c.ref.side}.${replyMark(c.reply)}.${c.reply.toks.map((t) => t.id).join(",")}`,
    tokens: visible.length, at,
    // `busy` covers writing and comparing; `replay` is the store's name for an update of the samples after a model change.
    ready: s.stage3d && !s.busy && !s.replay && c.reply.done && !c.reply.stale,
  };
}

/**
 * Which token's result belongs on the output: the model and its changes, the sample, the reply and
 * the token in it. The same index in the other reply or in another sample is another token.
 */
export function outputIdentity(s: Pick<State, "model" | "version" | "turns" | "word" | "fork">): string {
  const c = chosen(s);
  return c ? `${s.model.id}.${s.version}.${c.turn.id}.${c.ref.side}.${c.ref.index}.${c.tok.id}.${replyMark(c.reply)}` : "";
}

/** In replay the chassis uses recorded edits. In live one token can also show a difference reading. */
export const readingIdentity = (s: ReadingState, replaying: boolean) => `${outputIdentity(s)}.${s.view}.${replaying}`;

/** Why Replay answer is not available yet, in the visitor's words. Empty when it is. */
export function replayWait(s: Live): string {
  // A replay is drawn on the 3D model. Without the drawing there is nothing to walk a reply through.
  if (!s.stage3d) return "Replay needs the 3D drawing, which could not start here. Try again on the model.";
  if (!s.turns.length) return s.busy ? "Replay is ready when this reply is finished." : "Ask a question first. Once the reply is finished you can replay it here.";
  if (s.replay) return s.replay.status === "running" ? "Replay is ready when the sample update is finished." : "Retry the sample update or restore the originals, then replay.";
  if (s.busy) return "Replay is ready when this reply is finished.";
  const c = chosen(s);
  if (!c) return "Select a token in a reply to replay it.";
  if (c.reply.stale) return "This reply used earlier settings. Select a token in a current reply.";
  if (!c.reply.done) return "Replay is ready when this reply is finished.";
  return replayWord(s) ? "" : "Select a token in a reply to replay it.";
}

/** The visitor's own pauses counted when the replay began. */
let pausesAtStart = 0;

export const session = new ReplayController({
  beats: () => beatCount(store.get().model),
  subject: () => replaySubject(store.get()),
  select: (token) => {
    const s = store.get(), c = chosen(s), index = c ? visibleTokens(c.reply)[token] : undefined;
    if (!c || index === undefined) return;
    const word = { ...c.ref, index };
    store.set({ word, view: "push" });
  },
  left: (reason, follow) => {
    // A token chosen or a candidate picked during the replay is the visitor's own pause, as it is in
    // live output. It outlasts a replay that ends by itself. Back to live always follows.
    const chose = store.get().pauseRevision !== pausesAtStart;
    if (follow && (reason === "live" || !chose) && !store.get().follow) setFollowing(true);
  },
});
// The inspector measures the selected token as soon as it opens, so a replay never plays under it.
store.subscribe(() => { if (session.sync() && store.get().sheet) session.pause(); });

/**
 * Start a replay of the selected reply, or of one named by its sample and side. Nothing changes
 * unless that reply can be replayed now. The selection is held by the replay, so following pauses
 * for as long as it lasts and comes back as it was when it ends.
 */
export function startReplay(scope: Scope, of?: Run): boolean {
  const s = store.get();
  if (!s.stage3d || (!of && replayWait(s))) return false;
  let word = replayWord(s);
  if (of) {
    const turn = s.turns.findIndex((t) => t.id === of.sample), t = s.turns[turn];
    const index = replayableTokens(of.side === "normal" ? t?.normal : t?.changed)[0];
    if (index === undefined) return false;
    word = { turn, side: of.side, index };
  }
  if (!word || !replaySubject({ ...s, word })?.ready) return false;
  const following = s.follow;
  if (session.get().mode === "live") pausesAtStart = s.pauseRevision;
  store.set({ word, view: "push", follow: false });
  if (session.enter(scope, following)) return true;
  if (following) setFollowing(true);
  return false;
}

/** Switch runs for this sample, pausing at the same step and visible token position. */
export function switchReplayRun(side: Side) {
  const s = store.get(), r = session.get();
  if (r.mode !== "replay" || side === s.word?.side) return;
  const word = replayWord(s, side);
  if (!word || !replaySubject({ ...s, word })?.ready) return;
  store.set({ word, view: "push" });
  if (r.step < r.beats) session.seek(r.step);
}

export function useReplay<T>(select: (s: Snapshot) => T): T {
  const read = () => select(session.get());
  return useSyncExternalStore(session.subscribe, read, read);
}

type Linked = Pick<Stage, "setDriver" | "setPlayhead" | "holdReadings" | "setCandidates" | "setValues" | "setPoses">;
type Readings = {
  values: Parameters<Stage["setValues"]>;
  poses: Parameters<Stage["setPoses"]>[0];
  candidates: Parameters<Stage["setCandidates"]>[0];
};

/** The frame driver can reach a new token before React commits its data. Hold its readings until
 * the matching values, run settings and output have all arrived. */
export function linkStage(stage: Linked) {
  let delivered = "", last: Readings | undefined;
  const hold = () => stage.holdReadings(session.get().mode === "replay" && readingIdentity(store.get(), true) !== delivered);
  const show = () => {
    const r = session.get();
    stage.setPlayhead(r.mode === "replay" ? r.step : null, r.playing && r.step < r.beats ? fadeMs(r.speed) : 0);
    hold();
  };
  stage.setDriver(session);
  show();
  const off = session.subscribe(show);
  return {
    deliver(readings: Readings, identity: string) {
      if (identity !== readingIdentity(store.get(), session.get().mode === "replay")) return;
      if (last?.poses !== readings.poses) stage.setPoses(readings.poses);
      if (last?.values[0] !== readings.values[0] || last?.values[1] !== readings.values[1]) stage.setValues(...readings.values);
      if (last?.candidates !== readings.candidates) stage.setCandidates(readings.candidates);
      last = readings;
      delivered = identity;
      hold();
    },
    close() { off(); stage.setDriver(null); session.pause(); },
  };
}
