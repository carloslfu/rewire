// Dismantle in 3D: the running model as a specimen. Colors are the selected token's measured pushes,
// Replay walks a finished answer's values through the architecture token by token, and Punch writes
// the same change spec as the 2D controls.
import { useEffect, useMemo, useRef, useState } from "react";
import type { FloorDetail, Focus, Reply, Side } from "../model/types.ts";
import { guideTarget } from "../path/steps.ts";
import { applyChips, chipsWith, chooseWord, floorDetail, piece, retryComparison, send, setFocus, setTowerView, stepData, stopReply } from "../state/actions.ts";
import { store, useStore } from "../state/store.ts";
import { S } from "../strings.ts";
import { signed } from "../ui/color.ts";
import { chips as describeChips } from "../ui/describe.ts";
import { LearnedControl, MoreExperiments, PartControls } from "../ui/Lab.tsx";
import { Chips, DeviceBar } from "../ui/Panels.tsx";
import { ReplayStatus } from "../ui/ReplayStatus.tsx";
import { replySegments } from "../ui/reply-text.ts";
import { chosen, comparisonTarget, isStop, replyMark, towerValues } from "../ui/word.ts";
import { ReplayBar } from "./ReplayBar.tsx";
import { linkStage, outputIdentity, replayWait, session, startReplay, useReplay } from "./replay-session.ts";
import { attentionRow, layerPlates, outputBars, pushValues, tray } from "./adapters.ts";
import { buildArch, groupHeads, type Part, partIndex, partName } from "./arch.ts";
import { blocked, focusOf, isTarget, partChanged, partOf, poseOf, punched, restored, restoreLabel, strengthOf } from "./intervene.ts";
import { measurementKey } from "./latest.ts";
import { pushCoverage, runningPush } from "./playback.ts";
import type { BaySpec, Stage, Tool } from "./scene/stage.ts";
import { useMeasured } from "./useMeasured.ts";
import { RealNote, Workbench } from "./Workbench.tsx";

const TRAY = 16;
const text = (id: number) => { const t = piece(id); return t.trim() || JSON.stringify(t); };

