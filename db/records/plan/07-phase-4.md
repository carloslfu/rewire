---
type: phase
id: 01m3w1fnf52anexz4a7ch4manp
created: 2026-10-01T15:31:46.789723+00:00
updated: 2026-10-01T18:00:59.055645+00:00
summary: 'Phase 4: the tiny model'
exit: Noise to recognizable words in under 60 s on the development Mac and live training on a phone; gradient check; jax-js and the engine agree; slow-motion numbers match a reference
phase: '4'
title: 'Phase 4: the tiny model'
status: in_progress
---
## Status (October 1, 2026)
On the development Mac: noise to recognizable words well under 60 s (1,200 steps at 11 to 17 ms), gradient within 5e-7 of float64, jax-js and the engine agree, and slow motion matches float64 within 1e-6 after its step size was fixed to always improve the example ([[records/measurements/2026-10-01-tiny-model]]). Live training on a phone needs Carlos's phone.
