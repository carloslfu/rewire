---
type: run
id: 01m3w6jtzzs8vyq02k0bx1j9kz
created: 2026-10-01T17:00:53.631279+00:00
updated: 2026-10-01T17:00:53.653+00:00
summary: '4-bit lab: 14 floor formats with the original dictionary, then 8- and 4-bit dictionaries on the best floors'
captured_at: 2026-10-01
command: uv run python tools/quantlab.py; uv run python tools/dictlab.py
devices: '[[records/devices/dev-mac-m5-pro]]'
discarded: 'false'
title: 4-bit lab output
tool: py/tools/quantlab.py, py/tools/dictlab.py
---
Each line is one candidate's result file in artifacts/quantlab/ (not committed). Bytes assume an 8-bit dictionary for floor-only rows (quant lab) and the stated dictionary for "+d" rows (dictionary lab). KL and top-1 compare against the 16-bit model's own replies to 100 everyday prompts at temperature 1; retention counts the facts the 16-bit model knows (2 of 3 seeds).

```
16-bit: perplexity 20.954 on 299078 WikiText-2 test tokens (2,048-token windows); facts known 93 of 100
{"name": "clip-g128", "bytes": 394539008, "ppl": 27.122, "kl": 0.4035, "top1": 0.7426, "retention": 0.871, "path_facts_kept": true, "ppl_ratio": 1.2944, "passes": false}
{"name": "clip-g32", "bytes": 450412544, "ppl": 24.884, "kl": 0.2208, "top1": 0.8162, "retention": 0.9355, "path_facts_kept": true, "ppl_ratio": 1.1875, "passes": false}
{"name": "clip-g64", "bytes": 413163520, "ppl": 26.5537, "kl": 0.2831, "top1": 0.7801, "retention": 0.8925, "path_facts_kept": true, "ppl_ratio": 1.2672, "passes": false}
{"name": "gptq-g128", "bytes": 394539008, "ppl": 23.5369, "kl": 0.2661, "top1": 0.8038, "retention": 0.8925, "path_facts_kept": true, "ppl_ratio": 1.1233, "passes": false}
{"name": "gptq-g32+d4clip", "bytes": 372621312, "ppl": 22.5012, "kl": 0.1851, "top1": 0.8259, "retention": 0.9355, "path_facts_kept": true, "ppl_ratio": 1.0738, "passes": false}
{"name": "gptq-g32", "bytes": 450412544, "ppl": 21.9063, "kl": 0.1606, "top1": 0.8412, "retention": 0.9785, "path_facts_kept": true, "ppl_ratio": 1.0454, "passes": false}
{"name": "gptq-g64", "bytes": 413163520, "ppl": 22.9622, "kl": 0.2073, "top1": 0.8205, "retention": 0.957, "path_facts_kept": true, "ppl_ratio": 1.0958, "passes": false}
{"name": "gptqclip-g32+d4", "bytes": 372621312, "ppl": 22.477, "kl": 0.1722, "top1": 0.8349, "retention": 0.9462, "path_facts_kept": true, "ppl_ratio": 1.0727, "passes": false}
{"name": "gptqclip-g32+d4clip", "bytes": 372621312, "ppl": 22.5878, "kl": 0.1757, "top1": 0.8392, "retention": 0.9677, "path_facts_kept": true, "ppl_ratio": 1.078, "passes": false}
{"name": "gptqclip-g32+d8", "bytes": 450412544, "ppl": 22.0091, "kl": 0.1525, "top1": 0.8496, "retention": 0.957, "path_facts_kept": true, "ppl_ratio": 1.0504, "passes": false}
{"name": "gptqclip-g32", "bytes": 450412544, "ppl": 21.9951, "kl": 0.1523, "top1": 0.8493, "retention": 0.957, "path_facts_kept": true, "ppl_ratio": 1.0497, "passes": false}
{"name": "gptqclip-g64", "bytes": 413163520, "ppl": 22.2985, "kl": 0.1821, "top1": 0.8205, "retention": 0.957, "path_facts_kept": true, "ppl_ratio": 1.0642, "passes": false}
{"name": "hqq-g128", "bytes": 394539008, "ppl": 27.3466, "kl": 0.3878, "top1": 0.755, "retention": 0.9032, "path_facts_kept": true, "ppl_ratio": 1.3051, "passes": false}
{"name": "hqq-g64", "bytes": 413163520, "ppl": 25.978, "kl": 0.303, "top1": 0.7868, "retention": 0.9462, "path_facts_kept": true, "ppl_ratio": 1.2398, "passes": false}
{"name": "rtn-g128", "bytes": 394539008, "ppl": 29.2879, "kl": 0.5595, "top1": 0.7096, "retention": 0.8925, "path_facts_kept": true, "ppl_ratio": 1.3977, "passes": false}
{"name": "rtn-g32", "bytes": 450412544, "ppl": 25.0254, "kl": 0.2331, "top1": 0.8192, "retention": 0.9355, "path_facts_kept": true, "ppl_ratio": 1.1943, "passes": false}
{"name": "rtn-g64", "bytes": 413163520, "ppl": 27.908, "kl": 0.3136, "top1": 0.7734, "retention": 0.9032, "path_facts_kept": true, "ppl_ratio": 1.3319, "passes": false}
{"name": "rtnsym-g64", "bytes": 413163520, "ppl": 34.2376, "kl": 0.653, "top1": 0.6845, "retention": 0.871, "path_facts_kept": false, "ppl_ratio": 1.6339, "passes": false}
```

Two runs failed before these: GPTQ first crashed on a setup bug (it dequantized floors before quantizing them) and then on float64 on the GPU (MPS); both were fixed and the GPTQ rows above are from the third run.
