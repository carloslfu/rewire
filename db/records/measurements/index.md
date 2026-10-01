---
type: index
scope: type-folder
folder: records/measurements
updated: 2026-10-01T18:01:10.215542Z
---

# records/measurements

- [[records/measurements/2026-10-01-tiny-model]] — Tiny model: gradient matches float64 (relative error 5e-7), engine agrees with jax-js (4e-5), noise to words in 16 s on WebGPU
- [[records/measurements/2026-10-01-phase-3-agent-checks]] — Phase 3 agent checks: step 1 plays from its recording at 1.4 s on a 9 Mbps link before the model arrives; keyboard-only flow, accessibility tree, targets and copy fixed and verified
- [[records/measurements/2026-10-01-phase-2-checks]] — Phase 2 on the development Mac: neutral changes, swaps and interleaving are bit-exact; 60 of 66 recorded runs reproduce live word for word and all show their step's result
- [[records/measurements/2026-10-01-dev-mac-speed]] — Development Mac: 176 tokens/s, 40-token reply in 0.58 s with or without changes, first changed word 0.33 s, inspection 58 ms, 761 MB; device check within 12%
- [[records/measurements/2026-10-01-phase-0a-curation]] — Phase 0A curation: all four core steps and every optional step pass their rule on the chosen weights
- [[records/measurements/2026-10-01-engine-golden-parity]] — Engine matches the float32 reference on all seven golden traces: same words everywhere, score errors within the reference's own float32 noise
- [[records/measurements/2026-10-01-four-bit-lab]] — 4-bit lab: no format meets every bar; GPTQ with clipping in groups of 32 and a 4-bit clipped dictionary is best at 373 MB
- [[records/measurements/2026-10-01-path-smoke-test]] — Path smoke test: core steps 1, 3 and 10 hold on plainly rounded 4-bit weights; optional steps 4, 6, 7 and 8 read positive
