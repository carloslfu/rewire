// Dismantle in 3D: the running model as a specimen, and the one drawing of its architecture. Colors
// are the selected token's measured pushes, Replay walks a finished answer's values through the
// architecture token by token, and Punch writes the same change spec as the strength controls. Every
// reading here is also given in words and numbers, so the bench works without the drawing.
import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { FloorDetail, Focus } from "../model/types.ts";
import { guideAddress, guideTarget } from "../path/steps.ts";
import { applyChips, chipsWith, floorDetail, piece, retryComparison, setFocus, setTowerView, stepData } from "../state/actions.ts";
import { store, useStore } from "../state/store.ts";
import { S } from "../strings.ts";
import { modelPct, pct, scoreLabel, signed } from "../ui/color.ts";
import { chips as describeChips } from "../ui/describe.ts";
import { written } from "../ui/odds.ts";
import { LearnedControl, MoreExperiments, PartControls } from "../ui/PartControls.tsx";
import { ReplayStatus } from "../ui/ReplayStatus.tsx";
import { chosen, comparisonTarget, replyMark, towerValues } from "../ui/word.ts";
import { ReplayBar } from "./ReplayBar.tsx";
import { linkStage, outputIdentity, replayWait, session, startReplay, useReplay } from "./replay-session.ts";
import { activityValues, attentionRow, layerPlates, outputBars, pushValues, rmsLabel, tray } from "./adapters.ts";
import { buildArch, groupHeads, type Part, partIndex, partName, samePart } from "./arch.ts";
import { blocked, focusOf, isTarget, partChanged, partOf, poseOf, punched, restored, restoreLabel, sameFocus, strengthOf } from "./intervene.ts";
import { measurementKey } from "./latest.ts";
import { plateMatrices } from "./matrices.ts";
import { MatrixInspector, useCell } from "./MatrixInspector.tsx";
import { pushCoverage, runningPush } from "./playback.ts";
import { LayerReadings, PushLegend } from "./PushReadings.tsx";
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
  const visit = useStore((s) => s.stageFocus);
  // False when the 3D drawing could not start. The readings below then speak of numbers, not of lit windows.
  const drawn = useStore((s) => s.stage3d);
  const focus = useStore((s) => s.focus);
  const version = useStore((s) => s.version);
  const active = useStore((s) => !s.tiny && !s.teach);
  const st = stepData(useStore((s) => s.step));
  const arch = useMemo(() => buildArch(model), [model]);
  const [stage, setStage] = useState<Stage | null>(null);
  const [showActivity, setShowActivity] = useState(false);
  const [selected, setSelected] = useState<Part | null>(() => partOf(store.get().focus));
  const replaying = useReplay((r) => r.mode === "replay");
  const awaitingOutput = useReplay((r) => r.mode === "replay" && r.step < r.beats);
  // While a whole answer plays, the selected layer is not measured again for every token that goes by.
  const passing = useReplay((r) => r.mode === "replay" && r.playing && r.scope === "answer");

  const c = useMemo(() => chosen({ turns, word, fork }), [turns, word, fork]);
  const vals = useMemo(() => towerValues(c, view), [c, view]);
  const values = useMemo(() => pushValues(arch, vals), [arch, vals]);
  const activity = useMemo(() => activityValues(arch, c?.tok.activity), [arch, c?.tok.activity]);
  const activityMode = view === "push" && showActivity;
  const displayed = activityMode ? activity : values;
  const running = useMemo(() => (vals ? runningPush(model, vals) : null), [model, vals]);
  const coverage = useMemo(() => pushCoverage(model, vals), [model, vals]);
  const poses = useMemo(() => arch.parts.map((p) => poseOf(chips, p, model)), [arch, chips, model]);
  const changes = describeChips(chips);
  const reason = blocked({ mode, busy, replay, teachingBusy });
  const wq = c ? text(c.tok.id) : "";
  const target = model.id === "qwen" ? guideTarget(st) : null;
  const marked = target ? partOf(target) : null;

  // The inspector and the guided examples move the focus; the stage follows them. One selection is
  // shared: a part that opens another part's panel (the final normalization, shared keys and values)
  // stays selected while that panel is the one on show.
  useEffect(() => { setSelected((now) => (sameFocus(now, focus) ? now : partOf(focus))); }, [focus]);
  const shown = useRef(model.id);
  useEffect(() => { if (shown.current !== model.id) { shown.current = model.id; setSelected(null); } }, [model.id]);

  const select = (part: Part | null) => {
    setSelected(part);
    store.set({ focus: part ? focusOf(part) ?? { kind: "word" } : { kind: "word" } });
    if (part) store.set({ announce: describe(part, "explore").replace(/\n/g, ". ") });
  };
  // "Explore the full model" in the inspector: this bench is that model. It comes into view on the
  // part the inspector was showing, which the shared selection has already selected here.
  const [attention, setAttention] = useState(0);
  useEffect(() => {
    if (!visit || !active) return;
    store.set({ stageFocus: null });
    setAttention(visit.n);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visit?.n, active]);

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

  useEffect(() => { stage?.setValues(displayed?.scaled ?? null, activityMode ? "activity" : "signed"); }, [stage, displayed, activityMode]);
  useEffect(() => { stage?.setPoses(poses); }, [stage, poses]);
  useEffect(() => { stage?.setMarked(marked); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [stage, marked && partIndex(model, marked)]);
  useEffect(() => { stage?.setBay(bay); }, [stage, bay]);
  // The measured tensors of the selected layer, each number readable on its own. The tile of the one
  // being read is outlined on its plate once the visitor has chosen it, here or by tapping a tile.
  const matrices = useMemo(() => (plates ? plateMatrices(plates) : []), [plates]);
  const [cell, setCell, picked] = useCell(matrices);
  useEffect(() => { stage?.markTile(picked && cell ? { plate: cell.id, index: cell.index } : null); }, [stage, picked, cell]);
  useEffect(() => {
    stage?.setTray(slots.map((s, i) => ({ label: trayLabels[i], weight: s.weight })), slots.length - 1, c?.input ?? null, selected?.kind === "head" && row ? selected : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage, trayKey]);
  // The stage lends the replay its frames and draws its playhead. Each step reaches the stage directly,
  // without a render of this component. With no stage (another bench, a drawing that could not start, a rebuilt context) nothing moves.
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
  // Leaving this bench ends the replay. It never starts again by itself.
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
  // Why the comparison cannot be shown, in the one sentence that applies.
  const awaitingUpdate = !!replay && (word?.turn ?? turns.length - 1) >= replay.turn && replay.status !== "running";
  const diffHint = !turn ? "Ask a question, then change a part to compare it with the original."
    : !turn.changed ? S.diffNone
    : turn.changed.stale ? "This reply used earlier settings. Compare the latest reply instead."
    : awaitingUpdate ? "Finish the sample update to compare this reply."
    : turn.changed.comparing ? "Computing the change from the original…"
    : !turn.normal.done || !turn.changed.done ? "Writing the replies. The comparison will be available when they finish."
    : turn.changed.compareError ? `Comparison unavailable: ${turn.changed.compareError}`
    : "No comparison is available for this token yet.";
  const diffId = useId();

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
    const v = displayed?.raw[partIndex(model, part)];
    if (c && !awaitingOutput && v !== undefined && Number.isFinite(v)) {
      lines.push(activityMode ? `${part.kind === "layer" ? "Largest part output" : "Output size"} · ${rmsLabel(v)}`
        : `${scoreLabel(v)} ${view === "difference" ? "change in direct push" : part.kind === "layer" ? "direct push from all its parts" : "direct push"} for “${wq}”`);
    } else if (!awaitingOutput && (part.kind === "head" || part.kind === "mlp")) lines.push(c ? "Reading unavailable" : "Select a reply token to see its reading");
    if (isTarget(part) && strengthOf(chips, part) !== 1) lines.push(`Signal ${S.mult(strengthOf(chips, part))}`);
    if (part.kind !== "layer" && "floor" in part && poses[partIndex(model, { kind: "layer", floor: part.floor })].off) lines.push("Its layer is off");
    if (tool === "punch") lines.push(isTarget(part) ? (strengthOf(chips, part) === 0 ? "Click to put it back" : "Click to knock it out") : "Punch works on heads, MLPs and layers");
    if (tool === "grab" && isTarget(part)) lines.push("Drag to move it. The model does not change.");
    return lines.join("\n");
  }

  /** A few words on a part for the menus that name every part: its number for this token, a change on it, the example's marker. */
  const annotate = (part: Part): string => {
    const notes: string[] = [], v = displayed?.raw[partIndex(model, part)];
    if (c && !awaitingOutput && (part.kind === "head" || part.kind === "mlp" || part.kind === "layer" || part.kind === "embed")) {
      notes.push(activityMode ? rmsLabel(v) : v !== undefined && Number.isFinite(v) ? scoreLabel(v) : "unavailable");
    }
    if (isTarget(part)) {
      const mult = strengthOf(chips, part);
      if (mult !== 1) notes.push(S.mult(mult)); else if (partChanged(chips, part)) notes.push("changed");
    }
    if (marked && samePart(marked, part)) notes.push("example target");
    return notes.join(" · ");
  };

  const status = <span>{model.id === "tiny" ? "Your tiny model" : "Qwen3-0.6B"} · {model.floors} layers · {changes.length ? `${changes.length} active ${changes.length === 1 ? "change" : "changes"}` : "original model"}{reason ? ` · ${reason}` : ""}</span>;

  const meterBar = <div className="window-meter-bar">
    <div className="seg" role="group" aria-label="Model readings">
      <button type="button" aria-pressed={view === "push" && !showActivity} onClick={() => { setShowActivity(false); setTowerView("push"); }}>{S.viewPush}</button>
      <button type="button" aria-pressed={activityMode} onClick={() => { setShowActivity(true); setTowerView("push"); }}>Activity</button>
      <button type="button" aria-pressed={view === "difference"} disabled={!hasDiff} title={hasDiff ? S.diffNote : diffHint} aria-describedby={hasDiff ? undefined : diffId}
        onClick={() => setTowerView("difference")}>{S.viewDiff}</button>
    </div>
    {drawn && <div className="window-meter-key" aria-label="Meter color key">
      {activityMode ? <span><i className="meter-activity" />Larger output</span> : <>
        <span><i className="meter-up" />{view === "difference" ? "Increased" : "Raises score"}</span>
        <span><i className="meter-down" />{view === "difference" ? "Decreased" : "Lowers score"}</span>
      </>}
    </div>}
  </div>;
  const transport = <section className="stage-transport" aria-label={`${drawn ? "Colors" : "Numbers"} and totals for the selected token`}>
    {c && !replaying && <div className="stage-token"><button type="button" className="linkish" title="Its probability, the candidates it was drawn from, and its dictionary entry" onClick={() => setFocus({ kind: "word" })}>Details and candidates for “{wq}” →</button></div>}
    {!hasDiff && <p id={diffId} className={turn ? "note comparison-status" : "sr-only"}>{diffHint}
      {canRetry && <> <button type="button" className="linkish" disabled={mode !== "live" || busy} onClick={() => void retryComparison()}>Retry comparison</button></>}</p>}
    {marked && st && <button type="button" className="example-marker-key" onClick={() => { select(marked); stage?.focus(marked); }}><span aria-hidden="true" />Marked: {guideAddress(st)}</button>}
    {!replaying && <p className="stage-readout" role="status">
      {!c ? "Select a reply token to read the model."
        : activityMode ? activity ? `Output sizes measured while writing “${wq}”. Select a part to see its value.` : `Output sizes are unavailable for “${wq}”.`
        // A total is stated only for values that were measured. Without them nothing is lit and no number is given.
        : running && coverage.complete ? `${view === "difference" ? "Changes in direct push" : "Direct pushes"} add up to ${signed(running[running.length - 1])} for “${wq}”.`
        // Some values are not numbers. The parts that have one are lit, the rest are not, and a total of only some of them would mislead.
        : coverage.measured > 0 ? `Incomplete measurement for “${wq}”: ${(coverage.of - coverage.measured).toLocaleString("en-US")} of ${coverage.of.toLocaleString("en-US")} ${view === "difference" ? "changes in direct push" : "direct pushes"} are unavailable. ${drawn ? "Parts without a value are not lit, and no total is given." : "No total is given."}`
        : view !== "difference" ? `No direct pushes were measured for “${wq}”.${drawn ? " Nothing is lit." : ""}`
        : measuring ? `Measuring the change from the original for “${wq}”.${drawn ? " Nothing is lit until it is done." : ""}`
        : `No comparison has been measured for “${wq}”${drawn ? ", so nothing is lit" : ""}.`}
    </p>}
    {view === "difference" && !awaitingOutput && c?.forced && <dl className="token-probability-comparison">
      <dt>Probability of “{wq}” in the same context</dt>
      <dd><span>Original <strong className="num">{modelPct(Math.exp(c.tok.lp1))}</strong></span><span>Changed <strong className="num">{modelPct(Math.exp(c.forced.lp1))}</strong></span></dd>
    </dl>}
    {activityMode ? <p className="note">Activity measures how much each head or MLP adds to the model’s shared state, as a root mean square. Longer meters show larger outputs within this token. An empty track means zero. Dark glass means the reading is unavailable or its replay step is ahead.</p>
      : drawn && <PushLegend view={view} scale={values && coverage.measured > 0 ? values.scale : null} token={!!c} word={wq} values={!awaitingOutput && coverage.complete ? vals : null} model={model} />}
    <p className="note">Replay shows values the model already measured while writing, slowed down and in the order the model computes them. Nothing is generated again. It is not a timing of the real computation.</p>
  </section>;

  const how = c ? written(c.tok) : null;
  // The numbers of the layer the selected part is on, and every measured value in it one by one.
  const layer = floor >= 0 ? <>
    {c && !awaitingOutput && <LayerReadings model={model} values={vals} floor={floor} view={view} word={wq} />}
    {matrices.length > 0 && <MatrixInspector matrices={matrices} cell={cell} onCell={setCell} heading="Read one measured value" onLook={stage && bay ? () => stage.focusBay() : undefined} empty="" />}
  </> : null;

  const part = isTarget(selected) ? selected : null;
  const partActivity = selected && activity?.raw[partIndex(model, selected)];
  return <Workbench arch={arch} active={active} title={model.id === "tiny" ? "Your trained brain" : "Under the hood"} status={status}
    tools={["explore", "grab", "punch"]} selected={selected} onSelect={select} onPunch={punch} describe={describe}
    punchHelp="Click a head, an MLP or a layer to knock it out. Its real output is set to zero and your samples update. Click it again to put it back."
    annotate={annotate} onTile={(plate, index) => setCell({ id: plate, index })} attention={attention}
    onHidden={() => session.pause()} onStage={setStage} railTitle="Questions and comparisons" railName="Questions" bar={<>{meterBar}<ReplayBar activity={activityMode} /></>} replaying={replaying} transport={transport}
    restore={{ label: "Restore model", disabled: !!reason || !changes.length, run: () => void applyChips({}) }}>
    <ReplayStatus compact />
    {part ? <>
      <PartControls key={`${model.id}.${part.kind}.${part.floor}.${part.kind === "head" ? part.head : ""}`} part={focusOf(part) as Extract<Focus, { kind: "head" | "memory" | "floor" }>}
        disabled={!!reason} onClose={() => select(null)} showReading={!awaitingOutput} outputSize={c ? rmsLabel(partActivity ?? undefined) : undefined} />
      <div className="stage-part-actions">
        <button type="button" className="btn" disabled={!!reason} onClick={() => stage?.react(part, punch(part))}>{strengthOf(chips, part) === 0 ? "Put back" : "Knock out"}</button>
        <button type="button" className="btn quiet" disabled={!!reason || !partChanged(chips, part)} onClick={() => void chipsWith((spec) => restored(spec, part))}>{restoreLabel(part)}</button>
        <button type="button" className="btn quiet" disabled={!stage} onClick={() => stage?.focus(part)}>Look closer</button>
      </div>
      <p className="note">{waiting || (drawn ? `The plates beside layer ${part.floor + 1} show its measured values for ${c && !awaitingOutput ? `“${wq}”` : "this token"}. A tile can stand for several numbers. Click or tap one, or use the fields below, to read each number.`
        : `Read layer ${part.floor + 1}’s measured values below, one number at a time.`)}</p>
      {layer}
    </> : selected ? <section className="stage-info">
      <div className="section-heading"><h3>{partName(model, selected)}</h3><button type="button" className="btn quiet" onClick={() => select(null)}>Close</button></div>
      <p className="note">{selected.kind === "embed" ? S.def(model).dictionary : selected.kind === "kv" ? `Heads ${groupHeads(model, selected.group).map((h) => h + 1).join(" and ")} ask their own questions but read the same keys and values. This pairing is part of the model's design.`
        : selected.kind === "norm" ? "The stream is rescaled once more before it is turned into scores." : S.def(model).out}</p>
      {selected.kind === "embed" && c && !awaitingOutput && <>
        {values && <p className="scope-measurement"><span className="num">{signed(values.raw[0])}</span> {view === "difference" ? "change in direct push" : "direct push"} for “{wq}” from the token it read, “{text(c.input)}”</p>}
        <p className="scope-measurement">Embedding size <span className="num">{rmsLabel(partActivity ?? undefined)}</span></p>
      </>}
      {selected.kind === "unembed" && c && how && !awaitingOutput && <>
        <p className="scope-measurement">Wrote “{wq}”: {how.by === "draw" ? <><span className="num">{pct(how.chance)}</span> in the draw</> : "your choice in place of the draw"}.</p>
        <ol className="stage-candidates" aria-label="The model's own probabilities, as on the bars over Words out">
          {candidates.map((x, i) => <li key={i} className={x.chosen ? "chosen" : undefined}><span>{x.label}{x.chosen ? " (written)" : ""}</span><span className="num">{modelPct(x.p)}</span></li>)}
        </ol>
        <p className="note">The model's own probabilities at temperature 1 over its whole vocabulary: the bars over Words out. The draw's odds are a different measure, in the token's details.</p>
      </>}
      {selected.kind === "kv" && <p className="note">These shared inputs are measured on the Key and Value plates. The output meters belong to the heads that use them.{waiting ? ` ${waiting}` : ""}</p>}
      {selected.kind === "kv" && layer}
      <div className="stage-part-actions">
        <button type="button" className="linkish" onClick={() => setFocus(focusOf(selected) ?? { kind: "word" })}>Inspect details →</button>
        <button type="button" className="btn quiet" disabled={!stage} onClick={() => stage?.focus(selected)}>Look closer</button>
      </div>
    </section> : <section className="stage-info">
      <h3>Select a part</h3>
      <p className="note">{drawn ? "Select a head, MLP or layer to see its numbers and controls."
        : "Choose a layer in the menu above, then one of its heads or its MLP, to open its controls and measurements here."}</p>
      {marked && st && <button type="button" className="btn" onClick={() => select(marked)}>Find marked part</button>}
    </section>}
    <LearnedControl disabled={!!reason} />
    <MoreExperiments disabled={!!reason} />
    <RealNote punch real={`${model.floors} layers, ${model.heads} attention heads and one MLP in each, and heads paired on shared keys and values. The window meters show measured contributions to the token score or the size of each part’s output. Plates are measured values. The bars over Words out are the model's own probabilities for its top pieces and the piece it wrote, over its whole vocabulary before any sampling setting. Punch and the strength controls change the running model.`}
      drawing={`The shapes, sizes and positions. A model has no physical form. The dictionary tiles and MLP fins stand in for ${model.vocab.toLocaleString("en-US")} rows and ${model.units.toLocaleString("en-US")} neurons; they are not drawn one by one. During a replay, the amber corner brackets and their label mark the step the replay is at. They are a position, not a measurement.`} />
  </Workbench>;
}
