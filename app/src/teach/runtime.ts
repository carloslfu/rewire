import { encodeTable, type ChangeSpec } from "@rewire/engine/src/changes.ts";
import { download } from "@rewire/engine/src/gpu.ts";
import { LessonTrainer, LESSON_BATCH, type LessonFeature } from "@rewire/engine/src/lesson-trainer.ts";
import type { Model } from "@rewire/engine/src/model.ts";
import type { ChatTokenizer } from "@rewire/engine/src/tokenizer.ts";
import type { Example } from "./lessons.ts";
import type { LessonResult, LessonUpdate, ProbeResult } from "./types.ts";

/** Dedicated conversations, no shared chat context and no examples in test prompts. */
export class LessonRuntime {
  private epoch=0;
  private busy=false;
  constructor(private model:Model,private tok:ChatTokenizer) {}
  stop() { this.epoch++; }
  async train(examples:Example[],steps:number,lr:number,progress:(p:LessonUpdate)=>void,continueLesson=false):Promise<LessonResult> {
    if(this.busy) throw new Error("Wait for the current lesson operation to finish.");
    if(![80,200,400].includes(steps)||![0.001,0.003,0.01].includes(lr)) throw new Error("Invalid training settings");
    if(!examples.length||examples.length>24) throw new Error("Use 1 to 24 examples.");
    if(continueLesson&&!this.model.lesson) throw new Error("Teach a lesson before continuing it.");
    this.busy=true;const epoch=this.epoch,t0=performance.now(),c=this.model.conversation();
    let trainer:LessonTrainer|null=null,initialLoss:number|null=null,finalLoss:number|null=null;
    const features:LessonFeature[]=[];
    const stopped=()=>this.epoch!==epoch;
    try {
      const {width:W,units:U}=this.model.cfg;
      for(let e=0;e<examples.length&&!stopped();e++) {
        const ex=examples[e];
        if(!ex.prompt.trim()||!ex.answer.trim()||ex.prompt.length>600||ex.answer.length>300)throw new Error(`Example ${e+1} is empty or too long.`);
        const read=this.tok.firstTurn(ex.prompt),answer=[...this.tok.plain(ex.answer),this.tok.t.im_end];
        if(answer.length>96||read.length+answer.length>Math.min(384,this.model.cfg.maxContext)) throw new Error(`Shorten example ${e+1}. Each answer can have at most 95 tokens.`);
        progress({phase:"reading",step:e,total:examples.length});
        const f=await c.lessonFeatures([...read,...answer.slice(0,-1)],read.length-1);
        for(let i=0;i<answer.length;i++)features.push({x:f.x.slice(i*W,(i+1)*W),act:f.act.slice(i*U,(i+1)*U),target:answer[i]});
      }
      if(stopped())return {weights:null,steps:0,tokens:features.length,seconds:(performance.now()-t0)/1000,stopped:true,initialLoss,finalLoss};
      // Continue the installed parameters. Each round gets fresh Adam moments, including after recovery.
      trainer=new LessonTrainer(this.model,new Float32Array(await download(this.model.dev,this.model.w.finalNorm)),
        continueLesson?this.model.lesson!:undefined);
      const evaluate=async()=>{
        let loss=0,count=0;
        for(let i=0;i<features.length&&!stopped();i+=LESSON_BATCH){const batch=features.slice(i,i+LESSON_BATCH);loss+=(await trainer!.gradients(batch)).loss*batch.length;count+=batch.length;}
        return count===features.length?loss/count:null;
      };
      initialLoss=await evaluate();
      progress({phase:"training",step:0,total:steps,loss:initialLoss??undefined,weights:trainer.params});
      let seed=73;
      for(let s=0;s<steps&&!stopped();s++) {
        const batch=Array.from({length:LESSON_BATCH},()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return features[seed%features.length];});
        const loss=await trainer.train(batch,lr);
        if((s+1)%10===0||s+1===steps)progress({phase:"training",step:s+1,total:steps,loss,weights:trainer.params});
      }
      if(!stopped())finalLoss=await evaluate();
      return {weights:trainer.step?trainer.params:null,steps:trainer.step,tokens:features.length,seconds:(performance.now()-t0)/1000,stopped:stopped(),initialLoss,finalLoss};
    } finally { trainer?.destroy();this.model.release(c);this.busy=false; }
  }

  async probe(prompt:string,lesson:boolean):Promise<ProbeResult> {
    if(this.busy)throw new Error("Wait for training to finish.");
    if(!prompt.trim()||prompt.length>1200)throw new Error("Use a question of 1 to 1,200 characters.");
    if(lesson&&!this.model.lesson)throw new Error("Teach a lesson first.");
    this.busy=true;const epoch=this.epoch,c=this.model.conversation(),ids:number[]=[];let ended=false;
    try {
      const input=this.tok.firstTurn(prompt);
      if(input.length+64>this.model.cfg.maxContext)throw new Error("Shorten this test question.");
      const changes:ChangeSpec=lesson?{lesson:1}:{};
      c.setTable(encodeTable(changes,this.model.cfg));c.read(input.slice(0,-1));let next=input.at(-1)!;
      for(let i=0;i<64&&epoch===this.epoch;i++) {
        c.step(next,{seed:7,temperature:0,turn:0,step:i,slot:0});next=(await c.result(0)).token;
        if(next===this.tok.t.im_end||next===this.tok.t.endoftext){ended=true;break;}ids.push(next);
      }
      return {text:this.tok.decode(ids),ended,cancelled:epoch!==this.epoch};
    }finally{this.model.release(c);this.busy=false;}
  }
}
