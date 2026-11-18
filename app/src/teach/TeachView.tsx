import { lazy, Suspense, useRef, useState } from "react";
import { initialLesson, type LessonWeights } from "@rewire/engine/src/lora.ts";
import { applyChips, liveEngine, settleSelection, stopReply } from "../state/actions.ts";
import { store, useStore } from "../state/store.ts";
import { DeviceBar } from "../ui/Panels.tsx";
import { ModelWorkspace } from "../ui/ModelWorkspace.tsx";
import { generalChecks, lessonChecks, promptKey, starters, validateExamples, type Example, type LessonCheck } from "./lessons.ts";
import type { LessonResult, ProbeResult } from "./types.ts";

const TeachStage = lazy(() => import("../stage/TeachStage.tsx"));

interface TestRow extends LessonCheck { before?:ProbeResult; after?:ProbeResult; seen:boolean }
interface Entry extends Example { id:number }
type AnswerView = "both" | "before" | "after";
const reference=initialLesson({width:1024,units:3072});
const sameExamples=(a:Example[],b:Example[])=>JSON.stringify(a.map(({prompt,answer})=>({prompt:prompt.trim(),answer:answer.trim()})))===JSON.stringify(b);
const kindLabel={taught:"From your examples",challenge:"Your separate test",general:"General knowledge",custom:"Your question"};

