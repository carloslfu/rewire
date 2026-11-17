---
type: log
---

# Curator log

## [2026-11-04 19:10] capture | records/measurements/2026-11-04-unicode-decoding.md
Captured Unicode regression checks, release build, tokenizer parity and live Chrome byte-fragment inspection, continuation, restore and phone layout verification.

## [2026-11-04 19:10] decide | records/decisions/2026-11-04-lossless-token-display.md
Preserve raw token bytes, decode complete characters across tokens, expose individual parts in the inspector, and hold paused incomplete suffixes for Continue.

## [2026-11-17 03:03] capture | records/measurements/2026-11-16-3d-model-view.md
Captured the release gate (146 app tests, two engine lifecycle tests, three type checks, build, pinned-model gate), the 48 new 3D tests, seeded-defect results and bundle sizes. Run in Node only; no browser, GPU or live model.

## [2026-11-17 03:03] decide | records/decisions/2026-11-16-3d-model-view.md
Add a 3D specimen view to all three benches beside the 2D diagrams, with Explore, Grab and Punch kept separate and only measured values drawn. Awaiting browser review.

## [2026-11-17 03:20] capture | records/measurements/2026-11-16-3d-model-view.md
Second pass after the reviewing agent's browser session: recaptured the release gate (155 app tests, two engine lifecycle tests, three type checks, build with no warnings, pinned-model gate), the 57 new 3D tests, eight more seeded defects and bundle sizes. Run in Node only. Browser observations in the record are the reviewing agent's, on first-pass code; the second-pass fixes are not yet seen in a browser.

## [2026-11-17 03:20] decide | records/decisions/2026-11-16-3d-model-view.md
Second pass: Full view is raised above the sticky header and makes the page behind it inert; per-part restore undoes only that part's changes and is named for its scope; pooled readouts name the source cell; layer plates cover every captured stage and appear in order during replay; labels are placed and decluttered by the stage. Awaiting browser review of these fixes.

## [2026-11-17 03:27] capture | records/measurements/2026-11-16-3d-model-view.md
Final review passed against the built app with the production CSP: real Paris/Flip/Washington/restore inference, Punch, token replay, native inspection, 80-step teaching, 1,200-step Grow training and scoped weight restoration, Grab, 320/390-pixel layouts, dark and reduced-motion modes, and WebGL recovery preserving edits. Captured raw browser state and a clean final release gate: 155 app tests, two lifecycle tests, all type checks, production build and pinned-model check. Corrected the earlier attribution of the Washington answer to Punch; it was Flip.

## [2026-11-17 03:27] decide | records/decisions/2026-11-16-3d-model-view.md
Final Chrome review verified the revised full-view controls, phone labels, twenty tensor stages and restoration behavior. Keep 2D as the default and load 3D on request.

## [2026-11-17 13:41] capture | records/measurements/2026-11-17-3d-materials-navigation
Recorded final release gate and built-app visual, navigation, inference, training and recovery checks.

## [2026-11-17 13:41] decide | records/decisions/2026-11-17-3d-materials-navigation
Adopt detailed materials, studio lighting and direct camera controls; preserve real intervention semantics.

## [2026-11-17 15:35] capture | records/measurements/2026-11-17-follow-output
Captured the release gate, 182 app tests and two lifecycle tests, plus live Chrome selection, comparison, replay, mobile keyboard and trained-tiny-model checks. Full store validation has zero errors and warnings.

## [2026-11-17 15:35] decide | records/decisions/2026-11-17-follow-output
Adopt one shared following contract, persistent paused selection, valid removal fallback and complete-token replay handoff across 2D and 3D.