export default function DismantleStage() {
  const model = useStore((s) => s.model);
  const chips = useStore((s) => s.chips);
  const turns = useStore((s) => s.turns);
  const word = useStore((s) => s.word);
  const fork = useStore((s) => s.fork);
  const view = useStore((s) => s.view);
  const busy = useStore((s) => s.busy);
  const mode = useStore((s) => s.mode);
  const replay = useStore((s) => s.replay);
  const teachingBusy = useStore((s) => s.teachingBusy);
  const request = useStore((s) => s.replayRequest);
  const focus = useStore((s) => s.focus);
  const version = useStore((s) => s.version);
  const active = useStore((s) => !s.tiny && !s.teach);
  const st = stepData(useStore((s) => s.step));
  const arch = useMemo(() => buildArch(model), [model]);
  const [stage, setStage] = useState<Stage | null>(null);
  const [selected, setSelected] = useState<Part | null>(() => partOf(store.get().focus));
  const replaying = useReplay((r) => r.mode === "replay");
  // While a whole answer plays, the selected layer is not measured again for every token that goes by.
  const passing = useReplay((r) => r.mode === "replay" && r.playing && r.scope === "answer");

  const c = useMemo(() => chosen({ turns, word, fork }), [turns, word, fork]);
  const vals = useMemo(() => towerValues(c, view), [c, view]);
  const values = useMemo(() => pushValues(arch, vals), [arch, vals]);
  const running = useMemo(() => (vals ? runningPush(model, vals) : null), [model, vals]);
  const coverage = useMemo(() => pushCoverage(model, vals), [model, vals]);
  const poses = useMemo(() => arch.parts.map((p) => poseOf(chips, p, model)), [arch, chips, model]);
  const changes = describeChips(chips);
  const reason = blocked({ mode, busy, replay, teachingBusy });
  const wq = c ? text(c.tok.id) : "";
  const target = model.id === "qwen" ? guideTarget(st) : null;
  const marked = target ? partOf(target) : null;

  // The inspector and the guided examples move the focus; the stage follows them.
  useEffect(() => {
    setSelected((now) => {
      const mine = now ? focusOf(now) : ({ kind: "word" } as Focus);
      return JSON.stringify(mine) === JSON.stringify(focus) ? now : partOf(focus);
    });
  }, [focus]);
  const shown = useRef(model.id);
  useEffect(() => { if (shown.current !== model.id) { shown.current = model.id; setSelected(null); } }, [model.id]);

  const select = (part: Part | null) => {
    setSelected(part);
    store.set({ focus: part ? focusOf(part) ?? { kind: "word" } : { kind: "word" } });
    if (part) store.set({ announce: describe(part, "explore").replace(/\n/g, ". ") });
  };

  // ------------------------------------------------------------ the inspection pass, newest request only
  const floor = selected && "floor" in selected ? selected.floor : -1;
  const measurable = !!c && c.reply.done && !c.reply.stale && mode === "live";
  const key = c ? measurementKey({ model: model.id, version, turn: c.ref.turn, side: c.ref.side, index: c.ref.index, token: c.tok.id, length: c.reply.toks.length, mark: `${c.turn.id}.${replyMark(c.reply)}` }) : "";
  const detail = useMeasured<FloorDetail>(key, !!c && measurable && floor >= 0, passing, () => (c ? floorDetail(c.ref) : Promise.resolve(null)));
  const measured = detail.state === "ready" && detail.key === key ? detail.value : null;

  const plates = useMemo(() => (measured && floor >= 0 ? layerPlates(model, measured, floor) : null), [model, measured, floor]);
  const waiting = floor < 0 ? "" : !c ? "Ask a question and select a token to measure this layer."
    : c.reply.stale ? "This reply used earlier settings. Select a token in a current reply."
    : !c.reply.done ? "Waiting for the reply to finish."
    : mode !== "live" ? "Measurements need the model to be ready."
    : !plates ? (detail.state === "unavailable" ? S.noDetail : passing ? "Pause the replay to measure this layer for the token on screen." : "Measuring every step for this token…") : "";
  // The tower opens only for real plates. Until then the reason is given beside the stage, and the model stays whole.
  const bay = useMemo((): BaySpec | null => (floor < 0 || waiting || !plates ? null
    : { key: `${model.id}.layer.${floor}`, floor, plates }), [floor, model.id, plates, waiting]);

  // ------------------------------------------------------------ data into the stage
  const context = useMemo(() => (c ? [...c.reply.read, ...c.reply.toks.slice(0, c.ref.index).map((x) => x.id)] : []), [c]);
  const row = selected?.kind === "head" ? attentionRow(model, measured, selected.floor, selected.head) : null;
  const slots = tray(context.length, TRAY, row && row.length === context.length ? row : null);
  const trayLabels = slots.map((s) => (s.to - s.from > 1 ? `${s.to - s.from} earlier` : text(context[s.from]).replace(/\n/g, "↵")));
  const trayKey = JSON.stringify([trayLabels, slots.map((s) => Math.round(s.weight * 1000)), c?.input ?? null, selected?.kind === "head" && row ? partIndex(model, selected) : -1]);
  const candidates = useMemo(() => {
    return c ? outputBars(c.tok, 5).map((x) => ({ label: text(x.id), p: x.p, chosen: x.chosen })) : [];
  }, [c]);
  const candidateKey = JSON.stringify(candidates);

  useEffect(() => { stage?.setValues(values?.scaled ?? null, "signed"); }, [stage, values]);
  useEffect(() => { stage?.setPoses(poses); }, [stage, poses]);
  useEffect(() => { stage?.setMarked(marked); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [stage, marked && partIndex(model, marked)]);
  useEffect(() => { stage?.setBay(bay); }, [stage, bay]);
  useEffect(() => {
    stage?.setTray(slots.map((s, i) => ({ label: trayLabels[i], weight: s.weight })), slots.length - 1, c?.input ?? null, selected?.kind === "head" && row ? selected : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage, trayKey]);
  // The stage lends the replay its frames and draws its playhead. Each step reaches the stage directly,
  // without a render of this component. With no stage (2D, another bench, a rebuilt context) nothing moves.
  // This effect comes before the one that hands over candidates, so the link exists when they arrive.
  const link = useRef<ReturnType<typeof linkStage> | null>(null);
  useEffect(() => {
    if (!stage) return;
    const made = link.current = linkStage(stage);
    return () => { made.close(); link.current = null; };
  }, [stage]);
  // Keyed on the token's identity too: a replay that reached this token is waiting for exactly this
  // handover, even when the numbers are the same as the last token's.
  const outputKey = outputIdentity({ model, version, turns, word, fork });
  useEffect(() => { link.current?.deliver(candidates, outputKey); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [stage, candidateKey, outputKey]);

  // ------------------------------------------------------------ replay (the stage link is with the data above)
  // Leaving the 3D view or this bench ends the replay. It never starts again by itself.
  useEffect(() => { if (!active) { session.exit("closed"); store.set({ replayRequest: null }); } }, [active]);
  useEffect(() => () => session.exit("closed"), []);
  // "Replay in 3D" on a reply: start once the stage is drawing.
  useEffect(() => {
    if (!request || !stage) return;
    store.set({ replayRequest: null });
    if (!startReplay("answer", request)) store.set({ announce: replayWait(store.get()) || "That reply cannot be replayed now." });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request?.n, stage]);

  // ------------------------------------------------------------ tokens
  const hasDiff = !!comparisonTarget({ turns, word, fork });
  const turn = word ? turns[word.turn] : turns.at(-1);
  const canRetry = !!turn?.changed && !replay && !turn.changed.stale && !turn.changed.comparing && turn.normal.done && turn.changed.done && !hasDiff;
  // The comparison for this sample is still on its way: a reply is being written, or the changed model is reading the original.
  const measuring = !!turn?.changed && !turn.changed.stale && (!turn.normal.done || !turn.changed.done || !!turn.changed.comparing || replay?.status === "running");

  // ------------------------------------------------------------ edits
  const say = (announce: string) => store.set({ announce });
  const punch = (part: Part): boolean => {
    if (!isTarget(part)) { say("Punch works on attention heads, MLPs and layers."); return false; }
    const why = blocked(store.get());
    if (why) { say(why); return false; }
    const off = strengthOf(store.get().chips, part) === 0;
    void chipsWith((spec) => punched(spec, part));
    say(`${partName(model, part)} ${off ? "put back" : "knocked out: its output is now zero"}.${store.get().turns.length ? " Updating your samples." : ""}`);
    return true;
  };

  function describe(part: Part, tool: Tool): string {
    const lines = [partName(model, part)];
    const v = values?.raw[partIndex(model, part)];
    if (c && v !== undefined && !Number.isNaN(v)) {
      lines.push(`${signed(v)} ${view === "difference" ? "change in direct push" : part.kind === "layer" ? "direct push from all its parts" : "direct push"} for “${wq}”`);
    } else if (!c && (part.kind === "head" || part.kind === "mlp")) lines.push("Select a token to see its push");
    if (isTarget(part) && strengthOf(chips, part) !== 1) lines.push(`Signal ${S.mult(strengthOf(chips, part))}`);
    if (part.kind !== "layer" && "floor" in part && poses[partIndex(model, { kind: "layer", floor: part.floor })].off) lines.push("Its layer is off");
    if (tool === "punch") lines.push(isTarget(part) ? (strengthOf(chips, part) === 0 ? "Click to put it back" : "Click to knock it out") : "Punch works on heads, MLPs and layers");
    if (tool === "grab" && isTarget(part)) lines.push("Drag to move it. The model does not change.");
    return lines.join("\n");
  }

  const status = <span>{model.id === "tiny" ? "Your tiny model" : "Qwen3-0.6B"} · {model.floors} layers · {changes.length ? `${changes.length} active ${changes.length === 1 ? "change" : "changes"}` : "original model"}{reason ? ` · ${reason}` : ""}</span>;

  const transport = <section className="stage-transport" aria-label="Colors and totals for the selected token">
    <div className="stage-token">
      <span className="note" aria-hidden="true">Colors show</span>
      <div className="seg" role="group" aria-label="Colors show">
        <button type="button" aria-pressed={view === "push"} onClick={() => setTowerView("push")}>{S.viewPush}</button>
        <button type="button" aria-pressed={view === "difference"} disabled={!hasDiff} title={hasDiff ? S.diffNote : S.diffNone} onClick={() => setTowerView("difference")}>{S.viewDiff}</button>
      </div>
    </div>
    {canRetry && <p className="note">No comparison for this token yet. <button type="button" className="linkish" disabled={mode !== "live" || busy} onClick={() => void retryComparison()}>Retry comparison</button></p>}
    {!replaying && <p className="stage-readout" role="status">
      {!c ? "Nothing to show yet."
        // A total is stated only for values that were measured. Without them nothing is lit and no number is given.
        : running && coverage.complete ? `Every part is lit. ${view === "difference" ? "Changes in direct push" : "Direct pushes"} add up to ${signed(running[running.length - 1])} for “${wq}”.`
        // Some values are not numbers. The parts that have one are lit, the rest are not, and a total of only some of them would mislead.
        : coverage.measured > 0 ? `Incomplete measurement for “${wq}”: ${(coverage.of - coverage.measured).toLocaleString("en-US")} of ${coverage.of.toLocaleString("en-US")} ${view === "difference" ? "changes in direct push" : "direct pushes"} are unavailable. Parts without a value are not lit, and no total is given.`
        : view !== "difference" ? `No direct pushes were measured for “${wq}”. Nothing is lit.`
        : measuring ? `Measuring the change from the original for “${wq}”. Nothing is lit until it is done.`
        : `No comparison has been measured for “${wq}”, so nothing is lit.`}
    </p>}
    <p className="note">Replay shows values the model already measured while writing, slowed down and in the order the model computes them. Nothing is generated again. It is not a timing of the real computation.</p>
  </section>;

  const part = isTarget(selected) ? selected : null;
  return <Workbench arch={arch} active={active} title={model.id === "tiny" ? "Your trained brain" : "Under the hood"} status={status}
    tools={["explore", "grab", "punch"]} selected={selected} onSelect={select} onPunch={punch} describe={describe}
    punchHelp="Click a head, an MLP or a layer to knock it out. Its real output is set to zero and your samples update. Click it again to put it back."
    onHidden={() => session.pause()} onStage={setStage} rail={<StageQuestion />} railTitle="Question and replies" bar={<ReplayBar />} transport={transport}
    restore={{ label: "Restore model", disabled: !!reason || !changes.length, run: () => void applyChips({}) }}>
    <ReplayStatus compact />
    {part ? <>
      <PartControls key={`${model.id}.${part.kind}.${part.floor}.${part.kind === "head" ? part.head : ""}`} part={focusOf(part) as Extract<Focus, { kind: "head" | "memory" | "floor" }>}
        disabled={!!reason} onClose={() => select(null)} />
      <div className="stage-part-actions">
        <button type="button" className="btn" disabled={!!reason} onClick={() => stage?.react(part, punch(part))}>{strengthOf(chips, part) === 0 ? "Put back" : "Knock out"}</button>
        <button type="button" className="btn quiet" disabled={!!reason || !partChanged(chips, part)} onClick={() => void chipsWith((spec) => restored(spec, part))}>{restoreLabel(part)}</button>
        <button type="button" className="btn quiet" disabled={!stage} onClick={() => stage?.focus(part)}>Look closer</button>
      </div>
      <p className="note">{waiting || `The plates beside layer ${part.floor + 1} are its measured values for ${c ? `“${wq}” in the ${c.ref.side === "normal" ? "original" : "changed"} reply` : "this token"}. Hover a tile to read its number.`}</p>
    </> : selected ? <section className="stage-info">
      <div className="section-heading"><h3>{partName(model, selected)}</h3><button type="button" className="btn quiet" onClick={() => select(null)}>Close</button></div>
      <p className="note">{selected.kind === "embed" ? S.def(model).dictionary : selected.kind === "kv" ? `Heads ${groupHeads(model, selected.group).map((h) => h + 1).join(" and ")} ask their own questions but read the same keys and values. This pairing is part of the model's design.`
        : selected.kind === "norm" ? "The stream is rescaled once more before it is turned into scores." : S.def(model).out}</p>
      {selected.kind === "embed" && c && values && <p className="scope-measurement"><span className="num">{signed(values.raw[0])}</span> direct push for “{wq}” from the token it read, “{text(c.input)}”</p>}
      <div className="stage-part-actions">
        <button type="button" className="linkish" onClick={() => setFocus(focusOf(selected) ?? { kind: "word" })}>Inspect details →</button>
        <button type="button" className="btn quiet" disabled={!stage} onClick={() => stage?.focus(selected)}>Look closer</button>
      </div>
    </section> : <section className="stage-info">
      <h3>Select a part</h3>
      <p className="note">Click a head, an MLP or a layer to open its controls here. A window lit orange pushed toward the selected token and one lit blue pushed against it.</p>
      {marked && st && <button type="button" className="btn" onClick={() => select(marked)}>Find marked part</button>}
    </section>}
    <LearnedControl disabled={!!reason} />
    <MoreExperiments disabled={!!reason} />
    <RealNote punch real={`${model.floors} layers, ${model.heads} attention heads and one MLP in each, and heads paired on shared keys and values. The color of each lit window is a measured direct push. Plates are measured values. The bars over Words out are the model's own probabilities for its top pieces and the piece it wrote, over its whole vocabulary before any sampling setting. Punch and the strength controls change the running model.`}
      drawing={`The shapes, sizes and positions. A model has no physical form. The dictionary tiles and MLP fins stand in for ${model.vocab.toLocaleString("en-US")} rows and ${model.units.toLocaleString("en-US")} neurons; they are not drawn one by one. During a replay, the amber corner brackets and their label mark the step the replay is at. They are a position, not a measurement.`} />
  </Workbench>;
}

/** The question and its replies, kept beside the stage so an experiment never leaves the 3D view. */
function StageQuestion() {
  const mode = useStore((s) => s.mode);
  const busy = useStore((s) => s.busy);
  const replay = useStore((s) => s.replay);
  const model = useStore((s) => s.model);
  const draft = useStore((s) => s.draft);
  const turns = useStore((s) => s.turns);
  const word = useStore((s) => s.word);
  const k = Math.min(turns.length - 1, word?.turn ?? turns.length - 1), turn = turns[k];
  const submit = () => {
    if (mode !== "live" || busy || replay || !draft.trim()) return;
    store.set({ draft: "" });
    void send(draft);
  };
  const first = (r: Reply) => r.toks.findIndex((t) => !isStop(t.id));
  return <div className="stage-question">
    <form className="composer main-composer" onSubmit={(e) => { e.preventDefault(); submit(); }}>
      <textarea rows={2} value={draft} aria-label={model.id === "tiny" ? "Start a sentence" : "Question"} placeholder={model.id === "tiny" ? S.placeholderTiny : S.placeholderLive}
        onChange={(e) => store.set({ draft: e.target.value })}
        onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); submit(); } }} />
      {busy ? <button type="button" className="btn stop" onClick={stopReply}>Stop</button>
        : <button type="submit" className="btn primary" disabled={mode !== "live" || !!replay || !draft.trim()}>{model.id === "tiny" ? S.send : "Test question"}</button>}
    </form>
    <DeviceBar />
    <Chips />
    {turns.length > 1 && <label className="stage-sample">Sample
      <select value={k} onChange={(e) => { const i = Number(e.target.value), index = first(turns[i].normal); if (index >= 0) chooseWord({ turn: i, side: "normal", index }); }}>
        {turns.map((t, i) => <option key={t.id} value={i}>{i + 1}. {t.user.slice(0, 60)}</option>)}
      </select>
    </label>}
    {turn ? <>
      <p className="stage-asked">{turn.user}</p>
      <MiniReply reply={turn.normal} k={k} side="normal" label={model.id === "tiny" ? "Your tiny model" : "Original"} />
      {turn.changed && <MiniReply reply={turn.changed} k={k} side="changed" label={turn.changed.stale ? "Changed, with earlier settings" : "Changed"} />}
      <p className="note">Select a word to light the parts that pushed for it. Replay walks a finished reply through the model.</p>
    </> : <p className="note">{mode === "live" ? "Ask anything. Each word it writes lights the parts that pushed for it." : "Questions run once the model is ready."}</p>}
  </div>;
}

