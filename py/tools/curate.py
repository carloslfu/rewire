"""Phase 0A curation (section 8): the rule for each path step, the "it breaks" rule, the atlas, the
built-in concepts and the single-weight search, all on the converted 4-bit model.

  uv run python tools/curate.py artifacts/weights/<id> [stage ...]

Stages run in order and cache their results in artifacts/curate/<id>/<stage>.json; naming a stage
reruns it. The rule for a step that works: 5 paraphrased prompts, 20 seeds each; the stated result
shows on at least 4 prompts in at least 18 of 20 seeds, and the normal model shows the contrast in at
least 18 of 20 on those prompts.
"""
from __future__ import annotations

import json
import math
import re
import sys
import time
from pathlib import Path

import numpy as np
import torch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from rewire import breaks, chat, manifest  # noqa: E402
from rewire.atlas import concept_vectors, copying_scores, rho as measure_rho, start_marker_scores  # noqa: E402
from rewire.conv import ARTIFACTS, FLOORS, QH, TOK, VOCAB_REAL  # noqa: E402
from rewire.ref import Cache, Changes, Model, Weights, generate  # noqa: E402

SEEDS = list(range(20))
NEED_SEEDS, NEED_PROMPTS = 18, 4
DATA = Path(__file__).resolve().parents[1] / "data"
STOP = set(TOK["stop"])


def has(words):
    rx = re.compile("|".join(words), re.I)
    return lambda r: bool(rx.search(r["text"]))


class Ctx:
    def __init__(self, wdir: Path):
        t = time.time()
        self.wdir = wdir
        self.w, self.man = manifest.read(wdir, device=None)
        self.model = Model(self.w)
        self.base = Weights()  # the original 16-bit model: the break rule's loss
        self.m16 = Model(self.base)
        self.out = ARTIFACTS / "curate" / wdir.name
        self.out.mkdir(parents=True, exist_ok=True)
        self.thresholds = {"loss": breaks.LOSS_NATS, "tri": breaks.TRIGRAM_DISTINCT, "script": breaks.OTHER_SCRIPT}
        self.concepts: dict = {}
        self.rho = None
        print(f"loaded {wdir.name} in {time.time() - t:.0f}s", flush=True)

    def ch(self, spec, prompt=None):
        first = chat.system_end(prompt) if prompt else 0
        return Changes.make(spec, self.model.device, concepts=self.concepts, rho=self.rho, concept_from=first)

    def replies(self, msg: str, spec: dict, seeds=SEEDS, loss=True):
        prompt = chat.first_turn(msg)
        reps, _ = generate(self.model, prompt, self.ch(spec, prompt), seeds)
        out = []
        for r in reps:
            text = chat.decode([t for t in r.tokens if t not in STOP])
            row = {"seed": r.seed, "text": text, "tokens": r.tokens}
            if loss:
                sg = breaks.signs(self.m16, prompt, r.tokens, text)
                row["signs"] = sg
                row["broken"] = breaks.broken(sg, self.thresholds["loss"], self.thresholds["tri"], self.thresholds["script"])
            out.append(row)
        self.w.drop_cache()
        return out

    def save(self, name, obj):
        (self.out / f"{name}.json").write_text(json.dumps(obj, indent=1, default=lambda o: o.tolist() if hasattr(o, "tolist") else str(o)))

    def load(self, name):
        f = self.out / f"{name}.json"
        return json.loads(f.read_text()) if f.exists() else None


def count(rows, pred):
    return sum(1 for r in rows if pred(r))


def judge(per_prompt: list[dict]) -> dict:
    """per_prompt rows have 'stated' and 'contrast' counts out of 20 (and optional 'control')."""
    ok = [p for p in per_prompt if p["stated"] >= NEED_SEEDS and p["contrast"] >= NEED_SEEDS and p.get("control", 20) >= NEED_SEEDS]
    best = max(ok, key=lambda p: (p["stated"] + p["contrast"] + p.get("control", 20), -per_prompt.index(p))) if ok else None
    return {"passes": len(ok) >= NEED_PROMPTS, "passing_prompts": [p["prompt"] for p in ok], "best": best and best["prompt"]}


def first_seed(rows_a, pred_a, rows_b=None, pred_b=None):
    """The first seed whose rows show the stated result (and the contrast)."""
    for i, r in enumerate(rows_a):
        if pred_a(r) and (rows_b is None or pred_b(rows_b[i])):
            return r["seed"]
    return None


