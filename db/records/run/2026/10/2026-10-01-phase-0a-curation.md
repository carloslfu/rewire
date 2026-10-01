---
type: run
id: 01m3w8exhdwgz3tp7zzf9wm93p
created: 2026-10-01T17:33:42.317541+00:00
updated: 2026-10-01T17:33:42.317541+00:00
summary: 'Phase 0A curation of the chosen weights: every path step''s rule, the copying-head search and the start-marker weight scan'
captured_at: 2026-10-01
command: sh tools/pipeline.sh gptqclip 32 4 clip ...; uv run python tools/curate.py W step10 step5 step2 step4
devices: '[[records/devices/dev-mac-m5-pro]]'
discarded: 'false'
title: Phase 0A curation output
tool: py/tools/curate.py, py/tools/step5_search.py, py/tools/superweight_scan.py, py/tools/superweight_group.py
---
Curation of the chosen weights (gptqclip-g32-d4clip, manifest 88f06923) on the development Mac through the Python reference and the section 7.3 sampler. Every step uses 20 seeds per prompt; the rule needs the stated result in at least 18 of 20 seeds on at least 4 prompts, with the normal model showing the contrast in at least 18 of 20. Full results are in artifacts/curate/gptqclip-g32-d4clip/ (not committed); logs in artifacts/pipeline/.

```
breaks: thresholds loss 4.0 nats, trigram distinct 0.4, other script 0.2; 0 of 200 normal replies broken
atlas: 15 copying heads (score >= 0.3), 284 start-marker heads (score >= 0.6)
step1: 7 of 7 prompts pass (Eiffel Tower named in 20 of 20 under the swap; a Rome landmark in 20 of 20 normally)
step3: 6 of 6 (floor 1 off breaks 20 of 20; floor 14 off keeps the answer 20 of 20)
step4: hidden from the third word on: passes (20 of 20 broken on every prompt so far)
step5 (real words, first run): fails; broken 0, 0, 15, 4, 11, 0 of 20 with the 15 copying heads off
step5_search: K=15 made-up 5 of 6 pass, words 0; K=24 made-up 3, words 0; K=32 made-up 4, words 0; K=48 made-up 0, words 1
step5 (made-up words): 6 of 6 (off broken 20 of 20 on each; normal 20; random heads keep 20, 20, 19, 20, 20, 20)
concepts: ocean best at floor 15 (index 14), working 1.0, breaking 1.5; space and winter also measured
step6: 4 of 6 (concept present 18, 19, 12, 19, 16, 18 of 20; none broken at the working strength)
step7: 6 of 6; on the best prompt the answer becomes and stays the top floor guess at floor 23 (median)
step8: 6 of 6; mean probability of its own words 0.757 on made-up subjects against 0.996 on real ones
step9: 4 of 6 (third choice changes the story 16, 20, 19, 19, 16, 18 of 20)
step10 (first run): marked failing because the rule treated the 3-bit count as a required control
step10 (fixed rule): 5 of 6; 2 bits broken 20, 20, 20, 20, 20, 14 of 20; 3 bits broken 0 or 1 of 20, loss 0.31-0.95 -> 1.64-2.40 nats
step2 (single weight): fails; best single zeroing x1.05 perplexity (down[2][35,55])
superweight_scan: floor 3 (index 2) writes 8,067 into stream channel 35 at the start marker, in both 4-bit and 16-bit
superweight_group: zero top k of that row: x1.05, x1.23, x2.22, x8.28, x47.1, x76.1, x75.6, x76.1 (k = 1..8)
step2 (five weights): k=4 fails (broken 20, 19, 15, 18, 17); k=5 passes 4 of 5 (19, 19, 15, 18, 18); 460 of 8,067 left
```
