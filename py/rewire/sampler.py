"""The sampler of section 7.3, written to match the WGSL and TypeScript versions.

Every draw takes a 32-bit PCG hash of (seed, turn, step). Scores are divided by the
temperature, the top 20 are kept, softmax runs in float32, candidates are sorted by
probability (ties by lower id), the list is cut at top-p 0.8 and one is picked by
inverse CDF.
"""
from __future__ import annotations

import numpy as np

from .conv import SAMPLING, VOCAB_REAL

M32 = 0xFFFFFFFF


def pcg(x: int) -> int:
    s = (x * 747796405 + 2891336453) & M32
    w = (((s >> ((s >> 28) + 4)) ^ s) * 277803737) & M32
    return ((w >> 22) ^ w) & M32


def draw(seed: int, turn: int, step: int) -> float:
    h = pcg(pcg(pcg(seed & M32) ^ (turn & M32)) ^ (step & M32))
    return np.float32((h >> 8) * (2.0 ** -24))


def candidates(scores: np.ndarray, temperature: float | None = None, top_k: int | None = None,
               top_p: float | None = None):
    """Return (ids, probs, cut) for one score vector: the sorted top-k candidates with their
    float32 probabilities, and `cut`, the number kept by top-p. A temperature of 1 with
    top_k=None and top_p=None gives the full distribution used for comparisons."""
    t = np.float32(SAMPLING["temperature"] if temperature is None else temperature)
    k = SAMPLING["top_k"] if top_k is None else top_k
    p = SAMPLING["top_p"] if top_p is None else top_p
    s = np.asarray(scores[:VOCAB_REAL], dtype=np.float32) / t
    if k is None or k >= s.shape[0]:
        ids = np.arange(s.shape[0])
    else:
        part = np.argpartition(-s, k + 8)[: k + 8]  # a margin so ties at the boundary resolve by id
        order = np.lexsort((part, -s[part]))
        ids = part[order][:k]
    sel = s[ids]
    m = np.float32(sel.max())
    e = np.exp((sel - m).astype(np.float32)).astype(np.float32)
    total = np.float32(0)
    for v in e:  # sum in kept order, float32, as in WGSL
        total = np.float32(total + v)
    probs = (e / total).astype(np.float32)
    order = np.lexsort((ids, -probs))
    ids, probs = ids[order], probs[order]
    if p is None:
        return ids, probs, len(ids)
    acc = np.float32(0)
    cut = len(ids)
    for i, v in enumerate(probs):
        acc = np.float32(acc + v)
        if acc >= np.float32(p):
            cut = i + 1
            break
    return ids, probs, cut


def sample(scores: np.ndarray, seed: int, turn: int, step: int, temperature: float | None = None):
    """Pick one token id; also return the candidate list and the cut, for recordings."""
    ids, probs, cut = candidates(scores, temperature)
    kept = probs[:cut]
    total = np.float32(0)
    for v in kept:
        total = np.float32(total + v)
    target = np.float32(draw(seed, turn, step) * total)
    acc = np.float32(0)
    pick = cut - 1
    for i, v in enumerate(kept):
        acc = np.float32(acc + v)
        if acc > target:
            pick = i
            break
    return int(ids[pick]), ids, probs, cut
