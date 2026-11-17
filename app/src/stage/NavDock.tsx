// Finding your way around the 3D model: a breadcrumb that says where you are and steps through the
// layers, and a small dock with the camera's named actions. Everything here moves the view or the
// drawing. Nothing here changes the model.
import { type ReactNode, useId } from "react";
import { type Arch, groupHeads, movePart, type Part } from "./arch.ts";
import type { DragMode, Stage, ViewName } from "./scene/stage.ts";

export type DockPanel = "views" | "help" | null;

const VIEW_NAMES: [ViewName, string, string][] = [["home", "Three-quarter", "1"], ["front", "Front", "2"], ["side", "Side", "3"], ["top", "Top", "4"]];

const ICONS: Record<string, ReactNode> = {
  fit: <path d="M2 6V2h4M10 2h4v4M14 10v4h-4M6 14H2v-4" />,
  focus: <><circle cx="8" cy="8" r="3.2" /><path d="M8 1v2.5M8 12.5V15M1 8h2.5M12.5 8H15" /></>,
  out: <path d="M3 8h10" />,
  in: <path d="M3 8h10M8 3v10" />,
  pan: <path d="M8 2v12M2 8h12M6 4l2-2 2 2M6 12l2 2 2-2M4 6L2 8l2 2M12 6l2 2-2 2" />,
  spread: <path d="M3 8h10M3 5h10M3 11h10M6.4 2.6L8 1l1.6 1.6M6.4 13.4L8 15l1.6-1.6" />,
  views: <path d="M8 1.8l5.4 3.1v6.2L8 14.2l-5.4-3.1V4.9zM8 8l5.4-3.1M8 8L2.6 4.9M8 8v6.2" />,
  up: <path d="M4 10l4-4 4 4" />,
  down: <path d="M4 6l4 4 4-4" />,
};

function Icon({ name }: { name: keyof typeof ICONS }) {
  return <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{ICONS[name]}</svg>;
}

/** A short name for a part inside its layer. */
function leafName(arch: Arch, p: Part): string {
  switch (p.kind) {
    case "head": return `Head ${p.head + 1}`;
    case "mlp": return "MLP";
    case "kv": { const hs = groupHeads(arch.model, p.group); return `Keys and values ${hs[0] + 1}–${hs[hs.length - 1] + 1}`; }
    case "embed": return "Words in";
    case "norm": return "Final normalization";
    case "unembed": return "Words out";
    default: return "";
  }
}

export interface NavDockProps {
  arch: Arch;
  stage: Stage | null;
  selected: Part | null;
  onSelect: (part: Part | null) => void;
  drag: DragMode;
  onDrag: (mode: DragMode) => void;
  spread: number;
  onSpread: (amount: number) => void;
  panel: DockPanel;
  onPanel: (panel: DockPanel) => void;
  /** Whether this bench has Punch, for the help text. */
  punch: boolean;
}

