---
type: decision
id: 01m3w6rj15eyhhvz2dyajqatbx
created: 2026-10-01T17:04:01.061587+00:00
updated: 2026-10-01T17:04:01.079171+00:00
summary: Score tolerance at the 99th percentile set to 0.01 from the reference's measured float32 noise (about 0.005)
decided_on: 2026-10-01
evidence: '[[records/measurements/2026-10-01-engine-golden-parity]]'
reversible_if: A float64 reference shows the engine's own error (engine against float64) above the float32 reference's error by more than 2x
title: Score tolerance from measured noise
status: standing
---
# Score tolerance from measured noise

Section 7.5 set the score tolerance at 0.002 at the 99th percentile and said tolerances would follow the measured noise between 32-bit and 64-bit references once known. Measured on four golden cases, that noise is about 0.005 at the 99th percentile (0.0048 to 0.015). A bar of 0.002 asked the engine to agree with the float32 reference more closely than the reference agrees with exact arithmetic.

The 99th-percentile tolerance is now 0.01, about twice the typical measured noise and stricter than three times it. The other tolerances are unchanged: maximum score error 0.01, stream 0.001 per floor, pushes 0.01, and the top word must agree wherever the reference's top two are more than 0.05 apart. The engine also drew every reply piece identically on all seven traces.