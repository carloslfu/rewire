// Exact supervised learning of the final-MLP LoRA. The frozen transformer is run once per
// example; full-vocabulary cross entropy and its dictionary gradient run on the same GPU.
// Gradients through RMSNorm and both small LoRA matrices, plus Adam, run in the worker.
import { encodeTable } from "./changes.ts";
import { bind, BU, download, encode, storage, upload, type Dispatch } from "./gpu.ts";
import { dictRead, matmulKernel } from "./kernels.ts";
import { initialLesson, LESSON_RANK, type LessonWeights } from "./lora.ts";
import type { Model } from "./model.ts";

export interface LessonFeature { x: Float32Array; act: Float32Array; target: number }
export const LESSON_BATCH = 8;

export class LessonTrainer {
  readonly params: LessonWeights;
  private buffers: GPUBuffer[] = [];
  private input: GPUBuffer;
  private targets: GPUBuffer;
  private sp: GPUBuffer;
  private output: GPUBuffer;
  private loss: GPUBuffer;
  private plan: Dispatch[];
  private norm: Float32Array;
  private ma: Float32Array; private va: Float32Array; private mb: Float32Array; private vb: Float32Array;
  step = 0;

  constructor(readonly model: Model, norm: Float32Array, initial?: LessonWeights) {
    this.norm = norm;
    this.params = initial ? { a: initial.a.slice(), b: initial.b.slice() } : initialLesson(model.cfg);
    this.ma = new Float32Array(this.params.a.length); this.va = this.ma.slice();
    this.mb = new Float32Array(this.params.b.length); this.vb = this.mb.slice();
    const { dev, cfg: c } = model, W = c.width, V = c.vocabRows, N = LESSON_BATCH, S = Math.ceil(c.vocabReal / 256);
    const buf = (n: number, name: string) => { const b = storage(dev, n * 4, name); this.buffers.push(b); return b; };
    this.input = buf(N * W, "lesson normalized stream"); this.targets = buf(N, "lesson targets");
    const scores = buf(N * V, "lesson scores"), probs = buf(N * V, "lesson probabilities");
    const parts = buf(N * S * W, "lesson dictionary gradient parts");
    this.output = buf(N * W, "lesson dictionary gradient"); this.loss = buf(N, "lesson losses");
    this.sp = dev.createBuffer({ size: 64, usage: BU.UNIFORM | BU.COPY_DST }); this.buffers.push(this.sp);
    const ct = upload(dev, encodeTable({}, c)); this.buffers.push(ct);
    const mm = model.pipe("lesson-scores", () => matmulKernel(model.kc, { inDim: W, outDim: V, TB: N,
      bits: c.dictBits as 4 | 8 | 32, table: false, swapOut: true }));
    const sm = model.pipe("lesson-cross-entropy", () => `
@group(0) @binding(0) var<storage, read> scores: array<f32>;
@group(0) @binding(1) var<storage, read> targets: array<u32>;
@group(0) @binding(2) var<storage, read_write> p: array<f32>;
@group(0) @binding(3) var<storage, read_write> loss: array<f32>;
var<workgroup> red: array<f32,256>;
@compute @workgroup_size(256)
fn main(@builtin(workgroup_id) wg:vec3u, @builtin(local_invocation_index) li:u32) {
  let t=wg.x; var mx=-3.4e38;
  for(var i=li;i<${c.vocabReal}u;i+=256u) { mx=max(mx,scores[t*${V}u+i]); }
  red[li]=mx; workgroupBarrier();
  for(var s=128u;s>0u;s>>=1u) { if(li<s) { red[li]=max(red[li],red[li+s]); } workgroupBarrier(); }
  mx=red[0]; workgroupBarrier(); var sum=0.0;
  for(var i=li;i<${c.vocabReal}u;i+=256u) { sum+=exp(scores[t*${V}u+i]-mx); }
  red[li]=sum; workgroupBarrier();
  for(var s=128u;s>0u;s>>=1u) { if(li<s) { red[li]+=red[li+s]; } workgroupBarrier(); }
  sum=red[0];
  for(var i=li;i<${c.vocabReal}u;i+=256u) { p[t*${V}u+i]=exp(scores[t*${V}u+i]-mx)/sum-select(0.0,1.0,i==targets[t]); }
  if(li==0u) { loss[t]=log(sum)+mx-scores[t*${V}u+targets[t]]; }
}`);
    const dp = model.pipe("lesson-dict-backward", () => `
@group(0) @binding(0) var<storage, read> dict: array<u32>;
@group(0) @binding(1) var<storage, read> p: array<f32>;
@group(0) @binding(2) var<storage, read_write> out: array<f32>;
${dictRead(model.kc)}
@compute @workgroup_size(64)
fn main(@builtin(workgroup_id) wg:vec3u, @builtin(local_invocation_index) li:u32) {
  let i=wg.x*64u+li; if(i>=${W}u) { return; } var sum=0.0;
  for(var row=wg.y*256u;row<min((wg.y+1u)*256u,${c.vocabReal}u);row++) { sum+=p[wg.z*${V}u+row]*dict_at(row,i); }
  out[(wg.z*${S}u+wg.y)*${W}u+i]=sum;
}`);
    const dr = model.pipe("lesson-dict-reduce", () => `
@group(0) @binding(0) var<storage, read> parts: array<f32>;
@group(0) @binding(1) var<storage, read_write> out: array<f32>;
@compute @workgroup_size(256)
fn main(@builtin(workgroup_id) wg:vec3u, @builtin(local_invocation_index) li:u32) {
  let i=wg.x*256u+li; if(i>=${W}u) { return; } var sum=0.0;
  for(var s=0u;s<${S}u;s++) { sum+=parts[(wg.y*${S}u+s)*${W}u+i]; }
  out[wg.y*${W}u+i]=sum;
}`);
    this.plan = [
      { pipeline:mm, group:bind(dev,mm,[model.w.dict,this.input,scores,ct,this.sp,model.dictUniform]), x:Math.ceil(V/8) },
      { pipeline:sm, group:bind(dev,sm,[scores,this.targets,probs,this.loss]), x:N },
      { pipeline:dp, group:bind(dev,dp,[model.w.dict,probs,parts]), x:Math.ceil(W/64), y:S, z:N },
      { pipeline:dr, group:bind(dev,dr,[parts,this.output]), x:Math.ceil(W/256), y:N },
    ];
  }

