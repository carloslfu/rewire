"""Discover and test love / evil persona levers on Rewire's exact converted model.

Run from py/: .venv/bin/python -u tools/persona_search.py rank|screen|generate
All outputs are evidence, not automatic semantic labels. Generation is never used
as a prerecorded substitute for the live app. No network, paid APIs, or training.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import platform
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import torch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from rewire import chat, manifest  # noqa: E402
from rewire.conv import FLOORS, UNITS  # noqa: E402
from rewire.persona import activation_means, generate_batch, reply_scores  # noqa: E402
from rewire.ref import Cache, Changes, Model  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / "py/data/personas.json"


def save(path, obj):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, indent=1, ensure_ascii=False) + "\n")


def rank(model, man, data, out, meta, batch):
    # Calibrate the actual end-of-layer residual, including the final layer.
    cap = {}
    model.run(torch.tensor([chat.first_turn(data["development_prompts"][0])]), Cache(),
              Changes.make({}, model.device), capture=cap)
    rho = [float(cap["stream"][L + 1][0, 1:].norm(dim=-1).median()) for L in range(FLOORS)]
    norms = np.stack([m["down"].norm(dim=0).cpu().numpy() for m in model.w.mats()])
    del cap
    result = {"meta": meta, "rho_end": rho, "normalization": "delta = dose * median(norm(residual leaving layer), tokens 1:) / norm(down[:, unit]); additive at down input on every token", "concepts": {}}
    arrays = {"rho_end": np.array(rho), "down_norms": norms}
    for name in ("love", "evil"):
        examples = [(p, text) for p, pos, neg in data[name]["pairs"] for text in (pos, neg)]
        collected = []
        for i in range(0, len(examples), batch):
            collected.append(activation_means(model, examples[i:i + batch]))
            print(json.dumps({"stage": "rank", "concept": name, "texts": min(i + batch, len(examples)), "total": len(examples)}), flush=True)
        means = np.concatenate(collected)
        a, b = means[::2], means[1::2]
        diff = a.mean(0) - b.mean(0)
        scale = np.sqrt((a.var(0) + b.var(0)) / 2 + 0.01 ** 2)
        effect = diff / scale
        # Full ranking preserved; the causal shortlist later caps units per layer.
        order = np.argsort(-abs(effect), axis=None)
        rows = []
        for index in order[:4096]:
            L, n = divmod(int(index), UNITS)
            rows.append({"floor": L, "unit": n, "effect": float(effect[L, n]), "positive_mean": float(a[:, L, n].mean()),
                         "negative_mean": float(b[:, L, n].mean()), "down_norm": float(norms[L, n]), "rho": rho[L]})
        result["concepts"][name] = {"ranked": rows, "paired_texts": len(a)}
        arrays[name + "_means"] = means
        arrays[name + "_effects"] = effect
    save(out / "rank.json", result)
    np.savez_compressed(out / "activations.npz", **arrays)
    return result


def candidates(ranked, top, random_count):
    selected, per_floor = [], {}
    # Mid and late layers, with diversity rather than one layer monopolizing the search.
    for row in ranked:
        L = row["floor"]
        if L < 3 or per_floor.get(L, 0) >= max(6, top // 10):
            continue
        selected.append(dict(row, control=False))
        per_floor[L] = per_floor.get(L, 0) + 1
        if len(selected) == top:
            break
    rng = np.random.default_rng(20261028)
    used = {(r["floor"], r["unit"]) for r in ranked[:4096]}
    for row in selected[:random_count]:
        n = int(rng.integers(UNITS))
        while (row["floor"], n) in used:
            n = int(rng.integers(UNITS))
        selected.append({"floor": row["floor"], "unit": n, "control": True})
        used.add((row["floor"], n))
    return selected


def screen(model, rank_data, data, out, meta, args):
    stats = np.load(out / "activations.npz")
    result = {"meta": meta, "score": "Change in mean positive-reply logprob minus mean negative-reply logprob, averaged over four development pairs. This is a ranking heuristic, not a measured persona success rate.", "concepts": {}}
    checkpoint = out / "screen.json"
    if checkpoint.exists():
        result = json.loads(checkpoint.read_text())
        if result["meta"]["manifest_hash"] != meta["manifest_hash"] or result["meta"]["corpus_hash"] != meta["corpus_hash"]:
            raise ValueError("Checkpoint does not match model/corpus")
    for name in args.concepts:
        rows = candidates(rank_data["concepts"][name]["ranked"], args.top, args.controls)
        variants = []
        for row in rows:
            L, n = row["floor"], row["unit"]
            for dose in args.doses:
                delta = float(dose * stats["rho_end"][L] / max(stats["down_norms"][L, n], 1e-8))
                variants.append(dict(row, dose=dose, recipe=[{"floor": L, "unit": n, "delta": delta}]))
        existing = result["concepts"].setdefault(name, {"baseline": [], "baseline_positive": [], "baseline_negative": [], "variants": []})
        if not existing["baseline"]:
            for p, pos, neg in data[name]["screen"]:
                scores = reply_scores(model, p, [pos, neg], [[], []])
                existing["baseline"].append(float(scores[0] - scores[1]))
                existing["baseline_positive"].append(float(scores[0]))
                existing["baseline_negative"].append(float(scores[1]))
        done = {(r["floor"], r["unit"], r["dose"]) for r in existing["variants"]}
        pending = [r for r in variants if (r["floor"], r["unit"], r["dose"]) not in done]
        for i in range(0, len(pending), args.batch):
            group = pending[i:i + args.batch]
            deltas = []
            positive_deltas, negative_deltas = [], []
            for j, (p, pos, neg) in enumerate(data[name]["screen"]):
                recipes = [r["recipe"] for r in group for _ in range(2)]
                scores = reply_scores(model, p, [text for _ in group for text in (pos, neg)], recipes)
                deltas.append(scores[::2] - scores[1::2] - existing["baseline"][j])
                if existing.get("baseline_positive"):
                    positive_deltas.append(scores[::2] - existing["baseline_positive"][j])
                    negative_deltas.append(scores[1::2] - existing["baseline_negative"][j])
            shifts = np.array(deltas).T
            for b, (row, ds) in enumerate(zip(group, shifts)):
                pos_shift = float(np.array(positive_deltas)[:, b].mean()) if positive_deltas else 0
                neg_shift = float(np.array(negative_deltas)[:, b].mean()) if negative_deltas else 0
                # Penalize candidates that win the contrast by damaging BOTH replies.
                # Still only a discovery heuristic: free generation is the actual test.
                existing["variants"].append(dict(row, shifts=ds.tolist(), contrast_shift=float(ds.mean()),
                    positive_shift=pos_shift, negative_shift=neg_shift,
                    score=float(ds.mean()) + min(0, pos_shift), minimum=float(ds.min())))
            save(checkpoint, result)
            best = max(existing["variants"], key=lambda r: r["score"])
            print(json.dumps({"stage": "screen", "concept": name, "done": len(existing["variants"]), "total": len(variants),
                              "best": {k: best[k] for k in ("floor", "unit", "dose", "score", "control")}}), flush=True)
    return result


def generations(model, screen_data, data, out, meta, args):
    variants = [{"name": "normal", "recipe": []}]
    for name in ([] if args.recipes else args.concepts):
        seen = set()
        rows = sorted(screen_data["concepts"][name]["variants"], key=lambda r: -r["score"])
        for row in rows:
            key = row["floor"], row["unit"]
            if key in seen or row["control"]:
                continue
            seen.add(key)
            variants.append(dict(row, name=f"{name}:L{key[0]}N{key[1]}:{row['dose']}"))
            if len(seen) >= args.winners:
                break
        controls = [r for r in rows if r["control"]]
        if controls:
            variants.append(dict(controls[0], name=f"{name}:random-control"))
    if args.recipes:
        variants = json.loads(Path(args.recipes).read_text())
    if not variants or sum(v["name"] == "normal" and not v["recipe"] for v in variants) != 1:
        raise ValueError("Recipes require exactly one unchanged variant named normal")
    prompts = data[args.phase + "_prompts"]
    result = {"meta": meta, "phase": args.phase, "decoding": "greedy", "cap": args.cap,
              "variants": variants, "generations": []}
    path = out / (args.phase + ("-custom" if args.recipes else "") + ".json")
    for p in prompts:
        for i in range(0, len(variants), args.batch):
            group = variants[i:i + args.batch]
            generated = generate_batch(model, p, [v["recipe"] for v in group], args.cap)
            for v, r in zip(group, generated):
                result["generations"].append(dict(prompt=p, variant=v["name"], **r))
                print(json.dumps({"stage": "generate", "prompt": p, "variant": v["name"], "text": r["text"]}, ensure_ascii=False), flush=True)
            save(path, result)
    # Explicit restoration check, using the same backend, prompt, and decoding.
    normal = generate_batch(model, prompts[0], [[]], args.cap)[0]
    before = next(r for r in result["generations"] if r["prompt"] == prompts[0] and r["variant"] == "normal")
    result["restored_exactly"] = normal["ids"] == before["ids"]
    save(path, result)
    if not result["restored_exactly"]:
        raise AssertionError("Restoration did not match the unmodified generation")


def bundles(model, rank_data, data, out, meta, args):
    """Sparse mean-difference directions, capped at the runtime's 16-unit limit."""
    stats = np.load(out / "activations.npz")
    result = {"meta": meta, "method": "At each layer choose 16 units with largest absolute standardized activation difference. Set deltas proportional to positive minus negative mean; normalize their SUMMED down-projection output to dose * rho_end. Groups are distinct from a single-neuron discovery.", "concepts": {}}
    for name in args.concepts:
        means = stats[name + "_means"]
        difference = means[::2].mean(0) - means[1::2].mean(0)
        rows = []
        for L in range(7, 23):
            indices = np.argsort(-abs(stats[name + "_effects"][L]))[:16]
            raw = difference[L, indices]
            cols = model.w.mats()[L]["down"][:, indices.tolist()]
            length = float((cols @ torch.tensor(raw, device=model.device)).norm())
            for dose in (.2, .4):
                scale = dose * stats["rho_end"][L] / max(length, 1e-8)
                recipe = [{"floor": L, "unit": int(n), "delta": float(d * scale)} for n, d in zip(indices, raw)]
                shifts, positive = [], []
                for p, pos, neg in data[name]["screen"]:
                    s = reply_scores(model, p, [pos, neg, pos, neg], [[], [], recipe, recipe])
                    shifts.append(float(s[2] - s[3] - s[0] + s[1]))
                    positive.append(float(s[2] - s[0]))
                score = float(np.mean(shifts) + min(0, np.mean(positive)))
                rows.append({"name": f"{name}:group:L{L}:{dose}", "recipe": recipe, "dose": dose, "score": score, "shifts": shifts, "positive_shifts": positive})
        result["concepts"][name] = sorted(rows, key=lambda r: -r["score"])
        save(out / "bundles.json", result)
        print(json.dumps({"stage": "bundles", "concept": name, "best": [{k: r[k] for k in ("name", "score")} for r in result["concepts"][name][:5]]}), flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("stage", choices=["rank", "screen", "generate", "bundles"])
    parser.add_argument("--weights", type=Path, default=ROOT / "artifacts/weights/gptqclip-g32-d4clip")
    parser.add_argument("--out", type=Path, default=ROOT / "artifacts/personas/2026-10-28")
    parser.add_argument("--batch", type=int, default=8)
    parser.add_argument("--top", type=int, default=96)
    parser.add_argument("--controls", type=int, default=16)
    parser.add_argument("--concepts", nargs="+", choices=["love", "evil"], default=["love", "evil"])
    parser.add_argument("--doses", type=float, nargs="+", default=[-0.7, -0.35, 0.35, 0.7])
    parser.add_argument("--winners", type=int, default=6)
    parser.add_argument("--phase", choices=["development", "heldout"], default="development")
    parser.add_argument("--cap", type=int, default=64)
    parser.add_argument("--recipes")
    args = parser.parse_args()
    if args.batch < 1 or args.top < 1:
        parser.error("batch and top must be positive")
    data = json.loads(DATA.read_text())
    start = time.monotonic()
    with torch.inference_mode():
        w, man = manifest.read(args.weights)
        model = Model(w)
        meta = {"model": man["model"], "manifest_hash": man["hash"], "corpus_hash": hashlib.sha256(DATA.read_bytes()).hexdigest(),
                "torch": torch.__version__, "device": model.device, "platform": platform.platform(),
                "captured_at": datetime.now(timezone.utc).isoformat(), "command": sys.argv,
                "addressing": "zero-based layer and MLP unit; down-projection INPUT, not residual coordinate"}
        args.out.mkdir(parents=True, exist_ok=True)
        print(json.dumps({"loaded": meta, "seconds": time.monotonic() - start}), flush=True)
        if args.stage == "rank":
            rank(model, man, data, args.out, meta, args.batch)
        elif args.stage == "screen":
            screen(model, json.loads((args.out / "rank.json").read_text()), data, args.out, meta, args)
        elif args.stage == "bundles":
            bundles(model, json.loads((args.out / "rank.json").read_text()), data, args.out, meta, args)
        else:
            generations(model, {} if args.recipes else json.loads((args.out / "screen.json").read_text()), data, args.out, meta, args)
    print(json.dumps({"complete": args.stage, "seconds": time.monotonic() - start}), flush=True)


if __name__ == "__main__":
    main()
