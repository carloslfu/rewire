"""Recordings of every shipping path step (section 7.4) and the page's recordings/path.json.

  uv run python tools/record.py artifacts/weights/<id> [step ...]

Reads the curation results in artifacts/curate/<id>/, records each passing step's prompt at every stop
of its control (with the changed model fed the normal reply, for the underlines and the Difference view),
up to three recorded alternative questions, and full floor detail for the featured words. Writes to
app/public/recordings/.
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

from rewire import chat, manifest  # noqa: E402
from rewire.conv import ARTIFACTS, FLOORS, QH, TOK  # noqa: E402
from rewire.recording import RecordingWriter, featured_tensors, forced_records, write_featured  # noqa: E402
from rewire.ref import Changes, Model, generate_recorded  # noqa: E402

sys.path.insert(0, str(Path(__file__).resolve().parent))
import curate  # noqa: E402

APP = Path(__file__).resolve().parents[2] / "app" / "public" / "recordings"
STOP = set(TOK["stop"])


class Rec:
    def __init__(self, wdir: Path):
        self.w, self.man = manifest.read(wdir)
        self.model = Model(self.w)
        self.cur = ARTIFACTS / "curate" / wdir.name
        c = json.loads((self.cur / "concepts.json").read_text()) if (self.cur / "concepts.json").exists() else None
        self.rho = c["rho"] if c else self.man["rho"]
        self.concepts = {cid: [torch.tensor(v) for v in vs] for cid, vs in c["vectors"].items()} if c else self.man["_concepts"]
        APP.mkdir(parents=True, exist_ok=True)
        self.pushes_seen: list[np.ndarray] = []

    def cur_json(self, name):
        f = self.cur / f"{name}.json"
        return json.loads(f.read_text()) if f.exists() else None

    def ch(self, spec, prompt=None):
        first = chat.system_end(prompt) if prompt else 0
        return Changes.make(spec, self.model.device, concepts=self.concepts, rho=self.rho, concept_from=first)

    def run(self, rw: RecordingWriter, rid: str, msg: str, spec: dict, seed: int, normal=None, picked=None):
        """Records one run of the step's prompt; with `normal` (the normal run's reply), also the comparison."""
        prompt = chat.first_turn(msg)
        ch = self.ch(spec, prompt)
        if picked is not None:
            reps = [picked]
        else:
            reps, _ = generate_recorded(self.model, prompt, ch, [seed])
        r = reps[0]
        run = rw.add_run(rid, spec, seed, 0.7, [msg])
        rw.add_turn(run, prompt, r.records, ended=bool(r.tokens and r.tokens[-1] in STOP))
        if normal is not None:
            rw.add_compare(run, "normal", forced_records(self.model, prompt, normal, ch))
        self.w.drop_cache()
        return run, r, prompt

    def feature(self, rw: RecordingWriter, step: str, run, prompt, reply_tokens, index, spec):
        if index is None or index >= len(reply_tokens):
            return
        toks = prompt + reply_tokens[:index]
        t = featured_tensors(self.model, toks, len(toks) - 1, self.ch(spec, prompt), target=reply_tokens[index])
        name = f"{step}.{run.id}.{index}.safetensors"
        size = write_featured(APP / name, t)
        rw.add_featured(run, 0, index, name)
        print(f"   featured {name} {size / 1e6:.2f} MB", flush=True)
        self.w.drop_cache()

    def answer_index(self, tokens, pattern):
        """Index of the reply piece where the first match of `pattern` starts."""
        spans, text = [], ""
        for t in tokens:
            p = chat.piece(t)
            spans.append((len(text), len(text) + len(p)))
            text += p
        m = re.search(pattern, text, re.I)
        if not m:
            return None
        return next((i for i, (a, b) in enumerate(spans) if a <= m.start() < b), None)


def seeded(per, prompt):
    row = next(p for p in per if p["prompt"] == prompt)
    return row["seed"] if row["seed"] is not None else 0


def alts(res, n=3):
    return [p for p in res["passing_prompts"] if p != res["best"]][:n]


# ------------------------------------------------------------------ steps

def rec_step1(R: Rec):
    res = R.cur_json("step1")
    if not res or not res["passes"]:
        return None
    spec = res["spec"]
    rw = RecordingWriter(R.man["hash"], step="step-1")
    msg = res["best"]
    seed = seeded(res["per_prompt"], msg)
    nrun, nrep, prompt = R.run(rw, "normal", msg, {}, seed)
    crun, crep, _ = R.run(rw, "swap", msg, spec, seed, normal=nrep.tokens)
    ni = R.answer_index(nrep.tokens, r"col|vatic|trevi|panth|peter|spanish|forum|sistin")
    ci = R.answer_index(crep.tokens, r"eiff")
    R.feature(rw, "step-1", nrun, prompt, nrep.tokens, ni, {})
    R.feature(rw, "step-1", crun, prompt, crep.tokens, ci, spec)
    for a in alts(res):
        s = seeded(res["per_prompt"], a)
        n2 = R.run(rw, f"normal:{a}", a, {}, s)[1]
        R.run(rw, f"swap:{a}", a, spec, s, normal=n2.tokens)
    R.pushes_seen += [r["pushes"] for r in nrep.records[ni:ni + 1]] if ni is not None else []
    size = rw.write(APP / "step-1.rwr")
    print("  step-1", size, "bytes", flush=True)
    a, b = spec["swaps"][0]
    return {"n": 1, "slug": "step-1", "core": True, "recording": "step-1.rwr", "message": msg, "alternatives": alts(res),
            "control": {"kind": "swap", "a": "Paris", "b": "Rome", "ids": [a, b]},
            "featured": {"side": "normal", "index": ni} if ni is not None else None}


def rec_step3(R: Rec):
    res = R.cur_json("step3")
    if not res or not res["passes"]:
        return None
    rw = RecordingWriter(R.man["hash"], step="step-3")
    msg = res["best"]
    seed = seeded(res["per_prompt"], msg)
    nrun, nrep, prompt = R.run(rw, "normal", msg, {}, seed)
    mid = res["middle"]
    for fl in (0, mid):
        for m in (-1, 0, 2, 5):
            spec = {"floors": [{"floor": fl, "mult": m}]}
            run, rep, _ = R.run(rw, f"f{fl}x{m}", msg, spec, seed, normal=nrep.tokens)
            if m == 0:
                R.feature(rw, "step-3", run, prompt, rep.tokens, 0, spec)
    R.feature(rw, "step-3", nrun, prompt, nrep.tokens, 0, {})
    for a in alts(res, 2):
        s = seeded(res["per_prompt"], a)
        n2 = R.run(rw, f"normal:{a}", a, {}, s)[1]
        for fl in (0, mid):
            R.run(rw, f"f{fl}x0:{a}", a, {"floors": [{"floor": fl, "mult": 0}]}, s, normal=n2.tokens)
    print("  step-3", rw.write(APP / "step-3.rwr"), "bytes", flush=True)
    return {"n": 3, "slug": "step-3", "core": True, "recording": "step-3.rwr", "message": msg, "alternatives": alts(res, 2),
            "control": {"kind": "floors", "floors": [0, mid]}, "facts": {"middle": mid + 1}, "featured": {"side": "normal", "index": 0}}


def rec_simple(R: Rec, n: int, name: str, spec_of, control, core=False, facts=None, feature_changed=True, extras=None):
    """extras: (label, spec_of) pairs also recorded for the message and its alternatives (step 5's random heads)."""
    res = R.cur_json(name)
    if not res or not res["passes"]:
        return None
    rw = RecordingWriter(R.man["hash"], step=f"step-{n}")
    msg = res["best"]
    seed = seeded(res["per_prompt"], msg)
    spec = spec_of(res)
    nrun, nrep, prompt = R.run(rw, "normal", msg, {}, seed)
    crun, crep, _ = R.run(rw, "changed", msg, spec, seed, normal=nrep.tokens)
    R.feature(rw, f"step-{n}", nrun, prompt, nrep.tokens, 0, {})
    if feature_changed:
        R.feature(rw, f"step-{n}", crun, prompt, crep.tokens, 0, spec)
    for label, extra_of in extras or []:
        R.run(rw, label, msg, extra_of(res), seed, normal=nrep.tokens)
    for a in alts(res, 2):
        s = seeded(res["per_prompt"], a)
        n2 = R.run(rw, f"normal:{a}", a, {}, s)[1]
        R.run(rw, f"changed:{a}", a, spec, s, normal=n2.tokens)
        for label, extra_of in extras or []:
            R.run(rw, f"{label}:{a}", a, extra_of(res), s, normal=n2.tokens)
    print(f"  step-{n}", rw.write(APP / f"step-{n}.rwr"), "bytes", flush=True)
    return {"n": n, "slug": f"step-{n}", "core": core, "recording": f"step-{n}.rwr", "message": msg, "alternatives": alts(res, 2),
            "control": control(res), "facts": facts(res) if facts else {}, "featured": {"side": "normal", "index": 0}}


def rec_step6(R: Rec):
    res = R.cur_json("step6")
    if not res or not res["passes"]:
        return None
    rw = RecordingWriter(R.man["hash"], step="step-6")
    msg = res["best"]
    seed = seeded(res["per_prompt"], msg)
    fl, work, brk = res["floor"], res["working"], res["breaking"]
    stops = sorted({round(-work, 2), round(res.get("blend", work / 2), 2), round(work, 2), round(brk, 2)})
    nrun, nrep, prompt = R.run(rw, "normal", msg, {}, seed)
    for st in stops:
        spec = {"concept": {"id": "ocean", "floor": fl, "strength": st}}
        run, rep, _ = R.run(rw, f"c{st}", msg, spec, seed, normal=nrep.tokens)
        if st == round(work, 2):
            R.feature(rw, "step-6", run, prompt, rep.tokens, 0, spec)
    for a in alts(res, 2):
        s = seeded(res["per_prompt"], a)
        n2 = R.run(rw, f"normal:{a}", a, {}, s)[1]
        R.run(rw, f"c{round(work, 2)}:{a}", a, {"concept": {"id": "ocean", "floor": fl, "strength": round(work, 2)}}, s, normal=n2.tokens)
    print("  step-6", rw.write(APP / "step-6.rwr"), "bytes", flush=True)
    return {"n": 6, "slug": "step-6", "core": False, "recording": "step-6.rwr", "message": msg, "alternatives": alts(res, 2),
            "control": {"kind": "concept", "id": "ocean", "label": "ocean", "floor": fl, "stops": [0] + stops, "breaking": round(brk, 2)},
            "featured": {"side": "changed", "index": 0}}


def rec_step7(R: Rec):
    res = R.cur_json("step7")
    if not res or not res["passes"]:
        return None
    rw = RecordingWriter(R.man["hash"], step="step-7")
    msg = res["best"]
    row = next(p for p in res["per_prompt"] if p["prompt"] == msg)
    nrun, nrep, prompt = R.run(rw, "normal", msg, {}, row["seed"])
    R.feature(rw, "step-7", nrun, prompt, nrep.tokens, row["index"], {})
    R.pushes_seen += [nrep.records[row["index"]]["pushes"]]
    print("  step-7", rw.write(APP / "step-7.rwr"), "bytes", flush=True)
    return {"n": 7, "slug": "step-7", "core": False, "recording": "step-7.rwr", "message": msg,
            "control": {"kind": "guesses", "index": row["index"]}, "facts": {"floor": int(round(res["floor"] or 20))},
            "featured": {"side": "normal", "index": row["index"]}}


def rec_step8(R: Rec):
    res = R.cur_json("step8")
    if not res or not res["passes"]:
        return None
    rw = RecordingWriter(R.man["hash"], step="step-8")
    msg = res["best"]
    seed = seeded(res["per_prompt"], msg)
    nrun, nrep, prompt = R.run(rw, "normal", msg, {}, seed)
    # the least sure content word of the reply
    probs = [(np.exp(r["lp1"]), i) for i, r in enumerate(nrep.records) if re.match(r"^ ?[A-Za-z]{3,}", chat.piece(r["id"]) or "")]
    idx = min(probs)[1] if probs else 0
    R.feature(rw, "step-8", nrun, prompt, nrep.tokens, idx, {})
    print("  step-8", rw.write(APP / "step-8.rwr"), "bytes", flush=True)
    return {"n": 8, "slug": "step-8", "core": False, "recording": "step-8.rwr", "message": msg,
            "control": {"kind": "madeup", "index": idx}, "featured": {"side": "normal", "index": idx},
            "facts": {"made_up": round(res["mean_p_made_up"] * 100), "real": round(res["mean_p_real"] * 100)}}


def rec_step9(R: Rec):
    res = R.cur_json("step9")
    if not res or not res["passes"]:
        return None
    from rewire.ref import Reply
    rw = RecordingWriter(R.man["hash"], step="step-9")
    msg = res["best"]
    row = next(p for p in res["per_prompt"] if p["prompt"] == msg)
    pk = row["pick"]
    nrun, nrep, prompt = R.run(rw, "normal", msg, {}, pk["seed"])
    # the rewritten reply: same words up to the pick, the third candidate there, then the draws that follow
    forced = nrep.tokens[:pk["index"]] + [pk["third"]]
    recs = forced_records(R.model, prompt, forced, R.ch({}, prompt))
    gen, _ = generate_recorded(R.model, prompt + forced, R.ch({}, prompt), [pk["seed"]], cap=64 - len(forced), step0=len(forced))
    at = dict(nrep.records[pk["index"]], id=pk["third"], pushes=recs[pk["index"]]["pushes"], lp1=recs[pk["index"]]["lp1"])
    records = nrep.records[:pk["index"]] + [at] + gen[0].records
    picked = Reply(pk["seed"], forced + gen[0].tokens, records)
    run, _, _ = R.run(rw, "pick", msg, {}, pk["seed"], picked=picked)
    run.picked = {"turn": 0, "index": pk["index"], "id": pk["third"]}
    print("  step-9", rw.write(APP / "step-9.rwr"), "bytes", flush=True)
    return {"n": 9, "slug": "step-9", "core": True, "recording": "step-9.rwr", "message": msg,
            "control": {"kind": "pick", "index": pk["index"], "rank": 3}, "featured": {"side": "normal", "index": pk["index"]}}


def rec_step10(R: Rec):
    res = R.cur_json("step10")
    if not res or not res["passes"]:
        return None
    rw = RecordingWriter(R.man["hash"], step="step-10")
    msg = res["best"]
    seed = seeded(res["per_prompt"], msg)
    nrun, nrep, prompt = R.run(rw, "normal", msg, {}, seed)
    for b in (3, 2):
        run, rep, _ = R.run(rw, f"bits{b}", msg, {"bits": b}, seed, normal=nrep.tokens)
        if b == 3:
            R.feature(rw, "step-10", run, prompt, rep.tokens, 0, {"bits": b})
    for a in alts(res, 2):
        s = seeded(res["per_prompt"], a)
        n2 = R.run(rw, f"normal:{a}", a, {}, s)[1]
        for b in (3, 2):
            R.run(rw, f"bits{b}:{a}", a, {"bits": b}, s, normal=n2.tokens)
    print("  step-10", rw.write(APP / "step-10.rwr"), "bytes", flush=True)
    return {"n": 10, "slug": "step-10", "core": True, "recording": "step-10.rwr", "message": msg, "alternatives": alts(res, 2),
            "control": {"kind": "bits"}, "facts": {"at3": res["at3"]}, "featured": {"side": "normal", "index": 0}}


def answer_pushers(R: Rec):
    if not R.pushes_seen:
        return [], []
    m = np.mean(np.stack(R.pushes_seen), 0)
    heads = sorted(((m[1 + L * (QH + 1) + h], L, h) for L in range(FLOORS) for h in range(QH)), reverse=True)[:5]
    mems = sorted(((m[1 + L * (QH + 1) + QH], L) for L in range(FLOORS)), reverse=True)[:3]
    return [[L, h] for _, L, h in heads], [L for _, L in mems]


def swap_pairs():
    out = []
    for a, b in [("Paris", "Rome"), ("yes", "no"), ("cat", "dog")]:
        for fa in sorted({f for base in (a, a.lower(), a.capitalize()) for f in (base, " " + base)}):
            fb = fa.replace(a, b).replace(a.lower(), b.lower()).replace(a.capitalize(), b.capitalize())
            ia, ib = chat.plain(fa), chat.plain(fb)
            if len(ia) == 1 and len(ib) == 1 and [ia[0], ib[0]] not in [p["ids"] for p in out]:
                out.append({"a": fa.strip(), "b": fb.strip(), "ids": [ia[0], ib[0]]})
    return out


def main():
    wdir = Path(sys.argv[1])
    only = sys.argv[2:]
    t = time.time()
    R = Rec(wdir)
    steps = []
    jobs = [("step-1", lambda: rec_step1(R)), ("step-2", lambda: rec_simple(
        R, 2, "step2", lambda r: {"zeroed": r["weights"]}, lambda r: {"kind": "zeroed", "weights": r["weights"]},
        facts=lambda r: {"k": r["k"], "floor": r["floor"] + 1, "value": round(r["value"]), "left": round(r["left"]),
                         "typical": round(r["typical"]), "ratio": round(r["ratio"])})),
        ("step-3", lambda: rec_step3(R)),
        ("step-4", lambda: rec_simple(R, 4, "step4", lambda r: {"hidden": [{"key": 0, "from": r["chosen"]}]},
                                      lambda r: {"kind": "hide", "key": 0, "from": r["chosen"]})),
        ("step-5", lambda: rec_simple(R, 5, "step5", lambda r: {"heads": [{"floor": L, "head": h, "mult": 0} for L, h in r["heads"]]},
                                      lambda r: {"kind": "heads", "heads": r["heads"], "random": r["random"]},
                                      facts=lambda r: {"count": len(r["heads"])},
                                      extras=[("random", lambda r: {"heads": [{"floor": L, "head": h, "mult": 0} for L, h in r["random"]]})])),
        ("step-6", lambda: rec_step6(R)), ("step-7", lambda: rec_step7(R)), ("step-8", lambda: rec_step8(R)),
        ("step-9", lambda: rec_step9(R)), ("step-10", lambda: rec_step10(R))]
    old = json.loads((APP / "path.json").read_text()) if (APP / "path.json").exists() else {"steps": []}
    for slug, f in jobs:
        if only and slug not in only:
            prev = next((s for s in old["steps"] if s["slug"] == slug), None)
            if prev:
                steps.append(prev)
            continue
        print("==", slug, flush=True)
        s = f()
        if s:
            steps.append(s)
        else:
            print("   not shipping (failed its rule or not curated)", flush=True)
    steps.append({"n": 11, "slug": "step-11", "core": True, "control": {"kind": "tiny"}})
    steps.sort(key=lambda s: s["n"])
    at = R.cur_json("atlas") or {}
    heads, mems = answer_pushers(R)
    c = R.cur_json("concepts") or {"concepts": {}}
    concepts = [{"id": cid, "label": curate.CONCEPTS[cid]["label"], "best_floor": v["best"]["floor"], "working": v["best"]["working"],
                 "breaking": v["best"]["breaking"]} for cid, v in c["concepts"].items() if v.get("best")]
    path = {"manifest_hash": R.man["hash"], "steps": steps,
            "atlas": {"copying": at.get("copying", []), "start_marker": at.get("start_marker", []), "answer_heads": heads or old.get("atlas", {}).get("answer_heads", []),
                      "answer_memory": mems or old.get("atlas", {}).get("answer_memory", [])},
            "concepts": concepts, "swap_pairs": swap_pairs()}
    (APP / "path.json").write_text(json.dumps(path, indent=1))
    print("wrote", APP / "path.json", f"{time.time() - t:.0f}s")


if __name__ == "__main__":
    main()
