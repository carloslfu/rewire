"""Converted weights (section 7.4): one byte stream of tensors split into files of at most 16 MiB,
named by their hash, plus a manifest. Python writes them; the engine and the Python reference read
the same bytes, so both run identical weights."""
from __future__ import annotations

import hashlib
import json
from pathlib import Path

import numpy as np
import torch

from .conv import CHAT, CONV, FLOORS, MODEL, SAMPLING, VOCAB_ROWS, WIDTH
from .ref import MATS, Quant, Weights

FILE_MAX = 16 * 1024 * 1024
ALIGN = 256
NOTICE = "Quantized to 4 bits from Qwen/Qwen3-0.6B; not made or endorsed by the Qwen team."


def pack_codes(codes: torch.Tensor, bits: int) -> np.ndarray:
    """uint8 codes [out, in] -> u32 words, low bits first."""
    c = codes.cpu().numpy().astype(np.uint32).reshape(-1)
    per = 32 // bits
    c = c.reshape(-1, per)
    shifts = (np.arange(per, dtype=np.uint32) * bits)
    return np.bitwise_or.reduce(c << shifts, axis=1).astype(np.uint32)


def pack_params(scale16: torch.Tensor, offset16: torch.Tensor) -> np.ndarray:
    s = scale16.cpu().numpy().astype(np.float16).view(np.uint16).astype(np.uint32)
    o = offset16.cpu().numpy().astype(np.float16).view(np.uint16).astype(np.uint32)
    return (s | (o << 16)).reshape(-1).astype(np.uint32)


