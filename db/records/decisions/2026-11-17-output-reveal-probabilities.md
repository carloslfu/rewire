---
type: decision
id: 01m7n8jtmrstxnj4613zsff8yg
created: 2026-11-17T17:23:56.696371+00:00
updated: 2026-11-17T17:23:56.696371+00:00
summary: Reveal measured model probabilities only at the replay output step
decided_on: 2026-11-17
evidence: '[[records/measurements/2026-11-17-output-reveal-probabilities]]'
reversible_if: Measured behavior or user feedback shows the reveal boundary or probability definition obscures the computation or causes incorrect output.
title: Reveal measured model probabilities only at the replay output step
status: standing
---
# Reveal output only at the final step

During replay, Words out has no candidate bars, words or percentages until the selected token completes its final step. Show Not chosen yet while it is pending. Hide the result synchronously on a backward scrub or when the replay changes to a token whose candidates have not yet arrived. Candidate delivery must match the full model, version, sample, reply-side, token-index and token-id identity. New labels remain hidden until a rendered frame places them.

Use one measure throughout the 3D output bars and replay readout: model probability at temperature 1 over the full vocabulary. Reuse the existing logsumexp pass to cache alternative-candidate log probabilities without changing the sampler or adding inference. Always include the written token at exp(lp1), even when it was forced from outside the top candidate list. Omit alternatives with no measured model probability.

Use two decimal places, with <0.01% and >99.99% at the extremes and unavailable for invalid values. Do not invent a changing confidence through earlier layers. Equal values remain equal. Keep the historical reply and transport token name available for navigation, and show live results as they arrive. The 2D picker continues to expose its sampling measure with explicit explanatory copy.

This refines [[records/decisions/2026-11-17-replay-experience]] and fixes Carlos's reported early token reveal and frozen-looking percentage. Evidence: [[records/measurements/2026-11-17-output-reveal-probabilities]] and [[records/run/2026/11/2026-11-17-output-reveal-probabilities]].
