import { createContext, type ReactNode, useContext, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useNarrow } from "./useNarrow.ts";
import { createPortal } from "react-dom";

type Panel = "work" | "parts" | "camera";
interface WorkspaceSlots {
  parts: HTMLDivElement | null;
  camera: HTMLDivElement | null;
  open: (panel: Panel) => void;
  setOverlay: (element: HTMLDivElement | null) => void;
}

const Slots = createContext<WorkspaceSlots | null>(null);
export const useWorkspace = () => useContext(Slots);

/** A single editor follows its model into full screen. Moving its DOM host preserves drafts,
 * expanded comparisons, selection and the training forms while the canvas stays mounted. */
export function ModelWorkspace({ stage, children, id, label, workLabel }: {
  stage: ReactNode; children: ReactNode; id: string; label: string; workLabel: string;
}) {
  const uid = useId();
  const [panel, open] = useState<Panel>("work");
  const narrow = useNarrow();
  const scene = useRef<HTMLElement>(null);
  const [above, setAbove] = useState(false);
  useEffect(() => {
    if (!narrow || !scene.current || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(([entry]) => setAbove(!entry.isIntersecting && entry.boundingClientRect.bottom <= 0));
    observer.observe(scene.current);
    return () => observer.disconnect();
  }, [narrow]);
  const returnToModel = () => {
    scene.current?.scrollIntoView({ block: "start" });
    scene.current?.querySelector<HTMLElement>(".stage-view")?.focus({ preventScroll: true });
  };
  useEffect(() => { if (!narrow && panel === "camera") open("work"); }, [narrow, panel]);
  const [home, setHome] = useState<HTMLDivElement | null>(null);
  const [parts, setParts] = useState<HTMLDivElement | null>(null);
  const [camera, setCamera] = useState<HTMLDivElement | null>(null);
  const [overlay, setOverlay] = useState<HTMLDivElement | null>(null);
  const [editor] = useState(() => typeof document === "undefined" ? null : document.createElement("div"));
  const slots = useMemo(() => ({ parts, camera, open, setOverlay }), [parts, camera]);
  useLayoutEffect(() => {
    const target = overlay ?? home;
    if (!editor || !target) return;
    editor.className = "workspace-content";
    target.appendChild(editor);
    return () => editor.remove();
  }, [editor, home, overlay]);
  const tabs = [["work", workLabel], ["parts", "Inspect part"], ["camera", "Camera"]] as const;
  return <Slots.Provider value={slots}>
    <div className="lab-layout model-workspace">
      <section ref={scene} className="lab-scope stage-scope model-scene" id={id} aria-label={label}>{stage}</section>
      <div className="work-sidebar">
        <nav className="work-tabs" aria-label="Model workspace">
          {tabs.map(([key, name]) => <button type="button" key={key} className={`work-tab work-tab-${key}`}
            aria-pressed={panel === key} aria-controls={`${uid}-${key}`} onClick={() => open(key)}>{name}</button>)}
          {narrow && above && <button type="button" className="back-to-model" onClick={returnToModel}
            aria-label="Back to the 3D model">↑ Model</button>}
        </nav>
        <div id={`${uid}-work`} className="work-pane" hidden={panel !== "work"} ref={setHome} />
        <div id={`${uid}-parts`} className="work-pane work-parts" hidden={panel !== "parts"} ref={setParts} />
        <div id={`${uid}-camera`} className="work-pane work-camera" hidden={panel !== "camera"} ref={setCamera} />
      </div>
      {editor ? createPortal(children, editor) : children}
    </div>
  </Slots.Provider>;
}
