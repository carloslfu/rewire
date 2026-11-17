// The frame around the 3D stage, shared by Dismantle, Teach and Grow: tools and resets above, the
// stage in the middle, the selected part's real controls beside it. Expanding keeps the same mounted
// stage and only gives it the whole window.
import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import { stageShown } from "../state/actions.ts";
import { store } from "../state/store.ts";
import { onThemeChange } from "../ui/color.ts";
import { useNarrow } from "../ui/useNarrow.ts";
import { type Arch, groupHeads, movePart, type Part, partKey } from "./arch.ts";
import { isolate } from "./isolate.ts";
import { escapeIntent, stageKey } from "./keys.ts";
import { type DockPanel, NavDock } from "./NavDock.tsx";
import type { DragMode, Stage, Tool } from "./scene/stage.ts";
import { readTheme } from "./theme.ts";
import { ViewToggle } from "./ViewToggle.tsx";

const TOOL_NAME: Record<Tool, string> = { explore: "Explore", grab: "Grab", punch: "Punch" };

export interface WorkbenchProps {
  arch: Arch;
  /** False while another bench is on screen. */
  active: boolean;
  eyebrow?: string;
  title: string;
  status?: ReactNode;
  tools: Tool[];
  /** What Punch really does on this bench. */
  punchHelp?: string;
  selected: Part | null;
  onSelect: (part: Part | null) => void;
  /** Run the real edit. Returns whether it was accepted. */
  onPunch: (part: Part) => boolean;
  describe: (part: Part, tool: Tool) => string;
  /** The stage stopped drawing: a hidden tab, scrolled out of sight, or a lost context. */
  onHidden?: () => void;
  onStage: (stage: Stage | null) => void;
  restore?: { label: string; disabled: boolean; run: () => void };
  /** Question or training controls, shown beside the stage in the full view and below it on a phone. */
  rail?: ReactNode;
  railTitle?: string;
  /** Always in sight directly under the stage, in every layout. It does not scroll with the controls below it. */
  bar?: ReactNode;
  transport?: ReactNode;
  children: ReactNode;
}

