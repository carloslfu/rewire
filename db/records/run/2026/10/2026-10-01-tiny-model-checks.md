---
type: run
id: 01m3w6ehwb3rzarwaxzkndfv6e
created: 2026-10-01T16:58:33.227497+00:00
updated: 2026-10-01T16:58:33.422584+00:00
summary: 'Tiny model checks: 64-bit gradient check, jax-js against the engine, training speed on WebGPU and on the CPU'
captured_at: 2026-10-01
command: pnpm -C tiny test; uv run python tools/tiny_gradcheck.py; npx tsx scripts/record-run.ts; Teach on Alice in the dev page
devices: '[[records/devices/dev-mac-m5-pro]]'
discarded: 'false'
title: Tiny model checks
tool: tiny/test, py/tools/tiny_gradcheck.py, tiny/scripts/record-run.ts, app tiny view
---
Gradient check (tiny/test writes the case: vocab 40, context 16, batch 2; py/tools/tiny_gradcheck.py recomputes it in float64 with PyTorch autograd):

```
{
 "loss_jax": 3.705803871154785,
 "loss_64": 3.705805277546012,
 "loss_diff": 1.4063912270323442e-06,
 "grad_rel_error": 5.335905187643267e-07,
 "grad_max_abs_error": 2.1118055548718928e-07,
 "grad_max_abs": 0.38765756587671624
}
PASS
```

Tests (Node, jax-js on WebAssembly; the engine through Dawn's webgpu package):

```
✓ test/tiny.test.ts > tiny model > has the planned size 1ms
 ✓ test/tiny.test.ts > tiny model > writes a gradient case for the 64-bit check 784ms
max |engine - jax| over 24 positions: 4.05e-5 top agree 24 / 24
 ✓ test/engine-parity.test.ts > tiny model in the engine > matches jax-js logits at every position 998ms
first 3.728 last 0.003 ms/step 63.2
 ✓ test/tiny.test.ts > tiny model > learns a pattern with Adam 3833ms
```

The first parity run failed (max difference 3.4) because a new engine conversation started with an all-zero change table, which turns every floor off; the Qwen tests always set a table. Fixed by defaulting to the neutral table; the run above is after the fix.

Training in the page (the browser pane, Chromium with WebGPU, Alice text, batch 16 x 64 letters, Adam at 3e-3):

```
600 steps: "Trained 600 steps in 16 seconds. One step takes about 18 ms here." loss 1.557
sample at step 600: "ut they! the Mouse eat an thense a they same over backing. How, and I'm Why, and"
slow motion (plain gradient descent, learning rate 0.5, one 48-letter example): loss 1.474 before, 1.038 after
a later 1,200-step run measured 45 ms per step while the 4-bit lab shared the GPU (discarded as a timing)
```

Recorded run for devices without WebGPU (tiny/scripts/record-run.ts, jax-js on WebAssembly in Node, 1,200 steps):

```
1 4.616 | 100 2.548 | 300 1.905 | 600 1.557 | 900 1.222 | 1200 1.054
step 700 sample: "rack about a botter sputter, a Mouse say her like ever her: "
204.8 ms per step on the CPU
```
