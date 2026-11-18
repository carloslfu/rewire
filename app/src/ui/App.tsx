// The lab: freeform inference beside an always-on instrument, plus real training from noise.
import { lazy, Suspense, useEffect, useLayoutEffect, useRef, useState } from "react";
import { applyChips, backToQwen, clearSamples, freshStart, onPieces, stepData, stopReply } from "../state/actions.ts";
import { store, useStore } from "../state/store.ts";
import { S } from "../strings.ts";
import { Conversation, FinishedReplies } from "./Conversation.tsx";
import { Chips, Composer, PathList, StepCard, WhatsReal } from "./Panels.tsx";
import { Inspector } from "./Inspector.tsx";
import { Modal } from "./Modal.tsx";
import { LabScope } from "./Lab.tsx";
import { ModelWorkspace } from "./ModelWorkspace.tsx";
import { ExampleSelector } from "./Examples.tsx";

const Tiny = lazy(() => import("../tiny/TinyView.tsx"));
const Teach = lazy(() => import("../teach/TeachView.tsx"));

export function App() {
  const header = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    if (!header.current) return;
    const element = header.current;
    const resize = () => document.documentElement.style.setProperty("--app-header-height", `${element.offsetHeight}px`);
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(element);
    return () => { observer.disconnect(); document.documentElement.style.removeProperty("--app-header-height"); };
  }, []);
  const tiny = useStore((s) => s.tiny);
  const teach = useStore((s) => s.teach);
  const teachingBusy = useStore((s) => s.teachingBusy);
  const announce = useStore((s) => s.announce);
  const busy = useStore((s) => s.busy);
  const model = useStore((s) => s.model);
  const turns = useStore((s) => s.turns);
  const step = useStore((s) => s.step);
  const error = useStore((s) => s.error);
  const replayRequest = useStore((s) => s.replayRequest);
  const [, setTick] = useState(0);
  const [about, setAbout] = useState(false);
  const [trainingVisited, setTrainingVisited] = useState(false);
  const [teachVisited, setTeachVisited] = useState(false);
  useEffect(() => onPieces(() => setTick((t) => t + 1)), []);
  useEffect(() => {
    if (!replayRequest) return;
    const scene = document.getElementById("chat-scope");
    if (scene && scene.getBoundingClientRect().bottom < 150) scene.scrollIntoView({ block: "start" });
  }, [replayRequest]);
  useEffect(() => { if (tiny) setTrainingVisited(true); }, [tiny]);
  useEffect(() => { if (teach) setTeachVisited(true); }, [teach]);
  useEffect(() => {
    if (teach || tiny) history.replaceState(null, "", teach ? "#teach" : "#grow");
    else if (["#teach", "#grow"].includes(location.hash)) history.replaceState(null, "", location.pathname + location.search);
  }, [teach, tiny]);
  const train = () => { if(store.get().busy) stopReply(); store.set({ tiny: true, teach: false, sheet: false, pathOpen: false }); };
  const teaching = async () => {
    if(store.get().busy) stopReply();
    if (store.get().model.id === "tiny") await backToQwen();
    store.set({ teach: true, tiny: false, sheet: false, pathOpen: false });
  };

  const skipId = teach ? "teaching" : tiny ? "training" : "composer";
  return (
    <>
      <a className="skip" href={`#${skipId}`} onClick={event => {
        const field = document.getElementById(skipId);
        if (!field) return;
        event.preventDefault();
        field.closest(".model-workspace")?.querySelector<HTMLButtonElement>(".work-tab-work")?.click();
        requestAnimationFrame(() => field.focus());
      }}>{teach || tiny ? "Skip to training" : "Skip to questions"}</a>
      <header className="top" ref={header}>
        <span className="name">{S.title}</span>
        <span className="orient">A language model laboratory</span>
        <nav className="top-actions" aria-label="Main">
          <button type="button" disabled={teachingBusy} className={`btn quiet${!tiny && !teach ? " active-tab" : ""}`} onClick={() => {
            store.set({ teach: false });
            if (model.id === "tiny") void backToQwen();
            else {
              store.set({ tiny: false });
              const s = store.get();
              if (s.chips.lesson && s.chips.lesson !== s.lessonRevision) void applyChips({ ...s.chips, lesson: s.lessonRevision });
            }
          }}>Dismantle</button>
          <button type="button" disabled={teachingBusy} className={`btn quiet${teach ? " active-tab" : ""}`} onClick={() => void teaching()}>Teach</button>
          <button type="button" disabled={teachingBusy} className={`btn quiet${tiny ? " active-tab" : ""}`} onClick={train}>Grow</button>
          <button type="button" className="btn quiet" onClick={() => setAbout(true)}>About</button>
        </nav>
      </header>
      <div className="sr-only" aria-live="polite">{busy ? "" : announce}</div>
      {!tiny && !teach && <FinishedReplies />}
      <div hidden={tiny || teach}>
        <ModelWorkspace id="chat-scope" label="Live model visualizer" workLabel="Questions" stage={<LabScope />}>
          <main className="workspace" id="conversation" aria-label="Independent samples">
            {stepData(step)?.guide && <StepCard />}
            {!turns.length && !busy && !stepData(step)?.guide && <div className="lab-heading">
              <h1>{model.id === "tiny" ? "Try the model you grew" : "Ask the model"}</h1>
              <p>{model.id === "tiny" ? "Enter a few letters to see what it learned." : "Compare questions here. Select a word to follow it through the model."}</p>
            </div>}
            {!turns.length && busy && <p className="opening" role="status">Reading your question…</p>}
            <section className="chat-entry" aria-label={model.id === "tiny" ? "Continue your text" : "Test a question"}>
              <Chips />
              <Composer />
            </section>
            {model.id === "qwen" && <details className="work-examples">
              <summary>Guided experiments</summary>
              <ExampleSelector />
              <button type="button" className="linkish" onClick={() => store.set({ pathOpen: true })}>Explore all experiments</button>
            </details>}
            {turns.length > 0 && <div className="conversation-tools">
              <strong>{model.id === "tiny" ? "Generated text" : `${turns.length} ${turns.length === 1 ? "sample" : "samples"}`}</strong>
              <button type="button" className="btn quiet" onClick={() => {
                if (model.id === "tiny") freshStart(); else clearSamples();
              }}>{model.id === "tiny" ? "New text" : "Clear samples"}</button>
            </div>}
            <Conversation />
            {error && <div className="error-message" role="alert"><p>{error}</p><button type="button" className="btn quiet" onClick={() => store.set({ error: null })}>Dismiss</button></div>}
            {step !== null && !stepData(step)?.guide && <StepCard />}
            <div className="lab-onramp">{model.id === "tiny" && <button className="linkish" onClick={() => store.set({ pathOpen: true })}>Explore experiments</button>}<button className="linkish" onClick={() => void teaching()}>Teach this model something new</button><button className="linkish" onClick={train}>Grow your own model</button></div>
          </main>
        </ModelWorkspace>
      </div>
      {(teach || teachVisited) && <div hidden={!teach}><Suspense fallback={<p className="workspace opening" role="status">Opening Teach…</p>}><Teach /></Suspense></div>}
      {(tiny || trainingVisited) && <div hidden={!tiny}>
        <Suspense fallback={<p className="workspace opening" role="status">Opening training…</p>}><Tiny /></Suspense>
      </div>}
      <PathList />
      <Inspector />
      <Modal open={about} onClose={() => setAbout(false)} title="About Rewire" className="about-modal">
        <p className="about-intro">A real, small language model you can talk to, take apart and change.</p>
        <p>Qwen3-0.6B runs in your browser. Ask your own questions and change its computation. Teach trains a small addition to its final MLP using your examples. Grow trains a separate tiny transformer from random weights, then lets you physically scramble or erase its learned weights.</p>
        <p>This is a small model for exploring how AI works. It can give confident, incorrect answers.</p>
        <p>Conversations and changes last for this visit. Nothing you type leaves this device.</p>
        <p>Made by <a href="https://www.carlosgalarza.com">Carlos Galarza</a>. <a href="https://github.com/carloslfu/rewire" target="_blank" rel="noreferrer">Source code</a> is available under the MIT license.</p>
        <WhatsReal expanded />
      </Modal>
    </>
  );
}
