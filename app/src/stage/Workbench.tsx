// The frame around the 3D stage, shared by Dismantle, Teach and Grow: tools and resets above, the
// stage in the middle, the selected part's real controls beside it. Full screen keeps the same mounted
// stage and gives it the whole screen: its controls float over it, and the question and the selected
// part are panels that stay closed until they are asked for.
import { type ReactNode, type RefObject, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useWorkspace } from "../ui/ModelWorkspace.tsx";
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

const TOOL_NAME: Record<Tool, string> = { explore: "Explore", grab: "Grab", punch: "Punch" };
const SIDE_TITLE = "Selected part and experiments";

/** Why a stage could not start: the browser gave it no WebGL context, or its drawing code did not arrive. */
type Failure = "webgl" | "code";
const FAILURE: Record<Failure, string> = {
  webgl: "The 3D model could not start: this browser did not give it a WebGL context.",
  code: "The 3D model could not start: its drawing code did not load.",
};

/**
 * Whether a bench starts its stage now. One that could not start, on this bench or another, is not
 * started again by a render or by coming back to the bench: only by a request newer than the last one answered.
 */
export const startsStage = (able: boolean, answered: number, request: number) => able || answered !== request;

/** Whether an element has a box: it and everything around it is in the layout. */
const rendered = (el: HTMLElement | null) => !!el && el.getClientRects().length > 0;

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
  /** A few words on a part's state for the menus that name every part: its measured value, a change on it, a marker. */
  annotate?: (part: Part) => string;
  /** A tile of the detail bay was clicked or tapped: its plate, and the place of its number in that plate's tensor. */
  onTile?: (plate: string, index: number) => void;
  /**
   * Changes each time the visitor asks to be taken to the model at the selected part. The bench comes
   * into view, the camera goes to the part, and the keyboard focus goes to the stage.
   */
  attention?: number;
  /** The stage stopped drawing: a hidden tab, scrolled out of sight, or a lost context. */
  onHidden?: () => void;
  onStage: (stage: Stage | null) => void;
  restore?: { label: string; disabled: boolean; run: () => void };
  railTitle?: string;
  /** The word on the button that opens the rail in full screen. */
  railName?: string;
  /** Always in sight directly under the stage, in every layout. It does not scroll with the controls below it. */
  bar?: ReactNode;
  replaying?: boolean;
  /** A reply card launched replay. Bring its transport into view even from the Questions overlay. */
  replyReplay?: number;
  /** Along the bottom in full screen on a bench with no `bar`: the training controls, whose docked copy is then in a closed panel. */
  immersiveBar?: ReactNode;
  transport?: ReactNode;
  children: ReactNode;
}

