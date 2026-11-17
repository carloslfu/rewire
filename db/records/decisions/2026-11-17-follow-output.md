---
type: decision
id: 01m7n2c0r11cz69wda0g1hnhnf
created: 2026-11-17T15:35:22.113001+00:00
updated: 2026-11-17T15:35:22.113001+00:00
summary: Consistent following and paused selection in both visualizers
decided_on: 2026-11-17
evidence: '[[records/measurements/2026-11-17-follow-output]]'
reversible_if: User feedback or a reproduced lifecycle case shows this selection contract loses inspection context or misrepresents active output.
title: Consistent following and paused selection in both visualizers
status: standing
---
# One follow contract for 2D and 3D

Use a shared Follow output control and selection reconciler in both visualizers. Following tracks the active sample by stable identity. Push prefers its current changed reply, while Change from original measures an original token. Paused selection remains fixed while valid; when removed or replaced, choose the nearest valid output instead of leaving an empty view.

New questions, Continue, edits and model changes preserve the visitor's preference. Clearing samples, opening a guided example and switching model families start a fresh experiment with following enabled. Choosing a token or manipulating replay pauses following. Explicit resume completes the token and stops replay even when the selected token has not changed, while retaining playback speed.

Show the pressed state with a filled pill and check, an outline while paused, and an accessible explanatory hint. Preserve keyboard operation and a 44-pixel touch target at mobile widths.

Evidence: [[records/measurements/2026-11-17-follow-output]] and [[records/run/2026/11/2026-11-17-follow-output]]. This implements Carlos's request to improve all findings from the Follow output audit, using Claude Code with Fable 5.2.
