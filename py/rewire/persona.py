"""Batched, additive single-MLP-neuron experiments on the converted reference model.

No prompts are rewritten by steering. A dose is a fraction of a reference residual
norm, divided by the norm of the selected down-projection column. This is an
inference intervention, not training, a classifier, or a semantic neuron label.
"""
from __future__ import annotations

import math
import torch

from . import chat
from .conv import FLOORS, UNITS
from .ref import Cache, Changes, Model


def hook_for(recipes: list[list[dict]], device: str):
    """Independent recipes per batch row; all positions, before down projection."""
    by_floor: dict[int, torch.Tensor] = {}
    for b, recipe in enumerate(recipes):
        for n in recipe:
            floor, unit, delta = n["floor"], n["unit"], n["delta"]
            if type(floor) is not int or type(unit) is not int or not 0 <= floor < FLOORS or not 0 <= unit < UNITS:
                raise ValueError("Neuron address out of range")
            if not math.isfinite(delta) or abs(delta) > torch.finfo(torch.float32).max:
                raise ValueError("Invalid neuron delta")
            if floor not in by_floor:
                by_floor[floor] = torch.zeros(len(recipes), 1, UNITS)
            by_floor[floor][b, 0, unit] += float(delta)
    by_floor = {L: a.to(device) for L, a in by_floor.items()}

    def hook(L, act):
        return act + by_floor[L] if L in by_floor else act

    return hook


def padded(sequences: list[list[int]], device: str):
    tokens = torch.zeros(len(sequences), max(map(len, sequences)), dtype=torch.long, device=device)
    for b, seq in enumerate(sequences):
        tokens[b, :len(seq)] = torch.tensor(seq, device=device)
    return tokens


def target_mask(prefix_lengths: list[int], lengths: list[int], width: int, device="cpu"):
    """At hidden position t score token t+1, including the FIRST response token."""
    t = torch.arange(width, device=device)[None, :]
    starts = torch.tensor(prefix_lengths, device=device)[:, None] - 1
    ends = torch.tensor(lengths, device=device)[:, None] - 1
    return (t >= starts) & (t < ends)


def reply_scores(model: Model, prompt: str, replies: list[str], recipes: list[list[dict]]):
    """Mean response log probability, excluding padding; teacher-forced, not generation."""
    prefix = chat.first_turn(prompt)
    seqs = [prefix + chat.plain(reply) for reply in replies]
    tokens = padded(seqs, model.device)
    ch = Changes.make({}, model.device)
    xs = model.run(tokens, Cache(), ch, mlp_hook=hook_for(recipes, model.device))
    mask = target_mask([len(prefix)] * len(seqs), list(map(len, seqs)), tokens.shape[1] - 1, model.device)
    sums = torch.zeros(len(seqs), device=model.device)
    # Avoid materializing [batch, entire prompt, vocabulary] logits.
    for start in range(len(prefix) - 1, tokens.shape[1] - 1, 6):
        end = min(start + 6, tokens.shape[1] - 1)
        lp = model.scores(xs[:, start:end], ch).log_softmax(-1)
        chosen = lp.gather(-1, tokens[:, start + 1:end + 1, None]).squeeze(-1)
        sums += (chosen * mask[:, start:end]).sum(-1)
    return (sums / mask.sum(-1).clamp_min(1)).cpu().numpy()


def generate_batch(model: Model, prompt: str, recipes: list[list[dict]], cap=64):
    """Greedy, same exact prompt per row. Includes stopped rows only in the cache."""
    ch = Changes.make({}, model.device)
    hook = hook_for(recipes, model.device)
    prefix = chat.first_turn(prompt)
    tokens = torch.tensor([prefix] * len(recipes), device=model.device)
    cache = Cache()
    xs = model.run(tokens, cache, ch, mlp_hook=hook)
    rows: list[list[int]] = [[] for _ in recipes]
    done = [False] * len(recipes)
    for step in range(cap):
        ids = model.scores(xs[:, -1], ch).argmax(-1)
        for b, n in enumerate(ids.tolist()):
            if not done[b]:
                rows[b].append(n)
                done[b] = n in chat.TOK["stop"]
        if all(done) or step == cap - 1:
            break
        xs = model.run(ids[:, None], cache, ch, mlp_hook=hook)
    return [{"text": chat.decode([n for n in ids if n not in chat.TOK["stop"]]), "ids": ids,
             "ended": bool(ids and ids[-1] in chat.TOK["stop"])} for ids in rows]


def activation_means(model: Model, examples: list[tuple[str, str]]):
    """Equal weight per text, pooling ONLY the teacher-forced assistant response."""
    prefixes = [chat.first_turn(p) for p, _ in examples]
    seqs = [p + chat.plain(text) for p, (_, text) in zip(prefixes, examples)]
    tokens = padded(seqs, model.device)
    pos = torch.arange(tokens.shape[1], device=model.device)[None, :]
    mask = ((pos >= torch.tensor(list(map(len, prefixes)), device=model.device)[:, None]) &
            (pos < torch.tensor(list(map(len, seqs)), device=model.device)[:, None])).float()
    means = []

    def collect(L, act):
        means.append((act * mask[:, :, None]).sum(1) / mask.sum(1)[:, None])
        return act

    model.run(tokens, Cache(), Changes.make({}, model.device), mlp_hook=collect)
    return torch.stack(means, dim=1).cpu().numpy()