export function Workbench(p: WorkbenchProps) {
  const { arch, selected } = p;
  const narrow = useNarrow();
  const hint = useId();
  const root = useRef<HTMLDivElement>(null), host = useRef<HTMLDivElement>(null), labels = useRef<HTMLDivElement>(null), tip = useRef<HTMLDivElement>(null);
  const expander = useRef<HTMLButtonElement>(null), lower = useRef<HTMLDivElement>(null);
  const [stage, setStage] = useState<Stage | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "lost">("loading");
  const [generation, setGeneration] = useState(0);
  const [tool, setTool] = useState<Tool>("explore");
  const [expanded, setExpanded] = useState(false);
  const [arranged, setArranged] = useState(0);
  const [drag, setDrag] = useState<DragMode>("turn");
  const [spread, setSpread] = useState(0);
  const [panel, setPanel] = useState<DockPanel>(null);
  // The select whose menu the last Escape closed. A second Escape there closes the full view.
  const escaped = useRef<EventTarget | null>(null);
  // The stage outlives renders; it always calls the newest handlers.
  const latest = useRef(p);
  latest.current = p;

  // A bench that is not on screen holds no WebGL context; its stage is rebuilt when the visitor returns.
  const live = p.active;
  useEffect(() => {
    if (!live) return;
    let cancelled = false, made: Stage | null = null;
    // No WebGL, or the 3D code could not load: the benches fall back to the flat diagrams, which need neither.
    const unavailable = (reason: unknown) => {
      if (cancelled) return;
      console.error("Rewire: the 3D view could not start.", reason);
      store.set({ stage3d: false, scopeView: "2d", replayRequest: null, announce: "The 3D view could not start in this browser. Showing the 2D view." });
    };
    setState("loading");
    setArranged(0);
    setSpread(0);
    import("./scene/stage.ts").then(({ Stage }) => {
      if (cancelled || !host.current || !labels.current || !tip.current) return;
      try {
        made = new Stage({
          host: host.current, labels: labels.current, tip: tip.current, arch, theme: readTheme(),
          reducedMotion: matchMedia("(prefers-reduced-motion: reduce)").matches, coarse: matchMedia("(pointer: coarse)").matches,
          onSelect: (part) => latest.current.onSelect(part),
          onPunch: (part) => latest.current.onPunch(part),
          describe: (part, t) => latest.current.describe(part, t),
          onHidden: () => latest.current.onHidden?.(),
          onArranged: setArranged,
          onLost: () => setState("lost"),
          // The tool buttons and help text float over the stage; labels and the framing keep clear of them.
          reserved: () => {
            const view = host.current;
            if (!view) return [];
            const origin = view.getBoundingClientRect();
            return Array.from(view.querySelectorAll(".stage-toolbar > *, .stage-hint, .stage-crumb, .stage-dock"), (el) => {
              const r = el.getBoundingClientRect();
              return { left: r.left - origin.left, top: r.top - origin.top, width: r.width, height: r.height };
            });
          },
        });
      } catch (e) {
        unavailable(e);
        return;
      }
      setState("ready");
      setStage(made);
      latest.current.onStage(made);
      // Development only: `__rewireStage.info()` reports draw calls and triangles of the last frame.
      if (import.meta.env.DEV) (globalThis as unknown as { __rewireStage: Stage }).__rewireStage = made;
    }, unavailable);
    return () => {
      cancelled = true;
      setStage(null);
      latest.current.onStage(null);
      made?.dispose();
    };
  }, [arch, generation, live]);

  // While a stage is open the engine leaves the GPU room to draw it.
  useEffect(() => {
    if (!stage) return;
    stageShown(true);
    return () => stageShown(false);
  }, [stage]);
  useEffect(() => { stage?.setTool(tool); }, [stage, tool]);
  useEffect(() => { stage?.setSelection(selected); }, [stage, selected]);
  useEffect(() => { stage?.setDragMode(drag); }, [stage, drag]);
  useEffect(() => { stage?.setSpread(spread); }, [stage, spread]);
  // Docked, the controls share one scroll area under the stage: bring a newly selected part's controls into it.
  const selectedKey = selected ? partKey(selected) : "";
  useEffect(() => { if (selectedKey && lower.current) lower.current.scrollTop = 0; }, [selectedKey]);
  // The breadcrumb and the dock change size with the selection and the spread; labels and framing keep clear of them.
  const spreading = spread > 0;
  useEffect(() => { stage?.overlaysChanged(); }, [stage, selectedKey, spreading, expanded, narrow]);
  useEffect(() => stage ? onThemeChange(() => stage.setTheme(readTheme())) : undefined, [stage]);
  useEffect(() => {
    if (!stage) return;
    const motion = matchMedia("(prefers-reduced-motion: reduce)"), follow = () => stage.setReducedMotion(motion.matches);
    motion.addEventListener("change", follow);
    return () => motion.removeEventListener("change", follow);
  }, [stage]);
  // Full view is the foreground: its panel is lifted above the page header and the page behind it goes inert.
  useEffect(() => {
    const bench = root.current;
    if (!expanded || !bench) return;
    const scope = bench.closest(".lab-scope"), release = isolate(bench);
    scope?.classList.add("stage-raised");
    return () => { release(); scope?.classList.remove("stage-raised"); };
  }, [expanded]);
  useEffect(() => { if (!p.active || narrow) setExpanded(false); }, [p.active, narrow]);
  useEffect(() => { if (!p.tools.includes(tool)) setTool("explore"); }, [p.tools, tool]);

  const help: Record<Tool, string> = {
    explore: "Drag to turn the model. Scroll or pinch to zoom. Click a part to select it, and double-click to focus on it.",
    grab: "Drag a part to move it. This rearranges the drawing only. The model does not change.",
    punch: p.punchHelp ?? "",
  };
  const collapse = () => { setExpanded(false); requestAnimationFrame(() => expander.current?.focus()); };

  const frameKeys = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape" && !e.defaultPrevented) {
      // Escape first closes an open dock panel, from anywhere on the bench. Then it belongs to what has
      // focus: it closes an open menu, or steps out of a text field. Only then does it close the full view.
      const from = e.target as HTMLInputElement, intent = escapeIntent(from, escaped.current === from, e.nativeEvent.isComposing, !!panel);
      if (intent === "panel") { e.preventDefault(); escaped.current = null; setPanel(null); return; }
      if (!expanded) return;
      escaped.current = intent === "menu" ? from : null;
      if (intent === "leave") { e.preventDefault(); host.current?.focus(); }
      else if (intent === "close") { e.preventDefault(); collapse(); }
      return;
    }
    escaped.current = null;
    if (!expanded || e.key !== "Tab") return;
    const items = [...e.currentTarget.querySelectorAll<HTMLElement>("button, a[href], input, select, textarea, summary, [tabindex]")]
      .filter((el) => el.tabIndex >= 0 && !el.matches(":disabled") && el.getClientRects().length > 0);
    const first = items[0], last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
  };

  const resetLayout = () => { setSpread(0); stage?.resetLayout(); };

  const stageKeys = (e: React.KeyboardEvent<HTMLDivElement>) => {
    // An open panel takes Escape before the full view does, wherever in the stage the focus is.
    if (e.key === "Escape" && panel) { e.preventDefault(); setPanel(null); return; }
    if (e.target !== e.currentTarget) return;
    // A browser or system shortcut. While its modifier is down the release of Space may never reach
    // the page, so a pan held with Space ends here instead of staying on.
    if (e.altKey || e.metaKey || e.ctrlKey) { stage?.holdPan(false); return; }
    const key = stageKey(e);
    if (!key) return;
    e.preventDefault();
    switch (key.act) {
      case "move": { const next = movePart(arch.model, selected, key.key); if (next) p.onSelect(next); break; }
      case "orbit": stage?.orbit(key.azimuth, key.polar); break;
      case "zoom": stage?.zoom(key.factor); break;
      case "fit": stage?.resetView(); break;
      case "focus": if (selected) stage?.focus(selected); else if (key.orFit) stage?.resetView(); break;
      case "view": stage?.view(key.view); break;
      case "spread": setSpread((now) => (now > 0 ? 0 : 1)); break;
      case "help": setPanel((now) => (now === "help" ? null : "help")); break;
      case "pan": stage?.holdPan(true); break;
      case "punch": if (selected && p.tools.includes("punch")) stage?.react(selected, p.onPunch(selected)); break;
      case "ignore": break;
    }
  };
  const stageKeyUp = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === " " || e.key === "Meta" || e.key === "Control" || e.key === "Alt") stage?.holdPan(false);
  };

  const dock = <NavDock arch={arch} stage={stage} selected={selected} onSelect={p.onSelect} drag={drag} onDrag={setDrag}
    spread={spread} onSpread={setSpread} panel={panel} onPanel={setPanel} punch={p.tools.includes("punch")} />;

  return <div ref={root} className={`stage-bench${expanded ? " expanded" : ""}`} role={expanded ? "dialog" : undefined} aria-modal={expanded || undefined}
    aria-label={expanded ? `${p.title}, full view` : undefined} onKeyDown={frameKeys}>
    <header className="stage-head">
      <div className="stage-title">{p.eyebrow && <p className="eyebrow">{p.eyebrow}</p>}<h2>{p.title}</h2></div>
      <div className="stage-head-actions">
        <ViewToggle />
        {!narrow && <button ref={expander} type="button" className="btn quiet" aria-pressed={expanded} onClick={() => (expanded ? collapse() : setExpanded(true))}>{expanded ? "Close full view" : "Full view"}</button>}
      </div>
    </header>
    {(p.status || p.restore) && <div className="stage-status">
      {p.status}
      {p.restore && <button type="button" className="btn quiet" disabled={p.restore.disabled} onClick={p.restore.run}>{p.restore.label}</button>}
    </div>}
    <div className="stage-main">
      {p.rail && (expanded || narrow) && <aside className="stage-rail" aria-label={p.railTitle}>
        {narrow ? <details><summary>{p.railTitle}</summary>{p.rail}</details> : p.rail}
      </aside>}
      <div className="stage-view" ref={host} tabIndex={0} role="group" aria-describedby={hint} onKeyDown={stageKeys} onKeyUp={stageKeyUp} onBlur={() => stage?.holdPan(false)}
        aria-label={`3D model of ${arch.model.name}: ${arch.floors} layers, each with ${arch.heads} attention heads and one MLP. Arrow keys move between parts.`}>
        <div className="stage-labels" ref={labels} aria-hidden="true" />
        <div className="stage-top">
          <div className="stage-toolbar">
            <div className="seg" role="group" aria-label="Tool">
              {p.tools.map((t) => <button key={t} type="button" aria-pressed={tool === t} onClick={() => setTool(t)}>{TOOL_NAME[t]}</button>)}
            </div>
            <div className="stage-resets">
              <button type="button" className="btn" disabled={!stage || (!arranged && !spread)} title="Put moved parts back and close the spread. The model is not changed." onClick={resetLayout}>Reset layout</button>
            </div>
          </div>
          <p className="stage-hint" id={hint}><strong>{TOOL_NAME[tool]}.</strong> {help[tool]}</p>
        </div>
        {!narrow && dock}
        <div className="stage-tip" ref={tip} aria-hidden="true" hidden />
        {state === "loading" && <p className="stage-state" role="status">Opening the 3D model…</p>}
        {state === "lost" && <div className="stage-state" role="alert">
          <p>The 3D view stopped drawing. The model and your changes are not affected.</p>
          <div className="row"><button type="button" className="btn" onClick={() => setGeneration((g) => g + 1)}>Reload 3D view</button>
            <button type="button" className="btn quiet" onClick={() => store.set({ scopeView: "2d", replayRequest: null })}>Use the 2D view</button></div>
        </div>}
      </div>
      {p.bar && <div className="stage-bar">{p.bar}</div>}
      {narrow && <div className="stage-dockbar">{dock}</div>}
      <div className="stage-lower" ref={lower}>
        <div className="stage-controls">
          <PartPicker arch={arch} selected={selected} onSelect={p.onSelect} />
          {p.transport}
        </div>
        <aside className="stage-side" aria-label="Selected part and experiments">{p.children}</aside>
      </div>
    </div>
  </div>;
}

