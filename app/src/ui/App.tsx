// A conversation first. Experiments, training and model inspection open when requested.
import { lazy, Suspense, useEffect, useState } from "react";
import { backToQwen, freshStart, onPieces, openStep, stopReply } from "../state/actions.ts";
import { store, useStore } from "../state/store.ts";
import { S } from "../strings.ts";
import { Conversation, FinishedReplies } from "./Conversation.tsx";
import { Chips, Composer, PathList, StepCard, WhatsReal } from "./Panels.tsx";
import { Inspector } from "./Inspector.tsx";
import { Modal } from "./Modal.tsx";

const Tiny = lazy(() => import("../tiny/TinyView.tsx"));

export function App() {
  const tiny = useStore((s) => s.tiny);
  const announce = useStore((s) => s.announce);
  const busy = useStore((s) => s.busy);
  const model = useStore((s) => s.model);
  const turns = useStore((s) => s.turns);
  const error = useStore((s) => s.error);
  const [, setTick] = useState(0);
  const [about, setAbout] = useState(false);
  const [trainingVisited, setTrainingVisited] = useState(false);
  useEffect(() => onPieces(() => setTick((t) => t + 1)), []);
  useEffect(() => { if (tiny) setTrainingVisited(true); }, [tiny]);
  const train = () => { stopReply(); store.set({ tiny: true, sheet: false, pathOpen: false }); };

  return (
    <>
      <a className="skip" href={tiny ? "#training" : "#composer"}>{tiny ? "Skip to training" : "Skip to chat"}</a>
      <header className="top">
        <span className="name">{S.title}</span>
        <span className="orient">{tiny ? "Teach a tiny model" : model.id === "tiny" ? "The model you trained" : "A small AI you can change"}</span>
        <nav className="top-actions" aria-label="Main">
          {(tiny || model.id === "tiny") && <button type="button" className="btn quiet" onClick={() => {
            if (model.id === "tiny") void backToQwen();
            else store.set({ tiny: false });
          }}>Chat</button>}
          <button type="button" className="btn quiet" onClick={() => store.set({ pathOpen: true })}>Experiments</button>
          {!tiny && <button type="button" className="btn quiet" onClick={train}>Train</button>}
          <button type="button" className="btn quiet" onClick={() => setAbout(true)}>About</button>
        </nav>
      </header>
      <div className="sr-only" aria-live="polite">{busy ? "" : announce}</div>
      {!tiny && <FinishedReplies />}
      <div hidden={tiny}>
        <main className="workspace" id="conversation" aria-label="Conversation">
          <div className="conversation-tools">
            <span>{model.id === "tiny" ? "Your tiny model · text completion" : turns.length ? "Qwen3-0.6B" : "New conversation"}</span>
            {turns.length > 0 && <button type="button" className="btn quiet" onClick={() => {
              if (model.id === "tiny") freshStart();
              else void openStep(null);
            }}>{model.id === "tiny" ? "New text" : "New chat"}</button>}
          </div>
          {!turns.length && !busy && <div className="empty-chat">
            <h1>{model.id === "tiny" ? "Give it a few words to begin." : "What would you like to ask?"}</h1>
            <p>{model.id === "tiny" ? "It learned to continue text, one letter at a time." : "Start a conversation. Then change something inside the model."}</p>
          </div>}
          {!turns.length && busy && <p className="opening" role="status">Opening the example…</p>}
          <Conversation />
          {error && <div className="error-message" role="alert"><p>{error}</p><button type="button" className="btn quiet" onClick={() => store.set({ error: null })}>Dismiss</button></div>}
          <StepCard />
          <section className="chat-entry" aria-label={model.id === "tiny" ? "Continue your text" : "Chat with the model"}>
            <Chips />
            <Composer />
          </section>
        </main>
      </div>
      {(tiny || trainingVisited) && <div hidden={!tiny}>
        <Suspense fallback={<p className="workspace opening" role="status">Opening training…</p>}><Tiny /></Suspense>
      </div>}
      <PathList />
      <Inspector />
      <Modal open={about} onClose={() => setAbout(false)} title="About Rewire" className="about-modal">
        <p className="about-intro">A real, small language model you can talk to, take apart and change.</p>
        <p>Qwen3-0.6B runs in your browser. Try a recorded experiment, ask your own questions, or teach a separate tiny model from your writing.</p>
        <p>This is a small model for exploring how AI works. It can give confident, incorrect answers.</p>
        <p>Conversations and changes last for this visit. Nothing you type leaves this device.</p>
        <WhatsReal expanded />
      </Modal>
    </>
  );
}
