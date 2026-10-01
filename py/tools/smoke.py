"""The path smoke test (section 8): does Qwen3-0.6B show the effects at all?

Plainly rounded 4-bit weights in groups of 64. Steps 1, 3, 4, 5, 6, 7, 8 and 10, each on
3 prompts with 10 seeds, plus single-piece checks for the suggested swap pairs.
Writes artifacts/smoke/results.json and prints a summary.
"""
from __future__ import annotations

import json
import re
import sys
import time
from pathlib import Path

import numpy as np
import torch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from rewire import chat  # noqa: E402
from rewire.atlas import concept_vectors, copying_scores, rho  # noqa: E402
from rewire.breaks import broken, signs  # noqa: E402
from rewire.conv import ARTIFACTS, FLOORS, QH  # noqa: E402
from rewire.ref import Cache, Changes, Model, Quant, Weights, generate  # noqa: E402

SEEDS = list(range(10))
OUT = ARTIFACTS / "smoke"
EVERYDAY = ["Give me one tip for sleeping better.", "What is a good name for a cat?", "Why is the sky blue?"]


def word_forms(w: str) -> list[str]:
    return sorted({f for base in (w, w.lower(), w.capitalize(), w.upper()) for f in (base, " " + base)})


def single(form: str) -> int | None:
    ids = chat.plain(form)
    return ids[0] if len(ids) == 1 else None


def swap_pairs(a: str, b: str):
    pairs, missing = [], []
    for fa in word_forms(a):
        fb = fa.replace(a, b).replace(a.lower(), b.lower()).replace(a.upper(), b.upper())
        ia, ib = single(fa), single(fb)
        if ia is not None and ib is not None:
            pairs.append([ia, ib])
        else:
            missing.append((fa, ia is not None, fb, ib is not None))
    return pairs, missing


class Runner:
    def __init__(self):
        t = time.time()
        self.base = Weights()
        self.normal16 = Model(self.base)
        self.q = Weights(quant_cfg=Quant("rtn", 64, 16), base=self.base)
        self.model = Model(self.q)
        print(f"loaded in {time.time() - t:.0f}s", flush=True)
        self.concepts = {}
        self.rho = None

    def ch(self, spec, prompt=None):
        first = chat.system_end(prompt) if prompt else 0
        return Changes.make(spec, self.model.device, concepts=self.concepts, rho=self.rho, concept_from=first)

    def replies(self, msg: str, spec: dict, seeds=SEEDS, loss=True):
        prompt = chat.first_turn(msg)
        reps, _ = generate(self.model, prompt, self.ch(spec, prompt), seeds)
        out = []
        for r in reps:
            text = chat.decode([t for t in r.tokens if t not in (151645, 151643)])
            sg = signs(self.normal16, prompt, r.tokens, text) if loss else None
            out.append({"seed": r.seed, "text": text, "signs": sg, "broken": broken(sg) if sg else None})
        return out


def frac(rows, pred):
    return sum(1 for r in rows if pred(r)) / len(rows)


