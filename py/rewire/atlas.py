"""The atlas of named parts (section 8, Phase 0A) and concept vectors (section 7.2)."""
from __future__ import annotations

import numpy as np
import torch

from . import chat
from .conv import FLOORS, QH, TOK
from .ref import Cache, Changes, Model


def copying_scores(model: Model, n_seq: int = 32, length: int = 50, seed: int = 0, batch: int = 8) -> np.ndarray:
    """Average attention from each token of a repeated random sequence to the token that followed its
    earlier copy, per floor and head. Position 0 is the start marker."""
    rng = np.random.default_rng(seed)
    total = torch.zeros(FLOORS, QH)
    done = 0
    ch = Changes.make({}, model.device)
    while done < n_seq:
        b = min(batch, n_seq - done)
        seqs = rng.integers(1000, 30000, size=(b, length))
        toks = np.concatenate([np.full((b, 1), TOK["im_start"]), seqs, seqs], 1)
        cap: dict = {}
        model.run(torch.tensor(toks), Cache(), ch, capture=cap)
        q = torch.arange(1 + length + 1, 1 + 2 * length)  # second copy, from its second token
        k = q - length + 1  # the token after the earlier copy of the current token
        for L in range(FLOORS):
            pr = cap["probs"][L]  # [b, 16, T, T]
            total[L] += pr[:, :, q, k].mean(-1).sum(0).cpu()
        done += b
    return (total / n_seq).numpy()


def start_marker_scores(model: Model, prompts: list[str], from_pos: int = 8) -> np.ndarray:
    """Mean attention to position 0 from positions >= from_pos, per floor and head."""
    total = torch.zeros(FLOORS, QH)
    ch = Changes.make({}, model.device)
    for p in prompts:
        toks = chat.first_turn(p)
        cap: dict = {}
        model.run(torch.tensor([toks]), Cache(), ch, capture=cap)
        for L in range(FLOORS):
            total[L] += cap["probs"][L][0, :, from_pos:, 0].mean(-1).cpu()
    return (total / len(prompts)).numpy()


def streams_at(model: Model, texts: list[str], as_chat: bool = True) -> list[torch.Tensor]:
    """Per floor, the streams entering it at every position after the system turn, stacked over texts."""
    ch = Changes.make({}, model.device)
    per_floor: list[list[torch.Tensor]] = [[] for _ in range(FLOORS)]
    for t in texts:
        toks = chat.first_turn(t) if as_chat else chat.plain(t)
        start = chat.system_end(toks) if as_chat else 1
        cap: dict = {}
        model.run(torch.tensor([toks]), Cache(), ch, capture=cap)
        for L in range(FLOORS):
            per_floor[L].append(cap["stream"][L][0, start:].float().cpu())
    return [torch.cat(x, 0) for x in per_floor]


def rho(model: Model, prompts: list[str]) -> list[float]:
    """Median stream size entering each floor over a reference set, excluding position 0."""
    st = streams_at(model, prompts)
    return [float(s.norm(dim=-1).median()) for s in st]


def concept_vectors(model: Model, positive: list[str], negative: list[str]) -> list[torch.Tensor]:
    """Difference of mean streams, per floor, scaled to unit length."""
    pos = streams_at(model, positive)
    neg = streams_at(model, negative)
    out = []
    for L in range(FLOORS):
        d = pos[L].mean(0) - neg[L].mean(0)
        out.append(d / d.norm())
    return out
