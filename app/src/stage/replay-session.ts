// The one visual replay of the page, bound to the store. It watches every state change itself, so a
// replay can never run on into output that was removed, rewritten or measured under other settings.
import { useSyncExternalStore } from "react";
import type { Side } from "../model/types.ts";
import { setFollowing } from "../state/actions.ts";
import { type State, store } from "../state/store.ts";
import { chosen, comparisonTarget, replyMark, visibleTokens } from "../ui/word.ts";
import { beatCount } from "./playback.ts";
import { fadeMs, ReplayController, type Scope, type Snapshot, type Subject } from "./replay.ts";
import type { Stage } from "./scene/stage.ts";

type Live = Pick<State, "model" | "version" | "turns" | "word" | "fork" | "busy" | "replay">;

/** The selected reply as the replay sees it. Null when no token of a reply is selected. */
export function replaySubject(s: Live): Subject | null {
  const c = chosen(s);
  if (!c) return null;
  const visible = visibleTokens(c.reply), at = visible.indexOf(c.ref.index);
  if (at < 0) return null;
  return {
    epoch: `${s.model.id}.${s.version}`,
    reply: `${c.turn.id}.${c.ref.side}.${c.reply.toks.map((t) => t.id).join(",")}`,
    tokens: visible.length, at,
    // `busy` covers writing and comparing; `replay` is the store's name for an update of the samples after a model change.
    ready: !s.busy && !s.replay && c.reply.done && !c.reply.stale,
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

/** Why Replay answer is not available yet, in the visitor's words. Empty when it is. */
export function replayWait(s: Live): string {
  if (!s.turns.length) return s.busy ? "Replay is ready when this reply is finished." : "Ask a question first. Once the reply is finished you can replay it here.";
  if (s.replay) return s.replay.status === "running" ? "Replay is ready when the sample update is finished." : "Retry the sample update or restore the originals, then replay.";
  if (s.busy) return "Replay is ready when this reply is finished.";
  const c = chosen(s);
  if (!c) return "Select a token in a reply to replay it.";
  if (c.reply.stale) return "This reply used earlier settings. Select a token in a current reply.";
  if (!c.reply.done) return "Replay is ready when this reply is finished.";
  return replaySubject(s) ? "" : "Select a token in a reply to replay it.";
}

/** The view a token can be shown in: a comparison only where one was measured. */
const viewFor = (s: State, word: NonNullable<State["word"]>): State["view"] => (word.side === "normal" && comparisonTarget({ ...s, word }) ? s.view : "push");

/** The visitor's own pauses counted when the replay began. */
let pausesAtStart = 0;

export const session = new ReplayController({
  beats: () => beatCount(store.get().model),
  subject: () => replaySubject(store.get()),
  select: (token) => {
    const s = store.get(), c = chosen(s), index = c ? visibleTokens(c.reply)[token] : undefined;
    if (!c || index === undefined) return;
    const word = { ...c.ref, index };
    store.set({ word, view: viewFor(s, word) });
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
export function startReplay(scope: Scope, of?: { sample: number; side: Side }): boolean {
  const s = store.get();
  let word = s.word;
  if (of) {
    const turn = s.turns.findIndex((t) => t.id === of.sample), t = s.turns[turn];
    const index = visibleTokens(of.side === "normal" ? t?.normal : t?.changed)[0];
    if (index === undefined) return false;
    word = { turn, side: of.side, index };
  }
  if (!word || !replaySubject({ ...s, word })?.ready) return false;
  const following = s.follow;
  if (session.get().mode === "live") pausesAtStart = s.pauseRevision;
  store.set({ word, view: viewFor(s, word), follow: false });
  if (session.enter(scope, following)) return true;
  if (following) setFollowing(true);
  return false;
}

export function useReplay<T>(select: (s: Snapshot) => T): T {
  const read = () => select(session.get());
  return useSyncExternalStore(session.subscribe, read, read);
}

type Linked = Pick<Stage, "setDriver" | "setPlayhead" | "holdOutput" | "setCandidates">;

/**
 * Join the replay to a stage: the stage lends its frames and draws the playhead, and the output shows
 * a result only for the token it was handed for. The replay reaches a token (by playing on, by a
 * step, or because the visitor selected one, in this reply, the other reply or another sample) before
 * React hands over that token's candidates with `deliver`. Until then the output is held empty.
 * `deliver` must be called with outputIdentity of the state the candidates were made from.
 */
export function linkStage(stage: Linked) {
  let delivered = "";
  const show = () => {
    const r = session.get();
    stage.setPlayhead(r.mode === "replay" ? r.step : null, fadeMs(r.speed));
    stage.holdOutput(r.mode === "replay" && outputIdentity(store.get()) !== delivered);
  };
  stage.setDriver(session);
  show();
  const off = session.subscribe(show);
  return {
    deliver(list: Parameters<Stage["setCandidates"]>[0], identity: string) {
      delivered = identity;
      stage.setCandidates(list);
      stage.holdOutput(session.get().mode === "replay" && outputIdentity(store.get()) !== delivered);
    },
    close() { off(); stage.setDriver(null); session.pause(); },
  };
}
