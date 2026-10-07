import { beforeAll, expect, it } from "vitest";
import { getDevice, upload, download } from "../src/gpu.ts";
import { Model, type Weights } from "../src/model.ts";
import { LessonTrainer, type LessonFeature } from "../src/lesson-trainer.ts";
import { initialLesson } from "../src/lora.ts";
import { encodeTable, isNeutral } from "../src/changes.ts";
import { synthModel, type CpuModel } from "./cpuref.ts";
import type { ModelConfig } from "../src/config.ts";
import { LessonRuntime } from "../../app/src/teach/runtime.ts";
import type { ChatTokenizer } from "../src/tokenizer.ts";

const cfg:ModelConfig={name:"lesson test",floors:2,width:128,queryHeads:4,kvHeads:2,headSize:32,units:256,
  vocabRows:512,vocabReal:500,ropeTheta:10000,eps:1e-6,maxContext:128,group:32,dictBits:4,floorBits:4};
let dev:GPUDevice;
beforeAll(async()=>{const wg=await import("webgpu");Object.assign(globalThis,wg.globals);dev=await getDevice(wg.create([]));});
function weights(m:CpuModel):Weights{return {dict:upload(dev,m.dict),finalNorm:upload(dev,m.finalNorm),meanRow:upload(dev,m.meanRow),
  floors:m.floors.map(f=>({...Object.fromEntries(["q","k","v","o","gate","up","down","inNorm","postNorm"].map(k=>[k,upload(dev,f[k as keyof typeof f] as Float32Array)])),qkNorm:upload(dev,Float32Array.from([...f.qNorm,...f.kNorm]))})) as Weights["floors"]};}

it("differentiates full-vocabulary cross entropy through RMSNorm and both LoRA matrices",async()=>{
  const cpu=synthModel(cfg,4), model=new Model(dev,cfg,weights(cpu));
  const p=initialLesson(cfg); p.b.forEach((_,i)=>p.b[i]=Math.sin(i)*0.05);
  const t=new LessonTrainer(model,cpu.finalNorm,p);
  const batch:LessonFeature[]=[2,3].map(k=>({x:Float32Array.from({length:cfg.width},(_,i)=>Math.cos(i*k)*2),
    act:Float32Array.from({length:cfg.units},(_,i)=>Math.sin(i+k)),target:17*k}));
  const g=await t.gradients(batch);
  for(const [name,grad] of [["a",g.ga],["b",g.gb]] as const) for(const i of [0,113,351]) {
    const v=t.params[name][i],eps=0.01;
    t.params[name][i]=v+eps;const plus=(await t.gradients(batch)).loss;
    t.params[name][i]=v-eps;const minus=(await t.gradients(batch)).loss;
    t.params[name][i]=v;
    expect(Math.abs((plus-minus)/(2*eps)-grad[i])).toBeLessThan(0.0003);
  }
  const start=g.loss;for(let i=0;i<30;i++)await t.train(batch,0.01);
  expect((await t.gradients(batch)).loss).toBeLessThan(start*0.8);
  t.destroy();model.destroy();
},30000);

it("uses learned weights in prompt processing, generation, MLP pushes, and restores original logits exactly",async()=>{
  const cpu=synthModel(cfg,3),model=new Model(dev,cfg,weights(cpu)),c=model.conversation();
  const tokens=[3,17,250,41,99,7];
  const run=async(lesson:number|undefined,split:boolean)=>{
    c.length=0;c.setTable(encodeTable({lesson},cfg));
    if(split)for(const id of tokens.slice(0,-1))c.read([id]);else c.read(tokens.slice(0,-1));
    c.step(tokens.at(-1),{seed:7,turn:0,step:0,slot:0});const out=await c.result(0);
    return {out,scores:new Float32Array(await download(dev,c.scores))};
  };
  const base=await run(undefined,false),features=await c.lessonFeatures(tokens,tokens.length-1);
  const trainer=new LessonTrainer(model,cpu.finalNorm);
  for(let i=0;i<20;i++)await trainer.train([{...features,target:72}],0.01);
  model.setLesson(trainer.params);
  const taught=await run(1,false),sequential=await run(1,true),restored=await run(undefined,false);
  expect(isNeutral({lesson:1})).toBe(false);
  expect(Array.from(restored.scores)).toEqual(Array.from(base.scores));
  expect(taught.scores[72]).toBeGreaterThan(base.scores[72]);
  expect(Math.max(...taught.scores.map((v,i)=>Math.abs(v-sequential.scores[i])))).toBeLessThan(0.002);
  let mean=0;for(let i=0;i<cfg.vocabReal;i++)mean+=taught.scores[i]/cfg.vocabReal;
  expect(Math.abs(taught.out.pushes.reduce((s,v)=>s+v,0)-(taught.scores[taught.out.token]-mean))).toBeLessThan(0.005);
  // Disabling the last MLP also disables its learned addition.
  c.setTable(encodeTable({lesson:1,memory:[{floor:1,mult:0}]},cfg));c.length=0;c.read(tokens.slice(0,-1));
  c.step(tokens.at(-1),{seed:7,turn:0,step:0,slot:0});await c.result(0);
  const off=new Float32Array(await download(dev,c.scores));
  c.setTable(encodeTable({memory:[{floor:1,mult:0}]},cfg));c.length=0;c.read(tokens.slice(0,-1));
  c.step(tokens.at(-1),{seed:7,turn:0,step:0,slot:0});await c.result(0);
  expect(Array.from(new Float32Array(await download(dev,c.scores)))).toEqual(Array.from(off));
  // The inspected neuron pushes include B*A, including when an effective down weight is zeroed.
  const table=encodeTable({lesson:1,zeroed:[{floor:1,tensor:"down",row:5,col:9}]},cfg);
  c.setTable(table);c.length=0;c.read(tokens.slice(0,-1));
  c.step(tokens.at(-1),{seed:7,temperature:0,turn:0,step:0,slot:0});const greedy=await c.result(0);
  const scores=new Float32Array(await download(dev,c.scores));
  expect(greedy.token).toBe(scores.slice(0,cfg.vocabReal).indexOf(Math.max(...scores.slice(0,cfg.vocabReal))));
  const detail=await c.inspect(tokens.length-1,tokens.at(-1)!,greedy.token,{table,meanRow:cpu.meanRow,finalNorm:cpu.finalNorm,
    qkNorm:cpu.floors.map(f=>Float32Array.from([...f.qNorm,...f.kNorm]))});
  const push=detail.detail.get("f1.unit_push")!.reduce((s,v)=>s+v,0);
  expect(Math.abs(push-greedy.pushes[1+cfg.queryHeads+(cfg.queryHeads+1)])).toBeLessThan(0.01);
  trainer.destroy();model.destroy();
},30000);