export function Workbench(p: WorkbenchProps) {
  const { arch, selected } = p;
  const workspace = useWorkspace();
  const narrow = useNarrow();
  const hint = useId(), id = useId();
  const root = useRef<HTMLDivElement>(null), host = useRef<HTMLDivElement>(null), labels = useRef<HTMLDivElement>(null), tip = useRef<HTMLDivElement>(null);
  const expander = useRef<HTMLButtonElement>(null), lower = useRef<HTMLDivElement>(null);
  const head = useRef<HTMLElement>(null), foot = useRef<HTMLDivElement>(null), railEl = useRef<HTMLElement>(null);
  const cameraEl = useRef<HTMLElement>(null), cameraToggle = useRef<HTMLButtonElement>(null);
  const railToggle = useRef<HTMLButtonElement>(null), sideToggle = useRef<HTMLButtonElement>(null);
  const [stage, setStage] = useState<Stage | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "lost" | "failed">(() => (store.get().stage3d ? "loading" : "failed"));
  // Why this bench's own last start failed. Null when it has not failed itself: the stage is drawing, or another bench found out first.
  const [failure, setFailure] = useState<Failure | null>(null);
  const [generation, setGeneration] = useState(0);
  // Try again was pressed and has not been answered yet.
  const [retrying, setRetrying] = useState(false);
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

  const selectPart = (part: Part | null) => {
    p.onSelect(part);
    if (part && !immersive) workspace?.open("parts");
  };
  const selectRef = useRef(selectPart);
  selectRef.current = selectPart;
  // A tile's number is read in the part's panel, so a tap on a tile brings that panel forward too.
  const readTile = (plate: string, index: number) => {
    p.onTile?.(plate, index);
    if (p.onTile && !immersive) workspace?.open("parts");
  };
  const tileRef = useRef(readTile);
  tileRef.current = readTile;

  // Starting playback from a full-screen reply brings the model and transport back into view.
  useEffect(() => {
    if (p.replaying && root.current?.classList.contains("immersive")) {
      setOverlays(NONE);
      host.current?.focus({ preventScroll: true });
    }
  }, [p.replaying]);

  // A bench that is not on screen holds no WebGL context; its stage is rebuilt when the visitor returns.
  // Not on screen is another bench being open, and also this one being taken out of the layout by
  // whatever is around it: the bench then has no box at all.
  const [shown, setShown] = useState(true);
  useEffect(() => {
    const bench = root.current;
    if (!bench || typeof ResizeObserver === "undefined") return;
    const sizes = new ResizeObserver(() => setShown(rendered(bench)));
    sizes.observe(bench);
    setShown(rendered(bench));
    return () => sizes.disconnect();
  }, []);
  const live = p.active && shown;
  // The request the last start answered. A stage that could not start, here or on another bench, is
  // started again only when the visitor asks: never by coming back to the bench or by a render.
  const tried = useRef(0);
  useEffect(() => {
    if (!live || !rendered(root.current)) return;
    if (!startsStage(store.get().stage3d, tried.current, generation)) { setState("failed"); setRetrying(false); return; }
    tried.current = generation;
    let cancelled = false, made: Stage | null = null;
    // No WebGL, or the 3D code could not load. There is no other drawing to fall back to: the bench says
    // so, keeps its named parts, controls and readings, and offers to try again.
    const unavailable = (cause: Failure) => (reason: unknown) => {
      if (cancelled) return;
      console.error("Rewire: the 3D view could not start.", reason);
      setFailure(cause);
      setState("failed");
      setRetrying(false);
      store.set({ stage3d: false, replayRequest: null, announce: `${FAILURE[cause]} Parts can still be selected by name, and their controls and measurements work.` });
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
          onSelect: (part) => selectRef.current(part),
          onPunch: (part) => latest.current.onPunch(part),
          describe: (part, t) => latest.current.describe(part, t),
          onHidden: () => latest.current.onHidden?.(),
          onArranged: setArranged,
          onTile: (plate, index) => tileRef.current(plate, index),
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
        unavailable("webgl")(e);
        return;
      }
      setState("ready");
      setFailure(null);
      setRetrying(false);
      if (!store.get().stage3d) store.set({ stage3d: true });
      setStage(made);
      latest.current.onStage(made);
      // Development only: `__rewireStage.info()` reports draw calls and triangles of the last frame.
      if (import.meta.env.DEV) (globalThis as unknown as { __rewireStage: Stage }).__rewireStage = made;
    }, unavailable("code"));
    return () => {
      cancelled = true;
      setStage(null);
      latest.current.onStage(null);
      made?.dispose();
    };
  }, [arch, generation, live]);
  const retry = () => {
    if (retrying) return;
    setRetrying(true);
    setGeneration((g) => g + 1);
  };
  // Nothing is drawn and nothing will be until the visitor asks again. The parts are still there by name.
  const undrawn = state === "failed" || retrying;

  // The visitor asked to be taken to the model at the selected part: the bench comes into view and takes
  // the keyboard, and the camera goes to the part as soon as there is a stage to move.
  const attended = useRef(0);
  useEffect(() => {
    if (!p.attention) return;
    root.current?.scrollIntoView?.({ block: "nearest" });
    host.current?.focus({ preventScroll: true });
    // The part's own controls and readings are beside the model, as after selecting it there.
    if (latest.current.selected) {
      if (root.current?.classList.contains("immersive")) setOverlays(["side"]);
      else workspace?.open("parts");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.attention]);
  useEffect(() => {
    if (!stage || !p.attention || attended.current === p.attention) return;
    attended.current = p.attention;
    if (selected) stage.focus(selected); else stage.resetView();
  }, [stage, p.attention, selected]);

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
  useEffect(() => {
    const bar = foot.current, play = bar?.querySelector<HTMLButtonElement>(".replay-main");
    if (!p.replyReplay || !bar || !play) return;
    setOverlays(NONE);
    setPanel(null);
    play.focus({ preventScroll: true });
    const rect = bar.getBoundingClientRect();
    if (!root.current?.classList.contains("immersive") && (rect.top < 0 || rect.bottom > window.innerHeight)) {
      bar.scrollIntoView({ block: "end" });
    }
  }, [p.replyReplay]);
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
  // A control can disappear while it has focus. Escape then lands on the document.
  // An inspector dialog opened above the bench owns its own keys.
  useEffect(() => {
    const bench = root.current;
    if (!immersive || !bench) return;
    const doc = bench.ownerDocument;
    const key = (event: KeyboardEvent) => {
      const from = event.target instanceof Element ? event.target : null;
      if (event.key !== "Escape" || event.defaultPrevented || (from && (bench.contains(from) || from.closest("dialog")))) return;
      if (host.current && press.current(host.current, event.isComposing)) event.preventDefault();
    };
    doc.addEventListener("keydown", key);
    return () => doc.removeEventListener("keydown", key);
  }, [immersive]);

  const frameKeys = (e: React.KeyboardEvent<HTMLDivElement> | KeyboardEvent) => {
    if (e.key === "Escape" && !e.defaultPrevented) {
      if (pressEscape(e.target as HTMLElement, ("nativeEvent" in e ? e.nativeEvent : e).isComposing)) e.preventDefault();
      return;
    }
    escaped.current = null;
    if (!immersive || e.key !== "Tab") return;
    const items = [...root.current!.querySelectorAll<HTMLElement>("button, a[href], input, select, textarea, summary, [tabindex]")]
      .filter((el) => el.tabIndex >= 0 && !el.matches(":disabled") && el.getClientRects().length > 0);
    const first = items[0], last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
  };

  // React dispatches the portaled editor's events to its workspace. Physical full-screen
  // containment still owns Escape and focus wrapping for keys originating in that editor.
  useEffect(() => {
    const rail = railEl.current;
    if (!immersive || !rail || !workspace) return;
    const keys = (event: KeyboardEvent) => {
      if (event.target instanceof Element && event.target.closest(".workspace-content")) frameKeys(event);
    };
    rail.addEventListener("keydown", keys);
    return () => rail.removeEventListener("keydown", keys);
  });

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
      case "move": { const next = movePart(arch.model, selected, key.key); if (next) selectPart(next); break; }
      case "orbit": stage?.orbit(key.azimuth, key.polar); break;
      case "zoom": stage?.zoom(key.factor); break;
      case "fit": stage?.resetView(); break;
      case "focus": if (selected) stage?.focus(selected); else if (key.orFit) stage?.resetView(); break;
      case "view": stage?.view(key.view); break;
      case "spread": setSpread((now) => (now > 0 ? 0 : 1)); break;
      case "help":
        if (immersive && narrow) setOverlays(["camera"]);
        else if (narrow) workspace?.open("camera");
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

  const dock = <NavDock arch={arch} stage={stage} selected={selected} onSelect={selectPart} drag={drag} onDrag={setDrag}
    spread={spread} onSpread={setSpread} panel={panel} onPanel={setPanel} punch={p.tools.includes("punch")} />;
  const bar = p.bar ?? (immersive ? p.immersiveBar : null);
  const panelHead = (which: Overlay, title?: string) => <div className="stage-panel-head">
    <h3>{title}</h3><button type="button" className="btn quiet" aria-label={`Hide: ${title}`} onClick={() => closeOverlay(which)}>Hide</button>
  </div>;

  const picker = useRef<HTMLSelectElement>(null);
  /** Without the drawing, the menus that name every part are the way to select one. */
  const toPicker = () => {
    if (immersive) { if (!sideOpen) toggleOverlay("side"); } else workspace?.open("parts");
    requestAnimationFrame(() => picker.current?.focus());
  };

  const parts = <div className="stage-lower" ref={lower} id={`${id}-side`}>
        {immersive && panelHead("side", SIDE_TITLE)}
        <div className="stage-controls">
          <PartPicker arch={arch} selected={selected} onSelect={selectPart} annotate={p.annotate} first={picker} />
          {p.transport}
        </div>
        <aside className="stage-side" aria-label={SIDE_TITLE}>{p.children}</aside>
      </div>;
  const mobileDock = <div className="stage-dockbar">{dock}</div>;

  return <Immersive value={immersive}><div ref={root} className={`stage-bench${immersive ? " immersive" : ""}${immersive && narrow ? " narrow" : ""}${railOpen ? " rail-open" : ""}${sideOpen ? " side-open" : ""}${undrawn ? " undrawn" : ""}`}
    role={immersive ? "dialog" : undefined} aria-modal={immersive || undefined} aria-label={immersive ? `${p.title}, full screen` : undefined} onKeyDown={frameKeys}>
    <header className="stage-head" ref={head}>
      <div className="stage-title">{p.eyebrow && <p className="eyebrow">{p.eyebrow}</p>}<h2>{immersive && narrow ? "3D model" : p.title}</h2></div>
      <div className="stage-head-actions">
        {immersive && workspace && <button ref={railToggle} type="button" className="btn quiet" aria-expanded={railOpen} aria-controls={`${id}-rail`} title={p.railTitle} onClick={() => toggleOverlay("rail")}>{p.railName}</button>}
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
      {immersive && <aside className="stage-rail" ref={railEl} id={`${id}-rail`} aria-label={p.railTitle}>
        {panelHead("rail", p.railTitle)}
        {workspace && railOpen && <div ref={workspace.setOverlay} />}
      </aside>}
      <div className="stage-view" ref={host} tabIndex={0} role="group" aria-describedby={undrawn ? undefined : hint} onKeyDown={stageKeys} onKeyUp={stageKeyUp} onBlur={() => stage?.holdPan(false)}
        aria-label={undrawn ? `Parts of ${arch.model.name}, without the 3D drawing: ${arch.floors} layers, each with ${arch.heads} attention heads and one MLP. Arrow keys move between parts.`
          : `3D model of ${arch.model.name}: ${arch.floors} layers, each with ${arch.heads} attention heads and one MLP. Arrow keys move between parts.`}>
        <div className="stage-labels" ref={labels} aria-hidden="true" />
        <div className="stage-top" data-tool={tool}>
          <div className="stage-toolbar">
            {/* The tools and the camera act on the drawing. Without one they are not offered. */}
            {!undrawn && <div className="seg" role="group" aria-label="Tool">
              {p.tools.map((t) => <button key={t} type="button" aria-pressed={tool === t} onClick={() => setTool(t)}>{TOOL_NAME[t]}</button>)}
            </div>}
            {!undrawn && immersive && narrow && <button type="button" ref={cameraToggle} className="btn stage-camera-trigger"
              aria-expanded={open.includes("camera")} aria-controls={`${id}-camera`} onClick={() => toggleOverlay("camera")}>Camera</button>}
            <div className="stage-resets">
              {!undrawn && <button type="button" className="btn stage-reset" disabled={!stage || (!arranged && !spread)} title="Put moved parts back and close the spread. The model is not changed." onClick={resetLayout}>Reset layout</button>}
              {immersive && p.restore && <button type="button" className="btn" disabled={p.restore.disabled} onClick={p.restore.run}>{p.restore.label}</button>}
            </div>
          </div>
          {immersive && p.status && <p className="stage-caption">{p.status}</p>}
          {!undrawn && <p className="stage-hint" id={hint}><strong>{TOOL_NAME[tool]}.</strong> {help[tool]}</p>}
        </div>
        {!narrow && !undrawn && dock}
        <div className="stage-tip" ref={tip} aria-hidden="true" hidden />
        {state === "loading" && !retrying && <p className="stage-state" role="status">Opening the 3D model…</p>}
        {state === "lost" && <div className="stage-state" role="alert">
          <p>The 3D view stopped drawing. The model and your changes are not affected.</p>
          <div className="row"><button type="button" className="btn" onClick={() => setGeneration((g) => g + 1)}>Reload 3D view</button></div>
        </div>}
        {undrawn && <div className="stage-state stage-recovery" role="alert">
          <p><strong>{failure ? FAILURE[failure] : "The 3D model could not start in this browser."}</strong></p>
          <p>{failure === "code" ? "Check the connection, then try again. If it still does not load, reload the page."
            : "It is drawn with WebGL, which this browser or device is not providing right now. Closing other pages that draw in 3D, or turning graphics acceleration on, can bring it back."}</p>
          <p>The model itself is not affected. Every part can still be selected by name, and its controls and measurements are real and work without the drawing. There is no other drawing of the model.</p>
          <div className="row">
            <button type="button" className="btn" aria-disabled={retrying || undefined} onClick={retry}>{retrying ? "Trying again…" : "Try again"}</button>
            <button type="button" className="btn quiet" onClick={toPicker}>Select a part by name</button>
          </div>
          {generation > 0 && !retrying && <p className="note">It did not start when tried again.</p>}
        </div>}
      </div>
      {immersive && narrow && <aside className="stage-camera-panel" ref={cameraEl} id={`${id}-camera`}
        aria-label="Camera controls" hidden={!open.includes("camera")}>
        {panelHead("camera", "Camera controls")}
        <div className="stage-dockbar">{dock}</div>
      </aside>}
      {bar && <div className="stage-bar" ref={foot}>{bar}</div>}
      {narrow && !immersive && (workspace?.camera ? createPortal(mobileDock, workspace.camera) : mobileDock)}
      {workspace?.parts && !immersive ? createPortal(parts, workspace.parts) : parts}
    </div>
  </div></Immersive>;
}