export function NavDock({ arch, stage, selected, onSelect, drag, onDrag, spread, onSpread, panel, onPanel, punch }: NavDockProps) {
  const id = useId();
  const floor = selected && "floor" in selected ? selected.floor : -1;
  const leaf = selected && selected.kind !== "layer" ? leafName(arch, selected) : "";
  const above = movePart(arch.model, selected, "ArrowUp"), below = movePart(arch.model, selected, "ArrowDown");
  const home = () => { onSelect(null); stage?.resetView(); };
  // `short` is the word shown under the icon where there is no pointer to hover with.
  const act = (short: string, label: string, key: string, icon: keyof typeof ICONS, run: () => void, extra: { disabled?: boolean; pressed?: boolean } = {}) =>
    <button type="button" className="dock-btn" aria-label={label} data-tip={key ? `${label} · ${key}` : label} aria-pressed={extra.pressed} disabled={!stage || extra.disabled} onClick={run}>
      <Icon name={icon} /><span className="dock-word" aria-hidden="true">{short}</span></button>;

  return <div className="stage-bottom">
    <nav className="stage-crumb" aria-label="Where you are in the model">
      <button type="button" className="crumb" aria-current={selected ? undefined : "location"} disabled={!stage && !selected} onClick={home}>Model</button>
      {floor >= 0 && <><span className="crumb-sep" aria-hidden="true">›</span>
        <button type="button" className="crumb" aria-current={leaf ? undefined : "location"} onClick={() => onSelect({ kind: "layer", floor })}>Layer {floor + 1}</button></>}
      {leaf && <><span className="crumb-sep" aria-hidden="true">›</span><span className="crumb here" aria-current="location">{leaf}</span></>}
      <span className="crumb-steps" role="group" aria-label="Step through the layers">
        <button type="button" className="dock-btn" aria-label="Down one layer" data-tip="Down one layer · ↓" disabled={!below} onClick={() => below && onSelect(below)}><Icon name="down" /></button>
        <button type="button" className="dock-btn" aria-label="Up one layer" data-tip="Up one layer · ↑" disabled={!above} onClick={() => above && onSelect(above)}><Icon name="up" /></button>
      </span>
    </nav>
    <div className="stage-dock" role="toolbar" aria-label="Camera and layout">
      {act("Fit", "Fit the whole model", "Home", "fit", () => stage?.resetView())}
      {act("Focus", "Focus on the selected part", "F", "focus", () => selected && stage?.focus(selected), { disabled: !selected })}
      <span className="dock-sep" aria-hidden="true" />
      {act("Zoom out", "Zoom out", "−", "out", () => stage?.zoom(1.3))}
      {act("Zoom in", "Zoom in", "+", "in", () => stage?.zoom(1 / 1.3))}
      <span className="dock-sep" aria-hidden="true" />
      {act("Pan", "Pan: drags slide the view and clicks do nothing", "hold Space", "pan", () => onDrag(drag === "pan" ? "turn" : "pan"), { pressed: drag === "pan" })}
      {act("Spread", "Spread the layers apart", "E", "spread", () => onSpread(spread > 0 ? 0 : 1), { pressed: spread > 0 })}
      <span className="dock-sep" aria-hidden="true" />
      <button type="button" className="dock-btn" aria-label="Views" data-tip="Views" aria-expanded={panel === "views"} aria-controls={`${id}-views`} disabled={!stage} onClick={() => onPanel(panel === "views" ? null : "views")}><Icon name="views" /><span className="dock-word" aria-hidden="true">Views</span></button>
      <button type="button" className="dock-btn" aria-label="How to move around the model" data-tip="Controls · ?" aria-expanded={panel === "help"} aria-controls={`${id}-help`} onClick={() => onPanel(panel === "help" ? null : "help")}><span className="dock-glyph" aria-hidden="true">?</span><span className="dock-word" aria-hidden="true">Help</span></button>
      {spread > 0 && <label className="dock-range"><span className="dock-word">Spread</span>
        <input type="range" aria-label="How far the layers are spread" min={0.1} max={1} step={0.05} value={spread} onChange={(e) => onSpread(Number(e.target.value))} /></label>}
    </div>
    {panel === "views" && <div className="stage-pop" id={`${id}-views`} role="group" aria-label="Look from">
      <p className="pop-title">Look from</p>
      <div className="pop-views">
        {VIEW_NAMES.map(([name, label, key]) => <button key={name} type="button" className="btn" onClick={() => stage?.view(name)}>{label}<kbd>{key}</kbd></button>)}
      </div>
      <p className="note">Views turn around the part in focus, or the whole model after Fit.</p>
    </div>}
    {panel === "help" && <div className="stage-pop help" id={`${id}-help`} role="region" aria-label="How to move around the model">
      <dl>
        <dt>Mouse</dt>
        <dd>Drag to turn. Scroll to zoom toward the pointer. Drag with the right button, or with Shift, to pan. Double-click a part to focus on it, and the backdrop to fit the whole model.</dd>
        <dt>Trackpad</dt>
        <dd>Two-finger scroll or pinch to zoom. Shift-drag, or hold Space and drag, to pan.</dd>
        <dt>Touch</dt>
        <dd>One finger turns. Pinch to zoom, and move two fingers to pan. Tap to select, double-tap to focus.</dd>
        <dt>Keyboard</dt>
        <dd>With the model focused: arrows move between parts, Shift with arrows turns the model, <kbd>+</kbd> <kbd>−</kbd> zoom, <kbd>F</kbd> focuses the selected part, <kbd>Home</kbd> or <kbd>0</kbd> fits the model, <kbd>1</kbd> to <kbd>4</kbd> pick a view, <kbd>E</kbd> spreads the layers{punch ? <>, <kbd>P</kbd> punches the selected part</> : null}.</dd>
      </dl>
      <p className="note">Turning, panning, Spread and Grab only move the picture. While Pan is on, clicks select and change nothing. {punch ? "Only Punch and the controls beside the stage change the model." : "Nothing on the stage changes the model."}</p>
    </div>}
  </div>;
}
