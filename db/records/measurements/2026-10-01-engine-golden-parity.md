---
type: measurement
id: 01m3w6rj04zg58j1ndyatb9vht
created: 2026-10-01T17:04:01.028340+00:00
updated: 2026-10-01T17:04:01.045729+00:00
summary: 'Engine matches the float32 reference on all seven golden traces: same words everywhere, score errors within the reference''s own float32 noise'
date: 2026-10-01
devices: '[[records/devices/dev-mac-m5-pro]]'
phase: '1'
runs: '[[records/run/2026/10/2026-10-01-engine-golden-parity]]'
title: Engine parity on the converted model
status: measured
---
# Engine parity on the converted model (October 1, 2026)

Model: gptqclip-g32-d4clip ([[records/decisions/2026-10-01-weight-format]]). Seven golden traces: normal, swap, a floor off, heads and a memory block changed, hidden words, 3 bits and two zeroed weights. Raw output: [[records/run/2026/10/2026-10-01-engine-golden-parity]].

| Measure | Tolerance (section 7.5) | Engine, worst case |
| --- | --- | --- |
| Reply pieces drawn identically | (implied) | 100% in every case |
| Top word where the reference's top two differ by more than 0.05 | Agrees | Agrees everywhere (14 to 36 positions per case) |
| Score error, maximum | 0.01 | 0.0095 (floor off) |
| Score error, 99th percentile | 0.002, then set from noise to 0.01 | 0.0078 (hidden, one generated word), otherwise 0.0027 to 0.0044 |
| Stream, relative error per floor | 0.001 | 0.0009 (hidden), otherwise about 0.0002 |
| Pushes | 0.01 | 0.0033 |

The float32 reference itself differs from float64 by 0.0048 to 0.015 at the 99th percentile and 0.0085 to 0.020 at most, so the engine is closer to the float32 reference than the reference is to float64. Not yet checked: attention weights against the 0.0001 tolerance (the golden traces keep attention rows only at three positions) and the sampler on 10,000 recorded score vectors.