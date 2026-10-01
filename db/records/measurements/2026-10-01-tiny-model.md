---
type: measurement
id: 01m3w6ey2d1jz7xyep8v6zqxab
created: 2026-10-01T16:58:45.709480+00:00
updated: 2026-10-01T16:58:45.725380+00:00
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