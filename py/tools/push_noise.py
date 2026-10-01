"""The reference's own float32 noise on pushes: float64 against the float32 golden pushes.

  uv run python tools/push_noise.py artifacts/weights/<id> [case ...]

Regenerates each golden reply in float64 (same weights, changes, seed and half-precision key-value cache) and
compares the per-token pushes with the float32 ones stored in the golden file, on the tokens both runs wrote.
Prints the largest absolute difference and the largest difference relative to the push's size.
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
from rewire.conv import ARTIFACTS  # noqa: E402
from rewire.ref import Changes, Model, generate_recorded  # noqa: E402


@torch.no_grad()
def main():
    wdir = Path(sys.argv[1])
    only = sys.argv[2:]
    gdir = ARTIFACTS / "golden" / wdir.name
    w64, man = manifest.read(wdir, device="cpu", dtype=torch.float64)
    m64 = Model(w64, kv_half=True)
    out = {}
    for f in sorted(gdir.glob("*.json")):
        if f.name in ("engine-report.json", "noise-f32-vs-f64.json", "push-noise.json"):
            continue
        c = json.loads(f.read_text())
        if only and c["name"] not in only:
            continue
        g = load_file(str(gdir / f"{c['name']}.safetensors"))
        prompt = c["tokens"][:c["prompt_length"]]
        ch = Changes.make(c["changes"], "cpu", dtype=torch.float64, concepts=man["_concepts"], rho=man["rho"], concept_from=c["concept_first"])
        reps, _ = generate_recorded(m64, prompt, ch, [c["seed"]], guesses=False)
        toks = reps[0].tokens
        same = 0
        while same < min(len(toks), len(c["generated"])) and toks[same] == c["generated"][same]:
            same += 1
        p64 = np.stack([r["pushes"] for r in reps[0].records[:same]]).astype(np.float64)
        p32 = g["pushes"][:same].astype(np.float64)
        d = np.abs(p64 - p32)
        rel = d / np.maximum(np.abs(p64), 1.0)
        i = np.unravel_index(int(d.argmax()), d.shape)
        out[c["name"]] = {"tokens_compared": same, "max_abs": float(d.max()), "max_rel_over_1": float(rel.max()),
                          "worst": {"step": int(i[0]), "p": int(i[1]), "f64": float(p64[i]), "f32": float(p32[i])}}
        print(c["name"], json.dumps(out[c["name"]]), flush=True)
    (gdir / "push-noise.json").write_text(json.dumps(out, indent=1))


if __name__ == "__main__":
    main()
