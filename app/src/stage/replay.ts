// The visual replay: a walk back through output the model has already written. It reads cached
// values only, moves in whole steps, and never asks the model for anything. This file is the state
// machine alone, with no page, store or drawing in it; replay-session.ts binds it to the page.

/** Whole answer: every token in turn. This token: the selected token only. */
export type Scope = "answer" | "token";
export type SpeedId = "slow" | "steady" | "fast";

/** How long one step stays on screen before the next. Readable choices, not multiples of real time. */
export const SPEEDS: readonly { id: SpeedId; label: string; stepMs: number }[] = [
  { id: "slow", label: "Slow", stepMs: 400 },
  { id: "steady", label: "Steady", stepMs: 110 },
  { id: "fast", label: "Fast", stepMs: 50 },
];
export const DEFAULT_SPEED: SpeedId = "steady";
export const stepMs = (speed: SpeedId) => SPEEDS.find((s) => s.id === speed)?.stepMs ?? 110;
/** A finished token stays whole on screen this long before the next one starts. */
export const dwellMs = (speed: SpeedId) => Math.max(600, 4 * stepMs(speed));
/** How long a step takes to light up. The rest of the step nothing moves, so the frame is free for the camera. */
export const fadeMs = (speed: SpeedId) => Math.min(140, stepMs(speed) / 2);
/** A frame longer than this counts as this long: a stall or a hidden tab never turns into a jump. */
const LONGEST_FRAME = 100;

/** What is selected on the page right now, as the replay needs it. */
export interface Subject {
  /** The model and its changes. When this differs, cached values may no longer describe what is on screen. */
  epoch: string;
  /** The reply and its exact tokens. */
  reply: string;
  /** How many tokens of the reply can be selected. */
  tokens: number;
  /** Position of the selected token among them. */
  at: number;
  /** The reply is finished and current, and the model is not writing, updating or comparing. */
  ready: boolean;
}

/** Why a replay ended: the visitor went back to live, the output or model changed, or the 3D view closed. */
export type ExitReason = "live" | "changed" | "closed";

export interface ReplayHost {
  /** Steps in one token for the model on screen. */
  beats(): number;
  /** Read from live state every time. Null when nothing can be replayed. */
  subject(): Subject | null;
  /** Select a token of the reply being replayed, by its position among the selectable ones. */
  select(token: number): void;
  /** The replay ended. `follow` says whether Follow output should be on again. */
  left?(reason: ExitReason, follow: boolean): void;
}

export interface Snapshot {
  mode: "live" | "replay";
  scope: Scope;
  speed: SpeedId;
  playing: boolean;
  /** The replay reached the end of its scope and stopped there. */
  ended: boolean;
  /** A token chosen by hand, shown whole. Playing starts its walk from the first step. */
  picked: boolean;
  /** Position among the reply's selectable tokens, and how many there are. */
  token: number;
  tokens: number;
  /** Steps of the current token that are lit, from 1 to `beats`. */
  step: number;
  beats: number;
}

export class ReplayController {
  private s: Snapshot;
  private readonly listeners = new Set<() => void>();
  private epoch = "";
  private reply = "";
  /** Time gathered toward the next step, in milliseconds. */
  private waited = 0;
  /** Follow output as it was set when the replay began. */
  private following = false;
  /** True while the controller itself is moving the selection. */
  private selecting = false;

  constructor(private readonly host: ReplayHost) {
    this.s = { mode: "live", scope: "answer", speed: DEFAULT_SPEED, playing: false, ended: false, picked: false, token: 0, tokens: 0, step: 0, beats: 0 };
  }

  get = () => this.s;
  subscribe = (f: () => void) => { this.listeners.add(f); return () => { this.listeners.delete(f); }; };
  get playing() { return this.s.mode === "replay" && this.s.playing; }

  private set(patch: Partial<Snapshot>) {
    this.s = { ...this.s, ...patch };
    for (const f of [...this.listeners]) f();
  }

  /** Select a token and report whether the page now has exactly that token of the same reply selected. */
  private choose(token: number): Subject | null {
    this.selecting = true;
    try { this.host.select(token); } finally { this.selecting = false; }
    const now = this.host.subject();
    return now && now.ready && now.at === token ? now : null;
  }

  /**
   * Start replaying the selected reply: the whole answer from its first token, or the selected token
   * alone. Refused, with nothing changed, unless the reply is finished and the model is idle.
   */
  enter(scope: Scope, following = false): boolean {
    const before = this.host.subject();
    if (!before || !before.ready) return false;
    const token = scope === "answer" ? 0 : before.at;
    const now = token === before.at ? before : this.choose(token);
    if (!now) return false;
    if (this.s.mode === "live") this.following = following;
    this.epoch = now.epoch; this.reply = now.reply; this.waited = 0;
    this.set({ mode: "replay", scope, playing: true, ended: false, picked: false, token, tokens: now.tokens, step: 1, beats: this.host.beats() });
    return true;
  }

