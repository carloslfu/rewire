"""The dictionary's precision on top of the best floor formats (Phase 0A, 4-bit choice).

  uv run python tools/dictlab.py

The quant lab measured floor formats with the original dictionary. This measures the same metrics with
the dictionary at 8 bits and at 4 bits (plain rounding or clipping search, groups of 32), and the size of
each complete model. Results: artifacts/quantlab/<floors>+<dict>.json.
"""
from __future__ import annotations

import gc
import json
import sys
import time
from pathlib import Path

import torch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from quantlab import OUT, DATA, calibration, evaluate, gptq_weights, logits_on, perplexity, ppl_tokens, reference_replies  # noqa: E402
from rewire import quant  # noqa: E402
from rewire.conv import VOCAB_REAL  # noqa: E402
from rewire.ref import Model, Quant, Weights, quant8  # noqa: E402


def with_dict(w: Weights, base: Weights, kind: str, group: int):
    e = base.embed_orig.to(w.device)
    if kind == "d8":
        w.packed["dict"] = quant8(e, group)
        bits = 8
    elif kind == "d4":
        w.packed["dict"] = quant.quantize_rtn(e, group)
        bits = 4
    else:
        w.packed["dict"] = quant.quantize_clip_search(e, group)
        bits = 4
    w.quant_cfg = Quant("given", group, bits)
    c, s, o = w.packed["dict"]
    w.dictionary = w._dequant_dict(c, s, o).to(w.device, w.dtype)
    w.mean_row = w.dictionary[:VOCAB_REAL].cpu().double().mean(0).to(w.device, w.dtype)
    return bits


def main():
    base_w = Weights()
    m16 = Model(base_w)
    ids = ppl_tokens()
    every = json.loads((DATA / "everyday.json").read_text())[:100]
    facts = json.loads((DATA / "facts.json").read_text())
    b = json.loads((OUT / "base16.json").read_text())
    pairs = reference_replies(m16, every)
    base = {"ids": ids, "pairs": pairs, "ref_lp": logits_on(m16, pairs), "facts": facts, "known16": b["known16"], "ppl16": b["ppl16"]}
    calib = calibration()
    plan = {"gptqclip-g32": ["d8", "d4clip", "d4"], "gptq-g32": ["d4clip"]}
    for floors, dicts in plan.items():
        todo = [d for d in dicts if not (OUT / f"{floors}+{d}.json").exists()]
        if not todo:
            continue
        t = time.time()
        w = gptq_weights(base_w, 32, floors.startswith("gptqclip"), calib)
        print(floors, "quantized in", round(time.time() - t), "s", flush=True)
        for d in todo:
            bits = with_dict(w, base_w, d, 32)
            evaluate(f"{floors}+{d}", Model(w), base, quant.model_bytes(32, bits))
        del w
        gc.collect()
        torch.mps.empty_cache()


if __name__ == "__main__":
    main()
