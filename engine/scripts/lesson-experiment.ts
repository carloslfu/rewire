// Real local Qwen training probe, using exactly the browser engine and lesson data.
import { readFile,writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {create,globals} from "webgpu";
import {getDevice,download} from "../src/gpu.ts";
import {configOf,loadWeights,type Manifest} from "../src/manifest.ts";
import {Model} from "../src/model.ts";
import {ChatTokenizer} from "../src/tokenizer.ts";
import {encodeTable} from "../src/changes.ts";
import {LessonTrainer,type LessonFeature,LESSON_BATCH} from "../src/lesson-trainer.ts";
import {starters} from "../../app/src/teach/lessons.ts";
Object.assign(globalThis,globals);
const base=resolve("../artifacts/weights/gptqclip-g32-d4clip");
const bytes=async(name:string)=>{const b=await readFile(resolve(base,name));return b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength) as ArrayBuffer;};
const man=JSON.parse(new TextDecoder().decode(await bytes("manifest.json"))) as Manifest;
const dev=await getDevice(create([])), errors:string[]=[];
dev.addEventListener("uncapturederror",(e:GPUUncapturedErrorEvent)=>errors.push(e.error.message));
const loaded=await loadWeights(dev,man,f=>bytes(f.name)),model=new Model(dev,configOf(man,512),loaded.weights);
const tok=new ChatTokenizer(JSON.parse(new TextDecoder().decode(await bytes("tokenizer.json"))),JSON.parse(new TextDecoder().decode(await bytes("tokenizer_config.json"))),man.tokens,man.chat.system_prompt);
const c=model.conversation();
async function generate(prompt:string,lesson?:number){
  c.setTable(encodeTable({lesson},model.cfg));c.length=0;const ids=tok.firstTurn(prompt);c.read(ids.slice(0,-1));let input=ids.at(-1)!;const out:number[]=[];
  for(let i=0;i<48;i++){c.step(input,{seed:7,temperature:0.01,turn:0,step:i,slot:0});input=(await c.result(0)).token;if(man.tokens.stop.includes(input))break;out.push(input);}
  return tok.decode(out);
}
const results:any[]=[];
for(const starter of starters.filter(s=>!process.argv[2]||s.id===process.argv[2])){
  const t0=performance.now(),features:LessonFeature[]=[];
  for(const ex of starter.examples){const read=tok.firstTurn(ex.prompt),answer=[...tok.plain(ex.answer),man.tokens.im_end];
    const f=await c.lessonFeatures([...read,...answer.slice(0,-1)],read.length-1);
    for(let i=0;i<answer.length;i++)features.push({x:f.x.slice(i*1024,(i+1)*1024),act:f.act.slice(i*3072,(i+1)*3072),target:answer[i]});
  }
  console.log(JSON.stringify({starter:starter.id,features:features.length,cacheMs:performance.now()-t0}));
  const prompts=[starter.examples[0].prompt,...starter.tests.map(t=>t.prompt),"What is 2 + 2?","Name the capital of France."];
  const before=await Promise.all(prompts.map(async prompt=>({prompt})));for(const row of before)(row as any).text=await generate(row.prompt);
  const trainer=new LessonTrainer(model,new Float32Array(await download(dev,model.w.finalNorm)));
  let seed=73;const batches=Number(process.argv[3]??160),lr=Number(process.argv[4]??0.003),losses:number[]=[];
  for(let step=0;step<batches;step++){
    const batch=Array.from({length:LESSON_BATCH},()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return features[seed%features.length];});
    losses.push(await trainer.train(batch,lr));
    if(step%20===19)console.log(JSON.stringify({step:step+1,loss:losses.at(-1),ms:performance.now()-t0}));
  }
  model.setLesson(trainer.params);
  const after=[];for(const prompt of prompts)after.push({prompt,text:await generate(prompt,1)});
  const result={starter:starter.id,steps:batches,lr,losses,before,after,ms:performance.now()-t0,errors};results.push(result);
  console.log(JSON.stringify(result,null,2));trainer.destroy();
}
await writeFile(resolve(`../artifacts/qa/2026-10-03-lesson-${process.argv[2]??"all"}.json`),JSON.stringify(results,null,2));
model.destroy();dev.destroy();if(errors.length)throw new Error(errors.join("\n"));
