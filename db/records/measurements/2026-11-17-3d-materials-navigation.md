---
type: measurement
id: 01m7mvv6dq1ecy0xpbn63xjp56
created: 2026-11-17T13:41:19.415569+00:00
updated: 2026-11-17T13:41:19.415569+00:00
summary: Detailed 3D materials and navigation pass release and browser checks
date: 2026-11-17
devices: '[[records/devices/dev-mac-m5-pro]]'
note: 169 app tests and two engine lifecycle tests passed; Chrome exercised all three benches. No performance, physical-phone or screen-reader qualification.
phase: '6'
runs: '[[records/run/2026/11/2026-11-17-3d-materials-navigation]]'
title: Detailed 3D materials and navigation pass release and browser checks
status: measured
---
# Materials, navigation and real model controls

Evidence: [[records/run/2026/11/2026-11-17-3d-materials-navigation]]. Design: [[records/decisions/2026-11-17-3d-materials-navigation]]. This extends the November 16 implementation in [[records/measurements/2026-11-16-3d-model-view]]; those earlier results retain their historical scope.

## Final release gate

The final `corepack pnpm build:deploy` passed 169 app tests in 15 files, two engine lifecycle tests, type checks for engine, tiny and app, the production build and the pinned-model gate. No dependencies or model-engine code changed. The new tests exercise camera framing/pivots/presets, selection tracking, spread and reset, instanced detail picking, gesture cancellation and Pan isolation, keyboard intent, mobile dock markup, texture/nameplate mapping and resource disposal. `git diff --check` passed.

## Chrome review of the built app

- Close-up inspections showed visible aluminum brushing, ceramic grain, gold contacts and bezels, circuit traces, copper buses, fins, screw recesses and upright engraved labels. Studio reflections preserve metal shading in light and dark modes. Decorative materials do not replace measured data colors.
- Focus frames the selected component, view presets change the camera, breadcrumb layer stepping keeps context, and spread separates the layers without editing the model. Reset layout closes spread and returns grabbed parts.
- With Punch selected and Pan active, a head click did not create an edit. A drag that moved away and returned to its starting point did not punch. An intentional plain click did turn the head Off. These are regression checks for faults found in the first review.
- France's capital was Paris; flipping head 14 in layer 21 changed the answer to Washington, D.C.; Restore this head returned Paris. The token replay played, paused and sought to its end with actual measured values.
- Grabbing head 1 in layer 2 of Grow moved its complete detailed assembly and showed its tether. Its RMS stayed 0.06965. Reset layout returned it. Grow completed 1,200 steps; scrambling layer 2 changed its displayed RMS from 0.05274 to 0.05455, and Restore this layer returned 0.05274. These verify state transitions, not model quality.
- Teach completed 80 steps with live adapter plates, 32,768 changed parameters and displayed full-lesson loss from 3.070 to 0.701. The final minor CSS fix makes the training buttons wrap with spacing in the left rail; that exact rebuilt layout was checked separately.
- At 320 by 740 the eight camera controls form a labeled four-by-two grid, with 50-pixel-high targets and no document overflow. The 390 by 844 layout also had no overflow. Help, focus and spread remained usable. Viewport overrides were reset afterward.
- Dark mode and changing reduced-motion preferences were exercised. A deliberately lost WebGL context showed recovery controls; Reload 3D view recreated the scene with the selected head still Off. Scoped restore then worked. Media overrides were reset.
- Captured production-origin error logs were empty. Earlier development-tab extension messaging errors were outside this built-app capture.

## Limits

Phone dimensions were emulated in desktop Chrome. No physical touchscreen, screen reader, frame-rate, GPU-memory or draw-call benchmark was performed. This qualifies interaction and presentation on the recorded Mac, not a claim of universal performance. The physical representation remains a drawing of neural computations, not literal neural hardware.
