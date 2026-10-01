"""4-bit weight formats: one scale and one offset per group inside each row (section 6.1).

Codes are 0..15. A weight is offset + scale * code, with scale and offset stored as half
floats, so every function here rounds them to float16 before computing codes. The bits
change maps each code through a 16-entry table (section 7.2).
"""
from __future__ import annotations

import math

import torch

from .conv import CONV


def bit_table(bits: int) -> torch.Tensor:
    """t[code] in units of the group's scale: 4 bits is the identity; 3 and 2 bits snap each
    code to 8 or 4 evenly spaced levels between code 0 and code 15."""
    if bits == 4:
        return torch.arange(16, dtype=torch.float64)
    n = (1 << bits) - 1
    return torch.tensor([round(c * n / 15) * 15 / n for c in range(16)], dtype=torch.float64)


def _groups(w: torch.Tensor, group: int) -> torch.Tensor:
    out, inp = w.shape
    assert inp % group == 0, (inp, group)
    return w.reshape(out, inp // group, group)


def _codes(g: torch.Tensor, scale16: torch.Tensor, offset16: torch.Tensor) -> torch.Tensor:
    s = scale16.float().unsqueeze(-1)
    o = offset16.float().unsqueeze(-1)
    c = torch.round((g.float() - o) / torch.where(s == 0, torch.ones_like(s), s))
    return c.clamp_(0, 15).to(torch.uint8)


def quantize_rtn(w: torch.Tensor, group: int, symmetric: bool = False, clip: torch.Tensor | None = None):
    """Plain rounding. Affine: the group's min and max become codes 0 and 15. Symmetric:
    levels -8..7 times a scale. `clip` (per group, 0..1] shrinks the range, for the clipping search."""
    g = _groups(w.float(), group)
    if symmetric:
        amax = g.abs().amax(-1)
        if clip is not None:
            amax = amax * clip
        scale = amax / 7.5
        offset = -7.5 * scale
    else:
        lo, hi = g.amin(-1), g.amax(-1)
        if clip is not None:
            mid = (lo + hi) / 2
            lo, hi = mid + (lo - mid) * clip, mid + (hi - mid) * clip
        scale = (hi - lo) / 15
        offset = lo
    scale16, offset16 = scale.to(torch.float16), offset.to(torch.float16)
    codes = _codes(g, scale16, offset16)
    return codes.reshape(w.shape), scale16, offset16


def dequantize(codes: torch.Tensor, scale16: torch.Tensor, offset16: torch.Tensor, group: int,
               bits: int = 4, dtype=torch.float32) -> torch.Tensor:
    out, inp = codes.shape
    t = bit_table(bits).to(torch.float32).to(codes.device)
    c = t[codes.long()].reshape(out, inp // group, group)
    w = offset16.float().unsqueeze(-1) + scale16.float().unsqueeze(-1) * c  # float32, as the engine computes it
    return w.reshape(out, inp).to(dtype)


def quantize_clip_search(w: torch.Tensor, group: int, grid=(1.0, 0.95, 0.9, 0.85, 0.8, 0.75, 0.7)):
    """Per group, try shrinking the range and keep the clip with the least squared error."""
    g = _groups(w.float(), group)
    best_err = None
    best = None
    for c in grid:
        clip = torch.full(g.shape[:2], c, device=w.device)
        codes, s, o = quantize_rtn(w, group, clip=clip)
        err = ((dequantize(codes, s, o, group) - w.float()) ** 2).reshape(g.shape).sum(-1)
        if best_err is None:
            best_err, best = err, (codes.clone(), s.clone(), o.clone())
        else:
            better = err < best_err
            best_err = torch.where(better, err, best_err)
            bc, bs, bo = best
            gb = better.unsqueeze(-1)
            bc = torch.where(gb, _groups(codes, group), _groups(bc, group)).reshape(w.shape)
            best = (bc, torch.where(better, s, bs), torch.where(better, o, bo))
    return best


def packed_bytes(out: int, inp: int, group: int, bits: int = 4) -> int:
    """Bytes of one matrix in the file format: codes plus one 32-bit word per group."""
    return out * inp * bits // 8 + out * (inp // group) * 4


def model_bytes(group: int, dict_bits: int) -> int:
    m = CONV["model"]
    w, u, l = m["width"], m["memory_units"], m["floors"]
    qd, kvd = m["query_heads"] * m["head_size"], m["kv_heads"] * m["head_size"]
    per = (packed_bytes(qd, w, group) + 2 * packed_bytes(kvd, w, group) + packed_bytes(w, qd, group)
           + 2 * packed_bytes(u, w, group) + packed_bytes(w, u, group))
    norms = (2 * w + 2 * m["head_size"]) * 2
    if dict_bits == 16:
        dct = m["vocab_rows"] * w * 2
    else:
        dct = packed_bytes(m["vocab_rows"], w, group, dict_bits)
    return l * (per + norms) + dct + w * 2


if __name__ == "__main__":
    for g in (32, 64, 128):
        for d in (4, 8, 16):
            print(g, d, round(model_bytes(g, d) / 1e6, 1), "MB")
    print(bit_table(3).tolist(), bit_table(2).tolist(), math.pi)
