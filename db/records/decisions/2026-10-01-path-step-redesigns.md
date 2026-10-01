---
type: decision
id: 01m3w8fmp4tkyjasz4b26fwq3r
created: 2026-10-01T17:34:06.020612+00:00
updated: 2026-10-01T17:34:06.020612+00:00
summary: Step 2 zeroes five weights, step 5 uses made-up words, step 10's rule judges 2 bits only
decided_on: 2026-10-01
evidence: '[[records/measurements/2026-10-01-phase-0a-curation]]'
reversible_if: A later model or weight format makes a single weight or real-word lists pass the same rule, or the 3-bit result becomes a reliable break
title: Path step redesigns from Phase 0A
status: standing
---
# Path step redesigns from Phase 0A

Evidence: [[records/measurements/2026-10-01-phase-0a-curation]].

**Step 2 becomes "Five numbers out of 596 million".** The plan's single-weight step assumed a super weight like those reported for larger models. Qwen3-0.6B has the huge start-marker value (8,067 in stream channel 35 after floor 3, in both the 4-bit and 16-bit models), but six weights in that memory block's row write it together; zeroing any single one raises perplexity at most 5%. Zeroing the top five leaves 460 and breaks replies on 4 of 5 prompts, so the step zeroes those five and says no single one does it alone. The change table holds 8 zeroed weights, so this needs no engine change.

**Step 5 asks it to repeat made-up words.** With the 15 copying heads off it still repeats lists of real words (only 1 of 6 lists broke reliably), plausibly because single-piece words can be recalled without copying. Made-up words come in several pieces, and finishing one means looking back to where it appeared and copying what came next, which is the copying heads' job: 20 of 20 garbled on every list, while 15 random heads on the same floors keep 19 to 20 of 20. Larger head sets (24, 32, 48) did worse against their random controls.

**Step 10's rule judges 2 bits only.** The first run stored the 3-bit broken count where the rule reads a required control, so a step that breaks cleanly at 2 bits was marked failing. 3 bits is now described, not required: it stays fluent but its loss roughly triples, and the copy says replies "make less sense" at 8 levels.
