"""Golden traces for the engine's parity tests (section 7.4), from converted weights.

  uv run python tools/golden.py artifacts/weights/<id>

For each case: the turn-1 prompt, a reply written by the reference with the case's changes and seed,
then one pass over prompt + reply capturing every floor's stream, keys and values (as halves), the
top 64 scores per position, full intermediates at three positions, and the reply's pushes and
candidate lists. Written to artifacts/golden/<id>/<case>.safetensors and <case>.json; not committed.
"""
from __future__ import annotations

import json
import sys
import time
from pathlib import Path

import numpy as np
import torch
from safetensors.numpy import save_file

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from rewire import chat, manifest  # noqa: E402
from rewire.conv import ARTIFACTS, FLOORS  # noqa: E402
from rewire.ref import Cache, Changes, Model, generate_recorded  # noqa: E402

CASES = [
    ("normal", "What is Rome's most famous landmark?", {}, 11),
    ("swap", "What is the most famous landmark in Rome?", {"swaps": [[12095, 22000]]}, 12),
    ("floor-off", "Why is the sky blue?", {"floors": [{"floor": 13, "mult": 0}]}, 13),
    ("heads", "Continue this list: whale, pencil, ember, whale,", {"heads": [{"floor": 16, "head": 14, "mult": 0},
                                                                            {"floor": 21, "head": 8, "mult": -1}],
                                                                  "memory": [{"floor": 5, "mult": 2}]}, 14),
    ("hidden", "Give me one tip for sleeping better.", {"hidden": [{"key": 0, "from": 2}, {"key": 9, "from": 10}]}, 15),
    ("bits3", "What is a good name for a cat?", {"bits": 3}, 16),
    ("memory", "Suggest a name for a small boat.", {"memory": [{"floor": 5, "mult": 0}, {"floor": 18, "mult": 2}],
                                                    "heads": [{"floor": 11, "head": 4, "mult": -1}]}, 19),
    ("zeroed", "How do I make a cup of tea?", {"zeroed": [{"floor": 1, "tensor": "down", "row": 300, "col": 1000},
                                                          {"floor": 3, "tensor": "o", "row": 7, "col": 600}]}, 17),
]


def main():
    wdir = Path(sys.argv[1])
    only = sys.argv[2:]
    w, man = manifest.read(wdir, device="cpu")
    model = Model(w, kv_half=True)
    out = ARTIFACTS / "golden" / wdir.name
    out.mkdir(parents=True, exist_ok=True)
    concepts = man["_concepts"]
    rho = man["rho"]
    cases = list(CASES)
    if concepts:
        cid = next(iter(concepts))
        cases.append(("concept", "Give me a simple recipe for pancakes.", {"concept": {"id": cid, "floor": 14, "strength": 0.5}}, 18))
    # the swap case uses " Rome" and " Paris"; look the ids up rather than trusting constants
    rome, paris = chat.plain(" Rome")[0], chat.plain(" Paris")[0]
    for name, msg, spec, seed in cases:
        if only and name not in only:
            continue
        if name == "swap":
            spec = {"swaps": [[rome, paris]]}
        t = time.time()
        prompt = chat.first_turn(msg)
        ch = Changes.make(spec, "cpu", concepts=concepts, rho=rho, concept_from=chat.system_end(prompt))
        reps, _ = generate_recorded(model, prompt, ch, [seed], guesses=False)
        rep = reps[0]
        toks = prompt + rep.tokens
        cap: dict = {}
        xs = model.run(torch.tensor([toks]), Cache(), ch, capture=cap)
        sc = model.scores(xs[0], ch).float()
        top_v, top_i = sc.topk(64, -1)
        T = len(toks)
        inter_pos = [len(prompt) - 1, len(prompt) + len(rep.tokens) // 2, T - 1]
        tensors = {}
        for L in range(FLOORS + 1):
            tensors[f"stream_{L}"] = cap["stream"][L][0].float().numpy()
        for L in range(FLOORS):
            tensors[f"k_{L}"] = cap["k"][L][0].half().numpy()
            tensors[f"v_{L}"] = cap["v"][L][0].half().numpy()
            inter = cap["inter"][L]
            for key in ("h", "q", "o", "mid", "h2", "gate", "up", "act"):
                tensors[f"inter_{L}_{key}"] = inter[key][0, inter_pos].reshape(len(inter_pos), -1).float().numpy()
            tensors[f"inter_{L}_att"] = cap["att"][L][0, inter_pos].reshape(len(inter_pos), -1).float().numpy()
            tensors[f"inter_{L}_mem"] = cap["mem"][L][0, inter_pos].float().numpy()
            tensors[f"inter_{L}_probs"] = cap["probs"][L][0][:, inter_pos].permute(1, 0, 2).float().numpy()
        tensors["top_scores"] = top_v.numpy()
        tensors["top_ids"] = top_i.numpy().astype(np.int32)
        tensors["pushes"] = np.stack([r["pushes"] for r in rep.records]).astype(np.float32)
        tensors["cand_ids"] = np.stack([r["cand_ids"] for r in rep.records]).astype(np.int32)
        tensors["cand_probs"] = np.stack([r["cand_probs"] for r in rep.records]).astype(np.float32)
        tensors["cuts"] = np.array([r["cut"] for r in rep.records], dtype=np.int32)
        save_file({k: np.ascontiguousarray(v) for k, v in tensors.items()}, str(out / f"{name}.safetensors"))
        case = {"name": name, "manifest_hash": man["hash"], "tokens": toks, "changes": spec, "seed": seed,
                "prompt_length": len(prompt), "generated": rep.tokens, "intermediate_positions": inter_pos,
                "concept_first": chat.system_end(prompt), "text": chat.decode(rep.tokens)}
        (out / f"{name}.json").write_text(json.dumps(case))
        print(name, T, "tokens", round(time.time() - t, 1), "s", repr(case["text"][:70]), flush=True)


if __name__ == "__main__":
    main()
