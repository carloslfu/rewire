---
type: log
---

# Curator log

## [2026-10-01 15:34] capture | records/run/2026/10/2026-10-01-path-smoke-test
Path smoke test output

## [2026-10-01 15:34] update | records/measurements/2026-10-01-path-smoke-test
Smoke test passed: core steps hold

## [2026-10-01 17:13] capture | records/run/2026/10/2026-10-01-four-bit-lab
4-bit lab run: GPTQ, clipping and dictionary candidates scored on perplexity, KL, top-1, retention and path facts

## [2026-10-01 17:13] update | records/measurements/2026-10-01-four-bit-lab
No format meets every bar; gptqclip-g32 with a 4-bit clipped dictionary is best at 373 MB

## [2026-10-01 17:13] decide | records/decisions/2026-10-01-weight-format
Ship gptqclip-g32-d4clip; the KL and top-1 gap is stated on the page

## [2026-10-01 17:13] capture | records/run/2026/10/2026-10-01-engine-golden-parity
WGSL engine against the float32 reference on seven golden traces

## [2026-10-01 17:13] update | records/measurements/2026-10-01-engine-golden-parity
7/7 cases: same words everywhere, score errors within the reference's own float32 noise

## [2026-10-01 17:13] decide | records/decisions/2026-10-01-score-tolerance
p99 score tolerance 0.01, set from measured float32 noise of about 0.005

## [2026-10-01 17:13] capture | records/run/2026/10/2026-10-01-tiny-model-checks
Tiny model gradient check, engine parity and WebGPU training speed

## [2026-10-01 17:13] update | records/measurements/2026-10-01-tiny-model
Gradient matches float64, engine agrees with jax-js, noise to words in 16 s

