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

## [2026-10-01 18:01] capture | records/run/2026/10/2026-10-01-phase-0a-curation
Phase 0A curation, copying-head search and start-marker weight scan

## [2026-10-01 18:01] update | records/measurements/2026-10-01-phase-0a-curation
All core and optional steps pass their rule on the chosen weights

## [2026-10-01 18:01] decide | records/decisions/2026-10-01-path-step-redesigns
Step 2 zeroes five weights, step 5 uses made-up words, step 10 judges 2 bits

## [2026-10-01 18:01] update | records/measurements/2026-10-01-phase-2-checks
Phase 2 checks pass on the development Mac

## [2026-10-01 18:01] update | records/measurements/2026-10-01-dev-mac-speed
Development Mac speed, memory and device-check accuracy

## [2026-10-01 18:01] decide | records/decisions/2026-10-01-push-tolerance
Push tolerance from measured float32 push noise

## [2026-10-01 18:01] update | records/measurements/2026-10-01-phase-3-agent-checks
Throttled connection, keyboard, accessibility tree, targets and copy

## [2026-10-01 18:01] update | records/measurements/2026-10-01-tiny-model
Slow motion checked against float64; step size fixed

## [2026-10-01 18:01] update | records/plan/05-phase-2
Phase 2 passed on the development Mac

## [2026-10-01 18:01] update | records/plan/02-phase-0a
Phase 0A waiting only on recording approval

## [2026-10-01 18:01] update | DB.md
Declare capture and decide as this store's log kinds (used since setup)

## [2026-10-01 20:30] capture | records/measurements/2026-10-01-launch-readiness-continuation
Captured regression, release-preflight, Chrome fallback and phone-layout evidence; preserved physical-device and human approval gates.

## [2026-10-01 20:31] update | records/measurements/2026-10-01-launch-readiness-continuation
Keep tiny training as a smoke observation rather than introducing an uncontrolled speed measurement.

## [2026-10-01 20:42] capture | records/run/2026/10/2026-10-01-mac-browser-smoke
Preserved filtered native browser observations without claiming a complete Safari turn or a stable Firefox speed qualification.

## [2026-10-01 20:46] capture | records/run/2026/10/2026-10-01-trained-model-retry
Captured the explicit trained-model retry regression and final app suite/build.

## [2026-10-01 21:56] capture | records/measurements/2026-10-01-conversation-first-ux
Implemented the approved conversation-first interface; captured 57 passing tests, real browser experiments, training, recovery, keyboard and responsive checks while keeping physical-device and human gates open.

