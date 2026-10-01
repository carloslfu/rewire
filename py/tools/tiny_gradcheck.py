"""The tiny model's gradient against a 64-bit reference (section 6.3).

  uv run python tools/tiny_gradcheck.py [artifacts/tiny/grad-case.json]

The jax-js test writes the case (parameters, a batch, its loss and gradient in float32); this computes
the same loss in float64 with PyTorch autograd and reports the differences.
"""
from __future__ import annotations

import json
import math
import sys
from pathlib import Path

import torch

ROOT = Path(__file__).resolve().parents[2]


def main():
    f = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "artifacts" / "tiny" / "grad-case.json"
    case = json.loads(f.read_text())
    c = case["cfg"]
    P = torch.tensor(case["params"], dtype=torch.float64, requires_grad=True)
    T = c["context"]
    x = torch.tensor(case["x"]).view(-1, T)
    y = torch.tensor(case["y"]).view(-1, T)
    B = x.shape[0]
    W, H, KV, D, U = c["width"], c["heads"], c["kvHeads"], c["headSize"], c["units"]
    lay = {t["name"]: t for t in case["layout"]}

    def get(name):
        t = lay[name]
        return P[t["offset"]:t["offset"] + t["size"]].view(t["shape"])

    def rms(v, w):
        return v * torch.rsqrt(v.pow(2).mean(-1, keepdim=True) + c["eps"]) * w

    half = D // 2
    pos = torch.arange(T, dtype=torch.float64)[:, None]
    inv = torch.tensor([1 / c["theta"] ** ((2 * i) / D) for i in range(half)], dtype=torch.float64)
    ang = pos * inv
    cos = torch.cat([ang.cos(), ang.cos()], -1)[None, :, None, :]
    sin = torch.cat([ang.sin(), ang.sin()], -1)[None, :, None, :]

    def rot(v):
        return torch.cat([-v[..., half:], v[..., :half]], -1)

    dic = get("dict")
    h = dic[x]
    mask = torch.tril(torch.ones(T, T, dtype=torch.bool))
    for L in range(c["floors"]):
        hn = rms(h, get(f"f{L}.in_norm"))
        q = (hn @ get(f"f{L}.q").T).view(B, T, H, D)
        k = (hn @ get(f"f{L}.k").T).view(B, T, KV, D)
        v = (hn @ get(f"f{L}.v").T).view(B, T, KV, D)
        q = rms(q, get(f"f{L}.q_norm"))
        k = rms(k, get(f"f{L}.k_norm"))
        q = q * cos + rot(q) * sin
        k = k * cos + rot(k) * sin
        kx, vx = k.repeat_interleave(H // KV, 2), v.repeat_interleave(H // KV, 2)
        s = torch.einsum("bthd,bshd->bhts", q, kx) / math.sqrt(D)
        s = s.masked_fill(~mask, float("-inf"))
        att = torch.einsum("bhts,bshd->bthd", s.softmax(-1), vx).reshape(B, T, H * D)
        h = h + att @ get(f"f{L}.o").T
        h2 = rms(h, get(f"f{L}.post_norm"))
        h = h + (torch.nn.functional.silu(h2 @ get(f"f{L}.gate").T) * (h2 @ get(f"f{L}.up").T)) @ get(f"f{L}.down").T
    logits = rms(h, get("final_norm")) @ dic.T
    loss = torch.nn.functional.cross_entropy(logits.view(-1, c["vocab"]), y.reshape(-1))
    loss.backward()
    g64 = P.grad
    g32 = torch.tensor(case["grad"], dtype=torch.float64)
    rel = (g32 - g64).norm() / g64.norm()
    worst = (g32 - g64).abs().max()
    out = {"loss_jax": case["loss"], "loss_64": float(loss), "loss_diff": abs(case["loss"] - float(loss)),
           "grad_rel_error": float(rel), "grad_max_abs_error": float(worst), "grad_max_abs": float(g64.abs().max())}
    print(json.dumps(out, indent=1))
    ok = out["loss_diff"] < 1e-4 and out["grad_rel_error"] < 1e-4
    print("PASS" if ok else "FAIL")
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
