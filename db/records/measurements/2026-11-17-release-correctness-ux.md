---
type: measurement
id: 01m7ne0819pt1w63qb23skadn6
created: 2026-11-17T18:58:39.273623+00:00
updated: 2026-11-17T18:58:39.273623+00:00
summary: Release correctness and usability verification
date: 2026-11-17
devices: '[[records/devices/dev-mac-m5-pro]]'
note: Real local inference/training, browser fault checks and regression coverage; no universal browser or performance claim.
phase: '6'
runs: '[[records/run/2026/11/2026-11-17-release-correctness-ux]]'
title: Release correctness and usability verification
status: measured
---
# Release correctness and usability

The source and browser audit findings were corrected with actual Claude Code using `claude-fable-5-2`. The raw release gate, GPU suite results, model receipts and browser observations are in [[records/run/2026/11/2026-11-17-release-correctness-ux]]. This extends [[records/measurements/2026-11-17-output-reveal-probabilities]] with candidate-draw correctness, rewrite identity, intervention parity, training lineage and recovery checks.

## Release gate

The final production gate passed 274 app tests in 26 files, two engine lifecycle tests, every workspace type check, the production build and the pinned-model deployment check. The complete engine checks passed 40 tests across seven files plus nine real-Qwen golden tests. Tiny passed ten tests across three files. The lifecycle tests are included in the engine total, for 333 distinct tests across app, engine and tiny. GPU tests ran sequentially with a 1536 MB Node heap cap. Later follow-ups changed only app code, which was retested through the final gate.

The release still uses the pinned Qwen model revision and manifest. No model artifacts or inference precision were changed. The QA harness now serves the actual build beneath `/rewire` with the production CSP; fault injection files are temporary and excluded from shipped assets.

## Closed audit findings

| Finding | Result and evidence |
|---|---|
| Late picks shortened continued replies | The remaining write length now preserves the current reply length. Live Tiny letter 100 kept 160 letters with its first 99 unchanged, and Undo restored the exact original. A Qwen pick at token 101 kept 128 tokens and the exact preceding 100. |
| Undo reused a different reply's comparison | Comparisons require the same token sequence. After forcing Lyon, cutting layer 15 and undoing the pick, Paris was remeasured at 91%, replacing the stale picked-token comparison. |
| Draw percentages described pre-cut probabilities | Draw odds are normalized over the candidates actually kept by top-p. Model probability is a separate full-vocabulary column. Paris showed 100% in its one-candidate draw and 98.78% for the model in both 2D details and 3D. Manual choices are identified as the visitor's choice. |
| Replay overwrote a manual selection | A manual pause revision survives replay exit. After choosing Lyon during replay, the selected token stayed at Lyon and Follow output remained off. |
| Unmeasured difference looked like a measured zero | The live view said it was measuring, left parts unlit and displayed no total. Non-finite measurements are likewise labeled incomplete rather than rendered as valid totals. |
| Narrow Grow header overlapped the canvas | Header and status keep their actual text height. At 320 CSS pixels, the status ended before the canvas began, with no product document overflow. |
| Cancelled inspection poisoned its cache | Failed or cancelled results are not retained. Cache identity includes the actual prefix and model/version; bounded eviction and model-change cleanup are tested. |
| Full attention map could show a prior head | Maps use full identity and the newest-request guard. Deferred-response tests cover head changes and rewrites. Live recovery produced a real full attention map. |
| Multiple picks could share an inspection identity | Every writing or rewrite has its own revision. Tests fail under the prior identity and pass with the new one. |
| Copy and hidden-word chips assumed shared sample history | Samples are described as independent. Hidden chips name a word only when all sample prompts share it at that position. |
| Engine silently discarded excess changes | Oversized change specs are rejected before they appear active or reach encoding. GPU/reference tests exercise the maximum swap and hidden-word tables. |
| Retraining a damaged Grow copy lost the intact model | The intact checkpoint is retained until explicit adoption or a fresh start. A live layer-damage/retrain/restore sequence returned exact original output, step, loss and checkpoint text. |
| Checkpoint metadata outlived its weights | History, step and training corpus now travel with weights. Untrained damaged-copy history is explicitly attributed to the intact run. Adoption clears the old comparison and regenerates from the new intact weights. Training-failure state restoration is covered by lineage tests. |
| Held toggle keys repeated destructive toggles | Punch, spread and help act once per press; movement still repeats. Key-repeat behavior is unit tested. |
| Continue did nothing at a full context | Tiny reached its full context, reported the limit and removed Continue. Picking its final token still kept the full reply length. |
| Original Words in used current interventions | Dictionary rows now use the selected reply's own changes. Original and changed replies keep separate provenance. |
| Stationary hover retained old values | Tips refresh with new values, poses and detail plates. Scene tests cover a pointer that has not moved. |
| Candidate controls were active during a stopped update | Candidate picks are unavailable with an unfinished sample update and explain how to resume. Live stopped-update verification confirmed the controls were withheld. |
| 2D and 3D edit availability disagreed | Shared gating covers the map, stage, inspector and change chips. A live 3D head punch appeared as Off in 2D; restoring it in 2D restored the shared state. |
| Escape and modifier handling were inconsistent | Escape closes a dock panel before the full view, including when focus is outside the canvas. Space-pan releases on modifier and blur paths. A tiny Grab movement stays a click. |
| Compact 3D labels overlapped despite decluttering | Global caption/step margins and borders no longer affect stage labels. The previously overlapping caption and Paris chip were separated in the same 1920×902 view. |
| Worker failure left a usable tiny model looking broken | The successful Grow handoff creates a fresh worker and hides the prior Qwen error only while Tiny is live. Back to Qwen preserves its unavailable state and Retry. An actual Tiny failure still displays recovery controls. |
| Return to Qwen announced a nonexistent stopped reply | It now announces Qwen's actual readiness or failure. Both paths were checked live. |
| Tiny Retry hid progress while controls stayed disabled | Checking, download, Pause/Resume and startup remain visible until live again. A deferred regression covers all phases and a failed retry; the final browser build visibly showed Checking and then generated 160 letters after recovery. |

