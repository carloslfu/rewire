---
type: decision
id: 01m7kqadmab17r7c0e0x5w9n92
created: 2026-11-17T03:03:01.002805+00:00
updated: 2026-11-17T03:27:40.015659+00:00
summary: Add a 3D specimen view beside the 2D diagrams, with separate tools for looking, arranging and changing
decided_on: 2026-11-16
evidence: '[[records/measurements/2026-11-16-3d-model-view]]'
reversible_if: Browser testing shows the 3D view cannot stay interactive on supported devices, visitors confuse rearranging the drawing with changing the model, or Carlos prefers a different representation after seeing it.
title: Add a 3D specimen view beside the 2D diagrams, with separate tools for looking, arranging and changing
status: standing
---
# A 3D specimen beside the 2D diagrams

Carlos asked for a detailed 3D model of the whole language model inside Rewire that can be turned, zoomed, grabbed and punched, with punches changing real behavior. The choices below were made while implementing that request on November 16, in two passes with a browser review by a second agent between them. Evidence and its limits are in [[records/measurements/2026-11-16-3d-model-view]]. The final browser review and production-build checks passed; their evidence is in [[records/run/2026/11/2026-11-16-3d-chrome]].

## The frame

One large stage per bench, framed by plain 2D controls, rather than small 3D diagrams inside the existing panels. Tools and view resets sit on the stage. The replay controls and the selected part's existing controls sit under it, or beside it in Full view, where the question and replies (or the training controls) take a left rail. 2D stays the default and every bench has a 2D / 3D switch. Three.js loads only when 3D is opened, a bench that is off screen holds no WebGL context, and a browser that cannot create one stays in 2D.

Full view is the same mounted stage given the whole window, so nothing reloads. The bench sits inside a sticky panel that forms its own stacking context, so while Full view is open that panel is raised above the sticky page header; the first pass left it below, which hid the bench's controls. The rest of the page is made inert for as long as Full view is open, except dialogs and live regions, and is returned to exactly its earlier state on close.

## The specimen

A rack that reads like the 2D tower: one deck per layer, bottom to top, heads in a row with the MLP at the right. Heads sit in pairs on the base that holds the keys and values they share. Each deck has two junctions on a residual spine that runs from the dictionary block to the output block, which carries the real candidate probabilities as bars. The counts and the head pairing come from the model configuration. The shapes are a drawing, and the interface says so. Dictionary tiles and MLP fins stand in for rows and neurons and are never presented as individual parameters.

Selecting a layer pulls its deck forward and opens the tower above it. That layer's measured tensors, or weight matrices in Grow, stand in the gap as plates in computation order. This keeps the detail at its place in the model instead of in a separate panel. For a Qwen layer the plates are every stage the inspection pass captures: the input, its normalization, raw queries, keys and values, the normalized queries and keys, the rotated queries and keys, the scores before softmax, the attention weights, each head's mixed values, the combined attention output, the stream after attention, its normalization, and the MLP's gate, up, neuron activations, projection down and the stream out. During a replay a layer's plates come up one after another within that layer's attention and MLP beats.

Tensors larger than 128 tiles a side are reduced by keeping the largest-magnitude cell in each block. The readout names the cell the number came from, says how many cells the tile stands for and gives their range, so a number is never credited to a cell that does not hold it.

## Looking, arranging and changing are separate tools

Explore selects. Grab moves parts and changes nothing in the model. Punch changes the model, once per click: in Dismantle through `chipsWith` with the same spec the Off control writes, in Grow through `mutateWeights` for that layer from the intact copy. A part's pose is computed from the change spec, never from the animation, so the drawing cannot say something the model is not doing. Reset layout and Restore model are different buttons with different meanings.

A selected part's restore button undoes only what belongs to that part, and its name says which: Restore this head returns the head's strength and removes its direction change; Restore this MLP returns its strength and removes the additions to that layer's neurons; Restore this layer and its parts returns the layer's strength and removes, on that layer only, head and MLP strengths, direction changes, neuron additions, zeroed weights and a concept injected there. None of them touches another layer, weight precision, swaps, the hidden prompt or a taught adapter. Those have their own controls, and Restore model removes everything.

## Labels

Labels are DOM text positioned by the stage, not CSS transforms, so they can be measured. Each is clamped inside the view, then shown in order of importance only if it touches neither a more important label nor the toolbar. The camera frames the model inside the part of the view that the toolbar and edge labels leave clear. This replaced labels that were clipped at the edges and overlapped on phone widths.

## Only measured values

Colors are direct pushes, parameter statistics or adapter weights. A part without a measurement stays unlit. The replay is a slowed walk through one token's measured values and is labeled as not being a timing. Teach lights nothing but the adapter, because no activations are measured during teaching. A measurement that returns after the token, model or changes moved on is dropped. The scene draws only when something changed, and follows a change of the reduced-motion preference while it is open.

## Rejected

- 3D as the default: heavier than the diagrams on weak devices. Keep it an explicit, lazily loaded view.
- Free physics for punched parts: a part resting somewhere arbitrary would not show its state.
- Drawing every head's attention at once: sixteen fans over the context are unreadable. One selected head's measured attention is drawn.
- A second panel of plates beside the tower: it doubled the scene's width and pushed the model out of view.
- A per-part restore that also cleared changes elsewhere: the button would undo work the visitor did not point at.