def slim(rows, n=3):
    return [{"seed": r["seed"], "text": r["text"], "broken": r.get("broken")} for r in rows[:n]]


# ------------------------------------------------------------------ the break rule

def stage_breaks(C: Ctx):
    every = json.loads((DATA / "everyday.json").read_text())[:200]
    rows = []
    for i in range(0, len(every), 1):
        r = C.replies(every[i], {}, seeds=[0])[0]
        rows.append({"prompt": every[i], "text": r["text"], **r["signs"]})
        if i % 25 == 0:
            print("  breaks", i, flush=True)
    losses = [r["loss"] for r in rows]
    tris = [r["trigrams"] for r in rows if r["trigrams"] is not None]
    scripts = [r["other_script"] for r in rows]
    empties = sum(1 for r in rows if r["empty"])
    th = dict(C.thresholds)
    # calibrate: no normal reply may trigger a sign; move a threshold just past the worst normal reply
    if max(losses) >= th["loss"]:
        th["loss"] = math.ceil((max(losses) + 0.25) * 4) / 4
    if tris and min(tris) < th["tri"]:
        th["tri"] = math.floor((min(tris) - 0.02) * 100) / 100
    if max(scripts) >= th["script"]:
        th["script"] = math.ceil((max(scripts) + 0.02) * 100) / 100
    res = {"prompts": len(rows), "empty": empties, "max_loss": max(losses), "min_trigrams": min(tris) if tris else None,
           "max_other_script": max(scripts), "thresholds": th, "normal_broken_after": sum(
               1 for r in rows if breaks.broken(r, th["loss"], th["tri"], th["script"])), "worst": sorted(rows, key=lambda r: -r["loss"])[:5]}
    return res


# ------------------------------------------------------------------ step 1

STEP1 = ["What is Rome's most famous landmark?", "What is the most famous landmark in Rome?", "Which famous monument is in Rome?",
         "Name one landmark that tourists visit in Rome.", "Which landmark is Rome best known for?",
         "What famous building should I see in Rome?", "What is the best-known sight in Rome?"]
ROME = ["colosse", "colise", "coliseum", "vatican", "trevi", "pantheon", "st\\.? peter", "spanish steps", "roman forum", "sistine"]


def swap_ids(a: str, b: str):
    ia, ib = chat.plain(" " + a), chat.plain(" " + b)
    assert len(ia) == 1 and len(ib) == 1
    return [ia[0], ib[0]]


def stage_step1(C: Ctx):
    pair = swap_ids("Paris", "Rome")
    spec = {"swaps": [pair]}
    per = []
    for msg in STEP1:
        n = C.replies(msg, {}, loss=False)
        c = C.replies(msg, spec, loss=False)
        eiffel = has(["eiffel"])
        rome = lambda r: has(ROME)(r) and not eiffel(r)  # noqa: E731
        per.append({"prompt": msg, "stated": count(c, eiffel), "contrast": count(n, rome), "seed": first_seed(c, eiffel, n, rome),
                    "examples": {"normal": slim(n, 2), "changed": slim(c, 2)}})
        print("  step1", msg, per[-1]["stated"], per[-1]["contrast"], flush=True)
    return {"spec": spec, "per_prompt": per, **judge(per)}


# ------------------------------------------------------------------ step 3

FACTS3 = [("What is the capital of France?", ["paris"]), ("How many legs does a spider have?", ["eight", "\\b8\\b"]),
          ("What is the largest planet in our solar system?", ["jupiter"]), ("How many days are in a week?", ["seven", "\\b7\\b"]),
          ("What do bees make?", ["honey"]), ("What is the opposite of hot?", ["cold"])]
MIDDLE = 13  # floor 14 (one-based)


def stage_step3(C: Ctx):
    per = []
    for msg, ans in FACTS3:
        good = lambda r, a=ans: has(a)(r) and not r["broken"]  # noqa: E731
        n = C.replies(msg, {})
        first = C.replies(msg, {"floors": [{"floor": 0, "mult": 0}]})
        mid = C.replies(msg, {"floors": [{"floor": MIDDLE, "mult": 0}]})
        row = {"prompt": msg, "stated": count(first, lambda r: r["broken"]), "control": count(mid, good),
               "contrast": count(n, good), "seed": None, "examples": {"normal": slim(n, 2), "first_off": slim(first, 2), "middle_off": slim(mid, 2)}}
        for i in range(20):
            if first[i]["broken"] and good(mid[i]) and good(n[i]):
                row["seed"] = n[i]["seed"]
                break
        per.append(row)
        print("  step3", msg, row["stated"], row["control"], row["contrast"], flush=True)
    return {"middle": MIDDLE, "per_prompt": per, **judge(per)}