function MiniReply({ reply, k, side, label }: { reply: Reply; k: number; side: Side; label: string }) {
  const word = useStore((s) => s.word);
  const idle = useStore((s) => !s.busy && !s.replay);
  const sample = useStore((s) => s.turns[k]?.id);
  const segments = replySegments(reply);
  const playable = reply.done && !reply.stale && segments.length > 0 && sample !== undefined;
  return <div className={`reply${side === "changed" ? " changed" : ""}${reply.stale ? " stale" : ""}`}>
    <div className="reply-heading"><span className="who">{label}</span>
      {playable && <button type="button" className="linkish reply-replay" disabled={!idle} aria-label={`Replay this reply from its first token: ${label}`}
        title={idle ? "Walk this reply through the whole model, token by token" : "Replay is ready when the model has finished writing"} onClick={() => startReplay("answer", { sample, side })}>Replay</button>}
    </div>
    <div className="text" role="group" aria-label={`${label} reply`}>
      {segments.map((s) => reply.stale ? <span key={s.from}>{s.text}</span>
        : <button key={s.from} type="button" className={`tok${word && word.turn === k && word.side === side && s.from <= word.index && word.index < s.to ? " sel" : ""}`}
          aria-pressed={!!word && word.turn === k && word.side === side && s.from <= word.index && word.index < s.to}
          aria-label={!s.text.trim() ? (s.text.includes("\n") ? "Line break" : "Space") : undefined}
          onClick={() => chooseWord({ turn: k, side, index: s.from })}>{s.text}</button>)}
      {!reply.done && <span className="tok cursor" aria-hidden="true" />}
    </div>
  </div>;
}
