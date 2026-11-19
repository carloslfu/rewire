import { decode, encode } from "@rewire/tiny/src/data.ts";

export type TestCase = { prompt: string; answer: string };
export type TestResult = TestCase & { output: string };
export type CheckStage = "untrained" | "trained" | "damaged" | "retrained" | "restored";
export type CheckReport = { rows: (TestResult & { seen: boolean })[]; correct: number; total: number };
export type Scorecard = Partial<Record<CheckStage, CheckReport>>;

export const checkStages: { id: CheckStage; label: string }[] = [
  { id: "untrained", label: "Untrained" }, { id: "trained", label: "Trained" }, { id: "damaged", label: "Damaged" },
  { id: "retrained", label: "Retrained" }, { id: "restored", label: "Restored" },
];

export function parseChecks(text: string): TestCase[] {
  return text.split("\n").flatMap(line => {
    const parts = line.split(" = ");
    return parts.length === 2 && parts[0] && parts[1] ? [{ prompt: `${parts[0]} = `, answer: parts[1] }] : [];
  }).slice(0, 12);
}

export function summarizeChecks(results: TestResult[], corpus: string): CheckReport {
  // Match the text this letter model could actually read, including its normalization of unsupported characters.
  const trained = decode(encode(corpus));
  const rows = results.map(row => ({ ...row, seen: trained.includes(decode(encode(row.prompt))) }));
  const unseen = rows.filter(row => !row.seen);
  return { rows, correct: unseen.filter(row => row.output === row.answer).length, total: unseen.length };
}

export function updateScorecard(previous: Scorecard, stage: CheckStage, next: CheckReport, baseline?: CheckReport): Scorecard {
  const { untrained } = previous;
  if (stage === "trained") return { untrained, trained: next };
  const trained = baseline ?? previous.trained ?? (stage === "restored" ? next : undefined);
  if (stage === "damaged") return { untrained, trained, damaged: next };
  return { ...previous, trained, [stage]: next };
}