# ------------------------------------------------------------------ step 4

EVERY4 = ["Give me one tip for sleeping better.", "What is a good name for a cat?", "Why is the sky blue?",
          "How do I make a cup of tea?", "Suggest an easy dinner idea.", "What is a fun fact about octopuses?"]


def stage_step4(C: Ctx):
    res = {}
    for frm in (2, 1):
        per = []
        for msg in EVERY4:
            n = C.replies(msg, {})
            c = C.replies(msg, {"hidden": [{"key": 0, "from": frm}]})
            per.append({"prompt": msg, "stated": count(c, lambda r: r["broken"]), "contrast": count(n, lambda r: not r["broken"]),
                        "seed": first_seed(c, lambda r: r["broken"], n, lambda r: not r["broken"]), "examples": {"changed": slim(c, 2)}})
            print("  step4 from", frm, msg, per[-1]["stated"], per[-1]["contrast"], flush=True)
        res[f"from{frm}"] = {"per_prompt": per, **judge(per)}
        if res[f"from{frm}"]["passes"]:
            res["chosen"] = frm
            break
    res["passes"] = "chosen" in res
    return res


# ------------------------------------------------------------------ step 5 and the copying heads

LISTS = [["whale", "pencil", "ember", "socket", "violin", "harbor"], ["cobalt", "lantern", "meadow", "anchor", "fiddle", "glacier"],
         ["orbit", "pepper", "canyon", "velvet", "hammer", "comet"], ["tulip", "marble", "rocket", "saddle", "fossil", "lemon"],
         ["ladder", "pigeon", "cactus", "ribbon", "walnut", "beacon"], ["kettle", "zebra", "garnet", "pillow", "trumpet", "acorn"]]


def stage_atlas(C: Ctx):
    cs = copying_scores(C.model)
    copying = [(int(L), int(h)) for L, h in zip(*np.where(cs >= 0.3))]
    every = json.loads((DATA / "everyday.json").read_text())[:50]
    sm = start_marker_scores(C.model, every)
    start = [(int(L), int(h)) for L, h in zip(*np.where(sm >= 0.6))]
    return {"copying": copying, "copying_scores": cs.tolist(), "start_marker": start, "start_scores": sm.tolist()}


def list_ok(words):
    def f(r):
        t = r["text"].lower()
        pos = [t.find(w) for w in words]
        return all(p >= 0 for p in pos) and pos == sorted(pos)
    return f


def stage_step5(C: Ctx):
    at = C.load("atlas")
    heads = [tuple(x) for x in at["copying"]]
    rng = np.random.default_rng(1)
    rand = []
    for L, _ in heads:
        choices = [h for h in range(QH) if (L, h) not in heads and (L, h) not in rand]
        rand.append((L, int(rng.choice(choices))))
    off = {"heads": [{"floor": L, "head": h, "mult": 0} for L, h in heads]}
    roff = {"heads": [{"floor": L, "head": h, "mult": 0} for L, h in rand]}
    per = []
    for words in LISTS:
        msg = "Repeat these words in the same order: " + ", ".join(words) + "."
        ok = list_ok(words)
        n = C.replies(msg, {}, loss=False)
        o = C.replies(msg, off, loss=False)
        r = C.replies(msg, roff, loss=False)
        per.append({"prompt": msg, "stated": count(o, lambda x: not ok(x)), "contrast": count(n, ok), "control": count(r, ok),
                    "seed": first_seed(o, lambda x: not ok(x), n, ok), "examples": {"normal": slim(n, 1), "off": slim(o, 2), "random": slim(r, 1)}})
        print("  step5", per[-1]["stated"], per[-1]["contrast"], per[-1]["control"], flush=True)
    return {"heads": heads, "random": rand, "per_prompt": per, **judge(per)}


# ------------------------------------------------------------------ concepts and step 6

