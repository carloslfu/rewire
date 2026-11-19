import { encodeTable, type ChangeSpec } from "@rewire/engine/src/changes.ts";
import { download } from "@rewire/engine/src/gpu.ts";
import { LessonTrainer, LESSON_BATCH, type LessonFeature } from "@rewire/engine/src/lesson-trainer.ts";
import type { Conversation, Model } from "@rewire/engine/src/model.ts";
import type { ChatTokenizer } from "@rewire/engine/src/tokenizer.ts";
import type { Example } from "./lessons.ts";
import type { LessonResult, LessonUpdate, ProbeResult } from "./types.ts";

const PROBE_TOKENS=64;
/**
 * Cache positions for a lesson conversation that reads `positions` tokens: the next power of two, so
 * the two cache kernels are compiled for a handful of sizes at most, and never above the model's limit.
 */
export const lessonContext=(positions:number,maxContext:number)=>Math.min(maxContext,Math.max(128,2**Math.ceil(Math.log2(Math.max(1,positions)))));

/** Dedicated conversations, no shared chat context and no examples in test prompts. */
export class LessonRuntime {
  private epoch=0;
  private busy=false;
  constructor(private model:Model,private tok:ChatTokenizer) {}
  stop() { this.epoch++; }

  /**
   * A conversation of its own, sized to the positions this operation reads instead of the whole
   * context. A refused allocation is released and reported, and never leaves a half-usable cache.
   */
  private async open(positions:number):Promise<Conversation> {
    const dev=this.model.dev;
    dev.pushErrorScope("out-of-memory");
    let c:Conversation|null=null,failure:unknown=null;
    try{c=this.model.conversation(lessonContext(positions,this.model.cfg.maxContext));}catch(e){failure=e;}
    const refused=await dev.popErrorScope();
    if(c&&!refused)return c;
    if(c)this.model.release(c);
    if(failure&&!refused)throw failure;
    throw new Error("There is not enough GPU memory free for this. Close other tabs or apps, then try again.");
  }

