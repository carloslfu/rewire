"""Recordings (section 7.4): real runs, written once by the reference and played back by the page.

A recording file is 'RWRC', a u32 header length, the UTF-8 JSON header, padding to 4 bytes, then
fixed-size little-endian records. The header lists runs; each run's records are generated words
(GEN layout) and, for a changed run, its model fed the normal reply (FORCED layout), which gives the
underlines and the Difference view on the same words. Featured words carry full floor detail in a
separate safetensors file of half floats, fetched when tapped.

GEN record (P = floors * (heads + 1) + 1 pushes, C = 20 candidates, G = 5 guesses per floor):
  u32 id | f32 lp1 | f32 concept push | u16 cut | u16 flags (1: has guesses)
  C x u32 candidate ids | C x f16 candidate probs | P x f16 pushes | pad to 4
  floors * G x u32 guess ids | floors * G x f16 guess probs | pad to 4
FORCED record: u32 id | f32 lp1 | f32 concept push | P x f16 pushes | pad to 4

lp1 is the token's log-probability at temperature 1 without cuts (comparisons, section 6.2).
"""
from __future__ import annotations

import json
import math
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
import torch

from . import chat
from .conv import FLOORS, VOCAB_REAL
from .ref import Cache, Changes, Model

MAGIC = b"RWRC"
VERSION = 1
NCAND = 20
NGUESS = 5
QH = 16


def _pad4(n: int) -> int:
    return (n + 3) // 4 * 4


def layout(floors: int = FLOORS, heads: int = QH) -> dict:
    P = floors * (heads + 1) + 1
    g = {"id": 0, "lp1": 4, "concept": 8, "cut": 12, "flags": 14, "cand_ids": 16}
    g["cand_probs"] = g["cand_ids"] + 4 * NCAND
    g["pushes"] = g["cand_probs"] + 2 * NCAND
    g["guess_ids"] = _pad4(g["pushes"] + 2 * P)
    g["guess_probs"] = g["guess_ids"] + 4 * floors * NGUESS
    g["size"] = _pad4(g["guess_probs"] + 2 * floors * NGUESS)
    f = {"id": 0, "lp1": 4, "concept": 8, "pushes": 12}
    f["size"] = _pad4(f["pushes"] + 2 * P)
    return {"pushes": P, "floors": floors, "heads": heads, "candidates": NCAND, "guesses": NGUESS, "gen": g, "forced": f}


@dataclass
class Run:
    id: str
    changes: dict
    seed: int
    temperature: float
    messages: list[str]
    turns: list[dict] = field(default_factory=list)  # {prompt_tokens, first, count, ended}
    compare: dict | None = None  # {of, first, count}
    picked: dict | None = None  # {turn, index, id}: the pick was forced here (step 9)


