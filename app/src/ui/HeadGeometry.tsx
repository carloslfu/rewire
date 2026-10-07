import { useEffect, useId, useState } from "react";
import { geometryActive, type HeadGeometry as Geometry } from "@rewire/engine/src/changes.ts";
import { vectorStats } from "@rewire/engine/src/geometry.ts";
import type { FloorDetail } from "../model/types.ts";
import { chipsWith } from "../state/actions.ts";
import { useStore } from "../state/store.ts";
import { geometryKey } from "./describe.ts";
import type { Chosen } from "./word.ts";

export function HeadGeometry({ floor, head, detail, loading, chosen }: { floor: number; head: number; detail: FloorDetail | null; loading: boolean; chosen: Chosen | null }) {
  const id = useId();
  const model = useStore((s) => s.model);
  const live = useStore((s) => s.mode === "live");
  const chips = useStore((s) => s.chips);
  const current = chips.geometry?.find((g) => g.floor === floor && g.head === head);
  const kind = current?.kind ?? "none";
  const value = current?.kind === "rotate" ? current.angle : current?.kind === "remove" ? Math.round(current.amount * 100) : 0;
  const [draft, setDraft] = useState(value);
  const floorTransforms = chips.geometry?.filter((g) => g.floor === floor) ?? [];
  const sameTransform = (g: Geometry) => current && geometryKey(g) === geometryKey(current);
  const all = floorTransforms.length === model.heads && floorTransforms.every(sameTransform);
  useEffect(() => setDraft(value), [value, kind]);
  const commit = (g: Geometry | undefined, wholeLayer = all) => void chipsWith((s) => {
    const geometry = (s.geometry ?? []).filter((v) => !(v.floor === floor && (wholeLayer || v.head === head)));
    if (g && geometryActive(g)) {
      if (wholeLayer) for (let h = 0; h < model.heads; h++) geometry.push({ ...g, head: h });
      else geometry.push(g);
    }
    return { ...s, geometry };
  });
  const setKind = (k: string) => commit(k === "rotate" ? { floor, head, kind: "rotate", angle: 90, seed: 1 }
    : k === "remove" ? { floor, head, kind: "remove", amount: 1 }
    : k === "shuffle" ? { floor, head, kind: "shuffle", seed: 1 } : undefined);
  const setValue = (v: number) => {
    if (!current || current.kind === "shuffle" || v === value) return;
    commit(current.kind === "rotate" ? { ...current, angle: v } : { ...current, amount: v / 100 });
  };
  const measured = chosen?.reply.changes.geometry?.find((g) => g.floor === floor && g.head === head);
  const before = detail?.get(`f${floor}.heads_before`)?.subarray(head * model.width, (head + 1) * model.width);
  const after = detail?.get(`f${floor}.heads_after`)?.subarray(head * model.width, (head + 1) * model.width);
  const stats = measured && before && after ? vectorStats(before, after, detail?.get(`f${floor}.x`)) : null;
  const seed = current && current.kind !== "remove" ? current.seed : 1;
  return <section className="head-geometry">
    <h3>Change direction</h3>
    <p className="note">Turn the signal this head sends into the model.</p>
    <label className="geometry-choice" htmlFor={id}>Transform
      <select id={id} value={kind} disabled={!live} onChange={(e) => setKind(e.target.value)}>
        <option value="none">Untouched</option><option value="rotate">Rotate</option>
        <option value="remove">Remove overlap</option><option value="shuffle">Scramble coordinates</option>
      </select>
    </label>
    {!live && <p className="note">The model must be ready before a transformation can run.</p>}
    {current && <>
      <label className="geometry-scope"><input type="checkbox" disabled={!live} checked={all} onChange={(e) => {
        if (e.target.checked) commit(current, true);
        else void chipsWith((s) => ({ ...s, geometry: [...(s.geometry ?? []).filter((g) => g.floor !== floor), current] }));
      }} />Transform all {model.heads} attention heads on this layer</label>
      {kind !== "shuffle" && <>
        <div className="geometry-range-label"><label htmlFor={`${id}-range`}>{kind === "rotate" ? "Angle" : "Overlap removed"}</label><output htmlFor={`${id}-range`} className="num">{draft}{kind === "rotate" ? "°" : "%"}</output></div>
        <input id={`${id}-range`} aria-label={kind === "rotate" ? "Rotation angle" : "Overlap removed"} type="range" disabled={!live}
          min={kind === "rotate" ? -180 : 0} max={kind === "rotate" ? 180 : 100} step={kind === "rotate" ? 15 : 10} value={draft}
          onChange={(e) => setDraft(Number(e.target.value))} onPointerUp={(e) => setValue(Number(e.currentTarget.value))}
          onKeyUp={(e) => setValue(Number(e.currentTarget.value))} onBlur={(e) => setValue(Number(e.currentTarget.value))} />
        {kind === "rotate" && <div className="geometry-presets">{[45, 90, 180].map((angle) => <button type="button" className="btn quiet small" disabled={!live} key={angle} aria-pressed={value === angle} onClick={() => setValue(angle)}>{angle}°{angle === 90 ? " sideways" : angle === 180 ? " flip" : ""}</button>)}</div>}
      </>}
      {stats && stats.angle !== null && stats.ratio !== null && <div className="geometry-guide">
        <svg viewBox="0 0 140 110" role="img" aria-label={`Measured vectors: ${stats.angle.toFixed(1)} degrees apart, ${(stats.ratio * 100).toFixed(1)} percent of the original length.`}>
          <circle cx="70" cy="55" r="42" fill="none" stroke="var(--line)" />
          <path d="M70 55 H112 M106 51 L112 55 L106 59" fill="none" stroke="var(--muted)" strokeWidth="2" />
          <g transform={`translate(70 55) rotate(${-stats.angle}) scale(${stats.ratio})`}><path d="M0 0 H42 M36 -4 L42 0 L36 4" fill="none" stroke="var(--changed)" strokeWidth="3" /></g>
          <circle cx="70" cy="55" r="2" fill="var(--fg)" />
        </svg>
        <p className="note">The selected token’s measured angle and relative length, drawn in two dimensions. Gray is before; pink is after.</p>
      </div>}
      <p className="note">{kind === "rotate" ? "The plane comes from seeded coordinate pairs. It is not a learned meaning or a semantic opposite."
        : kind === "remove" ? "Removes the component parallel to the incoming stream, in either direction. At 100%, only the perpendicular component remains. Its length can shrink."
          : "Reassigns the same numbers to different coordinates. Length stays the same; the learned arrangement is disrupted."}</p>
      {current.kind !== "remove" && <div className="geometry-seed"><span className="note">{kind === "rotate" ? "Plane" : "Pattern"} {seed}</span><button className="btn small" type="button" disabled={!live} onClick={() => commit({ ...current, seed: (seed + 1) >>> 0 })}>{kind === "rotate" ? "Try another plane" : "Try another pattern"}</button></div>}
      {stats ? <div className="geometry-measured" aria-live="polite">
        <p className="note">Measured at the selected changed token</p>
        <dl className="kv"><dt>Angle from original</dt><dd className="num">{stats.angle === null ? "Undefined (zero vector)" : `${stats.angle.toFixed(1)}°`}</dd>
          <dt>Length retained</dt><dd className="num">{stats.ratio === null ? "Undefined (zero input)" : `${(stats.ratio * 100).toFixed(1)}%`}</dd>
          {measured?.kind === "remove" && <><dt>Alignment with stream</dt><dd className="num">{stats.streamCosine === null ? "Undefined" : (Math.abs(stats.streamCosine) < 0.00005 ? 0 : stats.streamCosine).toFixed(4)}</dd></>}
        </dl>
      </div> : <p className="note geometry-measured">{measured ? chosen?.reply.done ? loading ? "Measuring the selected token…" : "Measurements unavailable. Select another token to try again." : "Waiting for the changed reply to finish…" : "Select a word in the changed reply to measure its angle and length."}</p>}
    </>}
    <details><summary>What is being changed?</summary><p className="note">These are temporary changes to activations, after the head’s output projection and before addition to the residual stream. They apply while reading your prompt and writing each new token. The strength control above applies first. No weights are trained by these controls.</p></details>
  </section>;
}