  /** End the replay. Back to live always follows; any other ending returns Follow output to how it was. */
  exit(reason: ExitReason) {
    if (this.s.mode === "live") return;
    this.waited = 0;
    this.set({ mode: "live", playing: false, ended: false, picked: false });
    this.host.left?.(reason, reason === "live" || this.following);
  }

  /**
   * Compare the replay with what is on the page now. Changed output or a changed model ends it. A
   * token or reply the visitor selected themselves is adopted, paused and shown whole.
   */
  sync(): boolean {
    if (this.s.mode !== "replay") return false;
    if (this.selecting) return true;
    const now = this.host.subject();
    if (!now || !now.ready || now.epoch !== this.epoch) { this.exit("changed"); return false; }
    if (now.reply !== this.reply || now.at !== this.s.token) {
      this.reply = now.reply; this.waited = 0;
      this.set({ token: now.at, tokens: now.tokens, step: this.s.beats, playing: false, ended: false, picked: true });
    }
    return true;
  }

  /** Resume. After the end this starts over, and after choosing a token it walks that token from its first step. */
  play() {
    if (!this.sync() || this.s.playing) return;
    if (this.s.ended) { this.restart(); return; }
    this.waited = 0;
    this.set({ playing: true, picked: false, step: this.s.picked ? 1 : this.s.step });
  }

  pause() {
    if (this.playing) this.set({ playing: false });
  }

  /** Start over and play: from the first token of the answer, or from the first step of this token. */
  restart() {
    if (!this.sync()) return;
    const token = this.s.scope === "answer" ? 0 : this.s.token;
    if (token !== this.s.token && !this.choose(token)) { this.sync(); return; }
    this.waited = 0;
    this.set({ token, step: 1, playing: true, ended: false, picked: false });
  }

  /** One step forward or back, paused. In a whole-answer replay the steps run on into the neighboring token. */
  stepBy(direction: 1 | -1) {
    if (!this.sync()) return;
    const { step, beats, token, tokens, scope } = this.s;
    this.waited = 0;
    if (direction > 0 ? step < beats : step > 1) { this.set({ step: step + direction, playing: false, ended: false, picked: false }); return; }
    const next = token + direction;
    if (scope !== "answer" || next < 0 || next >= tokens) { this.set({ playing: false }); return; }
    if (!this.choose(next)) { this.sync(); return; }
    this.set({ token: next, step: direction > 0 ? 1 : beats, playing: false, ended: false, picked: false });
  }

  /** Scrub within the current token, paused. */
  seek(step: number) {
    if (!this.sync()) return;
    const to = Number.isFinite(step) ? Math.max(1, Math.min(this.s.beats, Math.round(step))) : 1;
    this.waited = 0;
    this.set({ step: to, playing: false, ended: false, picked: false });
  }

  /** Choose another token of the reply, paused and shown whole. */
  toToken(token: number) {
    if (!this.sync() || token < 0 || token >= this.s.tokens || token === this.s.token) return;
    if (!this.choose(token)) { this.sync(); return; }
    this.waited = 0;
    this.set({ token, step: this.s.beats, playing: false, ended: false, picked: true });
  }

  /** What Play covers. Kept between replays. Widening to the whole answer lets a finished token run on. */
  setScope(scope: Scope) {
    if (scope === this.s.scope) return;
    const more = this.s.mode === "replay" && scope === "answer" && this.s.token < this.s.tokens - 1;
    this.set({ scope, ended: this.s.ended && !more });
  }

  /** Kept between replays. */
  setSpeed(speed: SpeedId) {
    if (speed !== this.s.speed && SPEEDS.some((s) => s.id === speed)) this.set({ speed });
  }

  /**
   * One drawn frame has passed. Moves at most one step, whatever the frame took, and only once the
   * step's time is up. A finished token is held whole before the next one begins, and the last one
   * ends the replay instead of looping.
   */
  frame(dtMs: number) {
    if (!this.playing || !this.sync() || !this.s.playing) return;
    const { step, beats, token, tokens, scope, speed } = this.s;
    this.waited += Number.isFinite(dtMs) ? Math.max(0, Math.min(LONGEST_FRAME, dtMs)) : 0;
    if (step < beats) {
      const each = stepMs(speed);
      if (this.waited < each) return;
      // Time left over is kept, but never enough to make the next step arrive early by more than half.
      this.waited = step + 1 === beats ? 0 : Math.min(this.waited - each, each / 2);
      this.set({ step: step + 1 });
      return;
    }
    if (this.waited < dwellMs(speed)) return;
    this.waited = 0;
    if (scope === "answer" && token < tokens - 1) {
      if (this.choose(token + 1)) this.set({ token: token + 1, step: 1 });
      else this.sync();
    } else this.set({ playing: false, ended: true });
  }
}
