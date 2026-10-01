"""Fixed conventions (schemas/conventions.json) and the paths every tool shares."""
from __future__ import annotations

import json
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SCHEMAS = ROOT / "schemas"
ARTIFACTS = ROOT / "artifacts"
CONV = json.loads((SCHEMAS / "conventions.json").read_text())

MODEL = CONV["model"]
TOK = CONV["tokens"]
CHAT = CONV["chat"]
SAMPLING = CONV["sampling"]

FLOORS = MODEL["floors"]
WIDTH = MODEL["width"]
QH = MODEL["query_heads"]
KVH = MODEL["kv_heads"]
HD = MODEL["head_size"]
UNITS = MODEL["memory_units"]
VOCAB_ROWS = MODEL["vocab_rows"]
VOCAB_REAL = MODEL["vocab_real"]
EPS = MODEL["rms_eps"]
THETA = MODEL["rope_theta"]
PARTS = FLOORS * (QH + 1)  # 476 parts; pushes add the dictionary row: 477


def model_dir() -> Path:
    """The pinned Qwen3-0.6B snapshot in the Hugging Face cache."""
    from huggingface_hub import snapshot_download

    return Path(snapshot_download(MODEL["repo"], revision=MODEL["commit"], local_files_only=True))


def default_device() -> str:
    import torch

    if os.environ.get("REWIRE_DEVICE"):
        return os.environ["REWIRE_DEVICE"]
    return "mps" if torch.backends.mps.is_available() else "cpu"
