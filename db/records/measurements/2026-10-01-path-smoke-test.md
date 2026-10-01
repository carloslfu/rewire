---
type: measurement
id: 01m3w1ncdgw7knpcmx54tre1aq
created: 2026-10-01T15:34:54.128147+00:00
updated: 2026-10-01T15:34:54.128147+00:00
summary: 'Path smoke test: core steps 1, 3 and 10 hold on plainly rounded 4-bit weights; optional steps 4, 6, 7 and 8 read positive'
date: 2026-10-01
devices: '[[records/devices/dev-mac-m5-pro]]'
phase: smoke
runs: '[[records/run/2026/10/2026-10-01-path-smoke-test]]'
title: Path smoke test results
status: measured
---
# Path smoke test (October 1, 2026)

Qwen3-0.6B at commit c1899de, plainly rounded to 4 bits (affine, groups of 64, dictionary kept at 16 bits), on the development Mac. Each step ran 3 prompts with 10 seeds (5 for the concept grid) through the Python reference and the section 7.3 sampler. "Broken" uses the Phase 0A rule before calibration. Raw output: [[records/run/2026/10/2026-10-01-path-smoke-test]].

| Step | Result | Verdict |
| --- | --- | --- |
| 1 Swap Paris and Rome (core) | Changed model named the Eiffel Tower in 30 of 30 replies; the normal one named a Rome landmark in 30 of 30 | Holds |
| 3 Skip a floor (core) | Floor 1 off broke 30 of 30 (floor 2 off too); floor 14 off kept the answer in 30 of 30; floors 21 and 28 off kept it in 2 of 3 prompts | Holds |
| 10 Squeeze the numbers (core) | 4 bits broke 0 of 30; 3 bits (8 levels) broke 27 of 30, mostly by switching to Chinese or Arabic or looping; 2 bits broke 28 of 30 | Holds; 3 bits is already the breaking point |
| 4 Hide the start marker | Hidden from every later word: 0 of 30 broke. Hidden from every word after the second: 30 of 30 broke (empty replies) | The second version holds |
| 5 Copying heads | 14 heads score at least 0.3 (top: floor 17 head 15 at 0.96). The list prompt was unreliable even for the normal model (0.0 to 0.7) | Prompt needs redesign in Phase 0A |
| 6 Concept "ocean" | Floor 11 strength 0.6: sea in 4 of 5, none broken; floor 15 strength 0.4: 4 of 5, none broken; strength 1.0 and above breaks often | Promising; calibrate in Phase 0A |
| 7 Where the answer forms | The answer becomes and stays the top floor guess at floors 21, 25 and 28 (one-based) | Holds: upper floors |
| 8 Something made up | Admitted not knowing in 0 of 30; it described each made-up thing | Holds ("it describes it") |

Swap pairs that are single pieces in both words: Paris/Rome only " Paris"/" Rome"; yes/no in 6 forms; cat/dog in 5 forms (not " CAT"/" DOG"). A reply that starts with the city name writes it without a leading space, which is not swapped, so step 1's prompts must lead to replies like "The most famous landmark in Rome is ...".

Conclusion: the core steps hold, so engine work proceeds; optional steps 4, 6, 7 and 8 have an early positive read, step 5 needs a better prompt, and step 2 is first tested in Phase 0A.
