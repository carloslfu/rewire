// The numeric inspector the three benches share. Pick a matrix by name, then read any one of its
// numbers exactly, by row and column. Every control is an ordinary input or button, so the keyboard
// and a finger reach the same numbers a pointer does. The plates on the stage pool many numbers into
// a tile; nothing here is pooled.
import { type ReactNode, useEffect, useId, useMemo, useRef, useState } from "react";
import { ink, signed } from "../ui/color.ts";
import { type CellRef, defaultCell, exact, type Matrix, matrixStats } from "./matrices.ts";

/** Rows and columns of exact numbers shown around the one being read. */
const WINDOW = 5;
const n = (x: number) => x.toLocaleString("en-US");
const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
/** The page's blue-to-orange colors for a value already scaled to [-1, 1], with the same curve as everywhere else. In CSS, so it follows the theme. */
const tint = (t: number) => `color-mix(in oklab, var(${t < 0 ? "--neg" : "--pos"}) ${Math.round(Math.min(1, Math.abs(t)) ** 0.7 * 100)}%, var(--zero))`;
const brief = (v: number) => (!Number.isFinite(v) ? signed(v) : v === 0 ? "0" : signed(v, Math.abs(v) >= 10 ? 2 : 4));

/** The number to read: the chosen one while its matrix is offered and has it, otherwise where `preferred` (or the first matrix) moved or weighs the most. */
export function resolveCell(matrices: Matrix[], chosen: CellRef | null, preferred?: string): CellRef | null {
  const m = matrices.find((x) => x.id === chosen?.id) ?? matrices.find((x) => x.id === preferred) ?? matrices[0];
  if (!m) return null;
  return chosen && chosen.id === m.id && Number.isInteger(chosen.index) && chosen.index >= 0 && chosen.index < m.rows * m.cols ? chosen : { id: m.id, index: defaultCell(m) };
}

/** The number being read on a bench, and the way to choose another. An index below zero asks for a matrix's default number. */
export function useCell(matrices: Matrix[], preferred?: string) {
  const [chosen, setChosen] = useState<CellRef | null>(null);
  const cell = useMemo(() => resolveCell(matrices, chosen, preferred), [matrices, chosen, preferred]);
  return [cell, setChosen, chosen] as const;
}