class RecordingWriter:
    def __init__(self, manifest_hash: str, **meta):
        self.lay = layout()
        self.meta = {"manifest_hash": manifest_hash, **meta}
        self.runs: list[Run] = []
        self.gen: list[bytes] = []
        self.forced: list[bytes] = []
        self.ids: set[int] = set()
        self.featured: list[dict] = []

    def _gen_bytes(self, r: dict) -> bytes:
        g = self.lay["gen"]
        b = bytearray(g["size"])
        np.frombuffer(b, np.uint32, 1, g["id"])[:] = r["id"]
        np.frombuffer(b, np.float32, 1, g["lp1"])[:] = r.get("lp1", 0.0)
        np.frombuffer(b, np.float32, 1, g["concept"])[:] = r.get("concept", 0.0)
        np.frombuffer(b, np.uint16, 1, g["cut"])[:] = r["cut"]
        has_g = "guess_ids" in r
        np.frombuffer(b, np.uint16, 1, g["flags"])[:] = 1 if has_g else 0
        cid = np.asarray(r["cand_ids"], np.uint32)[:NCAND]
        cp = np.asarray(r["cand_probs"], np.float32)[:NCAND]
        np.frombuffer(b, np.uint32, len(cid), g["cand_ids"])[:] = cid
        np.frombuffer(b, np.float16, len(cp), g["cand_probs"])[:] = cp
        P = self.lay["pushes"]
        np.frombuffer(b, np.float16, P, g["pushes"])[:] = np.asarray(r["pushes"], np.float32)
        self.ids.update(int(x) for x in cid)
        self.ids.add(int(r["id"]))
        if has_g:
            gi = np.asarray(r["guess_ids"], np.uint32).reshape(-1)
            gp = np.asarray(r["guess_probs"], np.float32).reshape(-1)
            np.frombuffer(b, np.uint32, len(gi), g["guess_ids"])[:] = gi
            np.frombuffer(b, np.float16, len(gp), g["guess_probs"])[:] = gp
            self.ids.update(int(x) for x in gi)
        return bytes(b)

    def _forced_bytes(self, r: dict) -> bytes:
        f = self.lay["forced"]
        b = bytearray(f["size"])
        np.frombuffer(b, np.uint32, 1, f["id"])[:] = r["id"]
        np.frombuffer(b, np.float32, 1, f["lp1"])[:] = r["lp1"]
        np.frombuffer(b, np.float32, 1, f["concept"])[:] = r.get("concept", 0.0)
        np.frombuffer(b, np.float16, self.lay["pushes"], f["pushes"])[:] = np.asarray(r["pushes"], np.float32)
        return bytes(b)

    def add_run(self, rid: str, changes: dict, seed: int, temperature: float, messages: list[str]) -> Run:
        run = Run(rid, changes, seed, temperature, messages)
        self.runs.append(run)
        return run

    def add_turn(self, run: Run, prompt_tokens: list[int], records: list[dict], ended: bool):
        run.turns.append({"prompt_tokens": list(map(int, prompt_tokens)), "first": len(self.gen),
                          "count": len(records), "ended": bool(ended)})
        self.ids.update(int(t) for t in prompt_tokens)
        self.gen += [self._gen_bytes(r) for r in records]

    def add_compare(self, run: Run, of: str, records: list[dict]):
        run.compare = {"of": of, "first": len(self.forced), "count": len(records)}
        self.forced += [self._forced_bytes(r) for r in records]

    def add_featured(self, run: Run, turn: int, index: int, file: str):
        self.featured.append({"run": run.id, "turn": turn, "index": index, "file": file})

    def write(self, path: Path):
        pieces = {str(i): chat.piece(i) for i in sorted(self.ids)}
        head = {"format_version": VERSION, "producer": "python", **self.meta, "layout": self.lay,
                "gen_records": len(self.gen), "forced_records": len(self.forced),
                "runs": [{"id": r.id, "changes": r.changes, "seed": r.seed, "temperature": r.temperature,
                          "messages": r.messages, "turns": r.turns, "compare": r.compare,
                          **({"picked": r.picked} if r.picked else {})} for r in self.runs],
                "featured": self.featured, "pieces": pieces}
        hj = json.dumps(head, separators=(",", ":"), ensure_ascii=False).encode()
        out = bytearray(MAGIC + np.uint32(len(hj)).tobytes() + hj)
        out += b"\0" * (_pad4(len(out)) - len(out))
        for x in self.gen:
            out += x
        for x in self.forced:
            out += x
        path.write_bytes(bytes(out))
        return len(out)


def read(path: Path) -> tuple[dict, np.ndarray, np.ndarray]:
    """Header and the raw GEN and FORCED record bytes (tests and checks)."""
    b = path.read_bytes()
    assert b[:4] == MAGIC
    n = int(np.frombuffer(b, np.uint32, 1, 4)[0])
    head = json.loads(b[8:8 + n])
    off = _pad4(8 + n)
    g, f = head["layout"]["gen"]["size"], head["layout"]["forced"]["size"]
    gen = np.frombuffer(b, np.uint8, head["gen_records"] * g, off).reshape(-1, g)
    off += head["gen_records"] * g
    forced = np.frombuffer(b, np.uint8, head["forced_records"] * f, off).reshape(-1, f)
    return head, gen, forced


