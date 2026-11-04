---
type: measurement
id: 01m6kzh4pdacgw6td6djcreqhw
created: 2026-11-04T19:10:48.013170+00:00
updated: 2026-11-04T19:10:48.013170+00:00
summary: Unicode replies preserve split characters and inspectable token identities
date: 2026-11-04
devices: '[[records/devices/dev-mac-m5-pro]]'
phase: '6'
runs: '[[records/run/2026/11/2026-11-04-unicode-decoding]]'
title: Unicode replies preserve split characters and inspectable token identities
status: measured
---
# Unicode rendering checks

The release pipeline passed 98 app tests, two engine lifecycle tests, all three package type checks, the production build and the pinned-model gate. Four additional cached-tokenizer parity tests passed. Raw output and browser observations are in [[records/run/2026/11/2026-11-04-unicode-decoding]].

The reported greeting contains token 26525 with bytes `20 F0 9F 98` and token 232 with byte `8A`. Decoding each independently produced two replacement characters. Lossless sequence decoding renders `Hey buddy! What's up? 😊`. Chrome reproduced the corrected greeting, inspected both token parts with their original IDs and probabilities, generated a changed reply after cutting layer 15, then restored the identical original greeting.

A Hindi response hit the 64-piece cap inside a UTF-8 character. The paused display retained only complete characters; Continue completed `किया` and the reply without a spurious replacement symbol. At a 390 by 844 Chrome viewport, remove and undo preserved the emoji, inspector labels remained readable, and document width equaled viewport width at 390 pixels. This qualifies the phone layout in desktop Chrome, not physical phone inference. Captured console diagnostics came from Grammarly, with no app-origin errors or warnings.

Regression coverage includes ten real Qwen multilingual token sequences, every streamed prefix, accents, Arabic, Hindi, Chinese, Greek/Cyrillic, flags, skin tones, variation selectors, joined emoji, literal replacement characters, special marker boundaries, BOM and whitespace. Grapheme tests use arbitrary byte splits; 2,000 deterministic arbitrary byte sequences agree with TextDecoder. Integrated checks cover screen-reader text, selection of a continuation token, stale replies, a paused incomplete character and completion. Malformed output ending at actual model termination remains visible rather than being silently repaired.