/** The same selection the pointer makes, as two ordinary menus that name every part, each with a few words on its state. */
function PartPicker({ arch, selected, onSelect, annotate, first }: {
  arch: Arch; selected: Part | null; onSelect: (part: Part | null) => void; annotate?: (part: Part) => string; first?: RefObject<HTMLSelectElement | null>;
}) {
  const id = useId();
  const note = (part: Part) => { const said = annotate?.(part); return said ? ` · ${said}` : ""; };
  const where = !selected ? "" : selected.kind === "embed" ? "in" : selected.kind === "unembed" ? "out" : selected.kind === "norm" ? "norm" : String(selected.floor);
  const floor = selected && "floor" in selected ? selected.floor : -1;
  const which = !selected || !("floor" in selected) ? "" : selected.kind === "layer" ? "layer" : selected.kind === "mlp" ? "mlp" : selected.kind === "kv" ? `k${selected.group}` : `h${selected.head}`;
  const pickPart = (v: string) => onSelect(v === "layer" ? { kind: "layer", floor } : v === "mlp" ? { kind: "mlp", floor }
    : v[0] === "k" ? { kind: "kv", floor, group: Number(v.slice(1)) } : { kind: "head", floor, head: Number(v.slice(1)) });
  return <div className="stage-picker">
    <label htmlFor={`${id}-where`}>Select</label>
    <select id={`${id}-where`} ref={first} value={where} onChange={(e) => {
      const v = e.target.value;
      onSelect(v === "" ? null : v === "in" ? { kind: "embed" } : v === "out" ? { kind: "unembed" } : v === "norm" ? { kind: "norm" } : { kind: "layer", floor: Number(v) });
    }}>
      <option value="">Nothing</option>
      <option value="out">{`Words out${note({ kind: "unembed" })}`}</option>
      <option value="norm">Final normalization</option>
      {Array.from({ length: arch.floors }, (_, i) => arch.floors - 1 - i).map((L) => <option key={L} value={L}>{`Layer ${L + 1}${note({ kind: "layer", floor: L })}`}</option>)}
      <option value="in">{`Words in${note({ kind: "embed" })}`}</option>
    </select>
    {floor >= 0 && <select aria-label={`Part of layer ${floor + 1}`} value={which} onChange={(e) => pickPart(e.target.value)}>
      <option value="layer">{`Whole layer${note({ kind: "layer", floor })}`}</option>
      {Array.from({ length: arch.heads }, (_, h) => <option key={h} value={`h${h}`}>{`Attention head ${h + 1}${note({ kind: "head", floor, head: h })}`}</option>)}
      <option value="mlp">{`MLP${note({ kind: "mlp", floor })}`}</option>
      {Array.from({ length: arch.kvHeads }, (_, g) => { const hs = groupHeads(arch.model, g); return <option key={g} value={`k${g}`}>{`Keys and values of heads ${hs[0] + 1} to ${hs[hs.length - 1] + 1}`}</option>; })}
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