def has(words):
    rx = re.compile("|".join(words), re.I)
    return lambda r: bool(rx.search(r["text"]))


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    R = Runner()
    res: dict = {"seeds": len(SEEDS), "quant": "rtn affine 4-bit, groups of 64, dictionary 16-bit"}
    t0 = time.time()

    # Single-piece checks for the suggested swap pairs
    res["swap_pairs"] = {}
    for a, b in [("Paris", "Rome"), ("yes", "no"), ("cat", "dog")]:
        pairs, missing = swap_pairs(a, b)
        res["swap_pairs"][f"{a}/{b}"] = {"pairs": pairs, "not_single": missing}

    # Step 1: swap Paris and Rome
    pairs = res["swap_pairs"]["Paris/Rome"]["pairs"]
    s1 = []
    for msg in ["What is Rome's most famous landmark?", "Which famous monument is in Rome?",
                "Name one landmark that tourists visit in Rome."]:
        n = R.replies(msg, {}, loss=False)
        c = R.replies(msg, {"swaps": pairs}, loss=False)
        s1.append({"prompt": msg, "changed_eiffel": frac(c, has(["eiffel"])),
                   "normal_rome_landmark": frac(n, has(["colosse", "colise", "vatican", "trevi", "pantheon", "st\\.? peter"])),
                   "normal_eiffel": frac(n, has(["eiffel"])), "examples": {"normal": n[0]["text"], "changed": c[0]["text"]}})
    res["step1"] = s1
    print("step 1", [round(x["changed_eiffel"], 2) for x in s1], f"{time.time() - t0:.0f}s", flush=True)

    # Step 3: skip a floor
    facts = [("What is the capital of France?", ["paris"]), ("How many legs does a spider have?", ["eight", "\\b8\\b"]),
             ("What is the largest planet in our solar system?", ["jupiter"])]
    s3 = []
    for msg, ans in facts:
        row = {"prompt": msg}
        n = R.replies(msg, {})
        row["normal_correct"] = frac(n, has(ans))
        row["normal_broken"] = frac(n, lambda r: r["broken"])
        for fl in (0, 1, 13, 20, 27):
            c = R.replies(msg, {"floors": [{"floor": fl, "mult": 0}]})
            row[f"off{fl}_broken"] = frac(c, lambda r: r["broken"])
            row[f"off{fl}_correct"] = frac(c, has(ans))
            row[f"off{fl}_example"] = c[0]["text"]
        s3.append(row)
    res["step3"] = s3
    print("step 3", [(r["off0_broken"], r["off13_correct"]) for r in s3], f"{time.time() - t0:.0f}s", flush=True)

    # Step 4: hide the start marker
    s4 = []
    for msg in EVERYDAY:
        row = {"prompt": msg}
        for frm in (1, 2):
            c = R.replies(msg, {"hidden": [{"key": 0, "from": frm}]})
            row[f"from{frm}_broken"] = frac(c, lambda r: r["broken"])
            row[f"from{frm}_example"] = c[0]["text"]
        s4.append(row)
    res["step4"] = s4
    print("step 4", [(r["from1_broken"], r["from2_broken"]) for r in s4], f"{time.time() - t0:.0f}s", flush=True)

    # Step 5: copying heads
    cs = copying_scores(R.model)
    heads = [(int(L), int(h)) for L, h in zip(*np.where(cs >= 0.3))]
    res["copying_heads"] = {"threshold": 0.3, "heads": heads, "top": sorted(
        [(float(cs[L, h]), L, h) for L in range(FLOORS) for h in range(QH)], reverse=True)[:12]}
    rng = np.random.default_rng(1)
    rand_heads = []
    for L, _ in heads:  # same number of heads on the same floors, chosen at random
        choices = [h for h in range(QH) if (L, h) not in heads and (L, h) not in rand_heads]
        rand_heads.append((L, int(rng.choice(choices))))
    lists = [["whale", "pencil", "ember", "socket", "violin", "harbor", "maple", "quartz"],
             ["cobalt", "lantern", "meadow", "anchor", "fiddle", "glacier", "tunnel", "saddle"],
             ["orbit", "pepper", "canyon", "velvet", "hammer", "comet", "willow", "barrel"]]
    s5 = []
    for words in lists:
        msg = "Continue this list: " + ", ".join(words + words[:3]) + ","
        expect = words[3:6]
        pred = lambda r, e=expect: all(w in r["text"].lower() for w in e)  # noqa: E731
        n = R.replies(msg, {}, loss=False)
        off = R.replies(msg, {"heads": [{"floor": L, "head": h, "mult": 0} for L, h in heads]}, loss=False)
        rnd = R.replies(msg, {"heads": [{"floor": L, "head": h, "mult": 0} for L, h in rand_heads]}, loss=False)
        s5.append({"prompt": msg, "normal": frac(n, pred), "copying_off": frac(off, pred), "random_off": frac(rnd, pred),
                   "examples": {"normal": n[0]["text"], "off": off[0]["text"], "random": rnd[0]["text"]}})
    res["step5"] = s5
    print("step 5", len(heads), "heads", [(r["normal"], r["copying_off"], r["random_off"]) for r in s5],
          f"{time.time() - t0:.0f}s", flush=True)

    # Step 6: a concept (ocean)
    ref = EVERYDAY + ["Tell me a fun fact about space.", "How do I boil an egg?", "What is a verb?",
                      "Suggest a name for a band.", "How far is the Moon?", "What should I read next?",
                      "Explain gravity simply.", "What is your favorite color?"]
    R.rho = rho(R.model, ref)
    pos = ["The ocean waves crashed on the sandy beach.", "Fish swim deep in the salty sea.",
           "Sailors cross the ocean on great ships.", "Coral reefs live under the sea.",
           "The tide rolls in over the shore.", "Whales sing in the deep blue ocean.",
           "Seaweed floats on the ocean surface.", "We collected shells by the sea."]
    neg = ["The children played games in the park.", "Birds fly high over the city.",
           "Workers build houses with bricks.", "Trees grow tall in the forest.",
           "The train rolls into the station.", "Students read books in the library.",
           "Leaves fall on the quiet street.", "We collected stamps at home."]
    R.concepts = {"ocean": concept_vectors(R.model, pos, neg)}
    sea = ["\\bsea", "ocean", "wave", "beach", "fish", "shore", "tide", "coral", "seaweed", "marine", "salt water",
           "sailor", "\\bshell", "whale", "mermaid", "\\bboat", "\\bship", "seafood"]
    s6 = {"rho": R.rho, "grid": []}
    for fl in (6, 10, 14, 18):
        for st in (0.2, 0.4, 0.6, 1.0, 1.6):
            for msg in ["Give me a simple recipe for pancakes."]:
                c = R.replies(msg, {"concept": {"id": "ocean", "floor": fl, "strength": st}}, seeds=SEEDS[:5])
                s6["grid"].append({"floor": fl, "strength": st, "sea": frac(c, has(sea)),
                                   "broken": frac(c, lambda r: r["broken"]), "example": c[0]["text"]})
    n = R.replies("Give me a simple recipe for pancakes.", {}, seeds=SEEDS[:5])
    s6["normal_sea"] = frac(n, has(sea))
    res["step6"] = s6
    print("step 6", [(g["floor"], g["strength"], g["sea"], g["broken"]) for g in s6["grid"]], f"{time.time() - t0:.0f}s",
          flush=True)

    # Step 7: where does the answer form (floor guesses at the answer word)
    s7 = []
    ch0 = R.ch({})
    for msg, word in [("What is the capital of France?", " Paris"), ("What is the largest planet in our solar system?", " Jupiter"),
                      ("What is the chemical symbol for gold?", " Au")]:
        prompt = chat.first_turn(msg)
        rep, _ = generate(R.model, prompt, ch0, [0])
        toks = rep[0].tokens
        target = chat.plain(word)[0]
        if target not in toks:
            s7.append({"prompt": msg, "answer_in_reply": False, "reply": chat.decode(toks)})
            continue
        i = toks.index(target)
        cap: dict = {}
        R.model.run(torch.tensor([prompt + toks[:i]]), Cache(), ch0, capture=cap)
        after = [cap["stream"][L + 1][:, -1] for L in range(FLOORS)]
        gi, gp = R.model.guesses(after, ch0, k=5)
        top = gi[0, :, 0].cpu().tolist()
        first = next((L for L in range(FLOORS) if all(t == target for t in top[L:])), None)
        s7.append({"prompt": msg, "answer_in_reply": True, "first_floor_stable": first,
                   "guesses": [chat.piece(t) for t in top]})
    res["step7"] = s7
    print("step 7", [r.get("first_floor_stable") for r in s7], f"{time.time() - t0:.0f}s", flush=True)

    # Step 8: something made up
    dunno = ["not aware", "no information", "doesn't exist", "does not exist", "fictional", "not a real", "don't know",
             "do not know", "unknown", "not familiar", "no record", "isn't a", "is not a", "couldn't find", "not sure",
             "no known", "unable to"]
    s8 = []
    for msg in ["What is the capital of Velmoria?", "Who founded the city of Tarnhollow?", "What is the national dish of Quoridia?"]:
        n = R.replies(msg, {}, loss=False)
        s8.append({"prompt": msg, "admits": frac(n, has(dunno)), "examples": [r["text"] for r in n[:3]]})
    res["step8"] = s8
    print("step 8", [r["admits"] for r in s8], f"{time.time() - t0:.0f}s", flush=True)

    # Step 10: squeeze the numbers
    s10 = []
    for msg in EVERYDAY:
        row = {"prompt": msg}
        for bits in (4, 3, 2):
            c = R.replies(msg, {"bits": bits} if bits != 4 else {})
            row[f"b{bits}_broken"] = frac(c, lambda r: r["broken"])
            row[f"b{bits}_loss"] = float(np.mean([r["signs"]["loss"] for r in c]))
            row[f"b{bits}_example"] = c[0]["text"]
        s10.append(row)
        R.q.drop_cache()
    res["step10"] = s10
    print("step 10", [(r["b4_broken"], r["b3_broken"], r["b2_broken"]) for r in s10], f"{time.time() - t0:.0f}s", flush=True)

    res["seconds"] = round(time.time() - t0)
    (OUT / "results.json").write_text(json.dumps(res, indent=1, default=lambda o: o.tolist() if hasattr(o, "tolist") else str(o)))
    print("wrote", OUT / "results.json")


if __name__ == "__main__":
    main()