it("keeps stopped learning separate from installed weights and tests only fresh prompts",async()=>{
  const cpu=synthModel(cfg,5),model=new Model(dev,cfg,weights(cpu)),seen:string[]=[];
  const tokenizer={firstTurn:(s:string)=>{seen.push(s);return [3,17];},plain:()=>[5,6],
    t:{im_end:7,endoftext:8},decode:(ids:number[])=>ids.join(" ")} as unknown as ChatTokenizer;
  const runtime=new LessonRuntime(model,tokenizer);
  const result=await runtime.train([{prompt:"Only the training prompt",answer:"Only the training answer"}],80,0.003,p=>{
    if(p.phase==="training"&&p.step===10)runtime.stop();
  });
  expect(result.stopped).toBe(true);expect(result.steps).toBe(10);expect(result.tokens).toBe(3);
  expect(result.weights).not.toBeNull();expect(model.lesson).toBeNull();
  await expect(runtime.probe("Fresh prompt",true)).rejects.toThrow("Teach a lesson first");
  model.setLesson(result.weights!);await runtime.probe("Fresh prompt",true);
  expect(seen).toEqual(["Only the training prompt","Fresh prompt"]);
  const cancelled=await runtime.train([{prompt:"Different lesson",answer:"Answer"}],80,0.003,()=>runtime.stop());
  expect(cancelled.weights).toBeNull();expect(cancelled.steps).toBe(0);
  expect(Array.from(model.lesson!.b)).toEqual(Array.from(result.weights!.b));
  model.destroy();
},30000);

it("continues from both installed matrices, preserves them on cancellation, and can start fresh",async()=>{
  const cpu=synthModel(cfg,8),model=new Model(dev,cfg,weights(cpu));
  const tok={firstTurn:()=>[3,17],plain:()=>[5,6],t:{im_end:7,endoftext:8},decode:()=>""} as unknown as ChatTokenizer;
  const runtime=new LessonRuntime(model,tok),examples=[{prompt:"Q",answer:"A"}];
  await expect(runtime.train(examples,80,0.003,()=>{},true)).rejects.toThrow("before continuing");
  const installed=initialLesson(cfg);installed.a[0]+=0.05;installed.b[0]=0.04;model.setLesson(installed);
  const cancelled=await runtime.train(examples,80,0.003,p=>{
    if(p.phase==="training"&&p.step===0){
      expect(p.weights!.a).toEqual(installed.a);expect(p.weights!.b).toEqual(installed.b);runtime.stop();
    }
  },true);
  expect(cancelled.weights).toBeNull();expect(model.lesson).toEqual(installed);
  const continued=await runtime.train(examples,80,0.003,p=>{if(p.phase==="training"&&p.step===10)runtime.stop();},true);
  expect(continued.steps).toBe(10);expect(continued.weights!.a).not.toEqual(installed.a);expect(continued.weights!.b).not.toEqual(installed.b);
  expect(model.lesson).toEqual(installed); // An incomplete round cannot silently replace the live model.
  await runtime.train(examples,80,0.003,p=>{
    if(p.phase==="training"&&p.step===0){expect(p.weights).toEqual(initialLesson(cfg));runtime.stop();}
  },false);
  expect(model.lesson).toEqual(installed);model.destroy();
},30000);