CONCEPTS = {
    "ocean": {
        "label": "ocean",
        "pos": ["The ocean waves crashed on the sandy beach.", "Fish swim deep in the salty sea.", "Sailors cross the ocean on great ships.",
                "Coral reefs live under the sea.", "The tide rolls in over the shore.", "Whales sing in the deep blue ocean.",
                "Seaweed floats on the ocean surface.", "We collected shells by the sea."],
        "words": ["\\bsea", "ocean", "wave", "beach", "fish", "shore", "tide", "coral", "seaweed", "marine", "salt water", "sailor",
                  "\\bshell", "whale", "mermaid", "\\bboat", "\\bship", "seafood", "underwater", "aquatic"],
    },
    "space": {
        "label": "outer space",
        "pos": ["The rocket flew past the Moon.", "Astronauts float inside the space station.", "Stars and planets fill the night sky.",
                "The telescope found a distant galaxy.", "A comet streaked across the sky.", "Mars is a red planet.",
                "The spaceship landed on an asteroid.", "Saturn has bright rings."],
        "words": ["space", "planet", "star", "rocket", "astronaut", "galax", "moon", "orbit", "cosm", "nasa", "alien", "comet", "mars"],
    },
    "winter": {
        "label": "winter",
        "pos": ["Snow covered the quiet village.", "We built a snowman in the cold.", "Ice froze over the lake in December.",
                "The children wore warm scarves and mittens.", "A blizzard swept across the mountains.", "Frost formed on the window.",
                "We drank hot cocoa by the fire.", "Skiers raced down the snowy slope."],
        "words": ["snow", "winter", "ice", "frost", "cold", "freez", "blizzard", "mitten", "scarf", "cocoa", "sled", "ski", "chill"],
    },
}
NEG = ["The children played games in the park.", "Birds fly high over the city.", "Workers build houses with bricks.",
       "Trees grow tall in the forest.", "The train rolls into the station.", "Students read books in the library.",
       "Leaves fall on the quiet street.", "We collected stamps at home."]
RECIPES = ["Give me a simple recipe for pancakes.", "How do I make a grilled cheese sandwich?", "Give me a quick recipe for scrambled eggs.",
           "How do I bake simple cookies?", "Give me an easy recipe for tomato soup.", "How do I make a fruit salad?"]


def stage_concepts(C: Ctx):
    every = json.loads((DATA / "everyday.json").read_text())
    C.rho = measure_rho(C.model, every[:50])
    vecs = {cid: concept_vectors(C.model, c["pos"], NEG) for cid, c in CONCEPTS.items()}
    C.concepts = vecs
    out = {"rho": C.rho, "concepts": {}}
    for cid, c in CONCEPTS.items():
        grid = []
        for fl in (5, 8, 11, 14, 17, 20):
            for st in (0.25, 0.5, 0.75, 1.0, 1.5, 2.0):
                rows = C.replies(RECIPES[0], {"concept": {"id": cid, "floor": fl, "strength": st}}, seeds=SEEDS[:8])
                grid.append({"floor": fl, "strength": st, "topic": count(rows, has(c["words"])) / 8,
                             "broken": count(rows, lambda r: r["broken"]) / 8, "example": rows[0]["text"]})
            print("  concept", cid, fl, [(g["strength"], g["topic"], g["broken"]) for g in grid[-6:]], flush=True)
        # best floor: the largest topic share without breaking at a working strength; breaking line: first strength that breaks most
        best = None
        for fl in sorted({g["floor"] for g in grid}):
            rows = [g for g in grid if g["floor"] == fl]
            work = [g for g in rows if g["topic"] >= 0.75 and g["broken"] <= 0.125]
            brk = next((g["strength"] for g in rows if g["broken"] >= 0.75), None)
            if work and brk is not None:
                cand = {"floor": fl, "working": [min(g["strength"] for g in work), max(g["strength"] for g in work)], "breaking": brk,
                        "score": max(g["topic"] for g in work)}
                if best is None or (cand["score"], cand["working"][1] - cand["working"][0]) > (best["score"], best["working"][1] - best["working"][0]):
                    best = cand
        out["concepts"][cid] = {"grid": grid, "best": best}
    out["vectors"] = {cid: [v.cpu().numpy().tolist() for v in vs] for cid, vs in vecs.items()}
    return out


def use_concepts(C: Ctx):
    c = C.load("concepts")
    if c is None:
        return
    C.rho = c["rho"]
    C.concepts = {cid: [torch.tensor(v) for v in vs] for cid, vs in c["vectors"].items()}


