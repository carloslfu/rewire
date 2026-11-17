---
type: decision
id: 01m7n73zxst6a0hgn99xf6ce90
created: 2026-11-17T16:58:22.009185+00:00
updated: 2026-11-17T16:58:22.009185+00:00
summary: Whole-answer replay with frame-driven steps and explicit controls
decided_on: 2026-11-17
evidence: '[[records/measurements/2026-11-17-replay-experience]]'
reversible_if: User feedback or measured behavior shows the pacing, scope, state transitions or controls obscure the computation or impede manipulation.
title: Whole-answer replay with frame-driven steps and explicit controls
status: standing
---
# Whole-answer replay with explicit control

Replay answer starts at the first visible token of a finished reply and walks it through the entire architecture before proceeding to the next token. It stops at the end. This token remains an explicit secondary scope. This replaces the one-token-only replay interaction described in [[records/decisions/2026-11-17-follow-output]] while preserving the shared follow-selection contract.

Put the player immediately under the 3D model, with a reply-level entry in both the conversation and the model's reply rail. Show Live output, Replaying, Replay paused or Replay finished explicitly. Distinguish token navigation from labeled model-step controls. Show scope-correct progress, a keyboard scrubber, three readable pace choices, restart and Back to live. Back to live resumes following; other endings restore the preference from before replay. Model edits, new output, invalidated samples and leaving the view end the old replay. Hidden/offscreen/context-lost stages pause it.

Advance at most one whole step per frame with no catch-up after a stall. Keep the camera independent and let Explore, Grab, pan, zoom and spread continue to work. An amber bracket and label locate the current operation in the scene without inventing an activation. Use the cached real values; passing tokens must not launch repeated inspection work. Pausing can measure the current token.

When a 3D stage is open, inference waits for each queued step and leaves short idle windows for rendering. The 2D queue keeps its prior faster policy. This changes scheduling, not model mathematics, and is not a guaranteed rendering rate. While output is arriving, measurement hooks do not repeatedly set an already-empty state.

Evidence: [[records/measurements/2026-11-17-replay-experience]] and [[records/run/2026/11/2026-11-17-replay-experience]]. This implements Carlos's request for discoverable, manipulable whole-model replay using Claude Code with Fable 5.2.
