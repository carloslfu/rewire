// The replay state machine on its own: a finished reply of a few tokens, frames fed in by hand.
import { expect, it } from "vitest";
import { DEFAULT_SPEED, dwellMs, fadeMs, ReplayController, SPEEDS, stepMs, type Subject } from "../src/stage/replay.ts";

const BEATS = 10;

/** A page with one finished reply selected at its last token, as after a question was answered. */
function page(tokens = 3) {
  const p = {
    subject: { epoch: "qwen.4", reply: "7.normal.100,101,102", tokens, at: tokens - 1, ready: true } as Subject | null,
    selected: [] as number[], left: [] as [string, boolean][], changes: 0,
  };
  const replay = new ReplayController({
    beats: () => BEATS,
    subject: () => (p.subject ? { ...p.subject } : null),
    select: (i) => { p.selected.push(i); if (p.subject) p.subject.at = i; },
    left: (reason, follow) => { p.left.push([reason, follow]); },
  });
  replay.subscribe(() => { p.changes++; });
  /** Feed frames for a stretch of time. Returns how many frames it took. */
  const run = (ms: number, each = 16) => { let n = 0; for (let t = 0; t < ms; t += each, n++) replay.frame(each); return n; };
  /** Frames until `done`, with the largest move any single frame made. */
  const until = (done: () => boolean, each = 16) => {
    let frames = 0, most = 0;
    while (!done() && frames < 100_000) {
      const a = replay.get();
      replay.frame(each);
      const b = replay.get();
      most = Math.max(most, b.token === a.token ? b.step - a.step : 1);
      frames++;
    }
    return { frames, most };
  };
  return { p, replay, run, until };
}

it("starts live and refuses to replay output that is missing, unfinished or being updated", () => {
  const { p, replay } = page();
  expect(replay.get()).toMatchObject({ mode: "live", playing: false, scope: "answer", speed: DEFAULT_SPEED });
  expect(replay.playing).toBe(false);
  for (const subject of [null, { ...p.subject!, ready: false }]) {
    p.subject = subject;
    expect(replay.enter("answer", true)).toBe(false);
    expect(replay.enter("token", true)).toBe(false);
  }
  expect(replay.get().mode).toBe("live");
  expect(p.selected).toEqual([]);
  expect(p.left).toEqual([]);
  expect(p.changes).toBe(0);
  // Nothing on the transport does anything while live, and frames move nothing.
  replay.play(); replay.pause(); replay.restart(); replay.stepBy(1); replay.seek(4); replay.toToken(0); replay.frame(5000);
  expect(p.changes).toBe(0);
});

it("replays the whole answer from its first token, every step of every token, holds each finished token, and ends once", () => {
  const { p, replay, until } = page(3);
  expect(replay.enter("answer")).toBe(true);
  // The first visible token, its first step, already playing.
  expect(p.selected).toEqual([0]);
  expect(replay.get()).toMatchObject({ mode: "replay", scope: "answer", playing: true, ended: false, token: 0, tokens: 3, step: 1, beats: BEATS });
  const visited: string[] = [];
  replay.subscribe(() => { const s = replay.get(); visited.push(`${s.token}:${s.step}`); });
  const { frames, most } = until(() => replay.get().ended);
  // Every step of every token, in order, exactly once.
  const expected = [0, 1, 2].flatMap((t) => Array.from({ length: BEATS }, (_, i) => `${t}:${i + 1}`)).slice(1);
  expect(visited.slice(0, -1)).toEqual(expected);
  expect(visited.at(-1)).toBe(`2:${BEATS}`);
  expect(most).toBe(1);
  expect(p.selected).toEqual([0, 1, 2]);
  expect(replay.get()).toMatchObject({ mode: "replay", playing: false, ended: true, token: 2, step: BEATS });
  // The time it took is the steps plus one hold per token, give or take a frame per step.
  const ms = frames * 16, ideal = 3 * (BEATS - 1) * stepMs(DEFAULT_SPEED) + 3 * dwellMs(DEFAULT_SPEED);
  expect(ms).toBeGreaterThanOrEqual(ideal);
  expect(ms).toBeLessThan(ideal + 3 * BEATS * 16 + 64);
  // No loop: it stays ended however long frames keep coming.
  const settled = p.changes;
  for (let i = 0; i < 500; i++) replay.frame(16);
  expect(p.changes).toBe(settled);
  expect(replay.playing).toBe(false);
});