def stage_step6(C: Ctx):
    use_concepts(C)
    cc = C.load("concepts")["concepts"]["ocean"]
    best = cc["best"]
    if not best:
        return {"passes": False, "reason": "no working floor for ocean"}
    fl, work, brk = best["floor"], best["working"][1], best["breaking"]
    words = CONCEPTS["ocean"]["words"]
    per = []
    for msg in RECIPES:
        n = C.replies(msg, {})
        w = C.replies(msg, {"concept": {"id": "ocean", "floor": fl, "strength": work}})
        b = C.replies(msg, {"concept": {"id": "ocean", "floor": fl, "strength": brk}})
        sea_ok = lambda r: has(words)(r) and not r["broken"]  # noqa: E731
        per.append({"prompt": msg, "stated": count(w, sea_ok), "control": count(b, lambda r: r["broken"]),
                    "contrast": count(n, lambda r: not has(words)(r) and not r["broken"]),
                    "seed": next((n[i]["seed"] for i in range(20) if sea_ok(w[i]) and b[i]["broken"] and not has(words)(n[i])), None),
                    "examples": {"working": slim(w, 2), "broken": slim(b, 2)}})
        print("  step6", msg, per[-1]["stated"], per[-1]["control"], per[-1]["contrast"], flush=True)
    return {"floor": fl, "working": work, "breaking": brk, "per_prompt": per, **judge(per)}


# ------------------------------------------------------------------ step 7

FACTS7 = [("What is the capital of France?", " Paris"), ("What is the largest planet in our solar system?", " Jupiter"),
          ("What is the chemical symbol for gold?", " Au"), ("In which city is the Colosseum?", " Rome"),
          ("What is the capital of Japan?", " Tokyo"), ("Which planet is known as the Red Planet?", " Mars")]


@torch.no_grad()
def stage_step7(C: Ctx):
    per = []
    ch0 = C.ch({})
    for msg, word in FACTS7:
        prompt = chat.first_turn(msg)
        target = chat.plain(word)[0]
        reps, _ = generate(C.model, prompt, ch0, SEEDS)
        firsts, seed, index = [], None, None
        for r in reps:
            toks = r.tokens
            if target not in toks:
                firsts.append(None)
                continue
            i = toks.index(target)
            cap: dict = {}
            C.model.run(torch.tensor([prompt + toks[:i]]), Cache(), ch0, capture=cap)
            after = [cap["stream"][L + 1][:, -1] for L in range(FLOORS)]
            gi, _ = C.model.guesses(after, ch0, k=1)
            top = gi[0, :, 0].cpu().tolist()
            f = next((L for L in range(FLOORS) if all(t == target for t in top[L:])), None)
            firsts.append(f)
            if f is not None and f >= 14 and seed is None:
                seed, index = r.seed, i
        upper = sum(1 for f in firsts if f is not None and f >= 14)
        per.append({"prompt": msg, "stated": upper, "contrast": sum(1 for f in firsts if f is not None), "seed": seed, "index": index,
                    "median_floor": float(np.median([f for f in firsts if f is not None])) + 1 if any(f is not None for f in firsts) else None})
        print("  step7", msg, upper, per[-1]["median_floor"], flush=True)
    j = judge(per)
    best = next((p for p in per if p["prompt"] == j["best"]), None)
    return {"per_prompt": per, **j, "floor": best and best["median_floor"]}


# ------------------------------------------------------------------ step 8

DUNNO = ["not aware", "no information", "doesn't exist", "does not exist", "fictional", "not a real", "don't know", "do not know",
         "unknown", "not familiar", "no record", "isn't a real", "is not a real", "couldn't find", "not sure", "no known", "unable to",
         "imaginary", "made up", "made-up", "no such", "not recognized", "there is no"]


def stage_step8(C: Ctx):
    made = json.loads((DATA / "made_up.json").read_text())
    per = []
    for msg in made[:6]:
        n = C.replies(msg, {})
        describes = lambda r: not has(DUNNO)(r) and not r["broken"] and len(r["text"].strip()) > 10  # noqa: E731
        per.append({"prompt": msg, "stated": count(n, describes), "contrast": 20, "seed": first_seed(n, describes), "examples": slim(n, 3)})
        print("  step8", msg, per[-1]["stated"], flush=True)
    # how sure it was: mean probability (temperature 1) of its own words, made-up vs real facts
    def sure(msgs):
        vals = []
        for m in msgs:
            prompt = chat.first_turn(m)
            reps, _ = generate(C.model, prompt, C.ch({}), [0])
            from rewire.ref import reply_logprobs
            lp = reply_logprobs(C.model, prompt, reps[0].tokens, C.ch({}))
            vals.append(float(lp.exp().mean()))
        return float(np.mean(vals))
    real = [q for q, _ in json.loads((DATA / "facts.json").read_text())[:6]]
    return {"per_prompt": per, **judge(per), "mean_p_made_up": sure(made[:6]), "mean_p_real": sure(real)}


