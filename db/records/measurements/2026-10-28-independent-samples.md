---
type: measurement
id: 01m62f1yt5j03vr4hx0fa4tmkk
created: 2026-10-28T23:55:47.909427+00:00
updated: 2026-10-28T23:55:47.909427+00:00
summary: Independent questions preserve neighboring answers and reproduce all three demonstrations
date: 2026-10-28
devices: '[[records/devices/dev-mac-m5-pro]]'
phase: '6'
runs: '[[records/run/2026/10/2026-10-28-independent-samples]]'
title: Independent questions preserve neighboring answers and reproduce all three demonstrations
status: measured
---
# Independent sample checks

The release pipeline passed 80 app tests, two engine lifecycle tests, all three package type checks, the production build and the pinned-model deployment gate. Raw output and browser observations are in [[records/run/2026/10/2026-10-28-independent-samples]].

Chrome exercised the evil world question, the power question and the world question again. The repeated world question produced identical original and changed answers despite the intervening question. Editing the middle question to France preserved both neighboring answer pairs. Removing and undoing that sample reused its cached answers. After removal and a strength change from 0.2 to 0.4, Undo retained the original answer and refreshed only the restored changed answer at the current strength. The token input view contained only the selected sample prompt and reply.

At a 390 by 844 Chrome viewport, the France example reproduced Paris to Washington, D.C. Editing that sample to Japan produced Tokyo to London. Removing the sole sample and undoing restored both answers. Visible Edit and Remove controls, inline edit and Escape cancellation were checked, with no horizontal overflow (390-pixel document and viewport widths). A discovered overlapping token disclosure was fixed and rechecked with a 16-pixel gap. The viewport override was reset. This is phone-size Chrome layout testing, not a physical-phone qualification.

The love garden example reproduced the attachment-themed changed reply at 0.6. The evil world example reproduced chaos and control at 0.2. Presets remain selected demonstrations with their existing research limitations, not evidence for dedicated semantic neurons. No app-origin console errors or warnings were observed; the captured diagnostics originated in the Grammarly extension.

Regression tests cover independent token inputs and sampling position, edits including failed tokenization and clearing during a pending edit, multiple removals and selection-index remapping, cached undo, undo after changed or restored settings, empty-list undo, continuation and token inspection on an earlier sample.
