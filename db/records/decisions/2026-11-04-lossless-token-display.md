---
type: decision
id: 01m6kzh4pxz61pv9258c4kj5bn
created: 2026-11-04T19:10:48.029528+00:00
updated: 2026-11-04T19:10:48.029528+00:00
summary: Preserve token bytes and group characters for display
decided_on: 2026-11-04
evidence: '[[records/measurements/2026-11-04-unicode-decoding]]'
reversible_if: A qualified tokenizer or display method preserves full Unicode text and exact token inspection with a simpler format.
title: Preserve token bytes and group characters for display
status: standing
---
# Lossless token display

Send standalone token labels with their raw ByteLevel bytes from the worker. Decode reply sequences from bytes and keep graphemes together within a text run. A displayed character can span multiple tokens; the inspector exposes each token, byte label, probability and intervention independently. Never label a character-spanning group with one member token's probability. Display and screen-reader output share this path.

A length cap or Stop pauses an incomplete UTF-8 suffix until Continue supplies the remaining bytes. Actual model termination flushes malformed output honestly. Added chat markers and separate samples are decoding boundaries. Literal replacement characters are preserved. This changes presentation, not inference, sampling, model weights or token IDs.