export function MatrixInspector({ matrices, cell, onCell, heading, empty, difference = false, onLook, children }: {
  matrices: Matrix[];
  /** From `useCell`: always a number of one of `matrices`, or null when there are none. */
  cell: CellRef | null;
  onCell: (cell: CellRef) => void;
  heading: string;
  /** Said in place of the inspector while there is nothing to read. */
  empty: string;
  /** The plates on the stage show change since the start. The numbers around the one being read follow them. */
  difference?: boolean;
  /** Turn the camera to the plates. */
  onLook?: () => void;
  children?: ReactNode;
}) {
  const id = useId();
  const grid = useRef<HTMLTableElement>(null), follow = useRef(false);
  const m = matrices.find((x) => x.id === cell?.id);
  const stats = useMemo(() => (m ? matrixStats(m) : null), [m]);
  const index = m && cell ? cell.index : -1;
  // The keyboard moves the number being read, and the focus stays on it as the window moves under it.
  useEffect(() => {
    if (!follow.current) return;
    follow.current = false;
    grid.current?.querySelector<HTMLElement>('[aria-current="true"]')?.focus();
  }, [index, m?.id]);
  if (!m || !stats || !cell) return <section className="matrix-inspector" aria-labelledby={`${id}-h`}>
    <h3 id={`${id}-h`}>{heading}</h3>
    <p className="note">{empty}</p>
    {children}
  </section>;

  const row = Math.floor(index / m.cols), col = index % m.cols;
  const go = (r: number, c: number) => onCell({ id: m.id, index: Math.max(0, Math.min(m.rows - 1, r)) * m.cols + Math.max(0, Math.min(m.cols - 1, c)) });
  const now = m.values[index], before = m.start?.[index];
  const moved = !!m.start && difference;
  const shown = (i: number) => (moved ? m.values[i] - m.start![i] : m.values[i]);
  const scale = (moved ? stats.change?.max : stats.now.max) || 1;
  const R = Math.min(WINDOW, m.rows), C = Math.min(WINDOW, m.cols);
  const r0 = Math.max(0, Math.min(m.rows - R, row - Math.floor(R / 2))), c0 = Math.max(0, Math.min(m.cols - C, col - Math.floor(C / 2)));
  const name = m.cell(row, col);
  const keys = (e: React.KeyboardEvent) => {
    const step: Record<string, [number, number]> = { ArrowUp: [row - 1, col], ArrowDown: [row + 1, col], ArrowLeft: [row, col - 1], ArrowRight: [row, col + 1],
      Home: [row, 0], End: [row, m.cols - 1], PageUp: [row - WINDOW, col], PageDown: [row + WINDOW, col] };
    const to = step[e.key];
    if (!to || e.altKey || e.metaKey || e.ctrlKey) return;
    e.preventDefault();
    follow.current = true;
    go(to[0], to[1]);
  };
  const spoken = `${name}: ${m.start ? `now ${exact(now)}, at the start ${exact(before!)}, change ${exact(now - before!)}` : exact(now)}`;

  return <section className="matrix-inspector" aria-labelledby={`${id}-h`}>
    <div className="section-heading"><h3 id={`${id}-h`}>{heading}</h3>
      {onLook && <button type="button" className="btn quiet" onClick={onLook}>Show on the model</button>}</div>
    <div className="matrix-pick"><label htmlFor={`${id}-m`}>Matrix</label>
      <select id={`${id}-m`} value={m.id} onChange={(e) => onCell({ id: e.target.value, index: -1 })}>
        {matrices.map((x) => <option key={x.id} value={x.id}>{x.group ? `${x.group} · ${x.name}` : x.name}</option>)}
      </select></div>
    <p className="note">{m.detail}</p>
    <div className="matrix-axes">
      {m.rows > 1 && <Axis name={m.axes[0]} value={row} first={m.first[0]} size={m.rows} onChange={(v) => go(v, col)} />}
      {m.cols > 1 && <Axis name={m.axes[1]} value={col} first={m.first[1]} size={m.cols} onChange={(v) => go(row, v)} />}
    </div>
    <div className="matrix-jumps" role="group" aria-label="Go to">
      {stats.change && <button type="button" className="btn quiet" disabled={stats.change.at < 0 || stats.change.max === 0} title={`The ${m.unit} of this matrix that moved the most since the start`}
        onClick={() => onCell({ id: m.id, index: stats.change!.at })}>Largest change</button>}
      <button type="button" className="btn quiet" disabled={stats.now.at < 0} title={`The largest ${m.unit} of this matrix, by magnitude`} onClick={() => onCell({ id: m.id, index: stats.now.at })}>Largest {m.unit}</button>
    </div>
    <div className="matrix-reading">
      <p className="matrix-cell-name num">{name}</p>
      <dl className="kv">
        {m.start ? <><dt>Now</dt><dd className="num">{exact(now)}</dd><dt>At the start</dt><dd className="num">{exact(before!)}</dd><dt>Change</dt><dd className="num changed-text">{exact(now - before!)}</dd></>
          : <><dt>{capital(m.unit)}</dt><dd className="num">{exact(now)}</dd></>}
      </dl>
      <p className="sr-only" aria-live="polite">{spoken}</p>
    </div>
    <table className="matrix-window" ref={grid} onKeyDown={keys}
      aria-label={`Exact ${moved ? "changes since the start" : `${m.unit}s`} around ${name}. Arrow keys move one number at a time; Page Up and Page Down move ${WINDOW} rows.`}>
      <caption>{moved ? "Change since the start" : m.start ? `${capital(m.unit)}s now` : `${capital(m.unit)}s`}, around the one being read</caption>
      <thead><tr><td />{Array.from({ length: C }, (_, k) => <th key={k} scope="col">{m.cols > 1 ? n(c0 + k + m.first[1]) : ""}</th>)}</tr></thead>
      <tbody>{Array.from({ length: R }, (_, j) => <tr key={j}>
        <th scope="row">{m.rows > 1 ? n(r0 + j + m.first[0]) : ""}</th>
        {Array.from({ length: C }, (_, k) => {
          const r = r0 + j, c = c0 + k, i = r * m.cols + c, v = shown(i), here = i === index, t = Number.isFinite(v) ? Math.max(-1, Math.min(1, v / scale)) : 0;
          return <td key={k}><button type="button" className="matrix-cell num" aria-current={here ? "true" : undefined} tabIndex={here ? 0 : -1}
            aria-label={`${m.cell(r, c)}: ${exact(v)}`} style={{ background: tint(t), color: ink(t) }}
            onClick={() => { follow.current = true; go(r, c); }}>{brief(v)}</button></td>;
        })}
      </tr>)}</tbody>
    </table>
    <dl className="weight-metrics">
      {stats.change ? <>
        <div><dt>{capital(m.unit)}s changed</dt><dd>{n(stats.change.changed)} of {n(stats.count)}</dd></div>
        <div><dt>RMS change</dt><dd>{stats.change.rms.toFixed(5)}</dd></div>
        <div><dt>Largest change</dt><dd>{stats.change.max.toFixed(5)}</dd></div>
      </> : <>
        <div><dt>{capital(m.unit)}s</dt><dd>{n(stats.count)}</dd></div>
        <div><dt>RMS size</dt><dd>{stats.now.rms.toFixed(5)}</dd></div>
        <div><dt>Largest size</dt><dd>{stats.now.max.toFixed(5)}</dd></div>
      </>}
    </dl>
    <p className="note">This matrix{stats.change ? ` now: RMS size ${stats.now.rms.toFixed(5)}, largest ${stats.now.max.toFixed(5)}` : " only"}.
      {stats.unavailable > 0 ? ` ${n(stats.unavailable)} of its numbers are not finite and are left out of these sizes.` : ""} Blue is negative and orange is positive, on this matrix’s own scale.</p>
    {children}
  </section>;
}

/** One coordinate: a number field for typing it, and a step either way for a finger. */
function Axis({ name, value, first, size, onChange }: { name: string; value: number; first: number; size: number; onChange: (v: number) => void }) {
  const id = useId();
  // What is being typed, while it is not yet a number of this axis.
  const [text, setText] = useState<string | null>(null);
  useEffect(() => setText(null), [value]);
  const last = first + size - 1;
  const step = (to: number) => { setText(null); onChange(to); };
  return <div className="matrix-axis">
    <label htmlFor={id}>{capital(name)} <span className="note">{n(first)} to {n(last)}</span></label>
    <div className="matrix-step">
      <button type="button" className="btn" aria-label={`Previous ${name}`} disabled={value <= 0} onClick={() => step(value - 1)}>‹</button>
      <input id={id} type="number" inputMode="numeric" min={first} max={last} step={1} value={text ?? value + first}
        onChange={(e) => {
          const v = Number(e.target.value);
          if (e.target.value.trim() !== "" && Number.isInteger(v) && v >= first && v <= last) step(v - first);
          else setText(e.target.value);
        }} onBlur={() => setText(null)} />
      <button type="button" className="btn" aria-label={`Next ${name}`} disabled={value >= size - 1} onClick={() => step(value + 1)}>›</button>
    </div>
  </div>;
}
