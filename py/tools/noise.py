"""The reference's own float32 noise (section 7.5): float32 against float64 on the golden cases.

  uv run python tools/noise.py artifacts/weights/<id> [case ...]

Same weights, same tokens, same half-precision key-value cache; scores on the top 64 per position and the
stream per floor, compared exactly as the engine's parity test compares the engine against float32.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
import torch
from safetensors.numpy import load_file

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from rewire import manifest  # noqa: E402
from rewire.conv import ARTIFACTS, FLOORS  # noqa: E402
from rewire.ref import Cache, Changes, Model  # noqa: E402


@torch.no_grad()
def main():
    wdir = Path(sys.argv[1])
    only = sys.argv[2:]
    gdir = ARTIFACTS / "golden" / wdir.name
    w64, man = manifest.read(wdir, device="cpu", dtype=torch.float64)
    m64 = Model(w64, kv_half=True)
    out = {}
    for f in sorted(gdir.glob("*.json")):
        if f.name == "engine-report.json":
            continue
        c = json.loads(f.read_text())
        if only and c["name"] not in only:
            continue
        g = load_file(str(gdir / f"{c['name']}.safetensors"))
        toks = c["tokens"]
        ch = Changes.make(c["changes"], "cpu", dtype=torch.float64, concepts=man["_concepts"], rho=man["rho"], concept_from=c["concept_first"])
        cap: dict = {}
        xs = m64.run(torch.tensor([toks]), Cache(), ch, capture=cap)
        sc = m64.scores(xs[0], ch).numpy()
        ti, tv = g["top_ids"], g["top_scores"]
        T = len(toks)
        errs = np.abs(np.take_along_axis(sc, ti.astype(np.int64), 1) - tv).ravel()
        worst = 0.0
        for L in range(FLOORS + 1):
            ref = cap["stream"][L][0].numpy()
            a = g[f"stream_{L}"]
            worst = max(worst, float(np.sqrt(((a - ref) ** 2).sum() / (ref ** 2).sum())))
        out[c["name"]] = {"tokens": T, "max": float(errs.max()), "p99": float(np.quantile(errs, 0.99)), "stream_rel": worst}
        print(c["name"], json.dumps(out[c["name"]]), flush=True)
    (gdir / "noise-f32-vs-f64.json").write_text(json.dumps(out, indent=1))


if __name__ == "__main__":
    main()