# ------------------------------------------------------------------ step 9

STORIES = ["Write a two-sentence story about a dragon.", "Write a two-sentence story about a lost cat.",
           "Write a two-sentence story about a robot who learns to paint.", "Write a two-sentence story about a lighthouse keeper.",
           "Write a two-sentence story about a girl who finds a key.", "Write a two-sentence story about a talking tree."]


def stage_step9(C: Ctx):
    from rewire.ref import generate_recorded
    per = []
    for msg in STORIES:
        prompt = chat.first_turn(msg)
        ch0 = C.ch({})
        reps, _ = generate_recorded(C.model, prompt, ch0, SEEDS, guesses=False)
        changed, pick = 0, None
        for r in reps:
            # the first word piece (after the first three) whose third candidate is a word with at least 5%
            idx = next((i for i, rec in enumerate(r.records) if i >= 3 and len(rec["cand_ids"]) >= 3 and rec["cand_probs"][2] >= 0.05
                        and re.match(r"^ ?[A-Za-z]{3,}$", chat.piece(int(rec["cand_ids"][2])) or "")), None)
            if idx is None:
                continue
            third = int(r.records[idx]["cand_ids"][2])
            forced = r.tokens[:idx] + [third]
            # continue from the forced word with the same seed and step numbering
            rest = continue_from(C, prompt, forced, r.seed)
            orig_after, new_after = r.tokens[idx + 1:], rest
            if chat.decode(orig_after) != chat.decode(new_after):
                changed += 1
                if pick is None:
                    pick = {"seed": r.seed, "index": idx, "third": third, "original": chat.decode(r.tokens),
                            "rewritten": chat.decode(forced + rest)}
        per.append({"prompt": msg, "stated": changed, "contrast": 20, "seed": pick and pick["seed"], "pick": pick})
        print("  step9", msg, changed, flush=True)
    return {"per_prompt": per, **judge(per)}


@torch.no_grad()
def continue_from(C: Ctx, prompt, forced, seed, cap=64):
    from rewire.ref import sample_rows
    ch0 = C.ch({})
    c = Cache()
    xs = C.model.run(torch.tensor([prompt + forced]), c, ch0)
    last = xs[:, -1]
    out = []
    for step in range(len(forced), cap):
        sc = C.model.scores(last, ch0)
        tid = sample_rows(sc, [seed], 0, step)[0][0]
        out.append(tid)
        if tid in STOP:
            break
        xs = C.model.run(torch.tensor([[tid]]), c, ch0)
        last = xs[:, -1]
    return out


# ------------------------------------------------------------------ step 10

def stage_step10(C: Ctx):
    per = []
    for msg in EVERY4:
        n = C.replies(msg, {})
        b3 = C.replies(msg, {"bits": 3})
        b2 = C.replies(msg, {"bits": 2})
        per.append({"prompt": msg, "stated": count(b2, lambda r: r["broken"]), "control": count(b3, lambda r: r["broken"]),
                    "b3_loss": float(np.mean([r["signs"]["loss"] for r in b3])), "n_loss": float(np.mean([r["signs"]["loss"] for r in n])),
                    "contrast": count(n, lambda r: not r["broken"]),
                    "seed": next((n[i]["seed"] for i in range(20) if b2[i]["broken"] and b3[i]["broken"] and not n[i]["broken"]), None),
                    "examples": {"b3": slim(b3, 2), "b2": slim(b2, 2)}})
        print("  step10", msg, per[-1]["control"], per[-1]["stated"], per[-1]["contrast"], flush=True)
    j = judge(per)
    b3_breaks = sum(1 for p in per if p["control"] >= NEED_SEEDS) >= NEED_PROMPTS
    return {"per_prompt": per, **j, "at3": "breaks" if b3_breaks else "worse"}


# ------------------------------------------------------------------ step 2: one number

