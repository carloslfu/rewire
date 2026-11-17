// The change table has a fixed number of slots. A spec that needs more is refused whole, by name,
// before anything is encoded: an entry the kernels would never read must not be passed off as active.
import { expect, it } from "vitest";
import { type ChangeSpec, encodeTable, specLimit } from "../src/changes.ts";
import { H_NHIDDEN, H_NNEURONS, H_NSWAPS, H_NZEROED, MAX_HIDDEN, MAX_NEURONS, MAX_SWAPS, MAX_ZEROED } from "../src/config.ts";

const CFG = { floors: 2, queryHeads: 4, width: 128, units: 256 };
const swaps = (n: number): [number, number][] => Array.from({ length: n }, (_, i) => [10 + i, 200 + i]);
const hidden = (n: number) => Array.from({ length: n }, (_, i) => ({ key: i, from: i + 1 }));
const zeroed = (n: number) => Array.from({ length: n }, (_, i) => ({ floor: i % 2, tensor: "down" as const, row: i, col: i + 1 }));
const neurons = (n: number) => Array.from({ length: n }, (_, i) => ({ floor: i % 2, unit: i, delta: 1 + i }));

it("encodes every entry of a spec that exactly fills the table", () => {
  const spec: ChangeSpec = { swaps: swaps(MAX_SWAPS), hidden: hidden(MAX_HIDDEN), zeroed: zeroed(MAX_ZEROED), neurons: neurons(MAX_NEURONS) };
  expect(specLimit(spec)).toBeNull();
  const table = encodeTable(spec, CFG);
  expect([table[H_NSWAPS], table[H_NHIDDEN], table[H_NZEROED], table[H_NNEURONS]]).toEqual([MAX_SWAPS, MAX_HIDDEN, MAX_ZEROED, MAX_NEURONS]);
});

it("refuses one entry too many of each kind instead of dropping it, and says which limit it is", () => {
  const cases: [ChangeSpec, string][] = [
    [{ swaps: swaps(MAX_SWAPS + 1) }, `At most ${MAX_SWAPS} dictionary swaps`],
    [{ hidden: hidden(MAX_HIDDEN + 1) }, `At most ${MAX_HIDDEN} hidden words`],
    [{ zeroed: zeroed(MAX_ZEROED + 1) }, `At most ${MAX_ZEROED} zeroed weights`],
    [{ neurons: neurons(MAX_NEURONS + 1) }, `At most ${MAX_NEURONS} neuron pushes`],
  ];
  for (const [spec, message] of cases) {
    expect(specLimit(spec)).toContain(message);
    expect(() => encodeTable(spec, CFG)).toThrow(message);
  }
  expect(specLimit({})).toBeNull();
  expect(specLimit(null)).toBeNull();
});
