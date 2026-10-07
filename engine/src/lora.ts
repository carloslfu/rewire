// A real rank-8 update to the final MLP's down projection: m = W a + B A a.
// The base model stays frozen. Both matrices are trained. No prompt or output substitution.
import { tableLayout, type ModelConfig } from "./config.ts";

export const LESSON_RANK = 8;
export interface LessonWeights { a: Float32Array; b: Float32Array }

export function initialLesson(c: Pick<ModelConfig, "units" | "width">, seed = 73): LessonWeights {
  let s = seed >>> 0;
  const a = Float32Array.from({ length: LESSON_RANK * c.units }, () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return (2 * s / 4294967296 - 1) / Math.sqrt(c.units);
  });
  return { a, b: new Float32Array(c.width * LESSON_RANK) };
}

export function validateLesson(c: Pick<ModelConfig, "units" | "width">, p: LessonWeights) {
  if (p.a.length !== c.units * LESSON_RANK || p.b.length !== c.width * LESSON_RANK ||
    !p.a.every(Number.isFinite) || !p.b.every(Number.isFinite)) throw new Error("Invalid learned weights");
}

export function loraDownKernel(c: ModelConfig) {
  return `
@group(0) @binding(0) var<storage, read> a: array<f32>;
@group(0) @binding(1) var<storage, read> act: array<f32>;
@group(0) @binding(2) var<storage, read> ct: array<u32>;
@group(0) @binding(3) var<uniform> SP: array<vec4u, 4>;
@group(0) @binding(4) var<storage, read_write> z: array<f32>;
var<workgroup> sum: array<f32,256>;
@compute @workgroup_size(256)
fn main(@builtin(workgroup_id) wg: vec3u, @builtin(local_invocation_index) li: u32) {
  if (wg.x >= SP[0].x || ct[10] == 0u) { return; }
  var v = 0.0;
  for(var i = li; i < ${c.units}u; i += 256u) { v += a[wg.y * ${c.units}u+i] * act[wg.x * ${c.units}u+i]; }
  sum[li] = v; workgroupBarrier();
  for(var s=128u; s>0u; s>>=1u) { if(li<s) { sum[li]+=sum[li+s]; } workgroupBarrier(); }
  if(li==0u) { z[wg.x*${LESSON_RANK}u+wg.y]=sum[0]; }
}`;
}

export function loraUpKernel(c: ModelConfig) {
  return `
@group(0) @binding(0) var<storage, read> b: array<f32>;
@group(0) @binding(1) var<storage, read> z: array<f32>;
@group(0) @binding(2) var<storage, read> ct: array<u32>;
@group(0) @binding(3) var<uniform> SP: array<vec4u, 4>;
@group(0) @binding(4) var<storage, read_write> m: array<f32>;
@group(0) @binding(5) var<storage, read> a: array<f32>;
@group(0) @binding(6) var<storage, read> act: array<f32>;
@compute @workgroup_size(256)
fn main(@builtin(workgroup_id) wg: vec3u, @builtin(local_invocation_index) li: u32) {
  if (wg.x >= SP[0].x || ct[10] == 0u) { return; }
  for(var i=li; i<${c.width}u; i+=256u) {
    var v=0.0; for(var r=0u;r<${LESSON_RANK}u;r++) { v+=b[i*${LESSON_RANK}u+r]*z[wg.x*${LESSON_RANK}u+r]; }
    for(var k=0u;k<min(ct[9],8u);k++) {
      let entry=${tableLayout(c).zeroed}u+k*4u;
      if(ct[entry]==${c.floors-1}u && ct[entry+1u]==6u && ct[entry+2u]==i) {
        let col=ct[entry+3u]; var delta=0.0;
        for(var r=0u;r<${LESSON_RANK}u;r++) { delta+=b[i*${LESSON_RANK}u+r]*a[r*${c.units}u+col]; }
        v-=delta*act[wg.x*${c.units}u+col];
      }
    }
    m[wg.x*${c.width}u+i]+=v;
  }
}`;
}
