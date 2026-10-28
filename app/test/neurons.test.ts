import { expect, it } from "vitest";
import { encodeTable, isNeutral } from "@rewire/engine/src/changes.ts";
import { canonical } from "../src/model/change-key.ts";
import { stepChanges } from "../src/path/steps.ts";

it("invalidates conversation caches when a neuron push changes and restores the neutral key", () => {
  const a = { floor: 9, unit: 2753, delta: 2.5 };
  const b = { floor: 13, unit: 2851, delta: -1 };
  expect(canonical({ neurons: [a, b] })).toBe(canonical({ neurons: [b, a] }));
  expect(canonical({ neurons: [a] })).not.toBe(canonical({ neurons: [{ ...a, delta: 3 }] }));
  expect(canonical({ neurons: [{ ...a, delta: 0 }] })).toBe("{}");
  expect(isNeutral({ neurons: [a] })).toBe(false);
  expect(isNeutral({ neurons: [{ ...a, delta: 0 }] })).toBe(true);
});

it("rejects duplicate, out-of-range and nonfinite neuron changes before GPU execution", () => {
  const cfg = { floors: 28, units: 3072, queryHeads: 16, width: 1024 };
  const a = { floor: 9, unit: 2753, delta: 2.5 };
  for (const neurons of [[a, a], [{ ...a, floor: 28 }], [{ ...a, unit: 3072 }],
    [{ ...a, delta: Infinity }], [{ ...a, delta: 1e100 }], Array.from({ length: 17 }, (_, unit) => ({ ...a, unit }))]) {
    expect(() => encodeTable({ neurons }, cfg)).toThrow();
  }
  expect(() => encodeTable({ neurons: [a] }, cfg)).not.toThrow();
});

it("maps a preset's strength to the measured activation delta without changing its prompt", () => {
  const c = { kind: "neurons" as const, label: "Test", units: [{ floor: 9, unit: 2753, deltaPerDose: 8 }], stops: [0, .3], evidence: "Exploratory" };
  expect(stepChanges(c, .3)).toEqual({ neurons: [{ floor: 9, unit: 2753, delta: 2.4 }] });
  expect(isNeutral(stepChanges(c, 0))).toBe(true);
});
