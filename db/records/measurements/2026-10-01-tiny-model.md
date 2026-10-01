---
type: measurement
id: 01m3w6ey2d1jz7xyep8v6zqxab
created: 2026-10-01T16:58:45.709480+00:00
updated: 2026-10-01T18:01:10.215542+00:00
summary: 'Tiny model: gradient matches float64 (relative error 5e-7), engine agrees with jax-js (4e-5), noise to words in 16 s on WebGPU'
date: 2026-10-01
devices: '[[records/devices/dev-mac-m5-pro]]'
phase: '4'
runs: '[[records/run/2026/10/2026-10-01-tiny-model-checks]]'
title: Tiny model checks and training speed
status: measured
---
# Tiny model (October 1, 2026)

The tiny model has Qwen3's design at 4 floors, width 128, 4 query heads of 32 sharing 2 key-value heads, memory blocks of 384 units, a shared letter dictionary of 97 and about 0.8 million parameters. Raw output: [[records/run/2026/10/2026-10-01-tiny-model-checks]].

| Check | Result | Phase 4 exit |
| --- | --- | --- |
| Gradient against a float64 PyTorch reference | Loss within 1.4e-6; gradient relative error 5.3e-7, largest absolute error 2.1e-7 | Passes |
| jax-js and the engine's 32-bit path, same weights | Largest score difference 4.05e-5 over 24 positions; the top letter agrees at all 24 | Passes |
| Training on the development Mac (WebGPU, batch 16 x 64 letters) | About 16 to 18 ms a step; 600 steps in 16 seconds, from noise to recognizable words ("the Mouse eat an thense a they same over backing") | Passes the under-60-seconds check |
| Training on the CPU (jax-js WebAssembly, Node) | 205 ms a step, too slow for live training; recorded run of 1,200 steps for devices without WebGPU | As planned |
| Slow motion, one plain gradient step at learning rate 0.5 | Loss on a 48-letter example 1.474 before, 1.038 after | Numbers come from the same functions the gradient check verified |

Not yet measured: training live on a phone (needs Carlos's iPhone 13). A one-step time on a phone also feeds the Phase 0B device rule.

## Slow motion against float64
The page's slow-motion step (one plain gradient step on one example) is checked by the tiny tests, which run the same slowStep and compiled sampler and write artifacts/tiny/slow-case.json, and by py/tools/tiny_gradcheck.py, which recomputes it in float64: loss within 4e-7, loss after the step within 1e-6, right-letter probabilities within 2e-7 before and 4e-7 after. In the page a fixed step of 0.5 overshot on a trained model (loss 1.316 to 1.309 while the right letters' average probability fell from 53% to 50%), so the step size is now the largest of 0.5, 0.25, 0.1, 0.05, 0.02 and 0.01 that lowers the loss and raises that average; on the same trained model it chose 0.25 (loss 0.605, average 67%).
