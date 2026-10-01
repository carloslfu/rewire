"""The 4-bit lab (Phase 0A): choose the weight format.

Metrics, each against the original 16-bit model:
- WikiText-2 test perplexity, 2,048-token windows (reproduce the study's 20.9 first);
- KL divergence and top-1 agreement on the 16-bit model's replies to 100 everyday prompts;
- fact retention on the facts the 16-bit model knows (2 of 3 seeds name the answer);
- size in the file format.
Bar: perplexity at most 1.2x, KL at most 0.15 nats/token, top-1 at least 88%, retention at
least 95% (100% for the facts the path uses), at most 400 MB. Results land in
artifacts/quantlab/, one JSON per candidate, so a rerun skips finished ones.
"""
from __future__ import annotations

import gc
import json
import re
import sys
import time
from pathlib import Path

import numpy as np
import pyarrow.parquet as pq
import torch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from rewire import chat, quant, qlab  # noqa: E402
from rewire.conv import ARTIFACTS, FLOORS, VOCAB_REAL  # noqa: E402
from rewire.ref import MATS, Cache, Changes, Model, Quant, Weights, generate  # noqa: E402

OUT = ARTIFACTS / "quantlab"
DATA = Path(__file__).resolve().parents[1] / "data"
PATH_FACTS = {"What is the capital of France?", "What is the largest planet in our solar system?",
              "What is the chemical symbol for gold?", "In which city is the Colosseum?", "In which city is the Eiffel Tower?"}


def wikitext(split="test"):
    from huggingface_hub import hf_hub_download
    p = hf_hub_download("Salesforce/wikitext", f"wikitext-2-raw-v1/{split}-00000-of-00001.parquet", repo_type="dataset")
    return "\n\n".join(pq.read_table(p).column("text").to_pylist())


def ppl_tokens():
    f = OUT / "wikitext_test_ids.npy"
    if f.exists():
        return np.load(f)
    ids = np.array(chat.tokenizer()(wikitext("test"), add_special_tokens=False)["input_ids"], dtype=np.int64)
    np.save(f, ids)
    return ids


@torch.no_grad()
def perplexity(model: Model, ids: np.ndarray, seq: int = 2048) -> float:
    ch = Changes.make({}, model.device)
    n = len(ids) // seq
    nll, cnt = 0.0, 0
    for i in range(n):
        x = torch.tensor(ids[i * seq:(i + 1) * seq])[None]
        xs = model.run(x, Cache(), ch)
        sc = model.scores(xs[0, :-1], ch).float()
        lp = torch.log_softmax(sc, -1)
        tgt = x[0, 1:].to(lp.device)
        nll += float(-lp[torch.arange(seq - 1), tgt].sum())
        cnt += seq - 1
    return float(np.exp(nll / cnt))


@torch.no_grad()
def reference_replies(model16: Model, prompts: list[str]):
    f = OUT / "ref_replies.json"
    if f.exists():
        return json.loads(f.read_text())
    out = []
    for p in prompts:
        pr = chat.first_turn(p)
        reps, _ = generate(model16, pr, Changes.make({}, model16.device), [0])
        out.append([pr, reps[0].tokens])
    f.write_text(json.dumps(out))
    return out


@torch.no_grad()
def logits_on(model: Model, pairs):
    ch = Changes.make({}, model.device)
    res = []
    for pr, rep in pairs:
        xs = model.run(torch.tensor([pr + rep]), Cache(), ch)
        sc = model.scores(xs[0, len(pr) - 1: len(pr) + len(rep) - 1], ch).float()
        res.append(torch.log_softmax(sc[:, :VOCAB_REAL], -1).cpu())
    return res


def kl_top1(ref_lp, lp):
    kls, agree, n = 0.0, 0, 0
    for a, b in zip(ref_lp, lp):
        pa = a.exp()
        kls += float((pa * (a - b)).sum())
        agree += int((a.argmax(-1) == b.argmax(-1)).sum())
        n += a.shape[0]
    return kls / n, agree / n


@torch.no_grad()
def facts_known(model: Model, facts):
    ch = Changes.make({}, model.device)
    known = {}
    for q, ans in facts:
        reps, _ = generate(model, chat.first_turn(q), ch, [0, 1, 2])
        rx = re.compile("|".join(ans), re.I)
        hits = sum(1 for r in reps if rx.search(chat.decode(r.tokens)))
        known[q] = hits >= 2
    return known


