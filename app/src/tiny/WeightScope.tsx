import { useMemo, useState } from "react";
import { layout, TINY } from "@rewire/tiny/src/config.ts";
import { VOCAB } from "@rewire/tiny/src/data.ts";
import { weightStats } from "@rewire/tiny/src/lab.ts";
import { Strip } from "../ui/Strip.tsx";

const tensors = layout({ ...TINY, vocab: VOCAB }).tensors;

export function WeightScope({ params, reference, step, running, mutated }: {
  params: Float32Array | null; reference: Float32Array | null; step: number; running: boolean; mutated: boolean;
}) {
  const [selected, setSelected] = useState("f0.down");
  const [difference, setDifference] = useState(true);
  const tensor = tensors.find((t) => t.name === selected)!;
  const stats = useMemo(() => params && reference ? weightStats(params, reference) : null, [params, reference]);
  const layerStats = useMemo(() => new Map(tensors.map((t) => [t.name, params && reference ? weightStats(params.subarray(t.offset, t.offset + t.size), reference.subarray(t.offset, t.offset + t.size)) : null])), [params, reference]);
  const values = useMemo(() => {
    if (!params) return new Float32Array(tensor.size);
    const v = params.slice(tensor.offset, tensor.offset + tensor.size);
    if (difference && reference) for (let i = 0; i < v.length; i++) v[i] -= reference[tensor.offset + i];
    return v;
  }, [params, reference, tensor, difference]);
  return <div className="weight-scope">
    <div className="scope-title"><div><p className="eyebrow">Live weights</p><h2>{mutated ? "Under the knife" : running ? "A brain taking shape" : params ? "Your specimen" : "Waiting for its first lesson"}</h2></div><span className="num">{step.toLocaleString()} steps</span></div>
    <p className="note">4 transformer layers · {layout({ ...TINY, vocab: VOCAB }).total.toLocaleString()} trainable numbers</p>
    <div className="weight-layers" aria-label="Choose a layer to inspect">
      {[0, 1, 2, 3].map((floor) => <button key={floor} type="button" aria-pressed={selected.startsWith(`f${floor}.`)} onClick={() => setSelected(`f${floor}.down`)}>
        <span>Layer {floor + 1}</span><span className="weight-trace" aria-hidden="true">{["q", "k", "v", "o", "gate", "up", "down"].map((name) => {
          const t = tensors.find((x) => x.name === `f${floor}.${name}`)!;
          const stats = layerStats.get(t.name);
          return <i key={name} title={stats ? `${name}: RMS change ${stats.rms.toFixed(5)}` : `${name}: waiting for weights`} style={{ opacity: params ? Math.min(1, 0.15 + (stats?.rms ?? 0) * 12) : 0.12 }} />;
        })}</span>
      </button>)}
    </div>
    <div className="scope-settings"><label htmlFor="weight-matrix">Matrix</label><select id="weight-matrix" value={selected} onChange={(e) => setSelected(e.target.value)}>
      {tensors.filter((t) => t.shape.length === 2).map((t) => <option value={t.name} key={t.name}>{t.name === "dict" ? "Letter embeddings" : `Layer ${Number(t.name[1]) + 1} · ${t.name.split(".")[1]}`}</option>)}
    </select></div>
    <div className="seg" aria-label="Weight map" role="group"><button aria-pressed={difference} onClick={() => setDifference(true)}>Change since start</button><button aria-pressed={!difference} onClick={() => setDifference(false)}>Weights now</button></div>
    <div className="weight-image">{params ? <Strip values={values} rows={tensor.shape[0]} height={160} label={difference ? "Actual weight updates" : "Actual weights"} /> : <div className="weight-placeholder">The weight map appears when you start learning.</div>}</div>
    <p className="note">Every pixel is one weight. Blue is negative, orange is positive. Hover to read it. The color scale follows the values.</p>
    <dl className="weight-metrics"><div><dt>Weights changed</dt><dd>{stats ? stats.changed.toLocaleString() : "Waiting"}</dd></div><div><dt>RMS change</dt><dd>{stats?.rms.toFixed(5) ?? "Waiting"}</dd></div><div><dt>Largest change</dt><dd>{stats?.max.toFixed(5) ?? "Waiting"}</dd></div></dl>
    <p className="scope-footnote">Measured from the parameter arrays used for inference. Training updates all layers by backpropagation. Snapshots arrive every 100 steps.</p>
  </div>;
}
