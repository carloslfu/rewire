---
type: decision
id: 01m7mvv6e723cw6363x1wxyc69
created: 2026-11-17T13:41:19.431808+00:00
updated: 2026-11-17T13:41:19.431808+00:00
summary: Use detailed physical materials and direct camera controls in the 3D workbench
decided_on: 2026-11-17
evidence: '[[records/measurements/2026-11-17-3d-materials-navigation]]'
reversible_if: Carlos prefers a different visual language, users confuse the drawing with actual neural hardware, or qualified devices cannot keep the detailed view responsive.
title: Use detailed physical materials and direct camera controls in the 3D workbench
status: standing
---
# A detailed, manipulable instrument

Carlos asked for a much more realistic view with better materials, lighting and detail, plus easier navigation and controls. The implementation was authored with Claude Code Fable 5.2 and reviewed in Chrome. Evidence: [[records/measurements/2026-11-17-3d-materials-navigation]]. This refines [[records/decisions/2026-11-16-3d-model-view]] without changing the model or the meaning of its controls.

## Representation

Keep the model's real layer and head counts and instanced selectable assemblies. Give them machined aluminum decks, graphite framing, ceramic modules, gold contacts, glass windows, copper buses, circuit-board traces, heatsink fins, socket screws and engraved labels. Deterministic small textures and a locally generated studio reflection environment require no external art assets. Light surfaces carry shading and brushed reflections rather than looking like white blocks. Data only colors the inserts used for real measured values.

The scene retains render-on-demand, disposal and a lighter path on coarse devices. It remains an explicitly selected view beside 2D. The product explains which shapes are illustrative and which numbers are measured.

## Navigation and editing

A camera dock exposes fit, focus, zoom, pan, spread, view presets and help. A breadcrumb shows the selected layer and component, with direct layer stepping. Focus pivots around the component, excluding the tensor bay from the component's framing. View presets move around the target. Touch and mouse navigation retain the existing interaction model; phones get visible short labels and a balanced grid rather than unexplained icons wrapping unpredictably.

Explore selects; Grab rearranges the drawing; Punch writes a real intervention. Pan is an explicit navigation override, including clicks. A gesture that ever moves beyond click slop, is cancelled or gains a second pointer cannot become a Punch at release. Reset layout and Restore model remain separate. Spread moves layers apart with tethers and does not modify weights.

Empty Dismantle selections do not open a large blank tensor bay. Once actual measurements exist, the plates open at their layer. Teach and Grow continue to show real adapter and training weights. The native select menu and the help/view panels consume Escape appropriately before closing full view.
