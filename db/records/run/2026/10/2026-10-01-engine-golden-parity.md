---
type: run
id: 01m3w6rhysst537yypxb3qkvhy
created: 2026-10-01T17:04:00.983740+00:00
updated: 2026-10-01T17:04:01.009299+00:00
summary: Engine against the float32 reference on seven golden traces of the converted model, and the reference's own float32 noise
captured_at: 2026-10-01
command: REWIRE_WEIGHTS=gptqclip-g32-d4clip npx vitest run test/golden.test.ts; uv run python tools/noise.py artifacts/weights/gptqclip-g32-d4clip normal swap heads hidden
devices: '[[records/devices/dev-mac-m5-pro]]'
discarded: 'false'
title: Engine golden parity and reference noise
tool: engine/test/golden.test.ts, py/tools/noise.py
---
Engine (WebGPU through Dawn in Node) against the float32 Python reference, per golden case. Scores: errors over the top 64 per generated position; stream: relative error per floor over every position read; pushes: largest absolute error where the engine picked the same word; same words: share of reply pieces the engine drew identically; top: positions where the reference's top two were more than 0.05 apart and the engine's top word agrees.

```
bits3: {"tokens": 61, "maxErr": 0.006459236145019531, "p99": 0.0043621063232421875, "pushErr": 0.003276824951171875, "sampleAgree": 1, "topAgree": "28/28", "worstStream": 0.00018594853915269513}
floor-off: {"tokens": 60, "maxErr": 0.009485244750976562, "p99": 0.003475189208984375, "pushErr": 0.0025806427001953125, "sampleAgree": 1, "topAgree": "30/30", "worstStream": 0.00019678107467001243}
heads: {"tokens": 73, "maxErr": 0.008047103881835938, "p99": 0.003261566162109375, "pushErr": 0.0023512840270996094, "sampleAgree": 1, "topAgree": "36/36", "worstStream": 0.00018745281112839373}
hidden: {"tokens": 33, "maxErr": 0.0077667236328125, "p99": 0.0077667236328125, "pushErr": 0.0029821395874023438, "sampleAgree": 1, "topAgree": "1/1", "worstStream": 0.0008954506622203043}
normal: {"tokens": 46, "maxErr": 0.004634857177734375, "p99": 0.0031595230102539062, "pushErr": 0.0026590824127197266, "sampleAgree": 1, "topAgree": "14/14", "worstStream": 0.0002029252036029914}
swap: {"tokens": 47, "maxErr": 0.0029439926147460938, "p99": 0.002666473388671875, "pushErr": 0.0033288002014160156, "sampleAgree": 1, "topAgree": "14/14", "worstStream": 0.0001885423876957466}
zeroed: {"tokens": 64, "maxErr": 0.005650520324707031, "p99": 0.0031957626342773438, "pushErr": 0.0018243789672851562, "sampleAgree": 1, "topAgree": "31/31", "worstStream": 0.00018541725402528424}
```

The float32 reference (PyTorch on the Mac's GPU) against float64 (PyTorch on the CPU), same weights, tokens and half-precision cache:

```
heads: {"tokens": 74, "max": 0.010275471300593253, "p99": 0.005056255501892964, "stream_rel": 0.0002017280463607145}
hidden: {"tokens": 34, "max": 0.0198929844652298, "p99": 0.015003384629021177, "stream_rel": 0.0008451421900214379}
normal: {"tokens": 47, "max": 0.010251429961076752, "p99": 0.004797958753135337, "stream_rel": 0.00019748012534796916}
swap: {"tokens": 48, "max": 0.008476547020295655, "p99": 0.004898362709736881, "stream_rel": 0.00018926688797045576}
```

The first parity run against the original tolerance failed only on the 99th percentile of score errors (0.0027 to 0.0078 against 0.002); two further failures were report files read as cases, fixed in the test.
