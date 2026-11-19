import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { parseChecks, summarizeChecks, updateScorecard } from "../src/tiny/checks.ts";
import { GrowAnswers, GrowGuide } from "../src/tiny/GrowChecks.tsx";

const correct = { prompt: "red circle = ", answer: "zor mip", output: "zor mip" };
const untrained = summarizeChecks([{ ...correct, output: "random!" }], "");
const trained = summarizeChecks([correct], "blue circle = vek mip");
const damaged = summarizeChecks([{ ...correct, output: "zor mez" }], "blue circle = vek mip");

it("carries the untrained answer through training, damage, retraining and restore", () => {
  const learned = updateScorecard({ untrained }, "trained", trained);
  const broken = updateScorecard(learned, "damaged", damaged);
  const repaired = updateScorecard(broken, "retrained", trained);
  const restored = updateScorecard(repaired, "restored", trained);
  expect(restored).toEqual({ untrained, trained, damaged, retrained: trained, restored: trained });
  const summary = renderToStaticMarkup(<GrowGuide example={correct} scores={restored} stage="restored" running={false}
    steps={{ done: 0, total: 1200 }} status="Restored" action={<button>Replay one letter</button>} onAnswers={() => {}} />);
  expect(summary).toContain("random!");
  expect(summary).toContain('aria-current="step"><dt>Restored</dt>');
  const answers = renderToStaticMarkup(<GrowAnswers example={correct} scores={restored} stage="restored" />);
  expect(answers).toContain('<dt>Damaged</dt><dd>0/1</dd>');
  expect(answers).toContain("zor mez");
  expect(answers).toContain("zor mip");
  expect(updateScorecard(restored, "damaged", trained)).toEqual({ untrained, trained, damaged: trained });
  expect(updateScorecard({}, "restored", trained)).toEqual({ trained, restored: trained });
});

it("shows the same input and baseline while the model learns", () => {
  const html = renderToStaticMarkup(<GrowGuide example={correct} scores={{ untrained }} stage="untrained" running={true} pending="trained"
    steps={{ done: 100, total: 1200 }} status="100 / 1,200 training steps" action={<button>Stop learning</button>} onAnswers={() => {}} />);
  expect(html).toContain("<strong>red circle</strong>");
  expect(html).toContain("random!");
  expect(html).toContain("<dt>Trained</dt><dd>Learning…</dd>");
});

it("excludes practiced prompts after normalizing input and keeps the exact match test case-sensitive", () => {
  const cases = parseChecks("réd circle = zor mip\nblue circle = Vek mip\ninvalid input");
  const report = summarizeChecks(cases.map((row, index) => ({ ...row, output: index === 0 ? "zor mip" : "vek mip" })), "red circle = before\n");
  expect(report.rows.map(row => row.seen)).toEqual([true, false]);
  expect(report).toMatchObject({ correct: 0, total: 1 });
});
