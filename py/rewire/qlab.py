"""Quantization methods for the 4-bit lab (Phase 0A): plain rounding, clipping search, HQQ and
GPTQ without column reordering. Every method returns (codes uint8, scale16, offset16) in the
file format: a weight is offset + scale * code, codes 0..15, groups along the input."""
from __future__ import annotations

import math

import torch

from . import quant
from .conv import FLOORS, QH, HD, KVH


def hqq(w: torch.Tensor, group: int, iters: int = 20, p: float = 0.7, beta: float = 10.0, kappa: float = 1.01):
    """Half-quadratic optimization of each group's offset (HQQ), scale from the group's range."""
    out, inp = w.shape
    g = w.float().reshape(out, inp // group, group)
    lo, hi = g.amin(-1, keepdim=True), g.amax(-1, keepdim=True)
    scale = (hi - lo).clamp(min=1e-12) / 15
    zero = -lo / scale  # in code units
    we = torch.zeros_like(g)
    for _ in range(iters):
        wq = torch.round(g / scale + zero).clamp(0, 15)
        wr = (wq - zero) * scale
        d = g - wr
        we = torch.sign(d) * torch.relu(d.abs() - (1.0 / beta) * d.abs().clamp(min=1e-12).pow(p - 1))
        zero = (wq - (g - we) / scale).mean(-1, keepdim=True)
        beta *= kappa
    offset = (-zero * scale).squeeze(-1)
    s16, o16 = scale.squeeze(-1).to(torch.float16), offset.to(torch.float16)
    codes = quant._codes(g, s16, o16)
    return codes.reshape(w.shape), s16, o16


def gptq(w: torch.Tensor, H: torch.Tensor, group: int, blocksize: int = 128, percdamp: float = 0.01,
         clip: bool = False):
    """GPTQ with groups, in natural column order. H is the input Hessian (2 X^T X) [in, in].
    Group parameters are set from the error-updated weights when a group starts."""
    assert blocksize % group == 0
    W = w.clone().float().cpu()
    H = H.clone().double().cpu()
    out, inp = W.shape
    dead = torch.diag(H) == 0
    H[dead, dead] = 1
    W[:, dead] = 0
    damp = percdamp * torch.mean(torch.diag(H))
    H += torch.eye(inp, dtype=H.dtype) * damp
    L = torch.linalg.cholesky(H)
    Hinv = torch.cholesky_inverse(L)
    Hinv = torch.linalg.cholesky(Hinv, upper=True).float()
    codes = torch.zeros(out, inp, dtype=torch.uint8)
    s16 = torch.zeros(out, inp // group, dtype=torch.float16)
    o16 = torch.zeros(out, inp // group, dtype=torch.float16)
    for i1 in range(0, inp, blocksize):
        i2 = min(i1 + blocksize, inp)
        W1 = W[:, i1:i2].clone()
        Err = torch.zeros_like(W1)
        Hinv1 = Hinv[i1:i2, i1:i2]
        for i in range(i2 - i1):
            col = i1 + i
            if col % group == 0:
                gw = W1[:, i: i + group].clone()  # the group lies inside this block (group divides blocksize)
                if clip:
                    c, s, o = quant.quantize_clip_search(gw, group)
                else:
                    c, s, o = quant.quantize_rtn(gw, group)
                s16[:, col // group], o16[:, col // group] = s[:, 0], o[:, 0]
            gi = col // group
            s, o = s16[:, gi].float(), o16[:, gi].float()
            x = W1[:, i]
            q = torch.round((x - o) / torch.where(s == 0, torch.ones_like(s), s)).clamp(0, 15)
            codes[:, col] = q.to(torch.uint8)
            deq = o + s * q
            d = Hinv1[i, i]
            err = (x - deq) / d
            W1[:, i:] -= err.unsqueeze(1) @ Hinv1[i, i:].unsqueeze(0)
            Err[:, i] = err
        W[:, i2:] -= Err @ Hinv[i1:i2, i2:]
    return codes, s16, o16


def collect_hessians(model, batches: list[torch.Tensor], quantize_layer=None):
    """Run calibration batches floor by floor; for each floor, record 2 X^T X for the inputs of
    q/k/v (shared), o, gate/up (shared) and down, then let `quantize_layer(L, H)` replace the
    floor's matrices before the next floor reads its outputs (sequential GPTQ)."""
    from .ref import Cache, Changes, rms, rot
    w = model.w
    ch = Changes.make({}, model.device)
    xs = [w.dictionary[b.to(model.device)] for b in batches]
    T = batches[0].shape[1]
    pos = torch.arange(T, device=model.device)
    cos, sin = w.rope_cos[pos][None, :, None, :], w.rope_sin[pos][None, :, None, :]
    mask = pos[None, :] <= pos[:, None]
    for L in range(FLOORS):
        n = w.norms[L]
        Hs = {k: torch.zeros(d, d, dtype=torch.float64) for k, d in (("qkv", 1024), ("o", 2048), ("gu", 1024), ("down", 3072))}
        cnt = 0

        def acc(key, x):
            x2 = x.reshape(-1, x.shape[-1]).float()
            Hs[key].add_((2 * x2.T @ x2).cpu().double())

        for x in xs:
            h = rms(x, n["in"])
            acc("qkv", h)
        if quantize_layer is not None:
            quantize_layer(L, "qkv", Hs["qkv"] / sum(x.shape[0] * x.shape[1] for x in xs))
        m = w.mats(4)[L]
        new_xs = []
        atts = []
        for x in xs:
            B = x.shape[0]
            h = rms(x, n["in"])
            q = rms((h @ m["q"].T).view(B, T, QH, HD), n["q"])
            k = rms((h @ m["k"].T).view(B, T, KVH, HD), n["k"])
            v = (h @ m["v"].T).view(B, T, KVH, HD)
            q = q * cos + rot(q) * sin
            k = k * cos + rot(k) * sin
            Kx = k.half().float().repeat_interleave(QH // KVH, 2)
            Vx = v.half().float().repeat_interleave(QH // KVH, 2)
            sc = torch.einsum("bthd,bshd->bhts", q, Kx) / math.sqrt(HD)
            sc = sc.masked_fill(~mask[None, None], float("-inf"))
            att = torch.einsum("bhts,bshd->bthd", torch.softmax(sc, -1), Vx).reshape(B, T, QH * HD)
            atts.append(att)
            acc("o", att)
        if quantize_layer is not None:
            quantize_layer(L, "o", Hs["o"] / sum(x.shape[0] * x.shape[1] for x in xs))
        m = w.mats(4)[L]
        mids = [x + a @ m["o"].T for x, a in zip(xs, atts)]
        for mid in mids:
            acc("gu", rms(mid, n["post"]))
        if quantize_layer is not None:
            quantize_layer(L, "gu", Hs["gu"] / sum(x.shape[0] * x.shape[1] for x in xs))
        m = w.mats(4)[L]
        acts = []
        for mid in mids:
            h2 = rms(mid, n["post"])
            act = torch.nn.functional.silu(h2 @ m["gate"].T) * (h2 @ m["up"].T)
            acts.append(act)
            acc("down", act)
        if quantize_layer is not None:
            quantize_layer(L, "down", Hs["down"] / sum(x.shape[0] * x.shape[1] for x in xs))
        m = w.mats(4)[L]
        xs = [mid + act @ m["down"].T for mid, act in zip(mids, acts)]
    return xs