def evaluate(name: str, model: Model, base: dict, nbytes: int):
    f = OUT / f"{name}.json"
    t = time.time()
    r = {"name": name, "bytes": nbytes}
    r["ppl"] = perplexity(model, base["ids"])
    lp = logits_on(model, base["pairs"])
    r["kl"], r["top1"] = kl_top1(base["ref_lp"], lp)
    kn = facts_known(model, base["facts"])
    k16 = base["known16"]
    have = [q for q in k16 if k16[q]]
    r["retention"] = sum(1 for q in have if kn[q]) / len(have)
    r["path_facts_kept"] = all(kn[q] for q in PATH_FACTS if k16.get(q))
    r["lost_facts"] = [q for q in have if not kn[q]]
    r["ppl_ratio"] = r["ppl"] / base["ppl16"]
    r["passes"] = bool(r["ppl_ratio"] <= 1.2 and r["kl"] <= 0.15 and r["top1"] >= 0.88 and r["retention"] >= 0.95
                       and r["path_facts_kept"] and nbytes <= 400e6)
    r["seconds"] = round(time.time() - t)
    f.write_text(json.dumps(r, indent=1))
    print(json.dumps({k: (round(v, 4) if isinstance(v, float) else v) for k, v in r.items() if k != "lost_facts"}), flush=True)
    return r


def gptq_weights(base_w: Weights, group: int, clip: bool, calib) -> Weights:
    w = Weights(base=base_w)  # starts as the 16-bit model, replaced floor by floor
    w.quant_cfg = Quant("given", group, 16)
    w.packed = {}
    mats4 = w.mats(4)
    groups_of = {"qkv": ("q", "k", "v"), "o": ("o",), "gu": ("gate", "up"), "down": ("down",)}

    def qlayer(L, key, H):
        for name in groups_of[key]:
            c, s, o = qlab.gptq(base_w.orig[L][name], H, group, clip=clip)
            w.packed[(L, name)] = (c.to(w.device), s.to(w.device), o.to(w.device))
            mats4[L][name] = quant.dequantize(c, s, o, group).to(w.device, w.dtype)

    qlab.collect_hessians(Model(w), calib, quantize_layer=qlayer)
    return w


def calibration(n=64, T=512):
    rng = np.random.default_rng(0)
    ids = chat.tokenizer()(wikitext("train")[:3_000_000], add_special_tokens=False)["input_ids"]
    starts = rng.integers(0, len(ids) - T, size=n)
    return [torch.tensor([ids[s:s + T] for s in starts[i:i + 8]]) for i in range(0, n, 8)]


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    only = sys.argv[1:]
    base_w = Weights()
    m16 = Model(base_w)
    ids = ppl_tokens()
    every = json.loads((DATA / "everyday.json").read_text())[:100]
    facts = json.loads((DATA / "facts.json").read_text())
    f16 = OUT / "base16.json"
    if f16.exists():
        b = json.loads(f16.read_text())
    else:
        t = time.time()
        b = {"ppl16": perplexity(m16, ids), "tokens": int(len(ids))}
        b["known16"] = facts_known(m16, facts)
        b["seconds"] = round(time.time() - t)
        f16.write_text(json.dumps(b, indent=1))
    print("16-bit perplexity", round(b["ppl16"], 3), "facts known", sum(b["known16"].values()), flush=True)
    pairs = reference_replies(m16, every)
    base = {"ids": ids, "pairs": pairs, "ref_lp": logits_on(m16, pairs), "facts": facts, "known16": b["known16"],
            "ppl16": b["ppl16"]}
    cands = []
    for g in (32, 64, 128):
        cands.append((f"rtn-g{g}", Quant("rtn", g, 16)))
    cands.append(("rtnsym-g64", Quant("rtn-sym", 64, 16)))
    for g in (32, 64, 128):
        cands.append((f"clip-g{g}", Quant("clip", g, 16)))
    cands += [("hqq-g64", "hqq", 64), ("hqq-g128", "hqq", 128), ("gptq-g64", "gptq", 64), ("gptq-g128", "gptq", 128),
              ("gptqclip-g128", "gptqclip", 128)]
    calib = None
    for c in cands:
        name = c[0]
        if only and name not in only:
            continue
        if (OUT / f"{name}.json").exists():
            continue
        t = time.time()
        if isinstance(c[1], Quant):
            w = Weights(quant_cfg=c[1], base=base_w)
            group = c[1].group
        elif c[1] == "hqq":
            group = c[2]
            w = Weights(base=base_w)
            w.quant_cfg = Quant("given", group, 16)
            w.packed = {(L, m): qlab.hqq(base_w.orig[L][m].to(w.device), group) for L in range(FLOORS) for m in MATS}
            w._mats = {}
        else:
            group = c[2]
            calib = calib or calibration()
            w = gptq_weights(base_w, group, c[1] == "gptqclip", calib)
        print(name, "quantized in", round(time.time() - t), "s", flush=True)
        evaluate(name, Model(w), base, quant.model_bytes(group, 8))  # provisional: dictionary at 8 bits
        del w
        gc.collect()
        torch.mps.empty_cache()


if __name__ == "__main__":
    main()