## Teach, Grow and presentation

Teach ran a real 80-step adapter lesson and its automatic comparison checks. Both views showed the same changed parameter count and measurements. An immediately stopped continuation preserved the previous lesson. The learned adapter was carried into Dismantle and switched off there. This verifies the workflow, not that an 80-step lesson reliably learns the invented facts.

Grow ran real training with camera controls usable while updates arrived. Its held-out test table ran and reported five of six exact answers for the observed 1200-step checkpoint. That is a result for this small invented-language run, not a general capability score. A layer was damaged in 3D, retrained for 488 steps, and restored in 2D to the exact 1200-step history and output. A second retrained copy was explicitly adopted at step 1816, regenerated as Intact weights and no longer displayed the former intact comparison.

Both light and dark presentation, compact and full 3D views, Teach's 2D/3D mobile views, Grow's mobile header, candidate widths and focus outlines were inspected. At 320 CSS pixels the candidate table occupied 288 pixels and the bounded `>99.99%` value remained on one line. This is viewport emulation, not physical-phone qualification.

## Failure and replay checks

The local harness verified no-WebGPU explanations in Dismantle, Teach and Grow; download Pause/Resume; GPU reset recovery with samples and subsequent attention measurements; failure before Grow handoff; failure while Tiny was selected; retry back to real Qwen inference; and WebGL drawing-context loss with a clear Reload 3D path. The 3D renderer recovered without losing model samples.

Whole-answer replay opens from a reply. Manual selection stays paused. Earlier steps say Not chosen yet; the selected Paris token is revealed at its output step with 98.78%. The separate context-limit and late-pick checks exercised long Tiny and Qwen outputs. The source regressions retain backward-scrub, reduced-motion and pre-output visibility coverage.

## Scope and limits

The tested device is [[records/devices/dev-mac-m5-pro]] using Chrome. No claim is made for every browser, physical phone, GPU or memory pressure scenario. No throughput or frame-rate benchmark was taken. The startup-dead-worker harness is available but was not separately exercised live in this release; the actual worker-failure and recovery paths were. Training-worker failure restoration is unit tested, not fault-injected live.

Inference and training are real local computation. Replay walks measurements already captured from computation and is explicitly labeled as such. Its timing and physical-looking machinery are explanatory, not a recording of GPU instruction timing. The complete local QA record includes failure reproductions from earlier builds; the later observations identify their verified fixes.

Production deployment is verified after the commit is pushed; this record captures the release candidate and its functional gate rather than inventing a deployment result in advance.