@torch.no_grad()
def forced_records(model: Model, prompt: list[int], reply: list[int], ch: Changes, cache: Cache | None = None) -> list[dict]:
    """The model under `ch` fed `reply` after `prompt`: per reply token, its lp1, concept push and pushes."""
    if not reply:
        return []
    c = cache.clone() if cache is not None else Cache()
    p0 = c.length
    toks = list(prompt) + list(reply[:-1])
    cap: dict = {}
    xs = model.run(torch.tensor([toks]), c, ch, capture=cap)
    n = len(reply)
    start = len(prompt) - 1
    rows = torch.arange(start, start + n)
    xf = xs[0, rows]
    t = torch.tensor(reply, device=model.device)
    sc = model.scores(xf, ch).float()
    lp = torch.log_softmax(sc[:, :VOCAB_REAL], -1)
    lp1 = lp[torch.arange(n), t].cpu().numpy()
    u = model.push_vector(xf, t, ch)
    inp = torch.tensor(toks, device=model.device)[rows]
    emb = model.w.dictionary[ch.swap[inp]]
    att = [a[0, rows] for a in cap["att"]]
    mem = [m[0, rows] for m in cap["mem"]]
    pu = model.pushes(u, emb, att, mem, ch).float().cpu().numpy()
    out = []
    for i in range(n):
        cp = float(model.concept_push(u[i:i + 1], ch, p0 + start + i)[0])
        out.append({"id": int(reply[i]), "lp1": float(lp1[i]), "concept": cp, "pushes": pu[i]})
    return out


@torch.no_grad()
def featured_tensors(model: Model, tokens: list[int], position: int, ch: Changes, target: int | None = None) -> dict[str, np.ndarray]:
    """Every value a floor computes for the word read at `position` (the floor view), as float32 arrays.
    tokens: everything read up to and including `position`. With `target` (the word written there), also
    each memory unit's direct push toward it."""
    from .ref import rms
    toks = tokens[:position + 1]
    cap: dict = {}
    xs = model.run(torch.tensor([toks]), Cache(), ch, capture=cap)
    p = position
    out: dict[str, np.ndarray] = {}
    mats = model._effective(ch)
    n_keys = p + 1
    u = model.push_vector(xs[0, p][None], torch.tensor([target], device=model.device), ch)[0] if target is not None else None
    for L in range(FLOORS):
        inter = cap["inter"][L]
        x = cap["stream"][L][0, p]
        h = inter["h"][0, p]
        q_raw = (h @ mats[L]["q"].T)
        k_raw = (h @ mats[L]["k"].T)
        nrm = model.w.norms[L]
        q_n = rms(q_raw.view(QH, -1), nrm["q"]).reshape(-1)
        k_n = rms(k_raw.view(8, -1), nrm["k"]).reshape(-1)
        probs = cap["probs"][L][0][:, p, :n_keys]  # [16, n]
        qr = inter["q"][0, p]  # [16,128] rotated
        K = cap["k"][L][0, :n_keys]  # [n, 8, 128] rotated (pre-half)
        Kx = K.half().float().repeat_interleave(2, dim=1) if model.kv_half else K.repeat_interleave(2, dim=1)
        scores = torch.einsum("hd,shd->hs", qr.float(), Kx.float()) / math.sqrt(qr.shape[-1])
        vals = {
            "x": x, "h": h, "q_raw": q_raw, "k_raw": k_raw, "v": cap["v"][L][0, p].reshape(-1),
            "q_n": q_n, "k_n": k_n, "q": qr.reshape(-1), "k": cap["k"][L][0, p].reshape(-1),
            "scores": scores, "probs": probs, "att": cap["att"][L][0, p].reshape(-1), "o": inter["o"][0, p],
            "mid": inter["mid"][0, p], "h2": inter["h2"][0, p], "gate": inter["gate"][0, p],
            "up": inter["up"][0, p], "act": inter["act"][0, p], "mem": cap["mem"][L][0, p],
        }
        if u is not None:
            # unit j's push: its activity times (down column j . u), scaled like the block's output
            vals["unit_push"] = inter["act"][0, p] * (u @ mats[L]["down"]) * ch.mem[L] * ch.floor[L]
        for k, v in vals.items():
            out[f"f{L}.{k}"] = v.float().cpu().numpy()
    xf = xs[0, p]
    out["final.x"] = xf.float().cpu().numpy()
    out["final.xn"] = rms(xf, model.w.final_norm).float().cpu().numpy()
    sc = model.scores(xf[None], ch)[0].float()
    v, i = sc.topk(64)
    out["final.top_scores"] = v.cpu().numpy()
    out["final.top_ids"] = i.cpu().numpy().astype(np.float32)  # ids stay exact in float32
    return out


def write_featured(path: Path, tensors: dict[str, np.ndarray]):
    """Half floats, except token ids (float32, exact below 2^24)."""
    from safetensors.numpy import save_file
    out = {}
    for k, v in tensors.items():
        out[k] = np.ascontiguousarray(v.astype(np.float32 if k.endswith("_ids") else np.float16))
    save_file(out, str(path))
    return path.stat().st_size
