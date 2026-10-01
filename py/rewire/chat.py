"""The template rule of section 7.1: what the model reads, token by token."""
from __future__ import annotations

from functools import lru_cache

from .conv import CHAT, TOK


@lru_cache(maxsize=1)
def tokenizer():
    from transformers import AutoTokenizer

    from .conv import model_dir

    return AutoTokenizer.from_pretrained(str(model_dir()))


@lru_cache(maxsize=1)
def _plain_tokenizer():
    """The tokenizer with every added token removed (chat markers and the thinking tags), so typed text
    is always plain text. The browser builds the same tokenizer the same way."""
    import json

    from tokenizers import Tokenizer

    from .conv import model_dir

    j = json.loads((model_dir() / "tokenizer.json").read_text())
    j["added_tokens"] = []
    return Tokenizer.from_str(json.dumps(j))


def plain(text: str) -> list[int]:
    """Tokenize text with special tokens disabled, so nobody can type a chat marker."""
    if not text:
        return []
    return _plain_tokenizer().encode(text, add_special_tokens=False).ids


def assistant_opening() -> list[int]:
    return [TOK["im_start"]] + plain("assistant\n") + [TOK["think"]] + plain("\n\n") + [TOK["end_think"]] + plain("\n\n")


def first_turn(message: str, system: str | None = None) -> list[int]:
    system = CHAT["system_prompt"] if system is None else system
    return ([TOK["im_start"]] + plain("system\n" + system) + [TOK["im_end"]] + plain("\n")
            + [TOK["im_start"]] + plain("user\n" + message) + [TOK["im_end"]] + plain("\n")
            + assistant_opening())


def next_turn(generated: list[int], message: str) -> list[int]:
    """Tokens appended after a reply: the reply itself, its end marker if it was cut, then the
    next user turn and the assistant opening."""
    out = list(generated)
    if not out or out[-1] != TOK["im_end"]:
        out.append(TOK["im_end"])
    return (out + plain("\n") + [TOK["im_start"]] + plain("user\n" + message) + [TOK["im_end"]]
            + plain("\n") + assistant_opening())


def system_end(tokens: list[int]) -> int:
    """First position after the system turn: the user turn's start marker. A concept is added
    from here on."""
    seen = 0
    for i, t in enumerate(tokens):
        if t == TOK["im_start"]:
            seen += 1
            if seen == 2:
                return i
    return len(tokens)


def decode(ids: list[int]) -> str:
    return tokenizer().decode(ids, skip_special_tokens=False)


def piece(i: int) -> str:
    return tokenizer().decode([i], skip_special_tokens=False)
