---
type: measurement
id: 01m62c7kkary12j8771dd3kzng
created: 2026-10-28T23:06:27.306318+00:00
updated: 2026-10-28T23:06:59.634974+00:00
summary: Recheck France love and manipulation with manual guided examples
date: 2026-10-28
devices: '[[records/devices/dev-mac-m5-pro]]'
phase: '4'
runs: '[[records/run/2026/10/2026-10-28-guided-examples]]'
title: Recheck France love and manipulation with manual guided examples
status: analysis
---
# Rechecked effects and hands-on examples

Evidence: [[records/run/2026/10/2026-10-28-guided-examples]] and [[records/run/2026/10/2026-10-28-guided-chrome]]. Device: [[records/devices/dev-mac-m5-pro]]. This extends the earlier [[records/measurements/2026-10-28-love-evil-neurons]] analysis; it is a selected-demo replication, not a new held-out discovery study.

## Recheck

The production WebGPU engine loaded the exact converted Qwen3-0.6B manifest `88f069237c4d548d41953cbd7f9e8a07b73abd94a104a433154939c4d5f81f61`. Each scenario ran at temperature 0.7 with seeds 11, 7 and 42, and greedily with seed 11. Reply cap: 64 tokens. These are four decoding configurations on one checkpoint and device, not four independent model replications. Full text, token IDs, intervention values, stop flags and controls are retained in `fixtures/guided-examples/2026-10-28.json`.

| Intervention, zero-based address | Selected question | Observation across the four configurations |
| --- | --- | --- |
| L9N2753, dose 0.6, +23.323572700373692 activation | Describe a garden at sunrise. | Redirected a garden description toward affection or attachment. |
| Same love candidate | Tell me a fun fact about the moon. | Attachment and reassurance language, with loss of the factual task. |
| L12N2473, dose 0.4, -21.559503720199235 activation | What makes a good leader? | Manipulation and control language. |
| Same manipulation candidate | A friend lost a game. What could I say to them? | Mixed results. Some explicit manipulation; others vague or ordinary. |
| L20H13, multiplier -1 | what is the capital of france? | Paris became Washington, D.C. |
| Same head, two-turn screenshot conversation | what is paris? then what is the capital of france? | Paris described as in the United States, then Washington, D.C. named as France's capital. |
| Same head, specificity check | What is the capital of Japan? | Tokyo became London. |

The screenshot's effect therefore reproduces even without the earlier Paris turn. Its component is an attention head, not an MLP neuron. Flipping comparison head L20H2 preserved Paris and Tokyo in all four configurations, including the two-turn comparison. This is one comparison head, not a comprehensive control-head study.

There were 28 baseline/intervention comparisons and 12 additional comparison-head conditions. All 28 unchanged reruns restored the baseline token IDs exactly. The GPU reported no uncaptured errors. This supports testable causal effects of the interventions, without establishing semantic specificity, a dedicated France circuit, a love neuron or an evil neuron. The prior limitations on natural activation selectivity, near misses, semantic rating and circuit tracing still apply.

## Visitor flow

France, love and manipulation lead the example selector and experiment list. Selection starts a fresh unmodified chat and prepares an editable question. The visitor sends it, finds the dotted component marker, opens its controls, and makes the change. France uses the existing Flip control. Love and manipulation expose their specific neuron controls at the corresponding MLP, with the research address, signed addition and Original restoration. The inspector shows the marked neuron's actual activity and contribution even before intervention. Instructions and sample questions collapse after the first question, keeping the comparison prominent.

Chrome reproduced the selected effects through the actual UI. Restoring Normal brought back Paris; restoring the manipulation candidate's Original brought back the original leader answer. A 390 × 844 viewport exposed the same neuron controls and measured activity. Sample buttons only filled the draft, which remained editable; free play removed the guide markers.

All 71 app tests, two engine lifecycle tests, app/engine/tiny typechecks, the production build and deployment asset/pinned-manifest gate passed. The added lifecycle test covers no automatic generation or intervention, delayed initialization preserving the visitor's draft, manual change and switching examples. This is a feature-branch result. No public deployment is recorded.