/** The same selection the pointer makes, as two ordinary menus. */
function PartPicker({ arch, selected, onSelect }: { arch: Arch; selected: Part | null; onSelect: (part: Part | null) => void }) {
  const id = useId();
  const where = !selected ? "" : selected.kind === "embed" ? "in" : selected.kind === "unembed" || selected.kind === "norm" ? "out" : String(selected.floor);
  const floor = selected && "floor" in selected ? selected.floor : -1;
  const which = !selected || !("floor" in selected) ? "" : selected.kind === "layer" ? "layer" : selected.kind === "mlp" ? "mlp" : selected.kind === "kv" ? `k${selected.group}` : `h${selected.head}`;
  const pickPart = (v: string) => onSelect(v === "layer" ? { kind: "layer", floor } : v === "mlp" ? { kind: "mlp", floor }
    : v[0] === "k" ? { kind: "kv", floor, group: Number(v.slice(1)) } : { kind: "head", floor, head: Number(v.slice(1)) });
  return <div className="stage-picker">
    <label htmlFor={`${id}-where`}>Select</label>
    <select id={`${id}-where`} value={where} onChange={(e) => {
      const v = e.target.value;
      onSelect(v === "" ? null : v === "in" ? { kind: "embed" } : v === "out" ? { kind: "unembed" } : { kind: "layer", floor: Number(v) });
    }}>
      <option value="">Nothing</option>
      <option value="out">Words out</option>
      {Array.from({ length: arch.floors }, (_, i) => arch.floors - 1 - i).map((L) => <option key={L} value={L}>Layer {L + 1}</option>)}
      <option value="in">Words in</option>
    </select>
    {floor >= 0 && <select aria-label={`Part of layer ${floor + 1}`} value={which} onChange={(e) => pickPart(e.target.value)}>
      <option value="layer">Whole layer</option>
      {Array.from({ length: arch.heads }, (_, h) => <option key={h} value={`h${h}`}>Attention head {h + 1}</option>)}
      <option value="mlp">MLP</option>
      {Array.from({ length: arch.kvHeads }, (_, g) => { const hs = groupHeads(arch.model, g); return <option key={g} value={`k${g}`}>Keys and values of heads {hs[0] + 1} to {hs[hs.length - 1] + 1}</option>; })}
    </select>}
  </div>;
}

/** What in the picture is measured and what is only a way of drawing it. */
export function RealNote({ real, drawing, punch = false }: { real: string; drawing: string; punch?: boolean }) {
  return <details className="stage-real">
    <summary>What is real in this picture?</summary>
    <p className="note"><strong>Real.</strong> {real}</p>
    <p className="note"><strong>A drawing.</strong> {drawing}</p>
    <p className="note">The metal, ceramic, glass, screws, contacts and studio lighting are part of the drawing too. No shape stands for real hardware or for an individual parameter. A window is lit only by a measurement; a dark window has none.</p>
    <p className="note">Keyboard, with the model focused: arrow keys move between parts, F or Enter focuses the selected part, Home or 0 fits the whole model{punch ? ", P punches the selected part" : ""}, Shift with the arrows turns the model, and plus and minus zoom. The ? button on the stage lists every control.</p>
  </details>;
}
