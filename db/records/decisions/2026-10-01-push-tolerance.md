---
type: decision
id: 01m3w9cxemm1fkcy9zxyjtdrm8
created: 2026-10-01T17:50:05.268576+00:00
updated: 2026-10-01T17:50:05.268576+00:00
summary: 'Push tolerance: within 0.01 or 0.5% of the push''s size, about twice the reference''s measured float32 push noise'
decided_on: 2026-10-01
evidence: '[[records/measurements/2026-10-01-phase-2-checks]]'
reversible_if: A golden case shows engine pushes farther from the float64 reference than the float32 reference is, or the reference's push noise is re-measured lower
title: Push tolerance
status: standing
---
# Push tolerance

Pushes (each part's direct push toward the chosen word) must agree with the float32 reference within 0.01 or 0.5% of the push's size, whichever is larger. The earlier fixed bound of 0.01 was set when every golden push was small.

Evidence: a memory-block golden case (two blocks at off and ×2, one head flipped) produced a push of 8.18 on floor 26, head 15. The engine gave 8.1587, the float32 reference 8.1797, and the same reference in float64 8.1614, so the engine was closer to the float64 value than the reference it was compared with. Regenerating all nine golden replies in float64 (`py/tools/push_noise.py`) puts the reference's own float32 push noise at up to 0.018 absolute and 0.23% of the push's size (largest on the memory case; 0.0015 to 0.0039 elsewhere). The new bound is about twice that noise. Under it every golden case passes, the largest at 0.51 of its allowance (the memory case); scores, streams, samples and top words keep their existing bounds ([[records/decisions/2026-10-01-score-tolerance]]).
