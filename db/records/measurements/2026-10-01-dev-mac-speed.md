---
type: measurement
id: 01m3w9br3pc5mftsx033tjb8xh
created: 2026-10-01T17:49:27.030466+00:00
updated: 2026-10-01T17:49:27.030466+00:00
summary: 'Development Mac: 176 tokens/s, 40-token reply in 0.58 s with or without changes, first changed word 0.33 s, inspection 58 ms, 761 MB; device check within 12%'
date: 2026-10-01
devices: '[[records/devices/dev-mac-m5-pro]]'
phase: '1'
title: Speed on the development Mac
status: measured
---
# Speed on the development Mac (October 1, 2026)

The page's `?bench` (medians of five runs; inspection: one warm-up, then seven runs), Chrome 152 in the desktop app's browser pane, weights gptqclip-g32-d4clip, context capped at 1,024. No other GPU work running.

| Measure | Result | Target |
| --- | --- | --- |
| Writing speed, no changes | 176 to 178 tokens/s | 60+ |
| Read 300 pieces and write 40, no changes | 578 to 588 ms | 40-token reply under 1.5 s |
| Same with changes (a head off, a memory block ×2) | 577 to 589 ms (40+ tokens/s with changes) | 40+ tokens/s |
| First changed word after the read | 330 to 339 ms | under 0.5 s |
| Inspecting one word (every step, all floors) | 58 ms median, 57 to 68 ms | about 100 ms |
| GPU memory (weights, three conversations' caches, buffers) | 761 MB estimated | under 800 MB |
| Device check prediction of the 300 + 40 job | 0.579 to 0.659 s against 0.578 to 0.588 s measured, within 12% | within 20% |

Inspection phases: capture pass and readback 13 ms, unit pushes 11 ms, floor guesses 33 ms (14 ms of it reading 17 MB of scores back). Two earlier sessions measured 326 to 436 ms with every phase three to eight times slower, including pure CPU unpacking, while other work shared the machine; the first of those also counted shader compilation, which the bench now excludes with a warm-up.