export default function TeachView() {
  const active=useStore(s=>s.teach),busy=useStore(s=>s.teachingBusy),device=useStore(s=>s.device);
  const revision=useStore(s=>s.lessonRevision);
  const nextId=useRef(12);
  const [entries,setEntries]=useState<Entry[]>(starters[0].examples.map((e,id)=>({...e,id})));
  const [prompt,setPrompt]=useState(starters[0].tests[0].prompt);
  const [question,setQuestion]=useState("");
  const [steps,setSteps]=useState(200),[rate,setRate]=useState(0.003);
  const [weights,setWeights]=useState<LessonWeights|null>(null),[run,setRun]=useState<LessonResult|null>(null);
  const [trainedExamples,setTrainedExamples]=useState<Example[]>([]),[seenPrompts,setSeenPrompts]=useState<string[]>([]);
  const [totalSteps,setTotalSteps]=useState(0),[round,setRound]=useState(0);
  const [step,setStep]=useState(0),[losses,setLosses]=useState<{step:number;loss:number}[]>([]);
  const [status,setStatus]=useState(""),[error,setError]=useState("");
  const [rows,setRows]=useState<TestRow[]>([]);
  const [view,setView]=useState<AnswerView>("both");
  const [working,setWorking]=useState<{index:number;side:"before"|"after"}|null>(null);
  const [phase,setPhase]=useState<"idle"|"testing"|"training">("idle");
  const stop=useRef(false),operation=useRef(false),committed=useRef<LessonWeights|null>(null);
  const testSection=useRef<HTMLElement|null>(null),editor=useRef<HTMLDivElement|null>(null);
  const ready=device.kind==="ready";
  let examples:Example[]=[],validation="";
  try{examples=validateExamples(entries);}catch(e){validation=(e as Error).message;}
  const edited=!!run&&!sameExamples(entries,trainedExamples);
  const starter=starters.find(s=>sameExamples(entries,s.examples));
  const checks=lessonChecks(examples,prompt);
  const testWasTaught=seenPrompts.includes(promptKey(prompt))||examples.some(e=>promptKey(e.prompt)===promptKey(prompt));
  const begin=(p:typeof phase)=>{if(store.get().busy)stopReply();operation.current=true;stop.current=false;store.set({teachingBusy:true});setPhase(p);setError("");};
  const finish=()=>{operation.current=false;store.set({teachingBusy:false});setPhase("idle");setWorking(null);};
  const halt=()=>{stop.current=true;liveEngine()?.stopLesson();setStatus("Stopping after the current GPU operation…");};
  const patch=(i:number,v:Partial<TestRow>)=>setRows(rs=>rs.map((r,k)=>k===i?{...r,...v}:r));
  const scrollToTests=()=>testSection.current?.scrollIntoView({block:"start",behavior:matchMedia("(prefers-reduced-motion: reduce)").matches?"instant":"smooth"});
  const makeRows=(cases:LessonCheck[],seen:string[])=>cases.map(c=>({...c,seen:seen.includes(promptKey(c.prompt))}));

  const compare=async(cases:LessonCheck[],hasLesson:boolean)=>{
    const engine=liveEngine()!;
    setPhase("testing");
    for(let i=0;i<cases.length&&!stop.current;i++){
      setStatus(`Checking ${i+1} of ${cases.length} with the original weights…`);setWorking({index:i,side:"before"});
      const before=await engine.probeLesson(cases[i].prompt,false);if(before.cancelled)return false;patch(i,{before});
      if(hasLesson&&!stop.current){setStatus(`Checking ${i+1} of ${cases.length} with the learned weights…`);setWorking({index:i,side:"after"});
        const after=await engine.probeLesson(cases[i].prompt,true);if(after.cancelled)return false;patch(i,{after});}
    }
    return !stop.current;
  };
  const test=async(cases:LessonCheck[])=>{
    if(!liveEngine()||operation.current||!ready||!cases.length)return;
    begin("testing");setRows(makeRows(cases,seenPrompts));setView("both");
    try{const complete=await compare(cases,revision>0);
      setStatus(complete?"Checks complete. Compare what it learned and what else changed.":"Checks stopped. Completed answers remain below.");
    }catch(e){setError((e as Error).message);setStatus("Checks could not finish. Completed answers remain below.");}finally{finish();}
  };

  const train=async(continueLesson:boolean)=>{
    const engine=liveEngine();if(!engine||operation.current||!ready||validation)return;
    const known=examples.map(e=>({...e})),cases=lessonChecks(known,prompt);
    const seen=Array.from(new Set([...(continueLesson?seenPrompts:[]),...known.map(e=>promptKey(e.prompt))]));
    const previous={run,losses,step,rows};let installed=false;
    const restorePrevious=()=>{setWeights(committed.current);setRun(previous.run);setLosses(previous.losses);setStep(previous.step);setRows(previous.rows);};
    begin("training");setRows(makeRows(cases,seen));setView("both");setLosses([]);setStep(0);setRun(null);
    setStatus(continueLesson?"Continuing from your learned weights…":"Starting with the original Qwen model…");
    try{
      const result=await engine.trainLesson(known,steps,rate,p=>{
        if(p.phase==="reading")setStatus(`Reading example ${p.step+1} of ${p.total}…`);
        else{setStep(p.step);setStatus(`Learning · step ${p.step} of ${p.total}`);
          if(p.loss!==undefined)setLosses(ls=>[...ls,{step:p.step,loss:p.loss!}]);if(p.weights)setWeights(p.weights);}
      },continueLesson);
      if(!result.weights){restorePrevious();setStatus("Stopped before any training steps. Your previous lesson is unchanged.");return;}
      await engine.installLesson(result.weights);committed.current=result.weights;installed=true;
      setWeights(result.weights);setRun(result);setStep(result.steps);setTrainedExamples(known);setSeenPrompts(seen);
      setTotalSteps((continueLesson?totalSteps:0)+result.steps);setRound((continueLesson?round:0)+1);
      store.set(s=>({lessonRevision:s.lessonRevision+1,
        turns:s.turns.map(t=>t.changed?.changes.lesson?{...t,changed:{...t.changed,stale:true,compare:undefined}}:t)}));
      settleSelection();
      if(stop.current){setStatus(`Stopped after ${result.steps} steps. Your learned weights are kept. Run the checks when you are ready.`);return;}
      const complete=await compare(cases,true);
      setStatus(`${result.steps} steps in ${result.seconds.toFixed(1)} seconds. ${complete?"Checks complete. See what changed below.":"Checks stopped; your learned weights are kept."}`);
    }catch(e){if(!installed)restorePrevious();setError((e as Error).message);
      setStatus(installed?"Your learned weights are kept. Run the checks again.":revision?"Teaching stopped. Your previous lesson is unchanged.":"No learned weights were installed.");}
    finally{finish();}
  };

  const dismantle=async()=>{
    if(operation.current||!revision)return;
    store.set({teach:false,tiny:false});
    await applyChips({...store.get().chips,lesson:revision});
  };
  const pick=(id:string)=>{
    const s=starters.find(s=>s.id===id);
    setEntries((s?.examples??[{prompt:"",answer:""}]).map(e=>({...e,id:nextId.current++})));
    setPrompt(s?.tests[0].prompt??"");setError("");
    requestAnimationFrame(()=>{if(editor.current)editor.current.scrollTop=0;if(!s)editor.current?.querySelector("textarea")?.focus();});
  };
  const change=(id:number,key:"prompt"|"answer",value:string)=>{setError("");setEntries(es=>es.map(e=>e.id===id?{...e,[key]:value}:e));};
  const remove=(id:number,index:number)=>{setError("");setEntries(es=>es.filter(e=>e.id!==id));
    requestAnimationFrame(()=>{const fields=editor.current?.querySelectorAll<HTMLTextAreaElement>("textarea");if(fields?.length)fields[Math.min(index*2,fields.length-2)]?.focus();});};
  const add=()=>{const id=nextId.current++;setError("");setEntries(es=>[...es,{id,prompt:"",answer:""}]);
    requestAnimationFrame(()=>{const fields=editor.current?.querySelectorAll<HTMLTextAreaElement>("textarea");fields?.[fields.length-2]?.focus();});};
  // The lesson's state lives here, so switching between the flat map and the 3D model keeps it.
  const visualizer=<Suspense fallback={<p className="stage-state" role="status">Opening the 3D model…</p>}>
    <TeachStage weights={weights} reference={reference} step={step} running={busy&&phase==="training"} losses={losses} run={run} active={active}
      controls={{busy,phase,ready,validation,status,error,revision,train:c=>void train(c),halt,dismantle:()=>void dismantle()}} /></Suspense>;
  return <ModelWorkspace stage={visualizer} id="lesson-scope" label="Live learned weights" workLabel="Lesson">
    <main tabIndex={-1} className="workspace training-workspace" id="teaching">
      <div className="lab-heading"><p className="eyebrow">Teach the same model · Qwen3-0.6B</p>
        <h1>Teach it your world.</h1><p>Invent a fact. Give it examples. Find out what sticks when the examples are gone.</p></div>
      <section className="lesson-data" aria-labelledby="lesson-heading">
        <h2 id="lesson-heading">What should it learn?</h2>
        <div className="lesson-starters" role="group" aria-label="Example lessons">{starters.map(s=><button className="btn" key={s.id} disabled={busy}
          aria-pressed={sameExamples(entries,s.examples)} onClick={()=>pick(s.id)}>{s.name}</button>)}
          <button className="linkish" disabled={busy} onClick={()=>pick("own")}>Write your own</button></div>
        <p className="note">{starter?`${starter.description} Change an answer to make it yours.`:"Write the questions and answers you want it to learn. You can invent your own facts or give examples of a rule."}</p>
        <div className="row training-actions">{busy?<button className="btn" onClick={halt}>Stop {phase==="training"?"learning":"checking"}</button>:
          <><button className="btn primary" disabled={!ready||!!validation} onClick={()=>void train(revision>0)}>{revision?"Continue learning":"Teach Qwen"}</button>
            {revision>0&&<button className="linkish" disabled={!ready||!!validation} onClick={()=>void train(false)}>Train from original</button>}</>}
          {!busy&&rows.some(r=>r.after)&&<button className="linkish" onClick={scrollToTests}>See what changed ↓</button>}</div>
        <DeviceBar />
        <p className="note training-status" role="status">{status||"Training runs on this device. Original and learned answers are checked automatically."}</p>
        {error&&<p className="error-message" role="alert">{error}</p>}
        <div className="lesson-editor-heading"><h3>Your examples</h3><span className="note">{entries.length} of 24</span></div>
        <div className="lesson-example-list" ref={editor} role="group" aria-label="Training examples">
          {entries.map((entry,i)=><div className="lesson-example" key={entry.id}>
            <div className="lesson-example-number"><span>Example {i+1}</span><button className="linkish" disabled={busy||entries.length===1} aria-label={`Remove example ${i+1}`} onClick={()=>remove(entry.id,i)}>Remove</button></div>
            <label>Question<textarea rows={2} maxLength={600} spellCheck={false} disabled={busy} aria-label={`Question ${i+1}`} value={entry.prompt} onChange={e=>change(entry.id,"prompt",e.target.value)} /></label>
            <label>Answer to learn<textarea rows={2} maxLength={300} spellCheck={false} disabled={busy} aria-label={`Answer ${i+1}`} value={entry.answer} onChange={e=>change(entry.id,"answer",e.target.value)} /></label>
          </div>)}
        </div>
        <button className="linkish lesson-add" disabled={busy||entries.length>=24} onClick={add}>Add example</button>
        <p className="note" id="lesson-data-note">{validation||"Only these answers are training targets. Keep earlier examples to practice them while teaching something new."}</p>
        {edited&&<p className="note changed-text">Examples edited. Continue learning to apply them. Removing an example does not undo earlier learning.</p>}
        {revision>0&&<p className="note">{round} {round===1?"round":"rounds"} · {totalSteps} total steps. Continue learning keeps these weights. Train from original replaces them after the new round succeeds.</p>}
        <label className="lesson-challenge">Test it in different words <span className="note">This question stays out of training.</span>
          <textarea rows={2} maxLength={1200} disabled={busy} aria-label="Question held out of training" placeholder="Ask about your example in a new way…" value={prompt} onChange={e=>setPrompt(e.target.value)} /></label>
        <p className="note">{prompt.trim()?(testWasTaught?"This question matches a current or earlier training example. Reword it to test a question it has not practiced.":"After teaching, we compare a training example, this question, and a general knowledge check."):"Add a separate question to test beyond your examples. We will still check a taught example and general knowledge."}</p>
        <div className="lesson-settings"><label>Steps this round<select value={steps} disabled={busy} onChange={e=>setSteps(Number(e.target.value))}><option value={80}>80 · brief</option><option value={200}>200 · standard</option><option value={400}>400 · longer</option></select></label>
          <label>Learning rate<select value={rate} disabled={busy} onChange={e=>setRate(Number(e.target.value))}><option value={0.001}>0.001 · gentle</option><option value={0.003}>0.003 · standard</option><option value={0.01}>0.01 · bold</option></select></label></div>
        <p className="note">More steps can also make it overfit. Use the checks to decide what to try next.</p>
      </section>
      <section className="lesson-tests" ref={testSection} aria-labelledby="lesson-test-heading">
        <h2 id="lesson-test-heading">What changed?</h2>
        <p className="note">Both models get the same question in a fresh chat, without the examples. Look for what stuck and what got worse.</p>
        {busy&&phase==="testing"&&<button className="btn" onClick={halt}>Stop these checks</button>}
        <div className="lesson-suggestions"><button className="linkish" disabled={busy||!ready||!!validation} onClick={()=>void test(checks)}>Run lesson checks</button>
          <button className="linkish" disabled={busy||!ready} onClick={()=>void test(generalChecks.map(e=>({...e,kind:"general"})))}>Check general knowledge</button></div>
        {rows.length>0&&<div className="lesson-results">
          {rows.some(r=>r.after)&&<><div className="lesson-result-tools"><span className="note">Learned weights</span><div className="seg" role="group" aria-label="Compare generated answers">
            <button aria-pressed={view==="before"} onClick={()=>setView("before")}>Off</button><button aria-pressed={view==="after"} onClick={()=>setView("after")}>On</button><button aria-pressed={view==="both"} onClick={()=>setView("both")}>Side by side</button></div></div>
            <p className="note">Switch between the actual answers generated with the learned weights off and on. Same question, greedy decoding.</p></>}
          {rows.map((r,i)=><article className="lesson-result" key={`${i}:${r.prompt}`}><p className="eyebrow">{kindLabel[r.kind]}</p><h3>{r.prompt}</h3>
            <p className="note">{r.seen?"This question has been used in training.":"This question has not been used in training."}{r.answer?` Expected: ${r.answer}`:""}</p>
            <div className={`lesson-answer-pair${view!=="both"?" lesson-answer-single":""}`}>
              {view!=="after"&&<div><p className="eyebrow">Original Qwen · learned weights off</p><p>{r.before?.text||(working?.index===i&&working.side==="before"?"Generating…":"Not checked yet")}</p>{r.before&&!r.before.ended&&<small>Stopped at 64 tokens.</small>}</div>}
              {view!=="before"&&<div className="lesson-answer-changed"><p className="eyebrow">Your Qwen · learned weights on</p><p>{r.after?.text||(working?.index===i&&working.side==="after"?"Generating…":revision||busy?"Not checked yet":"Teach it to compare")}</p>{r.after&&!r.after.ended&&<small>Stopped at 64 tokens.</small>}</div>}
            </div>
          </article>)}
        </div>}
        <form onSubmit={e=>{e.preventDefault();void test([{prompt:question.trim(),answer:"",kind:"custom"}]);}}>
          <label htmlFor="lesson-question">Ask anything else</label>
          <div className="probe-input"><textarea id="lesson-question" rows={2} maxLength={1200} value={question} placeholder="Try a question of your own…" disabled={busy} onChange={e=>setQuestion(e.target.value)} />
          <button className="btn" disabled={busy||!ready||!question.trim()} type="submit">{revision?"Compare answers":"Try original"}</button></div>
        </form>
      </section>
      <section className="lesson-handoff"><h2>Now take apart what it learned.</h2><p className="note">Carry these exact weights into Dismantle. Cut an attention head or the final MLP, then replay your chat and see what survives.</p>
        <button className="btn" disabled={busy||!revision||!ready} onClick={()=>void dismantle()}>Dismantle this model</button>
        <p className="note">Your existing chat and interventions stay there. The learned weights become one more change you can switch off.</p></section>
      <section className="lesson-method"><h2>What is actually learning?</h2><p className="note">Two small matrices, A and B, add a rank-8 LoRA update to the down projection in layer 28’s MLP. All 32,768 adapter parameters can learn; Qwen’s original weights stay frozen. Training uses full-vocabulary next-token prediction and Adam. Dismantle interventions are set aside during teaching.</p>
        <p className="note">Continue learning starts from your current adapter. Each round resets the optimizer’s momentum and trains on the examples currently in the editor. Removing an example does not erase it from the weights. Train from original starts a fresh adapter.</p>
        <p className="note">This is a limited form of fine-tuning. It can memorize, generalize, forget, or fail. A lower training error does not prove it learned the rule. Weights and examples last for this visit.</p>
        <button className="linkish" disabled={busy} onClick={()=>store.set({teach:false,tiny:true})}>Want to train every weight from scratch? Open Grow</button></section>
    </main>
  </ModelWorkspace>;
}
