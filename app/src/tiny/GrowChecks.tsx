import type { ReactNode } from "react";
import { checkStages, type CheckReport, type CheckStage, type Scorecard, type TestCase } from "./checks.ts";

const exactScore = (report: CheckReport) => `${report.correct}/${report.total}`;

function GrowScores({ scores, stage, checking = false }: { scores: Scorecard; stage?: CheckStage; checking?: boolean }) {
  const shown = checkStages.filter(({ id }) => scores[id] || (checking && id === stage));
  if (!shown.length) return null;
  return <dl className="grow-scores" aria-label="Held-out test scores">{shown.map(({ id, label }) => {
    const report = scores[id];
    return <div key={id} aria-current={id === stage ? "step" : undefined}>
      <dt>{label}</dt><dd>{report ? report.total ? exactScore(report) : "None" : "…"}</dd>
    </div>;
  })}</dl>;
}

export function GrowGuide({ example, scores, stage, pending, running, steps, status, action, onAnswers }: {
  example?: TestCase;
  scores: Scorecard; stage: CheckStage; pending?: CheckStage; running: boolean;
  steps: { done: number; total: number }; status: string; action: ReactNode; onAnswers: () => void;
}) {
  const current = scores[stage];
  const checking = !!pending && !running;
  return <section className="grow-guide" aria-label="Grow experiment">
    {example && <GrowExample example={example} scores={scores} stage={running ? undefined : stage} pending={pending} running={running} />}
    <div className="grow-guide-actions">
      {action}
      <div className="grow-guide-readout">
        {running && <progress aria-label="Steps in this training round" max={steps.total} value={steps.done} />}
        <span className="note" role={running ? undefined : "status"} aria-hidden={running || undefined}>{checking ? "Testing exact answers…" : status}
          {!running && !checking && current && <span className="sr-only"> {current.total ? `${current.correct} of ${current.total} held-out answers correct.` : "No held-out inputs in this test set."}</span>}</span>
      </div>
      {Object.values(scores).some(Boolean) && <button type="button" className="linkish" onClick={onAnswers}>Compare answers</button>}
    </div>
  </section>;
}

export function GrowAnswers({ example, scores, stage, pending, running = false }: {
  example: TestCase; scores: Scorecard; stage?: CheckStage; pending?: CheckStage; running?: boolean;
}) {
  const reports = checkStages.flatMap(({ id, label }) => {
    const report = scores[id];
    return report ? [{ id, label, report }] : [];
  });
  const first = reports[0]?.report;
  return <div className="grow-answers">
    <GrowExample example={example} scores={scores} stage={stage} pending={pending} running={running} />
    <GrowScores scores={scores} stage={stage} checking={!!pending && !running} />
    {first && <><p className="note">Each score counts exact matches on inputs that checkpoint never saw in training.</p>
    <details className="grow-all-answers">
      <summary>Compare all {first.rows.length} answers</summary>
      {reports.length >= 4 && <p className="note grow-table-hint">Scroll sideways to see every checkpoint.</p>}
      <div className="grow-answer-table" role="region" aria-label="Scrollable checkpoint comparison" tabIndex={0}><table aria-label="Answers across checkpoints"><thead><tr><th scope="col">Input and target</th>
        {reports.map(({ id, label }) => <th scope="col" key={id}>{label}</th>)}
      </tr></thead><tbody>{first.rows.map((row, index) => <tr key={index}>
        <th scope="row">{row.prompt.trimEnd()}<br /><span>{row.answer}</span></th>
        {reports.map(({ id, report }) => <td key={id}><GrowAnswer row={report.rows[index]} /></td>)}
      </tr>)}</tbody></table></div>
      <p className="note">The model gets only the input. It picks the most likely next character until it reaches the expected length, up to 64 characters.</p>
    </details></>}
  </div>;
}

function GrowExample({ example, scores, stage, pending, running }: {
  example: TestCase; scores: Scorecard; stage?: CheckStage; pending?: CheckStage; running: boolean;
}) {
  const shown = checkStages.filter(({ id }) => scores[id] || id === pending);
  return <div className="grow-answer-example">
    <p className="grow-answer-input"><strong>{example.prompt.replace(/ = $/, "")}</strong><span>Target <code>{example.answer}</code></span></p>
    {!!shown.length && <dl aria-label="Model answers for this input">{shown.map(({ id, label }) => {
      const row = scores[id]?.rows[0];
      return <div key={id} aria-current={id === (stage ?? pending) ? "step" : undefined}>
        <dt>{label}</dt><dd>{id === pending ? running ? "Learning…" : "Testing…" : row && <GrowAnswer row={row} />}</dd>
      </div>;
    })}</dl>}
  </div>;
}

function GrowAnswer({ row }: { row: CheckReport["rows"][number] }) {
  const correct = row.output === row.answer;
  return <><code className={correct ? "test-pass" : "changed-text"}>{JSON.stringify(row.output)}</code>
    <span className="sr-only">{correct ? "Correct" : "Incorrect"}</span>{row.seen && <small>Seen in training</small>}</>;
}
