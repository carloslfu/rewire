---
type: measurement
id: 01m7n2c0qe40wfrszdtfke5dc7
created: 2026-11-17T15:35:22.094866+00:00
updated: 2026-11-17T15:35:22.094866+00:00
summary: Follow output selection, comparison and replay verification
date: 2026-11-17
devices: '[[records/devices/dev-mac-m5-pro]]'
note: Functional Chrome checks on the production build; mobile emulation, not a physical-device qualification.
phase: '6'
runs: '[[records/run/2026/11/2026-11-17-follow-output]]'
title: Follow output selection, comparison and replay verification
status: measured
---
# Follow output in both views

The release command passed 182 app tests, two engine lifecycle tests, all three workspace type checks, the production build and the pinned-model deployment check. The new deferred-stream action tests exercise the actual actions with controlled token delivery. Replay tests exercise the transition helper used by the 3D component, and markup tests check the shared control. Raw evidence: [[records/run/2026/11/2026-11-17-follow-output]].

The reviewing agent checked the built app in Chrome on [[records/devices/dev-mac-m5-pro]]. Captured browser states verify:

- Following selects the latest token; pausing before the first question selects the first token once. New questions and Continue preserve a valid paused selection.
- Editing an older sample makes it the active output target. Resume returns to that sample rather than the last list entry.
- Removing the followed sample selects remaining output. Removing the final sample shows an honest waiting state; undo restores a valid selection.
- Real model edits preserve the preference. Flipping attention head 14 on layer 21 changed the France answer from Paris to Washington, D.C. Difference view remained on the final original token after further model edits; Push moved immediately to changed output. Paused changed tokens fell back to the original when replaced, and Restore preserved that paused selection.
- 2D and 3D share selection and following. Back, Step, scrub and Play pause following. Resuming on the same token stops replay at the complete token and preserves the chosen speed.
- At a 320 by 740 CSS-pixel viewport, the shared button is 44 pixels high, the hint fits, and the page has no horizontal overflow. Enter and Space operate the control. This is responsive emulation, not a physical-phone claim.
- After 1,200 real Grow training steps, the tiny model's full lab preserved paused mode across new prompts, selected its first letter instead of leaving a blank visualization, and resumed to token 160. The same-token 3D replay resumed at beat 10.
- No application console errors were captured. Grammarly extension stylesheet errors were recorded separately.

No engine mathematics, weights, architecture, training protocol or rendering materials changed. This pass qualifies the follow-selection and replay interaction changes; it does not establish exhaustive device, browser or assistive-technology coverage. Public deployment is checked separately after the commit is pushed.
