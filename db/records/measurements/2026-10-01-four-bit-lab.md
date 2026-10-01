---
type: measurement
id: 01m3w6kd9fmwh9he8dp0f1mjhe
created: 2026-10-01T17:01:12.367322+00:00
updated: 2026-10-01T17:01:12.385186+00:00
summary: '4-bit lab: no format meets every bar; GPTQ with clipping in groups of 32 and a 4-bit clipped dictionary is best at 373 MB'
date: 2026-10-01
devices: '[[records/devices/dev-mac-m5-pro]]'
phase: 0A
runs: '[[records/run/2026/10/2026-10-01-four-bit-lab]]'
title: 4-bit lab results
status: measured
---
# 4-bit lab (October 1, 2026)

The bar: WikiText-2 perplexity at most 1.2 times the 16-bit figure (20.954 here, reproducing the study's 20.9), KL at most 0.15 nats per token on the 16-bit model's everyday replies, top-1 agreement at least 88%, fact retention at least 95% (100% for the facts the path uses), and at most 400 MB. Raw output: [[records/run/2026/10/2026-10-01-four-bit-lab]].

Floors only (original dictionary), best first:

| Format | Perplexity ratio | KL | Top-1 | Retention | MB with an 8-bit dictionary |
| --- | --- | --- | --- | --- | --- |
| GPTQ with clipping, groups of 32 | 1.050 | 0.152 | 84.9% | 95.7% | 450 |
| GPTQ, groups of 32 | 1.045 | 0.161 | 84.1% | 97.8% | 450 |
| GPTQ with clipping, groups of 64 | 1.064 | 0.182 | 82.1% | 95.7% | 413 |
| GPTQ, groups of 64 | 1.096 | 0.207 | 82.1% | 95.7% | 413 |
| Clipping search, groups of 32 | 1.188 | 0.221 | 81.6% | 93.5% | 450 |
| Plain rounding, groups of 32 | 1.194 | 0.233 | 81.9% | 93.5% | 450 |
| GPTQ, groups of 128 | 1.123 | 0.266 | 80.4% | 89.2% | 395 |
| HQQ, groups of 64 | 1.240 | 0.303 | 78.7% | 94.6% | 413 |
| Plain rounding, groups of 64 (the smoke test's format) | 1.332 | 0.314 | 77.3% | 90.3% | 413 |

Plain rounding, clipping and HQQ at groups of 64 and 128, and symmetric rounding, were worse still (see the run).

Dictionary precision on the best floors:

| Format | Perplexity ratio | KL | Top-1 | Retention | MB |
| --- | --- | --- | --- | --- | --- |
| GPTQ with clipping g32, dictionary 8-bit | 1.050 | 0.153 | 85.0% | 95.7% | 450 |
| GPTQ with clipping g32, dictionary 4-bit with clipping | 1.078 | 0.176 | 83.9% | 96.8% | 373 |
| GPTQ with clipping g32, dictionary 4-bit plain rounding | 1.073 | 0.172 | 83.5% | 94.6% | 373 |
| GPTQ g32, dictionary 4-bit with clipping | 1.074 | 0.185 | 82.6% | 93.5% | 373 |

Every format kept the five facts the path uses. No format meets the KL or top-1 bar; the 8-bit dictionary costs nothing measurable but puts the model at 450 MB. The choice and its gap are in [[records/decisions/2026-10-01-weight-format]].