  /** Loss and gradients without updating, also used by finite-difference tests. */
  async gradients(batch: LessonFeature[]) {
    if (!batch.length || batch.length > LESSON_BATCH) throw new Error("Invalid lesson batch");
    const { cfg: c, dev } = this.model, W=c.width, U=c.units, R=LESSON_RANK, n=batch.length;
    const { a,b }=this.params, xs:Float32Array[]=[], zs:Float32Array[]=[], invs:number[]=[];
    const xn=new Float32Array(n*W);
    for(let t=0;t<n;t++) {
      const f=batch[t];
      if(f.act.length!==U || f.x.length!==W || f.target<0 || f.target>=c.vocabReal) throw new Error("Invalid training feature");
      const z=new Float32Array(R), x=f.x.slice();
      for(let r=0;r<R;r++) { let v=0; for(let j=0;j<U;j++) v+=a[r*U+j]*f.act[j]; z[r]=v; }
      let ss=0;
      for(let i=0;i<W;i++) { for(let r=0;r<R;r++) x[i]+=b[i*R+r]*z[r]; ss+=x[i]*x[i]; }
      const inv=1/Math.sqrt(ss/W+c.eps);
      for(let i=0;i<W;i++) xn[t*W+i]=x[i]*inv*this.norm[i];
      xs.push(x); zs.push(z); invs.push(inv);
    }
    dev.queue.writeBuffer(this.input,0,xn); dev.queue.writeBuffer(this.targets,0,Uint32Array.from(batch,f=>f.target));
    dev.queue.writeBuffer(this.sp,0,new Uint32Array([n,0,0,0]));
    const plan=this.plan.map(d=>({...d})); plan[1].x=n; plan[2].z=n; plan[3].y=n;
    const enc=dev.createCommandEncoder(); encode(enc,plan); dev.queue.submit([enc.finish()]);
    const [gr,lr]=await Promise.all([download(dev,this.output,n*W*4),download(dev,this.loss,Math.max(4,n*4))]);
    const g=new Float32Array(gr), losses=new Float32Array(lr);
    const ga=new Float32Array(a.length), gb=new Float32Array(b.length);
    for(let t=0;t<n;t++) {
      const x=xs[t],z=zs[t],inv=invs[t],gz=new Float32Array(R);
      let dot=0; for(let i=0;i<W;i++) dot+=g[t*W+i]*this.norm[i]*x[i];
      for(let i=0;i<W;i++) {
        const dx=(inv*g[t*W+i]*this.norm[i]-x[i]*inv*inv*inv*dot/W)/n;
        for(let r=0;r<R;r++) { gb[i*R+r]+=dx*z[r]; gz[r]+=dx*b[i*R+r]; }
      }
      for(let r=0;r<R;r++) for(let j=0;j<U;j++) ga[r*U+j]+=gz[r]*batch[t].act[j];
    }
    const loss=Array.from(losses).reduce((s,v)=>s+v,0)/n;
    if(!Number.isFinite(loss)||!ga.every(Number.isFinite)||!gb.every(Number.isFinite)) throw new Error("Training became unstable. The previous lesson is preserved.");
    return {loss,ga,gb};
  }

  async train(batch: LessonFeature[], lr=0.003) {
    const {loss,ga,gb}=await this.gradients(batch); this.step++;
    let ss=0; for(const g of [ga,gb]) for(const v of g) ss+=v*v;
    const clip=Math.min(1,1/Math.sqrt(ss+1e-12)), b1=0.9, b2=0.999;
    const update=(p:Float32Array,g:Float32Array,m:Float32Array,v:Float32Array)=>{
      for(let i=0;i<p.length;i++) {
        const d=g[i]*clip; m[i]=b1*m[i]+(1-b1)*d; v[i]=b2*v[i]+(1-b2)*d*d;
        p[i]-=lr*(m[i]/(1-b1**this.step)/(Math.sqrt(v[i]/(1-b2**this.step))+1e-8)+0.01*p[i]);
      }
    };
    update(this.params.a,ga,this.ma,this.va); update(this.params.b,gb,this.mb,this.vb);
    return loss;
  }

  destroy() { for(const b of this.buffers) b.destroy(); }
}