it("moves one step at a time at a readable pace, with no catching up after a stall", () => {
  const { replay, run } = page(2);
  replay.enter("answer");
  // Not before its time, then exactly one step.
  run(stepMs("steady") - 16);
  expect(replay.get().step).toBe(1);
  run(32);
  expect(replay.get().step).toBe(2);
  // A frame that took a minute (a hidden tab, a stall) is one frame: at most one step.
  replay.frame(60_000);
  expect(replay.get().step).toBeLessThanOrEqual(3);
  const at = replay.get().step;
  replay.frame(60_000);
  replay.frame(60_000);
  expect(replay.get().step).toBeLessThanOrEqual(at + 2);
  // Nonsense frame times move nothing.
  const before = replay.get().step;
  replay.frame(Number.NaN); replay.frame(-500); replay.frame(0);
  expect(replay.get().step).toBe(before);
  // The speeds are few, named and ordered, and each leaves time between its steps for the step to finish lighting.
  expect(SPEEDS.map((s) => s.id)).toEqual(["slow", "steady", "fast"]);
  expect(SPEEDS.map((s) => s.stepMs)).toEqual([...SPEEDS.map((s) => s.stepMs)].sort((a, b) => b - a));
  for (const s of SPEEDS) {
    // Never faster than three frames a step on an ordinary display.
    expect(s.stepMs).toBeGreaterThanOrEqual(48);
    expect(fadeMs(s.id)).toBeLessThanOrEqual(s.stepMs / 2);
    expect(dwellMs(s.id)).toBeGreaterThanOrEqual(600);
  }
  // Changing speed keeps the place and takes effect on the next step.
  replay.seek(2); replay.play();
  replay.setSpeed("slow");
  expect(replay.get()).toMatchObject({ step: 2, playing: true, speed: "slow" });
  run(stepMs("steady") + 32);
  expect(replay.get().step).toBe(2);
  run(stepMs("slow"));
  expect(replay.get().step).toBe(3);
  replay.setSpeed("warp" as never);
  expect(replay.get().speed).toBe("slow");
});

it("shows a finished token whole for a while before the next one, even on very slow frames", () => {
  const { p, replay } = page(2);
  replay.setSpeed("fast");
  replay.enter("answer");
  replay.seek(BEATS - 1); replay.play();
  // Frames of 100 ms: slower than the fast pace. The last step arrives, then the hold, then the next token.
  replay.frame(100);
  expect(replay.get()).toMatchObject({ token: 0, step: BEATS });
  let held = 0;
  while (replay.get().token === 0 && held < 100) { replay.frame(100); held++; }
  expect(held * 100).toBeGreaterThanOrEqual(dwellMs("fast"));
  expect(replay.get()).toMatchObject({ token: 1, step: 1, playing: true });
  expect(p.selected).toEqual([0, 1]);
});

it("replays this token alone when asked, and can widen to the rest of the answer", () => {
  const { p, replay, until } = page(4);
  p.subject!.at = 1;
  expect(replay.enter("token")).toBe(true);
  // The selected token, not the first one, and nothing is selected for it.
  expect(p.selected).toEqual([]);
  expect(replay.get()).toMatchObject({ scope: "token", token: 1, step: 1, playing: true });
  until(() => replay.get().ended);
  expect(replay.get()).toMatchObject({ token: 1, step: BEATS, ended: true, playing: false });
  expect(p.selected).toEqual([]);
  // Replay again plays the same token again.
  replay.play();
  expect(replay.get()).toMatchObject({ token: 1, step: 1, ended: false, playing: true });
  until(() => replay.get().ended);
  // Widening the scope: there is more to play, so it is no longer at an end, and Play goes on from here.
  replay.setScope("answer");
  expect(replay.get()).toMatchObject({ scope: "answer", ended: false, playing: false, token: 1 });
  replay.play();
  until(() => replay.get().ended);
  expect(replay.get()).toMatchObject({ token: 3, step: BEATS, ended: true });
  expect(p.selected).toEqual([2, 3]);
  // At the last token there is nothing more either way.
  replay.setScope("token");
  expect(replay.get().ended).toBe(true);
  replay.setScope("answer");
  expect(replay.get().ended).toBe(true);
  // Replay again in the whole-answer scope goes back to the first token.
  replay.play();
  expect(replay.get()).toMatchObject({ token: 0, step: 1, playing: true, ended: false });
  // The scope chosen is kept for the next replay.
  replay.exit("live");
  expect(replay.get()).toMatchObject({ mode: "live", scope: "answer" });
});

