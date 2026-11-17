// The frame around the 3D stage, shared by Dismantle, Teach and Grow: tools and resets above, the
// stage in the middle, the selected part's real controls beside it. Full screen keeps the same mounted
// stage and gives it the whole screen: its controls float over it, and the question and the selected
// part are panels that stay closed until they are asked for.
import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import { stageShown } from "../state/actions.ts";
import { store } from "../state/store.ts";
import { onThemeChange } from "../ui/color.ts";
import { useNarrow } from "../ui/useNarrow.ts";
import { type Arch, groupHeads, movePart, type Part, partKey } from "./arch.ts";
import { Immersive, nativeScreen } from "./immersive.ts";
import { isolate } from "./isolate.ts";
import { escapeIntent, stageKey } from "./keys.ts";
import { type DockPanel, NavDock } from "./NavDock.tsx";
import type { DragMode, Stage, Tool } from "./scene/stage.ts";
import { readTheme } from "./theme.ts";
import { ViewToggle } from "./ViewToggle.tsx";

const TOOL_NAME: Record<Tool, string> = { explore: "Explore", grab: "Grab", punch: "Punch" };
const SIDE_TITLE = "Selected part and experiments";

type Overlay = "rail" | "side" | "camera";
const NONE: Overlay[] = [];

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
  /** The question or the lesson. A panel over the stage in full screen, and below the stage on a phone. */
  rail?: ReactNode;
  railTitle?: string;
  /** The word on the button that opens the rail in full screen. */
  railName?: string;
  /** Always in sight directly under the stage, in every layout. It does not scroll with the controls below it. */
  bar?: ReactNode;
  /** Along the bottom in full screen on a bench with no `bar`: the training controls, whose docked copy is then in a closed panel. */
  immersiveBar?: ReactNode;
  transport?: ReactNode;
  children: ReactNode;
}

