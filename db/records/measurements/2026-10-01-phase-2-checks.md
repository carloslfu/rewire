---
type: measurement
id: 01m3w9br3320tbb8bs25zn1zaq
created: 2026-10-01T17:49:27.011935+00:00
updated: 2026-10-01T17:50:12.377410+00:00
summary: 'Phase 2 on the development Mac: neutral changes, swaps and interleaving are bit-exact; 60 of 66 recorded runs reproduce live word for word and all show their step''s result'
date: 2026-10-01
devices: '[[records/devices/dev-mac-m5-pro]]'
phase: '2'
title: Phase 2 checks
status: measured
---
# Phase 2 checks on the development Mac (October 1, 2026)

The live WebGPU engine in the page (Chrome 152, development Mac), weights gptqclip-g32-d4clip (manifest 88f06923), driven from the page's own actions and engine client.

| Check | Result |
| --- | --- |
| Neutral controls reproduce the normal reply bit for bit | Four changes that run the change path but change nothing (a word swapped with itself; head, floor and memory multipliers of 1; a concept at strength 0) gave the same words with zero difference in every probability and push |
| Swaps reproduce exchanged replies | Swapping " Paris" and " Rome" and exchanging them in the question gave the normal reply with the two ids exchanged, identical probabilities, on two questions (one reply contained a swapped piece) |
| Interleaved equals solo | A changed reply written alongside the normal one equals the same reply written alone, word for word with zero probability difference, for two change sets (heads off and ×2; a floor off plus a swap); the normal replies also matched |
| Every change matches the reference | Nine golden traces (normal, swap, floor off, heads, hidden start marker, 3 bits, zeroed weights, concept, and memory blocks with a flipped head) pass the section 7.5 tolerances: score p99 at most 0.0078, streams at most 0.0009 relative, the same samples and top words everywhere. The memory case's largest push differs by 0.021 on a push of 8.18, where the float32 reference itself is 0.018 from float64; pushes now use [[records/decisions/2026-10-01-push-tolerance]] |
| Every shipping step reproduces | Replaying all 66 recorded runs through the live engine with their changes and seeds: 60 are identical word for word. Six diverge after a shared start (four in deliberately broken models, where probabilities are nearly flat; the grilled-cheese reply at word 18, "a tomato slice" against "a tomato"; two concept replies after word 50) and each still shows its step's result |
| Latency | See [[records/measurements/2026-10-01-dev-mac-speed]]: every target met |

Also verified in the page: the fork (first change forks at the latest message, chips re-fork, Reset closes), the Difference view, underlines, the head panel's attention lines and full attention map, and live inspection of every step for a word.
