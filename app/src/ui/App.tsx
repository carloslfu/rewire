// The lab: freeform inference beside an always-on instrument, plus real training from noise.
import { lazy, Suspense, useEffect, useState } from "react";
import { backToQwen, freshStart, onPieces, stopReply } from "../state/actions.ts";
import { store, useStore } from "../state/store.ts";
import { S } from "../strings.ts";
import { Conversation, FinishedReplies } from "./Conversation.tsx";
import { Chips, Composer, PathList, StepCard, WhatsReal } from "./Panels.tsx";
import { Inspector } from "./Inspector.tsx";
import { Modal } from "./Modal.tsx";
import { LabScope } from "./Lab.tsx";
import { useNarrow } from "./useNarrow.ts";

const Tiny = lazy(() => import("../tiny/TinyView.tsx"));

export function App() {
  const tiny = useStore((s) => s.tiny);
  const announce = useStore((s) => s.announce);
  const busy = useStore((s) => s.busy);
  const model = useStore((s) => s.model);
  const turns = useStore((s) => s.turns);
  const step = useStore((s) => s.step);
  const error = useStore((s) => s.error);
  const [, setTick] = useState(0);
  const [about, setAbout] = useState(false);
  const [trainingVisited, setTrainingVisited] = useState(false);
  const [scope, setScope] = useState(false);
  const narrow = useNarrow();
  useEffect(() => onPieces(() => setTick((t) => t + 1)), []);
  useEffect(() => { if (tiny) setTrainingVisited(true); }, [tiny]);
  const train = () => { stopReply(); setScope(false); store.set({ tiny: true, sheet: false, pathOpen: false }); };

  return (
    <>
      <a className="skip" href={tiny ? "#training" : "#composer"}>{tiny ? "Skip to training" : "Skip to chat"}</a>
      <header className="top">
        <span className="name">{S.title}</span>
        <span className="orient">A language model laboratory</span>
        <nav className="top-actions" aria-label="Main">
          <button type="button" className={`btn quiet${!tiny ? " active-tab" : ""}`} onClick={() => {
            if (model.id === "tiny") void backToQwen();
            else store.set({ tiny: false });
          }}>Dismantle</button>
          <button type="button" className={`btn quiet${tiny ? " active-tab" : ""}`} onClick={train}>Grow</button>
          <button type="button" className="btn quiet" onClick={() => setAbout(true)}>About</button>
        </nav>
      </header>
      <div className="sr-only" aria-live="polite">{busy ? "" : announce}</div>
      {!tiny && <FinishedReplies />}
      <div hidden={tiny} className={`lab-layout${scope ? " mobile-scope-open" : ""}`}>
        <main className="workspace" id="conversation" aria-label="Conversation">
          <div className="conversation-tools">
            <span>{model.id === "tiny" ? "Your tiny model · text completion" : "Qwen3-0.6B · 28 layers"}</span>
            {turns.length > 0 && <button type="button" className="btn quiet" onClick={() => {
              freshStart();
            }}>{model.id === "tiny" ? "New text" : "New chat"}</button>}
          </div>
          <button className="btn mobile-scope-toggle" aria-expanded={scope} aria-controls="chat-scope" onClick={() => setScope(!scope)}>{scope ? "Hide model" : "Show model"}</button>
          {!turns.length && !busy && <div className="empty-chat lab-heading">
            <p className="eyebrow">Dismantle a model</p>
            <h1>{model.id === "tiny" ? "Meet the brain you grew." : "Pull it apart.\nSee what survives."}</h1>
            <p>{model.id === "tiny" ? "Give it a few letters. Inspect what it learned, cut a connection, and try again." : "Ask anything. Cut a layer. Zero real weights. Follow every word through the machinery."}</p>
          </div>}
          {!turns.length && busy && <p className="opening" role="status">Opening the example…</p>}
          <Conversation />
          {error && <div className="error-message" role="alert"><p>{error}</p><button type="button" className="btn quiet" onClick={() => store.set({ error: null })}>Dismiss</button></div>}
          {step !== null && <StepCard />}
          <section className="chat-entry" aria-label={model.id === "tiny" ? "Continue your text" : "Chat with the model"}>
            <Chips />
            <Composer />
          </section>
          <div className="lab-onramp"><button className="linkish" onClick={() => store.set({ pathOpen: true })}>Explore recorded experiments</button><button className="linkish" onClick={train}>Grow your own model</button></div>
        </main>
        {!narrow && <aside id="chat-scope" className="lab-scope" aria-label="Live model visualizer"><LabScope /></aside>}
      </div>
      {narrow && <Modal open={scope && !tiny} onClose={() => setScope(false)} title="Live model" className="mobile-model"><div id="chat-scope"><LabScope /></div></Modal>}
      {(tiny || trainingVisited) && <div hidden={!tiny}>
        <Suspense fallback={<p className="workspace opening" role="status">Opening training…</p>}><Tiny /></Suspense>
      </div>}
      <PathList />
      <Inspector />
      <Modal open={about} onClose={() => setAbout(false)} title="About Rewire" className="about-modal">
        <p className="about-intro">A real, small language model you can talk to, take apart and change.</p>
        <p>Qwen3-0.6B runs in your browser. Ask your own questions and change its computation. Grow trains a separate tiny transformer from random weights, then lets you physically scramble or erase its learned weights.</p>
        <p>This is a small model for exploring how AI works. It can give confident, incorrect answers.</p>
        <p>Conversations and changes last for this visit. Nothing you type leaves this device.</p>
        <WhatsReal expanded />
      </Modal>
    </>
  );
}