  /**
   * One round of training. Nothing is installed here: the caller installs `weights` when they are not
   * null. A fresh adapter that would replace an installed lesson is only handed over complete; stopped
   * part-way it is discarded, so the installed lesson survives. A first lesson or a continued one keeps
   * the steps it finished.
   */
  async train(examples:Example[],steps:number,lr:number,progress:(p:LessonUpdate)=>void,continueLesson=false):Promise<LessonResult> {
    if(this.busy) throw new Error("Wait for the current lesson operation to finish.");
    if(![80,200,400].includes(steps)||![0.001,0.003,0.01].includes(lr)) throw new Error("Invalid training settings");
    if(!examples.length||examples.length>24) throw new Error("Use 1 to 24 examples.");
    if(continueLesson&&!this.model.lesson) throw new Error("Teach a lesson before continuing it.");
    this.busy=true;const epoch=this.epoch,t0=performance.now(),replacing=!continueLesson&&!!this.model.lesson;
    let c:Conversation|null=null,trainer:LessonTrainer|null=null,initialLoss:number|null=null,finalLoss:number|null=null;
    const features:LessonFeature[]=[];
    const stopped=()=>this.epoch!==epoch;
    const result=(weights:LessonResult["weights"],done:number,halted:boolean,discarded:boolean):LessonResult=>
      ({weights,steps:done,total:steps,discarded,tokens:features.length,seconds:(performance.now()-t0)/1000,stopped:halted,initialLoss,finalLoss});
    try {
      const {width:W,units:U}=this.model.cfg;
      // Every example is checked and measured before any GPU memory is taken.
      const reads=examples.map((ex,e)=>{
        if(!ex.prompt.trim()||!ex.answer.trim()||ex.prompt.length>600||ex.answer.length>300)throw new Error(`Example ${e+1} is empty or too long.`);
        const read=this.tok.firstTurn(ex.prompt),answer=[...this.tok.plain(ex.answer),this.tok.t.im_end];
        if(answer.length>96||read.length+answer.length>Math.min(384,this.model.cfg.maxContext)) throw new Error(`Shorten example ${e+1}. Each answer can have at most 95 tokens.`);
        return {read,answer};
      });
      c=await this.open(Math.max(...reads.map(r=>r.read.length+r.answer.length-1)));
      for(let e=0;e<reads.length&&!stopped();e++) {
        const {read,answer}=reads[e];
        progress({phase:"reading",step:e,total:reads.length});
        const f=await c.lessonFeatures([...read,...answer.slice(0,-1)],read.length-1);
        for(let i=0;i<answer.length;i++)features.push({x:f.x.slice(i*W,(i+1)*W),act:f.act.slice(i*U,(i+1)*U),target:answer[i]});
      }
      this.model.release(c);c=null;
      if(stopped())return result(null,0,true,false);
      // Continue the installed parameters. Each round gets fresh AdamW moments, including after recovery.
      trainer=new LessonTrainer(this.model,new Float32Array(await download(this.model.dev,this.model.w.finalNorm)),
        continueLesson?this.model.lesson!:undefined);
      // The loss over every training token, for the before and after figures of the round.
      const evaluate=async()=>{
        let loss=0,count=0;
        for(let i=0;i<features.length&&!stopped();i+=LESSON_BATCH){const batch=features.slice(i,i+LESSON_BATCH);loss+=(await trainer!.gradients(batch)).loss*batch.length;count+=batch.length;}
        return count===features.length?loss/count:null;
      };
      initialLoss=await evaluate();
      progress({phase:"training",step:0,total:steps,weights:trainer.params});
      let seed=73;
      for(let s=0;s<steps&&!stopped();s++) {
        const batch=Array.from({length:LESSON_BATCH},()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return features[seed%features.length];});
        // The loss of this sampled batch with the adapter as it stood after `s` updates.
        const loss=await trainer.train(batch,lr);
        if(s===0||(s+1)%10===0||s+1===steps)progress({phase:"training",step:s+1,total:steps,loss,lossStep:s,weights:trainer.params});
      }
      if(!stopped())finalLoss=await evaluate();
      // A stop that lands during or after the final evaluation still counts: read it once, here.
      const halted=stopped(),done=trainer.step,discarded=halted&&replacing&&done>0;
      return result(done&&!discarded?trainer.params:null,done,halted,discarded);
    } finally { trainer?.destroy();if(c)this.model.release(c);this.busy=false; }
  }

  async probe(prompt:string,lesson:boolean):Promise<ProbeResult> {
    if(this.busy)throw new Error("Wait for training to finish.");
    if(!prompt.trim()||prompt.length>1200)throw new Error("Use a question of 1 to 1,200 characters.");
    if(lesson&&!this.model.lesson)throw new Error("Teach a lesson first.");
    this.busy=true;const epoch=this.epoch,ids:number[]=[];let c:Conversation|null=null,ended=false;
    try {
      const input=this.tok.firstTurn(prompt);
      if(input.length+PROBE_TOKENS>this.model.cfg.maxContext)throw new Error("Shorten this test question.");
      c=await this.open(input.length+PROBE_TOKENS);
      const changes:ChangeSpec=lesson?{lesson:1}:{};
      c.setTable(encodeTable(changes,this.model.cfg));c.read(input.slice(0,-1));let next=input.at(-1)!;
      for(let i=0;i<PROBE_TOKENS&&epoch===this.epoch;i++) {
        c.step(next,{seed:7,temperature:0,turn:0,step:i,slot:0});next=(await c.result(0)).token;
        if(next===this.tok.t.im_end||next===this.tok.t.endoftext){ended=true;break;}ids.push(next);
      }
      return {text:this.tok.decode(ids),ended,cancelled:epoch!==this.epoch};
    }finally{if(c)this.model.release(c);this.busy=false;}
  }
}