it("pauses for every manual move, steps across tokens only in a whole-answer replay, and resumes from where it was put", () => {
  const { p, replay, run } = page(3);
  replay.enter("answer");
  run(stepMs("steady") * 2 + 32);
  expect(replay.get().step).toBe(3);
  replay.pause();
  expect(replay.get()).toMatchObject({ playing: false, step: 3 });
  run(5000);
  expect(replay.get().step).toBe(3);
  replay.play();
  expect(replay.get()).toMatchObject({ playing: true, step: 3 });
  // Step and scrub pause where they land.
  replay.stepBy(1);
  expect(replay.get()).toMatchObject({ playing: false, step: 4, token: 0 });
  replay.stepBy(-1); replay.stepBy(-1); replay.stepBy(-1);
  expect(replay.get()).toMatchObject({ step: 1, token: 0 });
  replay.stepBy(-1);
  expect(replay.get()).toMatchObject({ step: 1, token: 0 });
  replay.play();
  replay.seek(BEATS + 50);
  expect(replay.get()).toMatchObject({ playing: false, step: BEATS });
  replay.seek(-3);
  expect(replay.get().step).toBe(1);
  replay.seek(Number.NaN);
  expect(replay.get().step).toBe(1);
  replay.seek(4.6);
  expect(replay.get().step).toBe(5);
  // Past the last step of a token, a step goes on into the next token; before the first, back into the previous one.
  replay.seek(BEATS);
  replay.stepBy(1);
  expect(replay.get()).toMatchObject({ token: 1, step: 1, playing: false });
  replay.stepBy(-1);
  expect(replay.get()).toMatchObject({ token: 0, step: BEATS });
  expect(p.selected).toEqual([0, 1, 0]);
  // In this-token scope the steps stay inside the token.
  replay.setScope("token");
  replay.stepBy(1);
  expect(replay.get()).toMatchObject({ token: 0, step: BEATS });
  replay.setScope("answer");
  // Choosing a token by hand: paused, shown whole, and Play then walks that token from its first step to the end of the answer.
  replay.play();
  replay.toToken(2);
  expect(replay.get()).toMatchObject({ token: 2, step: BEATS, playing: false, picked: true, ended: false });
  replay.toToken(7); replay.toToken(-1);
  expect(replay.get().token).toBe(2);
  replay.play();
  expect(replay.get()).toMatchObject({ token: 2, step: 1, playing: true, picked: false });
  // Start over goes back to the first token and plays.
  replay.pause();
  replay.restart();
  expect(replay.get()).toMatchObject({ token: 0, step: 1, playing: true, ended: false });
  expect(p.selected.at(-1)).toBe(0);
});

it("adopts a token or reply the visitor selects, paused, and never moves the selection back", () => {
  const { p, replay, run } = page(4);
  replay.enter("answer");
  run(stepMs("steady") + 32);
  // The visitor clicks another token of the same reply.
  p.subject!.at = 2;
  replay.sync();
  expect(replay.get()).toMatchObject({ mode: "replay", playing: false, token: 2, step: BEATS, picked: true });
  expect(p.selected).toEqual([0]);
  // Noticed by the next frame too, before it moves anything.
  replay.play();
  p.subject!.at = 3;
  replay.frame(5000);
  expect(replay.get()).toMatchObject({ playing: false, token: 3, step: BEATS, picked: true });
  expect(p.selected).toEqual([0]);
  // Another reply (the changed one, or another sample): the replay is now of that reply, still paused.
  p.subject = { ...p.subject!, reply: "7.changed.200,201", tokens: 2, at: 1 };
  replay.sync();
  expect(replay.get()).toMatchObject({ mode: "replay", playing: false, token: 1, tokens: 2, picked: true, ended: false });
  // Resume follows the chosen scope from the chosen token.
  replay.play();
  expect(replay.get()).toMatchObject({ token: 1, step: 1, playing: true });
  expect(p.left).toEqual([]);
});

