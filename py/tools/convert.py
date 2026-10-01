"""Convert Qwen3-0.6B to the engine's format (section 7.4).

  uv run python tools/convert.py --method rtn --group 64 --dict-bits 8 [--extras artifacts/curation/extras.json]

`--extras` adds the atlas, the built-in concepts and rho from Phase 0A curation; without it, rho is
measured here and the atlas and concepts are empty. Output: artifacts/weights/<id>/ with the
manifest and the hashed files.
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

import torch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from rewire import manifest, qlab, quant  # noqa: E402
from rewire.atlas import rho as measure_rho  # noqa: E402
from rewire.conv import ARTIFACTS, FLOORS  # noqa: E402
from rewire.ref import MATS, Model, Quant, Weights, quant8  # noqa: E402

DATA = Path(__file__).resolve().parents[1] / "data"


def quantize(base: Weights, method: str, group: int, dict_bits: int) -> Weights:
    if method in ("rtn", "rtn-sym", "clip"):
        w = Weights(quant_cfg=Quant(method, group, dict_bits), base=base)
    elif method == "hqq":
        w = Weights(base=base)
        w.quant_cfg = Quant("given", group, 16)
        w.packed = {(L, m): qlab.hqq(base.orig[L][m].to(w.device), group) for L in range(FLOORS) for m in MATS}
        w._mats = {}
    elif method in ("gptq", "gptqclip"):
        sys.path.insert(0, str(Path(__file__).resolve().parent))
        from quantlab import calibration, gptq_weights  # noqa: E402
        w = gptq_weights(base, group, method == "gptqclip", calibration())
    else:
        raise ValueError(method)
    if dict_bits in (4, 8) and "dict" not in w.packed:
        e = base.embed_orig.to(w.device)
        w.packed["dict"] = quant8(e, group) if dict_bits == 8 else quant.quantize_rtn(e, group)
    w.quant_cfg = Quant(method, group, dict_bits)
    if dict_bits in (4, 8):
        c, s, o = w.packed["dict"]
        w.dictionary = w._dequant_dict(c, s, o).to(w.device, w.dtype)
        from rewire.conv import VOCAB_REAL
        w.mean_row = w.dictionary[:VOCAB_REAL].cpu().double().mean(0).to(w.device, w.dtype)
    return w


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--method", default="rtn")
    ap.add_argument("--group", type=int, default=64)
    ap.add_argument("--dict-bits", type=int, default=8)
    ap.add_argument("--extras", default=None)
    ap.add_argument("--metrics", default=None, help="the quant lab JSON for this format")
    a = ap.parse_args()
    t = time.time()
    base = Weights()
    w = quantize(base, a.method, a.group, a.dict_bits)
    extras = json.loads(Path(a.extras).read_text()) if a.extras else {}
    rho = extras.get("rho") or measure_rho(Model(w), json.loads((DATA / "everyday.json").read_text())[:50])
    concepts = {cid: [torch.tensor(v) for v in vecs] for cid, vecs in extras.get("concept_vectors", {}).items()}
    metrics = json.loads(Path(a.metrics).read_text()) if a.metrics else {}
    fid = f"{a.method}-g{a.group}-d{a.dict_bits}"
    out = ARTIFACTS / "weights" / fid
    man = manifest.write(w, out, {"method": a.method, "metrics": metrics}, rho, extras.get("atlas", {}), concepts,
                         extras.get("concepts", []))
    print(json.dumps({"id": fid, "dir": str(out), "files": len(man["files"]), "bytes": man["total_bytes"],
                      "hash": man["hash"], "seconds": round(time.time() - t)}))


if __name__ == "__main__":
    main()