export function Workbench(p: WorkbenchProps) {
  const { arch, selected } = p;
  const narrow = useNarrow();
  const hint = useId(), id = useId();
  const root = useRef<HTMLDivElement>(null), host = useRef<HTMLDivElement>(null), labels = useRef<HTMLDivElement>(null), tip = useRef<HTMLDivElement>(null);
  const expander = useRef<HTMLButtonElement>(null), lower = useRef<HTMLDivElement>(null);
  const head = useRef<HTMLElement>(null), foot = useRef<HTMLDivElement>(null), railEl = useRef<HTMLElement>(null);
  const cameraEl = useRef<HTMLElement>(null), cameraToggle = useRef<HTMLButtonElement>(null);
  const railToggle = useRef<HTMLButtonElement>(null), sideToggle = useRef<HTMLButtonElement>(null);
  const [stage, setStage] = useState<Stage | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "lost">("loading");
  const [generation, setGeneration] = useState(0);
  const [tool, setTool] = useState<Tool>("explore");
  const [immersive, setImmersive] = useState(false);
  // The panels open over the stage, in the order they were opened. Every full screen starts with none.
  const [overlays, setOverlays] = useState<Overlay[]>(NONE);
  const [arranged, setArranged] = useState(0);
  const [drag, setDrag] = useState<DragMode>("turn");
  const [spread, setSpread] = useState(0);
  const [panel, setPanel] = useState<DockPanel>(null);
  // The select whose menu the last Escape closed. A second Escape there moves on.
  const escaped = useRef<EventTarget | null>(null);
  // The stage outlives renders; it always calls the newest handlers.
  const latest = useRef(p);
  latest.current = p;
  const open = immersive ? overlays : NONE, railOpen = open.includes("rail"), sideOpen = open.includes("side");

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
          // In full screen the title, the exit and the bar along the bottom float over it too.
          reserved: () => {
            const view = host.current, bench = root.current;
            if (!view) return [];
            const origin = view.getBoundingClientRect();
            const floating = [...view.querySelectorAll(".stage-toolbar > *, .stage-caption, .stage-hint, .stage-crumb, .stage-dock"),
              ...(bench?.classList.contains("immersive") ? bench.querySelectorAll(".stage-head > *, .stage-bar") : [])];
            return floating.flatMap((el) => {
              const r = el.getBoundingClientRect();
              return r.width > 0 && r.height > 0 ? [{ left: r.left - origin.left, top: r.top - origin.top, width: r.width, height: r.height }] : [];
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
  // In full screen the floating controls sit clear of the title above and the bar below, whatever height those take.
  useEffect(() => {
    const bench = root.current;
    if (!immersive || !bench) return;
    const measure = () => {
      bench.style.setProperty("--head", `${head.current?.offsetHeight ?? 0}px`);
      bench.style.setProperty("--foot", `${foot.current?.offsetHeight ?? 0}px`);
      stage?.overlaysChanged();
    };
    const sizes = new ResizeObserver(measure);
    for (const el of [head.current, foot.current]) if (el) sizes.observe(el);
    measure();
    return () => { sizes.disconnect(); bench.style.removeProperty("--head"); bench.style.removeProperty("--foot"); };
  }, [immersive, stage]);
  // The breadcrumb and the dock change size with the selection and the spread; labels and framing keep clear of them.
  const spreading = spread > 0;
  // In full screen on a phone, Reset layout is on the toolbar only while there is something to reset.
  const resettable = immersive && narrow && arranged > 0;
  useEffect(() => { stage?.overlaysChanged(); }, [stage, selectedKey, spreading, immersive, narrow, railOpen, sideOpen, resettable]);
  // A panel open beside the stage covers one edge of it: the model is framed in what stays clear. On a
  // phone a panel covers the whole stage, and the framing is left alone.
  useEffect(() => {
    const view = host.current?.getBoundingClientRect();
    if (!stage || !view) return;
    const beside = (el: HTMLElement | null, shown: boolean) => (shown && !narrow ? el?.getBoundingClientRect() : undefined);
    const left = beside(railEl.current, railOpen), right = beside(lower.current, sideOpen);
    stage.setCover(left ? left.right - view.left : 0, right ? view.right - right.left : 0);
  }, [stage, narrow, railOpen, sideOpen]);
  useEffect(() => stage ? onThemeChange(() => stage.setTheme(readTheme())) : undefined, [stage]);
  useEffect(() => {
    if (!stage) return;
    const motion = matchMedia("(prefers-reduced-motion: reduce)"), follow = () => stage.setReducedMotion(motion.matches);
    motion.addEventListener("change", follow);
    return () => motion.removeEventListener("change", follow);
  }, [stage]);

  const leave = () => {
    screen.current?.exit();
    setImmersive(false);
    requestAnimationFrame(() => expander.current?.focus());
  };
  // The browser's own full screen, on top of the viewport one. When the browser ends it by its own
  // means (its Escape, a gesture), the full screen view closes with it.
  const screen = useRef<ReturnType<typeof nativeScreen> | null>(null), left = useRef(leave);
  left.current = leave;
  useEffect(() => {
    if (!root.current) return;
    const made = screen.current = nativeScreen(root.current, () => left.current());
    return () => { made.exit(); made.dispose(); screen.current = null; };
  }, []);
  // Asked for inside the click itself, as browsers require. A refusal leaves the viewport view, which needs no permission.
  const enter = () => {
    if (!p.active) return;
    screen.current?.enter();
    setOverlays(NONE);
    setImmersive(true);
  };
  useEffect(() => { if (!p.active) setImmersive(false); }, [p.active]);
  useEffect(() => { if (!immersive) screen.current?.exit(); }, [immersive]);
  // Full screen is the foreground: its panel is lifted above the page header and the page behind it goes inert.
  useEffect(() => {
    const bench = root.current;
    if (!immersive || !bench) return;
    const scope = bench.closest(".lab-scope"), release = isolate(bench);
    scope?.classList.add("stage-raised");
    return () => { release(); scope?.classList.remove("stage-raised"); };
  }, [immersive]);
  useEffect(() => { if (!p.tools.includes(tool)) setTool("explore"); }, [p.tools, tool]);

  const help: Record<Tool, string> = {
    explore: "Drag to turn the model. Scroll or pinch to zoom. Click a part to select it, and double-click to focus on it.",
    grab: "Drag a part to move it. This rearranges the drawing only. The model does not change.",
    punch: p.punchHelp ?? "",
  };

  const panelRefs = { rail: railEl, side: lower, camera: cameraEl };
  const toggleRefs = { rail: railToggle, side: sideToggle, camera: cameraToggle };
  const closeOverlay = (which: Overlay) => {
    // The focus goes back to the button that opened the panel, never to nothing.
    if (panelRefs[which].current?.contains(document.activeElement)) toggleRefs[which].current?.focus();
    if (which === "camera") setPanel(null);
    setOverlays((now) => now.filter((o) => o !== which));
  };
  const toggleOverlay = (which: Overlay) => {
    if (open.includes(which)) { closeOverlay(which); return; }
    if (narrow) setPanel(null);
    // A phone has room for one panel at a time.
    setOverlays((now) => (narrow ? [which] : [...now, which]));
    requestAnimationFrame(() => panelRefs[which].current?.querySelector<HTMLElement>(".stage-panel-head button")?.focus());
  };

  /**
   * One press of Escape, from the element that has the focus. An open dock panel closes first, from
   * anywhere on the bench. In full screen the press then belongs to what has the focus (an open menu,
   * a text field), then to an open panel over the stage, and only then to full screen itself.
   * False when the press is not ours: the browser's or the input method's.
   */
  const pressEscape = (from: HTMLElement, composing: boolean): boolean => {
    const intent = escapeIntent(from, escaped.current === from, composing, !!panel, open.length > 0);
    if (intent === "panel") { escaped.current = null; setPanel(null); return true; }
    if (!immersive) return false;
    escaped.current = intent === "menu" ? from : null;
    if (intent === "leave") host.current?.focus();
    else if (intent === "overlay") closeOverlay(railEl.current?.contains(from) ? "rail" : lower.current?.contains(from) ? "side" : open[open.length - 1]);
    else if (intent === "close") leave();
    else return false;
    return true;
  };
  const press = useRef(pressEscape);
  press.current = pressEscape;
  // Two ways a press can miss the bench. The control that had the focus is gone, so the key lands on
  // the page: it is still full screen's key. And on a phone the bench is inside a sheet, where the back
  // gesture asks the sheet to close: full screen takes that request first.
  useEffect(() => {
    const bench = root.current;
    if (!immersive || !bench) return;
    const doc = bench.ownerDocument, sheet = bench.closest("dialog");
    let keyed = -Infinity;
    const key = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      keyed = e.timeStamp;
      const from = e.target instanceof Element ? e.target : null, within = from?.closest("dialog");
      // On the bench the press was already handled. In a dialog opened over the bench it is the dialog's.
      if (e.defaultPrevented || (from && bench.contains(from)) || (within && within !== sheet)) return;
      if (host.current && press.current(host.current, e.isComposing)) e.preventDefault();
    };
    const cancel = (e: Event) => {
      if (e.target !== sheet) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      // A request that follows an Escape key press is that same press, already handled as a key.
      if (e.timeStamp - keyed < 100) return;
      const focused = doc.activeElement instanceof HTMLElement && bench.contains(doc.activeElement) ? doc.activeElement : host.current;
      if (focused) press.current(focused, false);
    };
    doc.addEventListener("keydown", key);
    sheet?.addEventListener("cancel", cancel, true);
    return () => { doc.removeEventListener("keydown", key); sheet?.removeEventListener("cancel", cancel, true); };
  }, [immersive]);

  const frameKeys = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape" && !e.defaultPrevented) {
      if (pressEscape(e.target as HTMLElement, e.nativeEvent.isComposing)) e.preventDefault();
      return;
    }
    escaped.current = null;
    if (!immersive || e.key !== "Tab") return;
    const items = [...e.currentTarget.querySelectorAll<HTMLElement>("button, a[href], input, select, textarea, summary, [tabindex]")]
      .filter((el) => el.tabIndex >= 0 && !el.matches(":disabled") && el.getClientRects().length > 0);
    const first = items[0], last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
  };

  const resetLayout = () => { setSpread(0); stage?.resetLayout(); };

  const stageKeys = (e: React.KeyboardEvent<HTMLDivElement>) => {
    // An open panel takes Escape before full screen does, wherever in the stage the focus is.
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
      case "help":
        if (immersive && narrow) setOverlays(["camera"]);
        setPanel((now) => (now === "help" ? null : "help"));
        break;
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
  const bar = p.bar ?? (immersive ? p.immersiveBar : null);
  const panelHead = (which: Overlay, title?: string) => <div className="stage-panel-head">
    <h3>{title}</h3><button type="button" className="btn quiet" aria-label={`Hide: ${title}`} onClick={() => closeOverlay(which)}>Hide</button>
  </div>;

  return <Immersive value={immersive}><div ref={root} className={`stage-bench${immersive ? " immersive" : ""}${immersive && narrow ? " narrow" : ""}${railOpen ? " rail-open" : ""}${sideOpen ? " side-open" : ""}`}
    role={immersive ? "dialog" : undefined} aria-modal={immersive || undefined} aria-label={immersive ? `${p.title}, full screen` : undefined} onKeyDown={frameKeys}>
    <header className="stage-head" ref={head}>
      <div className="stage-title">{p.eyebrow && <p className="eyebrow">{p.eyebrow}</p>}<h2>{immersive && narrow ? "3D model" : p.title}</h2></div>
      <div className="stage-head-actions">
        {!immersive && <ViewToggle />}
        {immersive && p.rail && <button ref={railToggle} type="button" className="btn quiet" aria-expanded={railOpen} aria-controls={`${id}-rail`} title={p.railTitle} onClick={() => toggleOverlay("rail")}>{p.railName}</button>}
        {immersive && <button ref={sideToggle} type="button" className="btn quiet" aria-expanded={sideOpen} aria-controls={`${id}-side`} title={SIDE_TITLE} onClick={() => toggleOverlay("side")}>Part</button>}
        <button ref={expander} type="button" className="btn stage-screen" aria-label={immersive ? "Exit full screen" : undefined} onClick={() => (immersive ? leave() : enter())}>
          <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d={immersive ? "M6 2v4H2M10 2v4h4M14 10h-4v4M2 10h4v4" : "M2 6V2h4M10 2h4v4M14 10v4h-4M6 14H2v-4"} /></svg>
          <span>{immersive ? <>Exit<span className="wide"> full screen</span></> : "Full screen"}</span></button>
      </div>
    </header>
    {!immersive && (p.status || p.restore) && <div className="stage-status">
      {p.status}
      {p.restore && <button type="button" className="btn quiet" disabled={p.restore.disabled} onClick={p.restore.run}>{p.restore.label}</button>}
    </div>}
    <div className="stage-main">
      {p.rail && (immersive || narrow) && <aside className="stage-rail" ref={railEl} id={`${id}-rail`} aria-label={p.railTitle}>
        {immersive ? <>{panelHead("rail", p.railTitle)}{p.rail}</> : <details><summary>{p.railTitle}</summary>{p.rail}</details>}
      </aside>}
      <div className="stage-view" ref={host} tabIndex={0} role="group" aria-describedby={hint} onKeyDown={stageKeys} onKeyUp={stageKeyUp} onBlur={() => stage?.holdPan(false)}
        aria-label={`3D model of ${arch.model.name}: ${arch.floors} layers, each with ${arch.heads} attention heads and one MLP. Arrow keys move between parts.`}>
        <div className="stage-labels" ref={labels} aria-hidden="true" />
        <div className="stage-top" data-tool={tool}>
          <div className="stage-toolbar">
            <div className="seg" role="group" aria-label="Tool">
              {p.tools.map((t) => <button key={t} type="button" aria-pressed={tool === t} onClick={() => setTool(t)}>{TOOL_NAME[t]}</button>)}
            </div>
            {immersive && narrow && <button type="button" ref={cameraToggle} className="btn stage-camera-trigger"
              aria-expanded={open.includes("camera")} aria-controls={`${id}-camera`} onClick={() => toggleOverlay("camera")}>Camera</button>}
            <div className="stage-resets">
              <button type="button" className="btn stage-reset" disabled={!stage || (!arranged && !spread)} title="Put moved parts back and close the spread. The model is not changed." onClick={resetLayout}>Reset layout</button>
              {immersive && p.restore && <button type="button" className="btn" disabled={p.restore.disabled} onClick={p.restore.run}>{p.restore.label}</button>}
            </div>
          </div>
          {immersive && p.status && <p className="stage-caption">{p.status}</p>}
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
      {immersive && narrow && <aside className="stage-camera-panel" ref={cameraEl} id={`${id}-camera`}
        aria-label="Camera controls" hidden={!open.includes("camera")}>
        {panelHead("camera", "Camera controls")}
        <div className="stage-dockbar">{dock}</div>
      </aside>}
      {bar && <div className="stage-bar" ref={foot}>{bar}</div>}
      {narrow && !immersive && <div className="stage-dockbar">{dock}</div>}
      <div className="stage-lower" ref={lower} id={`${id}-side`}>
        {immersive && panelHead("side", SIDE_TITLE)}
        <div className="stage-controls">
          <PartPicker arch={arch} selected={selected} onSelect={p.onSelect} />
          {p.transport}
        </div>
        <aside className="stage-side" aria-label={SIDE_TITLE}>{p.children}</aside>
      </div>
    </div>
  </div></Immersive>;
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
