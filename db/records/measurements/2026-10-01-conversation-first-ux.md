---
type: measurement
id: 01m3wqfjqc19gck58gbb93cffg
created: 2026-10-01T21:56:12.652833+00:00
updated: 2026-10-01T21:56:12.652833+00:00
summary: Conversation-first UI, real chat, ten experiments, training and fallback checks
date: 2026-10-01
devices: '[[records/devices/dev-mac-m5-pro]]'
phase: '5'
runs: '[[records/run/2026/10/2026-10-01-conversation-first-checks]], [[records/run/2026/10/2026-10-01-conversation-first-browser]]'
title: Conversation-first UX and end-to-end checks
status: measured
---
# Conversation-first experience

Evidence: [[records/run/2026/10/2026-10-01-conversation-first-checks]] and [[records/run/2026/10/2026-10-01-conversation-first-browser]].

The automated suite passes 57 tests: 25 engine, 5 tiny-model and 27 app tests. Ten new action regressions cover double submission, navigation during tokenization or recording fetch, preserved conversations when selecting an experiment, recording provenance, stop/continue, tokenizer failures, mixed recorded/live output, stale inspection and failed recording retry. TypeScript, production build, diff checks and the release preflight pass. The model manifest and inference kernels are unchanged.

Chrome on the development Mac exercised arbitrary live questions and a follow-up, original/changed output, experiment selection without replacing the chat, undo, continuation and multiline input. The small model gave incorrect sky-color explanations; working generation is not answer-quality qualification. About names this limitation. Recorded examples, live replies and recorded starts continued live carry distinct labels; a real continuation of the five-weight experiment confirmed the mixed label.

All ten recorded experiments were exercised: dictionary swap, five weights, both floor removals, hidden start marker, copying and matched random heads, all five concept strengths, floor guesses, made-up-answer probabilities, forced third choice with undo, and all three weight precisions. The inspector opens explanations first, then word details, then the full model. Keyboard focus wraps in dialogs and Escape restores its opener. Space and line-break tokens have accessible names. Completed replies retain the existing live-region announcement model; spoken screen-reader use is not qualified.

Live tiny-model training completed 1,200 steps, showing initial and final samples, a learning curve and a real slow-motion gradient update. The trained weights generated text and exposed their actual candidates. Entering/leaving training preserved chat and results. A separate custom-text run stopped after navigation and its partial weights remained usable. New text clears only the tiny conversation. Short own-text input is blocked. A no-WebGPU fixture plays the explicitly labeled Alice recording and does not expose its weights as locally trained.

Responsive comparison measurements: page width equals viewport width at 390 and 320 px. Training and the experiment picker also fit 390 px; the full inspector fits 320 px with internal tower scrolling. Tapping a head on a narrow screen moves directly to its details. Light and dark appearance were visually checked, and temporary emulation was reset. These are desktop viewport checks, not physical phone tests.

Production-build fault fixtures verify session-only operation after Cache Storage refusal, explicit activation after the crash flag, hash repair after same-size cache corruption, and a replacement worker followed by continuation of the preserved reply. The cache fixture independently reported the repaired hash. Final production-page console checks reported no errors or warnings. One intermediate training chunk failed after its old build was replaced during development; reloading the current build restored it. It is excluded from the final-build pass.

Open gates remain: recording approval, physical device classes and actual GPU failure, first-time visitors, spoken screen-reader testing, remote model hosting/staging and public release approval. This check does not claim them passed.
