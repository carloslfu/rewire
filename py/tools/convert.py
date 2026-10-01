"""Convert Qwen3-0.6B to the engine's format (section 7.4).

  uv run python tools/convert.py --method rtn --group 64 --dict-bits 8 [--extras artifacts/curation/extras.json]

`--extras` adds the atlas, the built-in concepts and rho from Phase 0A curation; without it, rho is
measured here and the atlas and concepts are empty. Output: artifacts/weights/<id>/ with the
manifest and the hashed files.
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

import torch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from rewire import manifest, qlab, quant  # noqa: E402
from rewire.atlas import rho as measure_rho  # noqa: E402
from rewire.conv import ARTIFACTS, FLOORS  # noqa: E402
from rewire.ref import MATS, Model, Quant, Weights, quant8  # noqa: E402

DATA = Path(__file__).resolve().parents[1] / "data"


def quantize(base: Weights, method: str, group: int, dict_bits: int, dict_method: str = "rtn") -> Weights:
    if method in ("rtn", "rtn-sym", "clip"):
        w = Weights(quant_cfg=Quant(method, group, dict_bits), base=base)
    elif method == "hqq":
        w = Weights(base=base)
        w.quant_cfg = Quant("given", group, 16)
        w.packed = {(L, m): qlab.hqq(base.orig[L][m].to(w.device), group) for L in range(FLOORS) for m in MATS}
        w._mats = {}
    elif method in ("gptq", "gptqclip"):
        sys.path.insert(0, str(Path(__file__).resolve().parent))
        from quantlab import calibration, gptq_weights  # noqa: E402
        w = gptq_weights(base, group, method == "gptqclip", calibration())
    else:
        raise ValueError(method)
    if dict_bits in (4, 8) and "dict" not in w.packed:
        e = base.embed_orig.to(w.device)
        if dict_bits == 8:
            w.packed["dict"] = quant8(e, group)
        elif dict_method == "clip":
            w.packed["dict"] = quant.quantize_clip_search(e, group)
        else:
            w.packed["dict"] = quant.quantize_rtn(e, group)
    w.quant_cfg = Quant(method, group, dict_bits)
    if dict_bits in (4, 8):
        c, s, o = w.packed["dict"]
        w.dictionary = w._dequant_dict(c, s, o).to(w.device, w.dtype)
        from rewire.conv import VOCAB_REAL
        w.mean_row = w.dictionary[:VOCAB_REAL].cpu().double().mean(0).to(w.device, w.dtype)
    return w


CARD = """---
license: apache-2.0
base_model: Qwen/Qwen3-0.6B
tags: [rewire, 4-bit, webgpu]
---
# Qwen3-0.6B for Rewire (4-bit)

Quantized to 4 bits from Qwen/Qwen3-0.6B; not made or endorsed by the Qwen team.

These are the weights the Rewire page downloads to run Qwen3-0.6B in the browser with WebGPU, in a plain
format so the numbers it shows are the architecture's own: 4-bit codes with one scale and offset per
group of {group} weights inside each row, no scales folded into the normalizations and no reordering of
columns. Files of at most 16 MiB named by their hash; `manifest.json` describes every tensor.

- Source: Qwen/Qwen3-0.6B at commit {commit}, Apache 2.0 (see LICENSE).
- Floors: {method}, groups of {group}. Dictionary: {dict_bits} bits ({dict_method}).
- Size: {mb} MB.

Measured against the original 16-bit model ({protocol}):

| Measure | 16-bit | This model |
| --- | --- | --- |
| WikiText-2 perplexity | {ppl16} | {ppl} |
| KL divergence on everyday replies (nats per token) | 0 | {kl} |
| Top-1 agreement on everyday replies | 100% | {top1} |
| Facts kept (of those the 16-bit model knows) | 100% | {retention} |

The tokenizer files are Qwen's, unchanged.
"""


def publish_files(out: Path, man: dict, metrics: dict):
    """Everything the page fetches from the weights' host: Qwen's tokenizer files and LICENSE, and a card."""
    import shutil
    from rewire.conv import model_dir
    src = model_dir()
    for f in ("tokenizer.json", "tokenizer_config.json", "LICENSE"):
        if (src / f).exists():
            # The Hugging Face cache keeps files read-only; copy bytes, not modes, and replace any earlier copy.
            (out / f).unlink(missing_ok=True)
            shutil.copyfile(src / f, out / f)
    q = man["quantization"]
    base16 = json.loads((ARTIFACTS / "quantlab" / "base16.json").read_text()) if (ARTIFACTS / "quantlab" / "base16.json").exists() else {}
    fmt = lambda v, f: (f.format(v) if isinstance(v, (int, float)) else "not measured")  # noqa: E731
    (out / "README.md").write_text(CARD.format(
        group=man["config"]["group"], commit=man["commit"], method=q["method"], dict_bits=man["config"]["dict_bits"],
        dict_method=q.get("dict_method", "rtn"), mb=round(man["total_bytes"] / 1e6),
        protocol="WikiText-2 test set in 2,048-token windows; replies of the 16-bit model to 100 everyday prompts",
        ppl16=fmt(base16.get("ppl16"), "{:.2f}"), ppl=fmt(metrics.get("ppl"), "{:.2f}"), kl=fmt(metrics.get("kl"), "{:.3f}"),
        top1=fmt(metrics.get("top1", None) and metrics["top1"] * 100, "{:.1f}%"),
        retention=fmt(metrics.get("retention", None) and metrics["retention"] * 100, "{:.1f}%")))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--method", default="rtn")
    ap.add_argument("--group", type=int, default=64)
    ap.add_argument("--dict-bits", type=int, default=8)
    ap.add_argument("--dict-method", default="rtn", choices=["rtn", "clip"])
    ap.add_argument("--extras", default=None)
    ap.add_argument("--metrics", default=None, help="the quant lab JSON for this format")
    ap.add_argument("--from", dest="src", default=None, help="reuse an already converted model's weights (adds extras only)")
    a = ap.parse_args()
    t = time.time()
    old_metrics = {}
    if a.src:
        w, old = manifest.read(Path(a.src))
        a.method, a.group, a.dict_bits = old["quantization"]["method"], old["config"]["group"], old["config"]["dict_bits"]
        old_metrics = old["quantization"].get("metrics", {})
        a.dict_method = old["quantization"].get("dict_method", "rtn")
    else:
        base = Weights()
        w = quantize(base, a.method, a.group, a.dict_bits, a.dict_method)
    extras = json.loads(Path(a.extras).read_text()) if a.extras else {}
    rho = extras.get("rho") or measure_rho(Model(w), json.loads((DATA / "everyday.json").read_text())[:50])
    concepts = {cid: [torch.tensor(v) for v in vecs] for cid, vecs in extras.get("concept_vectors", {}).items()}
    metrics = json.loads(Path(a.metrics).read_text()) if a.metrics else old_metrics
    fid = f"{a.method}-g{a.group}-d{a.dict_bits}" + ("clip" if a.dict_method == "clip" and a.dict_bits == 4 else "")
    if a.src:
        fid = Path(a.src).name
    out = ARTIFACTS / "weights" / fid
    man = manifest.write(w, out, {"method": a.method, "dict_method": a.dict_method, "metrics": metrics}, rho, extras.get("atlas", {}), concepts,
                         extras.get("concepts", []))
    publish_files(out, man, metrics)
    print(json.dumps({"id": fid, "dir": str(out), "files": len(man["files"]), "bytes": man["total_bytes"],
                      "hash": man["hash"], "seconds": round(time.time() - t)}))


if __name__ == "__main__":
    main()
