"""Step 5 search: which copying heads does list repetition depend on?

Ranks heads by copying score (atlas), turns off the top K, and compares with K random heads on the same
floors, on everyday word lists and made-up word lists. Prints per-prompt counts out of 20 seeds and writes
artifacts/curate/<id>/step5_search.json. It only measures; the step's rule stays in curate.py.

  uv run python tools/step5_search.py artifacts/weights/<id> 15 24 32 48
"""
from __future__ import annotations

import json
import sys
import time
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from curate import LISTS, MADE_UP, Ctx, count, list_ok  # noqa: E402
from rewire.conv import QH  # noqa: E402


def matched_random(heads: list[tuple[int, int]], seed: int = 1) -> list[tuple[int, int]]:
    rng = np.random.default_rng(seed)
    rand: list[tuple[int, int]] = []
    for L, _ in heads:
        choices = [h for h in range(QH) if (L, h) not in heads and (L, h) not in rand]
        rand.append((L, int(rng.choice(choices))))
    return rand


def main():
    wdir = Path(sys.argv[1])
    ks = [int(k) for k in sys.argv[2:]] or [15, 24, 32, 48]
    C = Ctx(wdir)
    at = C.load("atlas")
    cs = np.array(at["copying_scores"])
    flat = np.argsort(-cs, axis=None)
    ranked = [(int(i // QH), int(i % QH)) for i in flat]
    sets = [("words", LISTS), ("made-up", MADE_UP)]
    normal: dict[str, list] = {}
    out: dict = {"ranked": ranked[:64], "scores": [float(cs[L, h]) for L, h in ranked[:64]], "k": {}}
    for kind, lists in sets:
        for words in lists:
            msg = ("Repeat these made-up words in the same order: " if kind == "made-up" else "Repeat these words in the same order: ") + ", ".join(words) + "."
            normal[msg] = C.replies(msg, {}, loss=False)
    for K in ks:
        t = time.time()
        heads = ranked[:K]
        rand = matched_random(heads)
        off = {"heads": [{"floor": L, "head": h, "mult": 0} for L, h in heads]}
        roff = {"heads": [{"floor": L, "head": h, "mult": 0} for L, h in rand]}
        rows = []
        for kind, lists in sets:
            for words in lists:
                msg = ("Repeat these made-up words in the same order: " if kind == "made-up" else "Repeat these words in the same order: ") + ", ".join(words) + "."
                ok = list_ok(words)
                o = C.replies(msg, off, loss=False)
                r = C.replies(msg, roff, loss=False)
                row = {"kind": kind, "prompt": msg, "stated": count(o, lambda x: not ok(x)), "contrast": count(normal[msg], ok),
                       "control": count(r, ok), "off_example": o[0]["text"][:160], "random_example": r[0]["text"][:160]}
                rows.append(row)
                print(f"  K={K} {kind:8s} broken={row['stated']:2d} normal_ok={row['contrast']:2d} random_ok={row['control']:2d} | {row['off_example'][:70]!r}", flush=True)
        passing = {kind: sum(1 for r in rows if r["kind"] == kind and r["stated"] >= 18 and r["contrast"] >= 18 and r["control"] >= 18) for kind, _ in sets}
        out["k"][K] = {"heads": heads, "random": rand, "rows": rows, "passing": passing}
        print(f"== K={K}: passing prompts {passing} in {time.time() - t:.0f}s", flush=True)
        C.save("step5_search", out)


if __name__ == "__main__":
    main()
