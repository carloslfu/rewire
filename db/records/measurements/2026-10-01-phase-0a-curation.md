---
type: measurement
id: 01m3w8fmne1jf63v2x2q8n1hv0
created: 2026-10-01T17:34:05.998931+00:00
updated: 2026-10-01T17:34:05.998931+00:00
summary: 'Phase 0A curation: all four core steps and every optional step pass their rule on the chosen weights'
date: 2026-10-01
devices: '[[records/devices/dev-mac-m5-pro]]'
phase: 0A
runs: '[[records/run/2026/10/2026-10-01-phase-0a-curation]]'
title: Phase 0A curation results
status: measured
---
# Phase 0A curation results (October 1, 2026)

The chosen weights (GPTQ with clipping in groups of 32, 4-bit clipped dictionary; manifest 88f06923) on the development Mac. Rule: the stated result in at least 18 of 20 seeds on at least 4 prompts, with the normal model showing the contrast in at least 18 of 20 on those prompts. Raw output: [[records/run/2026/10/2026-10-01-phase-0a-curation]].

| Step | Prompts passing | What was measured | Verdict |
| --- | --- | --- | --- |
| 1 Swap Paris and Rome (core) | 7 of 7 | Swapped model names the Eiffel Tower in 20 of 20; normal names a Rome landmark in 20 of 20 | Ships |
| 2 Five numbers out of 596 million | 4 of 5 | Floor 3 writes 8,067 into stream channel 35 at the start marker, where 99.9% of the other numbers stay below 4.9. Six weights carry it; zeroing the largest alone raises perplexity 5%, the top five 47 times, and breaks replies (19, 19, 15, 18, 18 of 20) | Ships with five weights |
| 3 Skip a floor (core) | 6 of 6 | Floor 1 off breaks 20 of 20; floor 14 off keeps the answer 20 of 20 | Ships |
| 4 Hide the start marker | 6 of 6 | Hidden from the third word on: broken 20 of 20 on every prompt | Ships |
| 5 Turn off the copying heads | 6 of 6 | 15 heads with copying score at least 0.3. Made-up words garbled in 20 of 20 on every list; 15 random heads on the same floors keep 19 to 20 of 20. Real words survive (0 of 6 lists pass) | Ships with made-up words |
| 6 Add a concept, then push too far | 4 of 6 | "Ocean" at floor 15, strength 1.0 works (present in 18 to 19 of 20 on passing prompts), 1.5 breaks | Ships |
| 7 Where does the answer form? | 6 of 6 | The answer becomes and stays the top floor guess at floor 23 (median, best prompt) | Ships |
| 8 Ask about something made up | 6 of 6 | It describes every made-up subject; its own words average 0.757 probability against 0.996 on real subjects | Ships |
| 9 Force its third choice (core) | 4 of 6 | The third choice changes the story in 16 to 20 of 20 | Ships |
| 10 Squeeze the numbers (core) | 5 of 6 | 2 bits broken in 20 of 20 on five prompts (14 on the sixth). 3 bits stays fluent (0 or 1 of 20 broken) but its loss roughly triples, 0.31-0.95 to 1.64-2.40 nats | Ships; copy says 8 levels "make less sense" |

All four core steps pass and every optional step ships, so the path has 11 steps including the tiny model. Two first results were bookkeeping or design problems rather than model results: step 10's rule had required its 3-bit count as a control, and step 5's real-word lists did not need the copying heads. Both are recorded in [[records/decisions/2026-10-01-path-step-redesigns]].
