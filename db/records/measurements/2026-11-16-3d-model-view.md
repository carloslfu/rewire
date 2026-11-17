---
type: measurement
id: 01m7kqadkh7k8rr6vxapwwf0gy
created: 2026-11-17T03:03:00.977094+00:00
updated: 2026-11-17T03:27:39.985793+00:00
summary: 3D model view passes the release gate and live Chrome inference, training, manipulation and recovery checks
date: 2026-11-16
devices: '[[records/devices/dev-mac-m5-pro]]'
note: 155 app tests, two engine lifecycle tests and final release checks passed. Real inference, teaching, training and graphics recovery were exercised in Chrome. Frame rate, GPU memory, physical touch devices and assistive technology remain unmeasured.
phase: '6'
runs: '[[records/run/2026/11/2026-11-16-3d-model-view]]'
title: 3D model view passes release and live Chrome checks
status: measured
---
# 3D model view: what was checked and what was not

Raw output: [[records/run/2026/11/2026-11-16-3d-model-view]]. Design: [[records/decisions/2026-11-16-3d-model-view]].

The implementation was authored in Claude Code using Fable 5.2. The implementing agent ran automated checks, and the reviewing agent exercised the real model in Chrome, reviewed the rendering and requested focused fixes. Final production-build output and captured browser state are in [[records/run/2026/11/2026-11-16-3d-chrome]].

## Checked in Node, on the final code

- The release gate passed: 155 app tests in 15 files (the 98 that existed plus 57 new), two engine lifecycle tests, type checks for the engine, tiny and app packages, the production build with no warnings, and the pinned-model gate for manifest `88f06923…`.
- The 57 new tests cover: every real component drawn once at a stable index for Qwen (731 parts: 28 layers, 448 heads, 224 key/value groups, 28 MLPs, plus dictionary, final normalization and output) and the tiny model (35 parts); head-to-group seating equal to the engine's; push slots equal to the 2D tower's; replay order, running sums and clock behavior; Punch writing the same change spec as the 2D Off control and one real changed generation per punch through the mocked engine, with a second punch restoring the original answers; edits refused while a reply is written, while teaching and before the model is ready; each tiny-model weight owned by exactly one part; adapter plates and rank sizes; stale measurements dropped; picking, posing, arranging, the tower gap, reduced motion and disposal of the Three.js scene; render-on-demand, hidden and zero-size pausing, context loss, pointer selection, punch and grab, and full release of listeners, observers, frames, DOM and the GPU context, using a fake renderer; and control gating of the three benches rendered to markup.
- Added in the second pass, each at a boundary the review named: a pooled tile's readout names the cell the number came from and the real size of its block, including the short blocks at an edge; a layer's plates run through all twenty captured stages in computation order, including normalized and rotated queries and keys and the scores before softmax, with masked scores read out as negative infinity; a part's restore removes exactly that part's changes and nothing in another layer or another kind of change, and the button's name states the scope; labels stay inside the view, off the toolbar and apart from each other at 320, 390 and 520 pixel stages built with fake DOM boxes; the camera frames the model inside the part of the view the toolbar leaves clear; a layer's plates come up one after another only during that layer's own beats; a reduced-motion change made while the stage is open takes effect; the page behind the full view is made inert and restored exactly, leaving dialogs and live regions alone; the stylesheet stacks the raised scope above the sticky header; the Strength slider is tied to its label; the renderer asks for `PCFShadowMap`; and a touch device with shadows off stops asking for frames when idle.
- Fifteen seeded defects, seven in the first pass and eight in the second, were each caught by at least one test.
- Entry load: 363.54 kB of JavaScript in the entry's static import graph, against 360.72 kB at commit `a26c79b` (one chunk then, five now). CSS grew from 41.92 kB to 52.16 kB. Three.js and the scene are a separate 627.29 kB chunk (158.74 kB gzip as Vite reports it) that is not in the entry graph and is fetched when the 3D view is opened.
- The specimen is 24 mesh and line objects for either model, because heads, MLPs, decks and their details are instanced. The stage adds a ground plane, the detail bay's plates (two objects per plate, at most 20 plates for a Qwen layer) and up to eight attention arcs.

## Checked in Chrome against the built production app

Raw browser state and the final release output: [[records/run/2026/11/2026-11-16-3d-chrome]]. The local server applied the production content security policy.

- Dismantle answered “The capital of France is Paris.” Flipping head 14 in layer 21 changed the reply to “The capital of France is Washington, D.C.” Restore this head returned Paris. Flip and Punch are different operations: Punch writes Off, and the keyboard P path was separately exercised as Off and back On.
- Selected-token comparison showed a direct-push change of −5.46 for Paris. Replay, play/pause, step, keyboard seek and scrubbing worked. The expanded layer exposed twenty captured tensor stages.
- Full view showed its header and close control above the page header. The native Rotate & inspect dialog opened above Full view and closed normally.
- Teach ran 80 steps, changed all 32,768 adapter parameters and lowered its displayed loss from 3.070 to 0.701. The adapter remained through a switch to 2D and back to 3D.
- Grow trained for 1,200 steps to a displayed loss of 0.070. Scrambling layer 2 changed its RMS from 0.05274 to 0.05455; Restore this layer returned 0.05274. These values verify state changes and are not a training-quality benchmark.
- A pointer drag in Grab moved head 1 in layer 2, showed its tether and was undone with Reset layout. This interaction was checked before the final label polish; its code was unchanged afterward.
- At 390 by 844 and 320 by 740 the document had no horizontal overflow. The final phone fix kept the selected token “Paris” readable at 320 pixels by wrapping the explanatory note onto its own line. Labels stayed inside the stage and clear of its toolbar.
- Dark mode and a reduced-motion preference change while the view was open were exercised. A real intervention still worked with reduced motion enabled.
- A deliberately lost WebGL context displayed the recovery alert. Reload 3D view recovered the scene while preserving the selected head's Off edit, and the scoped restore then worked.
- The final captured browser console contained no errors. The removed shadow-map warning was fixed.

## Limits of the verification

- No frame-rate, GPU-memory or draw-call capture from a real renderer. The object count above is not a measured frame.
- Keyboard interactions were exercised in Chrome. No screen reader or other assistive technology run was performed.
- Phone sizes were emulated in desktop Chrome; no physical touch device was tested.
