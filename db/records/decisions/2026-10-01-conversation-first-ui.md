---
type: decision
id: 01m3wqfjqwm8ez50xf4mdk25p6
created: 2026-10-01T21:56:12.668898+00:00
updated: 2026-10-01T21:56:12.668898+00:00
summary: Chat is central; experiments, inspection and training reveal detail on demand
decided_on: 2026-10-01
evidence: '[[records/measurements/2026-10-01-conversation-first-ux]]'
reversible_if: First-time user tests show that optional inspection obscures the causal lesson or makes real controls difficult to find.
title: Conversation-first interface
status: standing
---
# Conversation first

The user found the packed interface excessive and asked for free chat, a simpler presentation and a compelling demonstration. After the proposal to center chat, keep one Paris/Rome experiment, reveal model internals on demand and separate training, the user approved implementation and end-to-end testing.

The landing view therefore contains the conversation, one compact experiment and the composer. Original/changed replies appear only after a change. Experiments is an optional picker, with three entries first and the rest disclosed on request. Eligible modifications can be selected for an existing live chat without replacing its messages; opening a recorded example is a separate explicit action.

Look inside reveals the explanation, then word probabilities and the full model. Training has its own view and leads with writing before/after learning. The same real measurements and controls remain available. There is no mandatory numbered tour, permanent three-column instrument panel or model/backend picker.

Recordings remain an immediate demonstration and fallback, clearly labeled beside each reply. Live questions are unrestricted by the example list. A recorded reply extended by live inference is labeled as such. Real model limitations remain visible in About.

Validation and remaining qualification gates: [[records/measurements/2026-10-01-conversation-first-ux]].
