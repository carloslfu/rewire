"""Step 2 follow-up: how many of the weights that write the start marker's huge value must go before it breaks?

Ranks floor 2's down-projection weights into stream channel 35 by their contribution at the start marker
(weight times activation), zeroes the top k for k in 1..8 (the change table holds 8), and measures short
perplexity plus the break rule on the everyday prompts. Writes artifacts/curate/<id>/superweight_group.json.

  uv run python tools/superweight_group.py artifacts/weights/<id>
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import torch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from curate import DATA, EVERY4, Ctx, count, short_ppl  # noqa: E402
from rewire import chat  # noqa: E402
from rewire.ref import Cache  # noqa: E402

FLOOR, CH = 2, 35


@torch.no_grad()
def main():
    wdir = Path(sys.argv[1])
    C = Ctx(wdir)
    mats = C.w.mats(4)
    acts = torch.zeros(mats[FLOOR]["down"].shape[1])
    for msg in json.loads((DATA / "everyday.json").read_text())[:8]:
        cap: dict = {}
        C.model.run(torch.tensor([chat.first_turn(msg)]), Cache(), C.ch({}), capture=cap)
        acts += cap["inter"][FLOOR]["act"][0][0].float().cpu() / 8  # the start marker's units
    row = mats[FLOOR]["down"][CH].float().cpu()
    contrib = row * acts
    order = contrib.abs().argsort(descending=True)
    total = float(contrib.sum())
    print(f"start marker channel {CH} after floor {FLOOR + 1}: {total:.1f}; top contributions:", flush=True)
    for j in order[:10].tolist():
        print(f"  unit {j}: weight {float(row[j]):+.3f} x activation {float(acts[j]):+.1f} = {float(contrib[j]):+.1f}", flush=True)
    base = short_ppl(C, {})
    out = {"floor": FLOOR, "channel": CH, "total": total, "base_ppl": base,
           "top": [{"unit": j, "weight": float(row[j]), "act": float(acts[j]), "contrib": float(contrib[j])} for j in order[:10].tolist()], "k": []}
    for k in range(1, 9):
        spec = {"zeroed": [{"floor": FLOOR, "tensor": "down", "row": CH, "col": j} for j in order[:k].tolist()]}
        p = short_ppl(C, spec)
        left = total - float(contrib[order[:k]].sum())
        per = []
        if p / base > 3:
            for msg in EVERY4[:5]:
                z = C.replies(msg, spec)
                per.append({"prompt": msg, "broken": count(z, lambda r: r["broken"]), "example": z[0]["text"][:120]})
        out["k"].append({"k": k, "ppl": p, "ratio": p / base, "left": left, "per_prompt": per})
        print(f"  zero top {k}: value left {left:8.1f}  ppl {p:8.2f}  x{p / base:7.2f}  broken {[q['broken'] for q in per]}", flush=True)
    C.save("superweight_group", out)


if __name__ == "__main__":
    main()
