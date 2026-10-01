"""Step 2 diagnosis: where do the massive activations come from, and does any single weight carry one?

Prints, per floor, the largest memory-block output and stream values with their channel and position, then
scores zeroing the down-projection weights that write the largest outputs (super-weight candidates) by
short perplexity on the 4-bit model and the original 16-bit model. Writes
artifacts/curate/<id>/superweight_scan.json. Measures only; step 2's rule stays in curate.py.

  uv run python tools/superweight_scan.py artifacts/weights/<id>
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import torch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from curate import DATA, Ctx, short_ppl  # noqa: E402
from rewire import chat  # noqa: E402
from rewire.conv import FLOORS  # noqa: E402
from rewire.ref import Cache, Changes, Model  # noqa: E402


@torch.no_grad()
def scan(model: Model, prompts: list[str]):
    rows = []
    for L in range(FLOORS):
        rows.append({"floor": L, "mem_max": 0.0, "mem_ch": -1, "mem_pos": -1, "act_ch": -1, "act_max": 0.0, "stream_max": 0.0, "stream_ch": -1})
    ch = Changes.make({}, model.device)
    for p in prompts:
        cap: dict = {}
        model.run(torch.tensor([chat.first_turn(p)]), Cache(), ch, capture=cap)
        for L in range(FLOORS):
            mem = cap["mem"][L][0].float().abs()  # [T, 1024]
            v, idx = mem.flatten().max(0)
            pos, c = divmod(int(idx), mem.shape[1])
            r = rows[L]
            if float(v) > r["mem_max"]:
                act = cap["inter"][L]["act"][0][pos].float().abs()
                r.update(mem_max=float(v), mem_ch=c, mem_pos=pos, act_ch=int(act.argmax()), act_max=float(act.max()))
            s = cap["stream"][L + 1][0].float().abs()
            sv, sidx = s.flatten().max(0)
            if float(sv) > r["stream_max"]:
                r.update(stream_max=float(sv), stream_ch=int(sidx) % s.shape[1])
    return rows


def main():
    wdir = Path(sys.argv[1])
    C = Ctx(wdir)
    prompts = json.loads((DATA / "everyday.json").read_text())[:8]
    out: dict = {}
    for name, model in (("q4", C.model), ("f16", C.m16)):
        rows = scan(model, prompts)
        out[name] = rows
        print(f"== {name}: floor  mem_max(ch,pos) <- act_ch(act_max)   stream_max(ch)", flush=True)
        for r in rows:
            print(f"  {r['floor']:2d}  {r['mem_max']:9.1f} ({r['mem_ch']},{r['mem_pos']}) <- {r['act_ch']} ({r['act_max']:.1f})   {r['stream_max']:9.1f} ({r['stream_ch']})", flush=True)
    # candidates: for the floors with the largest memory outputs, the down weight from the spiking unit to the
    # spiking channel, plus that channel's three largest incoming weights
    top = sorted(out["q4"], key=lambda r: -r["mem_max"])[:4]
    mats = C.w.mats(4)
    cands = []
    for r in top:
        L, c, j = r["floor"], r["mem_ch"], r["act_ch"]
        cands.append((L, c, j))
        row = mats[L]["down"][c].abs().cpu()
        for k in row.topk(3).indices.tolist():
            if (L, c, k) not in cands:
                cands.append((L, c, k))
    base = short_ppl(C, {})
    scored = []
    for L, c, j in cands:
        spec = {"zeroed": [{"floor": L, "tensor": "down", "row": c, "col": j}]}
        p = short_ppl(C, spec)
        w = float(mats[L]["down"][c, j])
        scored.append({"floor": L, "row": c, "col": j, "weight": w, "ppl": p, "ratio": p / base})
        print(f"  zero down[{L}][{c},{j}] (w={w:+.3f}): ppl {p:.2f}  x{p / base:.3f}", flush=True)
    out.update({"base_ppl": base, "candidates": scored})
    C.save("superweight_scan", out)


if __name__ == "__main__":
    main()