def unpack(words: np.ndarray, out: int, inp: int, group: int, bits: int):
    per = 32 // bits
    n = out * inp // per
    w = words[:n]
    shifts = (np.arange(per, dtype=np.uint32) * bits)
    codes = ((w[:, None] >> shifts) & ((1 << bits) - 1)).reshape(out, inp).astype(np.uint8)
    p = words[n:n + out * (inp // group)]
    s = (p & 0xFFFF).astype(np.uint16).view(np.float16).reshape(out, inp // group)
    o = (p >> 16).astype(np.uint16).view(np.float16).reshape(out, inp // group)
    return torch.from_numpy(codes), torch.from_numpy(s.copy()), torch.from_numpy(o.copy())


def write(w: Weights, out_dir: Path, quant_meta: dict, rho: list[float], atlas: dict, concepts: dict[str, list[torch.Tensor]],
          concept_meta: list[dict]) -> dict:
    """Write the converted model. `w` must be quantized (packed codes for every floor matrix)."""
    out_dir.mkdir(parents=True, exist_ok=True)
    g = w.quant_cfg.group
    tensors = []
    stream = bytearray()

    def add(name, arr: np.ndarray, shape, kind, group=None):
        nonlocal stream
        pad = (-len(stream)) % ALIGN
        stream += b"\0" * pad
        b = arr.tobytes()
        tensors.append({"name": name, "shape": list(shape), "kind": kind, **({"group": group} if group else {}),
                        "offset": len(stream), "bytes": len(b)})
        stream += b

    db = w.quant_cfg.dict_bits
    if db in (4, 8):
        c, s, o = w.packed["dict"]
        add("dict", np.concatenate([pack_codes(c, db), pack_params(s, o)]), [VOCAB_ROWS, WIDTH], f"q{db}", g)
    else:
        add("dict", w.dictionary.cpu().numpy().astype(np.float16), [VOCAB_ROWS, WIDTH], "f16")
    add("final_norm", w.final_norm.cpu().numpy().astype(np.float32), [WIDTH], "f32")
    add("mean_row", w.mean_row.cpu().numpy().astype(np.float32), [WIDTH], "f32")
    for L in range(FLOORS):
        n = w.norms[L]
        add(f"f{L}.in_norm", n["in"].cpu().numpy().astype(np.float32), [WIDTH], "f32")
        add(f"f{L}.post_norm", n["post"].cpu().numpy().astype(np.float32), [WIDTH], "f32")
        add(f"f{L}.qk_norm", np.concatenate([n["q"].cpu().numpy(), n["k"].cpu().numpy()]).astype(np.float32), [256], "f32")
        for m in MATS:
            c, s, o = w.packed[(L, m)]
            add(f"f{L}.{m}", np.concatenate([pack_codes(c, 4), pack_params(s, o)]), list(c.shape), "q4", g)
    for cid, vecs in concepts.items():
        add(f"concept.{cid}", torch.stack(vecs).float().cpu().numpy(), [FLOORS, WIDTH], "f32")
    files = []
    for i in range(0, len(stream), FILE_MAX):
        chunk = bytes(stream[i:i + FILE_MAX])
        h = hashlib.sha256(chunk).hexdigest()
        (out_dir / f"{h[:32]}.bin").write_bytes(chunk)
        files.append({"name": f"{h[:32]}.bin", "sha256": h, "bytes": len(chunk)})
    manifest = {
        "format_version": 1,
        "model": MODEL["repo"],
        "commit": MODEL["commit"],
        "license": "Apache-2.0",
        "notice": NOTICE,
        "config": {"floors": FLOORS, "width": WIDTH, "query_heads": MODEL["query_heads"], "kv_heads": MODEL["kv_heads"],
                   "head_size": MODEL["head_size"], "units": MODEL["memory_units"], "vocab_rows": VOCAB_ROWS,
                   "vocab_real": MODEL["vocab_real"], "rope_theta": MODEL["rope_theta"], "eps": MODEL["rms_eps"],
                   "group": g, "dict_bits": db, "floor_bits": 4},
        "quantization": {"method": quant_meta.get("method"), "group": g, "dictionary_bits": db, "metrics": quant_meta.get("metrics", {})},
        "tensors": tensors,
        "files": files,
        "total_bytes": len(stream),
        "chat": CHAT,
        "tokens": CONV["tokens"],
        "sampling": SAMPLING,
        "rho": [float(x) for x in rho],
        "bit_tables": CONV["changes"]["bit_tables"],
        "atlas": atlas,
        "concepts": concept_meta,
    }
    text = json.dumps(manifest, indent=1)
    (out_dir / "manifest.json").write_text(text)
    manifest["hash"] = hashlib.sha256(text.encode()).hexdigest()
    return manifest


def read(dir_: Path, device=None, dtype=torch.float32) -> tuple[Weights, dict]:
    """Load converted weights into the Python reference, bit for bit."""
    man = json.loads((dir_ / "manifest.json").read_text())
    stream = b"".join((dir_ / f["name"]).read_bytes() for f in man["files"])
    t = {x["name"]: x for x in man["tensors"]}
    g = man["config"]["group"]

    def arr(name, dt):
        x = t[name]
        return np.frombuffer(stream, dtype=dt, count=x["bytes"] // np.dtype(dt).itemsize, offset=x["offset"])

    packed = {}
    for L in range(FLOORS):
        for m in MATS:
            x = t[f"f{L}.{m}"]
            packed[(L, m)] = tuple(v.to(device or "cpu") for v in unpack(arr(f"f{L}.{m}", np.uint32), *x["shape"], g, 4))
    db = man["config"]["dict_bits"]
    if db in (4, 8):
        packed["dict"] = tuple(v.to(device or "cpu") for v in unpack(arr("dict", np.uint32), VOCAB_ROWS, WIDTH, g, db))
    w = Weights(device=device, dtype=dtype, quant_cfg=Quant("given", g, db), packed=packed)
    if db == 16:
        w.dictionary = torch.from_numpy(arr("dict", np.float16).astype(np.float32).reshape(VOCAB_ROWS, WIDTH)).to(w.device, dtype)
        w.mean_row = torch.from_numpy(arr("mean_row", np.float32).copy()).to(w.device, dtype)
    concepts = {c["id"]: [torch.from_numpy(v.copy()) for v in arr(f"concept.{c['id']}", np.float32).reshape(FLOORS, WIDTH)]
                for c in man.get("concepts", [])}
    man["_concepts"] = concepts
    man["hash"] = hashlib.sha256((dir_ / "manifest.json").read_bytes()).hexdigest()
    return w, man