@torch.no_grad()
def short_ppl(C: Ctx, spec: dict, windows: int = 8, seq: int = 512) -> float:
    ids = np.load(ARTIFACTS / "quantlab" / "wikitext_test_ids.npy")
    ch = C.ch(spec)
    nll, cnt = 0.0, 0
    for i in range(windows):
        x = torch.tensor(ids[i * seq:(i + 1) * seq])[None]
        xs = C.model.run(x, Cache(), ch)
        lp = torch.log_softmax(C.model.scores(xs[0, :-1], ch).float(), -1)
        tgt = x[0, 1:].to(lp.device)
        nll += float(-lp[torch.arange(seq - 1), tgt].sum())
        cnt += seq - 1
    return float(np.exp(nll / cnt))


@torch.no_grad()
def stage_step2(C: Ctx):
    base = short_ppl(C, {})
    mats = C.w.mats(4)
    cands = set()
    # super-weight candidates: in early floors' down projections, the input channel with activation spikes and the
    # output row where it lands; plus each early floor's 20 largest weights
    every = json.loads((DATA / "everyday.json").read_text())[:8]
    acts = torch.zeros(FLOORS, mats[0]["down"].shape[1])
    for msg in every:
        cap: dict = {}
        C.model.run(torch.tensor([chat.first_turn(msg)]), Cache(), C.ch({}), capture=cap)
        for L in range(4):
            acts[L] = torch.maximum(acts[L], cap["inter"][L]["act"][0].abs().amax(0).cpu())
    for L in range(4):
        j = int(acts[L].argmax())
        col = mats[L]["down"][:, j].abs().cpu()
        for r in col.topk(3).indices.tolist():
            cands.add((L, "down", int(r), j))
        for t in ("down", "o", "up", "gate", "q", "k", "v"):
            W = mats[L][t].abs().flatten().cpu()
            top = W.topk(20 if t == "down" else 4).indices
            for k in top.tolist():
                cands.add((L, t, k // mats[L][t].shape[1], k % mats[L][t].shape[1]))
    rows = []
    for (L, t, r, c) in sorted(cands):
        spec = {"zeroed": [{"floor": L, "tensor": t, "row": r, "col": c}]}
        p = short_ppl(C, spec)
        rows.append({"floor": L, "tensor": t, "row": r, "col": c, "ppl": p, "ratio": p / base})
    rows.sort(key=lambda x: -x["ratio"])
    print("  step2 top", rows[:5], flush=True)
    res = {"base_ppl": base, "candidates": len(rows), "top": rows[:10]}
    for best in rows[:3]:
        if best["ratio"] < 10:
            break
        spec = {"zeroed": [{k: best[k] for k in ("floor", "tensor", "row", "col")}]}
        per = []
        for msg in EVERY4[:5]:
            n = C.replies(msg, {})
            z = C.replies(msg, spec)
            per.append({"prompt": msg, "stated": count(z, lambda r: r["broken"]), "contrast": count(n, lambda r: not r["broken"]),
                        "seed": first_seed(z, lambda r: r["broken"], n, lambda r: not r["broken"]), "examples": slim(z, 2)})
        broke = sum(1 for p in per if p["stated"] >= NEED_SEEDS)
        if broke >= 4:
            res.update({"weight": spec["zeroed"][0], "per_prompt": per, "passes": True, "best": max(per, key=lambda p: p["stated"])["prompt"]})
            return res
    res["passes"] = False
    return res


STAGES = ["breaks", "atlas", "step1", "step3", "step4", "step5", "concepts", "step6", "step7", "step8", "step9", "step10", "step2"]


def main():
    wdir = Path(sys.argv[1])
    only = sys.argv[2:]
    C = Ctx(wdir)
    for st in STAGES:
        cached = C.load(st)
        run = (st in only) if only else cached is None
        if not run:
            if cached and st == "breaks":
                C.thresholds = cached["thresholds"]
            continue
        t = time.time()
        print(f"== {st}", flush=True)
        if st not in ("breaks", "atlas", "concepts"):
            use_concepts(C)
        res = globals()[f"stage_{st}"](C)
        res["seconds"] = round(time.time() - t)
        C.save(st, res)
        if st == "breaks":
            C.thresholds = res["thresholds"]
        print(f"   {st}: passes={res.get('passes')} in {res['seconds']}s", flush=True)


if __name__ == "__main__":
    main()
