"""The rule for "it breaks" (section 8, Phase 0A): any one of four signs, calibrated so that none of
the normal model's everyday replies trigger it."""
from __future__ import annotations

import re
import unicodedata

import torch

from .ref import Changes, Model, reply_logprobs
from .conv import TOK

LOSS_NATS = 4.0
TRIGRAM_DISTINCT = 0.40
OTHER_SCRIPT = 0.20


def content(tokens: list[int]) -> list[int]:
    return [t for t in tokens if t not in TOK["stop"]]


def trigram_distinct(text: str) -> float | None:
    words = re.findall(r"\w+|[^\w\s]", text.lower())
    if len(words) < 6:
        return None
    tri = [tuple(words[i:i + 3]) for i in range(len(words) - 2)]
    return len(set(tri)) / len(tri)


def other_script_share(text: str) -> float:
    letters = [c for c in text if c.isalpha()]
    if not letters:
        return 0.0
    other = sum(1 for c in letters if not unicodedata.name(c, "").startswith("LATIN"))
    return other / len(letters)


def signs(normal: Model, prompt: list[int], reply: list[int], text: str) -> dict:
    """Measure the four signs for one reply. `normal` is the unchanged 16-bit model."""
    body = content(reply)
    out = {"empty": len(text.strip()) == 0}
    if body:
        lp = reply_logprobs(normal, prompt, reply, Changes.make({}, normal.device))
        out["loss"] = float(-lp.mean())
    else:
        out["loss"] = 0.0
    out["trigrams"] = trigram_distinct(text)
    out["other_script"] = other_script_share(text)
    return out


def broken(s: dict, loss=LOSS_NATS, tri=TRIGRAM_DISTINCT, script=OTHER_SCRIPT) -> bool:
    return bool(s["empty"] or s["loss"] >= loss or (s["trigrams"] is not None and s["trigrams"] < tri)
                or s["other_script"] >= script)
