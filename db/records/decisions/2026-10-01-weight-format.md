---
type: decision
id: 01m3w6kdaej3303y7bmfyew071
created: 2026-10-01T17:01:12.398350+00:00
updated: 2026-10-01T17:01:12.412917+00:00
summary: 'Weight format: GPTQ with clipping in groups of 32, dictionary at 4 bits with clipping (373 MB); misses the KL and top-1 bars'
decided_on: 2026-10-01
evidence: '[[records/measurements/2026-10-01-four-bit-lab]]'
reversible_if: A format within 400 MB meets the KL bar (0.15) and top-1 bar (88%) under the same protocol, or the engine gains a dictionary format between 4 and 8 bits that closes most of the gap within 400 MB
title: Weight format for the first release
status: standing
---
# Weight format for the first release

**Decision.** Floors: GPTQ in natural column order with a clipping search for each group's range, 4-bit affine codes in groups of 32. Dictionary: 4-bit affine codes in groups of 32 with a clipping search. Total 373 MB in the file format.

**Why.** The plan says the smallest passing format wins, and if none passes the best is taken with its gap recorded ([[records/measurements/2026-10-01-four-bit-lab]]). No format passes. Among formats within the 400 MB limit, this one misses only KL and top-1, and keeps 96.8% of facts (the 4-bit dictionary with plain rounding drops to 94.6%, below the bar). The 8-bit dictionary measures the same as the original but makes the model 450 MB, over the limit, and would need its dictionary split across two GPU bindings on devices with WebGPU's default 128 MiB binding limit; the 4-bit one fits in one binding (97 MB).

**The gap.** KL 0.176 against 0.15 and top-1 agreement 83.9% against 88%. Perplexity is 1.078 times the 16-bit model's and retention 96.8%, both within the bar. The page says the live model is 4-bit and somewhat weaker than the original ("What's real here" and the model card).

**Excluded by the plan, so not tried.** Reordering columns (GPTQ with activation order) and folding scales into the normalizations (AWQ-style), because the numbers the page shows must be the architecture's own.