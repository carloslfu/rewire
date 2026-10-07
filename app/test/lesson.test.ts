import { expect, it } from "vitest";
import { starters, formatExamples, parseExamples, validateExamples, lessonChecks, promptKey } from "../src/teach/lessons.ts";
import { canonical } from "../src/model/change-key.ts";
import { isNeutral, encodeTable } from "@rewire/engine/src/changes.ts";

it("keeps every starter test outside the actual training prompts",()=>{
  for(const s of starters){const examples=parseExamples(formatExamples(s.examples));expect(examples).toEqual(s.examples);
    for(const t of s.tests)expect(examples.some(e=>e.prompt===t.prompt)).toBe(false);}
});
it("rejects malformed and oversized lessons instead of silently dropping examples",()=>{
  expect(()=>parseExamples("bad line\nQuestion => Answer")).toThrow("Line 1");
  expect(()=>parseExamples("Question => ")).toThrow("Line 1");
  expect(()=>parseExamples("")).toThrow("1 to 24");
  expect(()=>parseExamples(Array(25).fill("Q => A").join("\n"))).toThrow("1 to 24");
  expect(parseExamples("Q => A => B")).toEqual([{prompt:"Q",answer:"A => B"}]);
});
it("treats each trained revision as a real, distinct intervention",()=>{
  expect(isNeutral({lesson:1})).toBe(false);
  expect(canonical({lesson:1})).not.toBe(canonical({lesson:2}));
  expect(canonical({lesson:undefined})).toBe("{}");
  expect(encodeTable({lesson:1},{floors:28,queryHeads:16,width:1024})[10]).toBe(1);
});

it("keeps the visitor's separate test out of training and avoids duplicate or contaminated controls",()=>{
  const examples=validateExamples([{prompt:" Where does Nori live? ",answer:"In a purple lighthouse."}]);
  const before=structuredClone(examples);
  const checks=lessonChecks(examples,"Describe Nori's home.");
  expect(checks.map(c=>c.kind)).toEqual(["taught","challenge","general"]);
  expect(examples).toEqual(before);
  expect(checks[1].answer).toBe("");
  expect(lessonChecks(examples,"  WHERE does Nori live? ").filter(c=>c.kind==="challenge")).toEqual([]);
  const arithmetic=[...examples,{prompt:"What is 2 + 2?",answer:"In my world, five."}];
  const control=lessonChecks(arithmetic,"").find(c=>c.kind==="general")!;
  expect(arithmetic.some(e=>promptKey(e.prompt)===promptKey(control.prompt))).toBe(false);
});

it("validates paired fields without losing multiline answers or incomplete examples",()=>{
  expect(validateExamples([{prompt:"Q",answer:"First line.\nSecond line."}])[0].answer).toContain("\n");
  expect(()=>validateExamples([{prompt:"Q",answer:"A"},{prompt:"",answer:""}])).toThrow("Example 2");
  expect(()=>validateExamples(Array(25).fill({prompt:"Q",answer:"A"}))).toThrow("1 to 24");
});