it("ends at once when the output or the model changes, and never advances into what is gone", () => {
  const cases: [string, (s: Subject) => Subject | null][] = [
    ["a new question or Continue is being written", (s) => ({ ...s, ready: false })],
    ["the model was changed, restored or punched", (s) => ({ ...s, epoch: "qwen.5" })],
    ["the other model is on screen", (s) => ({ ...s, epoch: "tiny.6", reply: "9.normal.1,2", tokens: 5, at: 4 })],
    ["the sample was removed or cleared", () => null],
  ];
  for (const [, change] of cases) for (const via of ["frame", "sync", "play", "step", "seek", "token", "restart"] as const) for (const following of [true, false]) {
    const { p, replay, run } = page(3);
    replay.enter("answer", following);
    run(stepMs("steady") + 32);
    if (via !== "frame") replay.pause();
    const selected = [...p.selected];
    p.subject = change(p.subject!);
    if (via === "frame") replay.frame(60_000);
    else if (via === "sync") replay.sync();
    else if (via === "play") replay.play();
    else if (via === "step") replay.stepBy(1);
    else if (via === "seek") replay.seek(5);
    else if (via === "token") replay.toToken(0);
    else replay.restart();
    expect(replay.get()).toMatchObject({ mode: "live", playing: false, ended: false });
    // Follow output returns to how it was before the replay.
    expect(p.left).toEqual([["changed", following]]);
    expect(p.selected).toEqual(selected);
    // And it stays ended: later frames and controls do nothing.
    const settled = p.changes;
    replay.frame(60_000); replay.play(); replay.stepBy(1); replay.sync();
    expect(p.changes).toBe(settled);
    expect(p.selected).toEqual(selected);
  }
});

it("ends on Back to live with following on, and on a closed view with following as it was", () => {
  for (const [reason, was, follow] of [["live", false, true], ["live", true, true], ["closed", false, false], ["closed", true, true]] as const) {
    const { p, replay } = page(3);
    replay.enter("token", was);
    // Entering again while replaying (another scope, another reply) does not forget how following was set.
    replay.enter("answer", !was);
    replay.exit(reason);
    expect(replay.get()).toMatchObject({ mode: "live", playing: false });
    expect(p.left).toEqual([[reason, follow]]);
    replay.exit(reason);
    expect(p.left).toHaveLength(1);
  }
});

it("does not select into a reply that changes under it while it is advancing to the next token", () => {
  const { p, replay } = page(3);
  let fail = false;
  const strict = new ReplayController({
    beats: () => BEATS, subject: () => (p.subject ? { ...p.subject } : null),
    // The selection does not take: the reply was replaced between the check and the move.
    select: (i) => { p.selected.push(i); if (fail) p.subject = { ...p.subject!, epoch: "qwen.9" }; else p.subject!.at = i; },
    left: (reason, follow) => { p.left.push([reason, follow]); },
  });
  void replay;
  strict.enter("answer", true);
  strict.seek(BEATS); strict.play();
  fail = true;
  for (let i = 0; i < 100 && strict.get().mode === "replay"; i++) strict.frame(100);
  expect(strict.get()).toMatchObject({ mode: "live", playing: false });
  expect(p.left).toEqual([["changed", true]]);
  expect(p.selected).toEqual([0, 1]);
});

it("tells its listeners only when something changed, so a frame between steps costs nothing", () => {
  const { p, replay } = page(2);
  replay.enter("answer");
  const before = p.changes;
  for (let i = 0; i < 5; i++) replay.frame(16);
  expect(p.changes).toBe(before);
  replay.setSpeed(replay.get().speed);
  replay.setScope(replay.get().scope);
  replay.sync();
  expect(p.changes).toBe(before);
  const snapshot = replay.get();
  replay.frame(1);
  expect(replay.get()).toBe(snapshot);
});
