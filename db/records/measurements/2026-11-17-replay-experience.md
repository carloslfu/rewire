---
type: measurement
id: 01m7n73zx3mzcyk63n3tw82rwt
created: 2026-11-17T16:58:21.987657+00:00
updated: 2026-11-17T16:58:21.987657+00:00
summary: Whole-answer replay, render pacing and fast-output verification
date: 2026-11-17
devices: '[[records/devices/dev-mac-m5-pro]]'
note: Functional Chrome checks and regression tests; responsive emulation, no frame-rate benchmark.
phase: '6'
runs: '[[records/run/2026/11/2026-11-17-replay-experience]]'
title: Whole-answer replay, render pacing and fast-output verification
status: measured
---
# Replay through the whole model and answer

The final release gate passed 217 app tests across 20 files, two engine lifecycle tests, all workspace type checks, the production build and the pinned-model deployment check. Raw output and the four Claude Code receipts for `claude-fable-5-2` are in [[records/run/2026/11/2026-11-17-replay-experience]]. Tests exercise the controller, its real store/action binding, frame-driven scene, GPU pacing queue, responsive markup and rapid token delivery into real React roots.

## Browser verification

Chrome checks used the production-CSP local preview on [[records/devices/dev-mac-m5-pro]]. Qwen produced the real France answer, then replayed its seven visible tokens through all 58 architecture steps per token and stopped at the final token. The scope-specific progress reached its maximum for both the whole answer and a single token. Back a step, Next step, keyboard scrubbing, Pause, Resume, Start over and Back to live were checked.

The amber bracket and nearby step label were visually reviewed in the full model and in dark/reduced-motion mode. Orbit, zoom and a successful drag of Layer 22 remained usable while replay continued. The position marker is an orientation cue, not an activation measurement. Real per-token pushes, probabilities, selection controls and model interventions retain their original meaning.

The first implementation was checked for original/changed reply entry, a real Layer 21 Head 14 flip changing Paris to Washington, D.C., restore, new questions while following was paused, sample removal/undo and switching back to 2D. Later refinements left this controller/action behavior intact. On the refined build, forcing WebGL context loss paused replay; Reload 3D view retained its position and stayed paused. Scrolling the model offscreen paused replay; returning and resuming continued it. Hidden-tab attempts under the browser tool did not make the document hidden, so that behavior is qualified by the scene unit tests rather than claimed as a browser observation.

At 320 and 390 CSS-pixel widths, no horizontal overflow was observed. The mobile reply entry opened the model sheet, showed the active step and prominent Pause control, and the token, step, scope and speed buttons had 44-pixel touch targets at the 320-pixel width. These are responsive viewport checks, not physical-phone qualification.

## Fast-output regression found and fixed

The tiny model exposed React error 185 during live 3D output. The 3D measurement effect replaced an already-empty state after every incoming token. The burst could exhaust React's nested-update limit, interrupting notification of that token even though later tokens repaired the screen. The same empty-state pattern in the 2D inspector was guarded as well.

A real React-root test reproduces the old exception and verifies the corrected hook through successive output bursts. The new measurement hook makes no state update when there is still nothing to measure; completed and stale measurements keep their existing identity guards.

After a fresh 1,200-step training run on the final build, Chrome verified the new readiness announcement, a 160-token reply with the 3D view open, Continue to 224 tokens, another 160-token reply with Layer 2 selected, and a multi-token replay. Pausing exposed the actual measurements for the selected token. No application console errors were captured after this fixed-build reload and rerun. Earlier failing logs and the development-only stale-chunk error are retained in the raw run.

## Limits

This qualifies functional behavior on this Mac and Chrome. It is not exhaustive browser, hardware, accessibility or numerical-engine qualification. No FPS, frame-latency or throughput claim is made. The worker gives the renderer an idle window while the 3D view is open, but the browser/driver schedules the GPU, and a single forward pass is not subdivided. Replay uses cached measured output and requires the model idle. Public deployment is verified after the commit is pushed.
