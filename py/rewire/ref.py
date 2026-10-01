"""The PyTorch reference: Qwen3-0.6B computed in the engine's kernel order, with every
change of section 7.2, the pushes, the floor guesses and the captures the engine is
checked against. Float32 by default (float64 on the CPU for the 64-bit reference).
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field

import numpy as np
import torch
from safetensors import safe_open

from . import quant
from .conv import (EPS, FLOORS, HD, KVH, QH, THETA, TOK, UNITS, VOCAB_REAL, VOCAB_ROWS, WIDTH,
                   default_device, model_dir)
from .sampler import draw

MATS = ("q", "k", "v", "o", "gate", "up", "down")
HF = {"q": "self_attn.q_proj", "k": "self_attn.k_proj", "v": "self_attn.v_proj", "o": "self_attn.o_proj",
      "gate": "mlp.gate_proj", "up": "mlp.up_proj", "down": "mlp.down_proj"}


@dataclass
class Quant:
    method: str = "rtn"  # rtn | rtn-sym | clip | given
    group: int = 64
    dict_bits: int = 16  # 16 keeps the original dictionary; 8 or 4 quantize it with the same group


class Weights:
    """Model weights. `quant=None` is the original 16-bit model (bfloat16 values in float32 math)."""

    def __init__(self, device: str | None = None, dtype=torch.float32, quant_cfg: Quant | None = None,
                 packed: dict | None = None, base: "Weights | None" = None):
        self.device = device or (base.device if base else default_device())
        self.dtype = dtype
        self.quant_cfg = quant_cfg
        if base is not None:  # share the original tensors with an already loaded model
            self.embed_orig, orig = base.embed_orig, base.orig
            self.final_norm = base.final_norm.to(self.device, dtype)
            self.norms = [{k: v.to(self.device, dtype) for k, v in n.items()} for n in base.norms]
        else:
            f = safe_open(str(model_dir() / "model.safetensors"), framework="pt")
            get = lambda n: f.get_tensor(n).to(torch.float32)  # noqa: E731
            self.embed_orig = get("model.embed_tokens.weight")
            self.final_norm = get("model.norm.weight").to(self.device, dtype)
            self.norms = []
            orig = []
            for L in range(FLOORS):
                p = f"model.layers.{L}."
                self.norms.append({
                    "in": get(p + "input_layernorm.weight").to(self.device, dtype),
                    "post": get(p + "post_attention_layernorm.weight").to(self.device, dtype),
                    "q": get(p + "self_attn.q_norm.weight").to(self.device, dtype),
                    "k": get(p + "self_attn.k_norm.weight").to(self.device, dtype),
                })
                orig.append({m: get(p + HF[m] + ".weight") for m in MATS})
        self.packed = packed  # name -> (codes, scale16, offset16), filled when quantized
        if quant_cfg is not None and packed is None:
            self.packed = {}
            for L in range(FLOORS):
                for m in MATS:
                    self.packed[(L, m)] = self._quantize(orig[L][m].to(self.device), quant_cfg)
            if quant_cfg.dict_bits < 16:
                self.packed["dict"] = self._quantize(self.embed_orig.to(self.device), quant_cfg, quant_cfg.dict_bits)
        self.orig = orig
        self._mats: dict[int, list[dict]] = {}
        if self.packed is not None and "dict" in self.packed:
            c, s, o = self.packed["dict"]
            self.dictionary = self._dequant_dict(c, s, o).to(self.device, dtype)
        else:
            self.dictionary = self.embed_orig.to(self.device, dtype)
        self.mean_row = self.dictionary[:VOCAB_REAL].cpu().double().mean(0).to(self.device, dtype)
        rope_cos, rope_sin = rope_table(4096)
        self.rope_cos, self.rope_sin = rope_cos.to(self.device, dtype), rope_sin.to(self.device, dtype)

    def _quantize(self, w, cfg: Quant, bits: int = 4):
        if bits == 8:
            return quant8(w, cfg.group)
        if cfg.method == "rtn":
            return quant.quantize_rtn(w, cfg.group)
        if cfg.method == "rtn-sym":
            return quant.quantize_rtn(w, cfg.group, symmetric=True)
        if cfg.method == "clip":
            return quant.quantize_clip_search(w, cfg.group)
        raise ValueError(cfg.method)

    def _dequant_dict(self, c, s, o):
        if self.quant_cfg.dict_bits == 8:
            return dequant8(c, s, o, self.quant_cfg.group)
        return quant.dequantize(c, s, o, self.quant_cfg.group)

    def mats(self, bits: int = 4) -> list[dict]:
        """Matrices inside the floors, dequantized through the bits table (cached per width)."""
        if bits not in self._mats:
            for b in [b for b in self._mats if b != 4]:  # keep at most one squeezed width alive
                del self._mats[b]
            if self.packed is None:
                self._mats[bits] = [{m: self.orig[L][m].to(self.device, self.dtype) for m in MATS} for L in range(FLOORS)]
            else:
                self._mats[bits] = [{m: quant.dequantize(*self.packed[(L, m)], self.quant_cfg.group, bits)
                                     .to(self.device, self.dtype) for m in MATS} for L in range(FLOORS)]
        return self._mats[bits]

    def drop_cache(self, keep: int = 4):
        for b in list(self._mats):
            if b != keep:
                del self._mats[b]


def quant8(w, group):
    g = w.float().reshape(w.shape[0], w.shape[1] // group, group)
    lo, hi = g.amin(-1), g.amax(-1)
    s16, o16 = ((hi - lo) / 255).to(torch.float16), lo.to(torch.float16)
    s = s16.float().unsqueeze(-1)
    c = torch.round((g - o16.float().unsqueeze(-1)) / torch.where(s == 0, torch.ones_like(s), s)).clamp(0, 255)
    return c.to(torch.uint8).reshape(w.shape), s16, o16


def dequant8(c, s16, o16, group):
    out, inp = c.shape
    w = o16.float().unsqueeze(-1) + s16.float().unsqueeze(-1) * c.float().reshape(out, inp // group, group)
    return w.reshape(out, inp)


def rope_table(n: int):
    """Position rotation computed in 64-bit floats, then rounded (rotate-half layout)."""
    inv = 1.0 / (THETA ** (torch.arange(0, HD, 2, dtype=torch.float64) / HD))
    ang = torch.arange(n, dtype=torch.float64)[:, None] * inv[None, :]
    ang = torch.cat([ang, ang], dim=-1)
    return torch.cos(ang), torch.sin(ang)


@dataclass
class Changes:
    head: torch.Tensor  # [28, 16]
    mem: torch.Tensor  # [28]
    floor: torch.Tensor  # [28]
    swap: torch.Tensor  # [VOCAB_ROWS] long
    hidden: list = field(default_factory=list)  # [(key, from)]
    zeroed: list = field(default_factory=list)  # [(floor, tensor, row, col)]
    bits: int = 4
    concept: tuple | None = None  # (floor, strength, vector[1024], first position)
    spec: dict = field(default_factory=dict)

    @staticmethod
    def make(spec: dict | None, device, dtype=torch.float32, concepts: dict | None = None, rho=None,
             concept_from: int = 0) -> "Changes":
        spec = spec or {}
        head = torch.ones(FLOORS, QH, dtype=dtype)
        for h in spec.get("heads", []):
            head[h["floor"], h["head"]] = h["mult"]
        mem = torch.ones(FLOORS, dtype=dtype)
        for m in spec.get("memory", []):
            mem[m["floor"]] = m["mult"]
        flo = torch.ones(FLOORS, dtype=dtype)
        for m in spec.get("floors", []):
            flo[m["floor"]] = m["mult"]
        swap = torch.arange(VOCAB_ROWS)
        for a, b in spec.get("swaps", []):
            swap[a], swap[b] = b, a
        concept = None
        c = spec.get("concept")
        if c:
            vec = concepts[c["id"]]
            if isinstance(vec, (list, tuple)):  # one unit vector per floor
                vec = vec[c["floor"]]
            concept = (c["floor"], float(c["strength"]) * float(rho[c["floor"]]), vec.to(device, dtype), concept_from)
        return Changes(head.to(device), mem.to(device), flo.to(device), swap.to(device),
                       [(h["key"], h["from"]) for h in spec.get("hidden", [])],
                       [(z["floor"], z["tensor"], z["row"], z["col"]) for z in spec.get("zeroed", [])],
                       spec.get("bits", 4), concept, spec)


class Cache:
    def __init__(self):
        self.k: list = [None] * FLOORS
        self.v: list = [None] * FLOORS
        self.length = 0

    def append(self, L, k, v):
        self.k[L] = k if self.k[L] is None else torch.cat([self.k[L], k], 1)
        self.v[L] = v if self.v[L] is None else torch.cat([self.v[L], v], 1)

    def expand(self, b):
        for L in range(FLOORS):
            self.k[L] = self.k[L].expand(b, *self.k[L].shape[1:]).contiguous()
            self.v[L] = self.v[L].expand(b, *self.v[L].shape[1:]).contiguous()

    def rewind(self, n):
        for L in range(FLOORS):
            self.k[L] = self.k[L][:, :n].contiguous()
            self.v[L] = self.v[L][:, :n].contiguous()
        self.length = n

    def clone(self):
        c = Cache()
        c.k = [t.clone() for t in self.k]
        c.v = [t.clone() for t in self.v]
        c.length = self.length
        return c


def rms(x, w):
    x32 = x
    r = torch.rsqrt(x32.pow(2).mean(-1, keepdim=True) + EPS)
    return x32 * r * w


class Model:
    def __init__(self, weights: Weights, kv_half: bool = True):
        self.w = weights
        self.device = weights.device
        self.dtype = weights.dtype
        self.kv_half = kv_half  # the engine keeps keys and values as half floats

    def _effective(self, ch: Changes) -> list[dict]:
        mats = self.w.mats(ch.bits)
        if not ch.zeroed:
            return mats
        mats = [dict(m) for m in mats]
        for L, t, r, c in ch.zeroed:
            mats[L][t] = mats[L][t].clone()
            mats[L][t][r, c] = 0
        return mats

    def run(self, tokens: torch.Tensor, cache: Cache, ch: Changes, capture: dict | None = None) -> torch.Tensor:
        """Read `tokens` [B, T] after the cache; return the final stream [B, T, 1024] before the
        final normalization. `capture` collects per-floor values when given."""
        B, T = tokens.shape
        p0 = cache.length
        dev, dt = self.device, self.dtype
        mats = self._effective(ch)
        ids = ch.swap[tokens.to(dev)]
        x = self.w.dictionary[ids]
        pos = torch.arange(p0, p0 + T, device=dev)
        cos, sin = self.w.rope_cos[pos][None, :, None, :], self.w.rope_sin[pos][None, :, None, :]
        tot = p0 + T
        kpos = torch.arange(tot, device=dev)
        mask = kpos[None, :] <= pos[:, None]
        for key, frm in ch.hidden:
            mask = mask & ~((kpos[None, :] == key) & (pos[:, None] >= frm))
        if capture is not None:
            capture.setdefault("embed", []).append(x)
        for L in range(FLOORS):
            if ch.concept is not None and ch.concept[0] == L:
                _, s, vec, first = ch.concept
                add = (pos >= first).to(dt)[None, :, None] * (s * vec)[None, None, :]
                x = x + add
            if capture is not None:
                capture.setdefault("stream", []).append(x)
            a = ch.floor[L]
            n = self.w.norms[L]
            m = mats[L]
            h = rms(x, n["in"])
            q = (h @ m["q"].T).view(B, T, QH, HD)
            k = (h @ m["k"].T).view(B, T, KVH, HD)
            v = (h @ m["v"].T).view(B, T, KVH, HD)
            q = rms(q, n["q"])
            k = rms(k, n["k"])
            q = q * cos + rot(q) * sin
            k = k * cos + rot(k) * sin
            cache.append(L, k.half(), v.half()) if self.kv_half else cache.append(L, k, v)
            K = cache.k[L].to(dt)
            V = cache.v[L].to(dt)
            Kx = K.repeat_interleave(QH // KVH, dim=2)
            Vx = V.repeat_interleave(QH // KVH, dim=2)
            sc = torch.einsum("bthd,bshd->bhts", q, Kx) / math.sqrt(HD)
            sc = sc.masked_fill(~mask[None, None], float("-inf"))
            mx = sc.amax(-1, keepdim=True)
            any_ = torch.isfinite(mx)
            pr = torch.exp(sc - torch.where(any_, mx, torch.zeros_like(mx)))
            pr = torch.where(any_, pr / pr.sum(-1, keepdim=True), torch.zeros_like(pr))
            att = torch.einsum("bhts,bshd->bthd", pr, Vx)
            att = att * ch.head[L][None, None, :, None]
            o = att.reshape(B, T, QH * HD) @ m["o"].T
            mid = x + a * o
            h2 = rms(mid, n["post"])
            g = h2 @ m["gate"].T
            u = h2 @ m["up"].T
            act = torch.nn.functional.silu(g) * u
            mo = (act @ m["down"].T) * ch.mem[L]
            x = mid + a * mo
            if capture is not None:
                capture.setdefault("att", []).append(att)
                capture.setdefault("mem", []).append(mo)
                capture.setdefault("probs", []).append(pr)
                capture.setdefault("k", []).append(k)
                capture.setdefault("v", []).append(v)
                capture.setdefault("inter", []).append({"h": h, "q": q, "o": o, "mid": mid, "h2": h2, "gate": g, "up": u, "act": act})
        cache.length = tot
        if capture is not None:
            capture.setdefault("stream", []).append(x)
        return x

    def scores(self, xf: torch.Tensor, ch: Changes) -> torch.Tensor:
        """Final scores [.., VOCAB_ROWS] through the swap map, unused rows masked."""
        xn = rms(xf, self.w.final_norm)
        s = xn @ self.w.dictionary.T
        s = s[..., ch.swap]
        s[..., VOCAB_REAL:] = float("-inf")
        return s

    def guesses(self, streams: list[torch.Tensor], ch: Changes, k: int = 5):
        """Floor guesses: each floor's output through the final normalization and dictionary.
        streams: list of 28 tensors [N, 1024] (stream after floor L). Returns ids [N,28,k], probs."""
        st = torch.stack(streams, 1)
        sc = self.scores(st, ch)
        lp = torch.log_softmax(sc.float(), -1)
        v, i = lp.topk(k, -1)
        return i, v.exp()

    def push_vector(self, xf: torch.Tensor, t: torch.Tensor, ch: Changes) -> torch.Tensor:
        """u such that a part's push toward t is (part output) . u. xf [N,1024], t [N]."""
        r = torch.rsqrt(xf.pow(2).mean(-1, keepdim=True) + EPS)
        row = self.w.dictionary[ch.swap[t]] - self.w.mean_row
        return row * self.w.final_norm * r

    def pushes(self, u: torch.Tensor, embed_row: torch.Tensor, att: list, mem: list, ch: Changes) -> torch.Tensor:
        """477 pushes per row: dictionary row, then per floor 16 heads and the memory block.
        att[L]: [N, 16, 128] head outputs after head multipliers; mem[L]: [N, 1024]."""
        mats = self._effective(ch)
        out = [(embed_row * u).sum(-1, keepdim=True)]
        for L in range(FLOORS):
            a = ch.floor[L]
            g = u @ mats[L]["o"]  # [N, 2048]
            hp = (att[L] * g.view(-1, QH, HD)).sum(-1) * a
            mp = (mem[L] * u).sum(-1, keepdim=True) * a
            out += [hp, mp]
        return torch.cat(out, -1)

    def concept_push(self, u, ch: Changes, position: int):
        if ch.concept is None or position < ch.concept[3]:
            return torch.zeros(u.shape[0], device=u.device, dtype=u.dtype)
        _, s, vec, _ = ch.concept
        return (s * vec * u).sum(-1)


def rot(x):
    h = x.shape[-1] // 2
    return torch.cat([-x[..., h:], x[..., :h]], -1)


@dataclass
class Reply:
    seed: int
    tokens: list
    records: list  # per token: dict(id, cand_ids, cand_probs, cut, pushes?, guesses?)


def sample_rows(scores: torch.Tensor, seeds, turn: int, step: int, temperature: float = 0.7, top_k: int = 20,
                top_p: float = 0.8):
    """Sampler of section 7.3 for a batch of score rows (one per seed)."""
    t = scores.float() / temperature
    vals, idx = t.topk(top_k + 8, -1)
    vals, idx = vals.cpu().numpy(), idx.cpu().numpy()
    out = []
    for b, seed in enumerate(seeds):
        order = np.lexsort((idx[b], -vals[b]))[:top_k]
        ids, sel = idx[b][order], vals[b][order].astype(np.float32)
        m = np.float32(sel.max())
        e = np.exp((sel - m).astype(np.float32)).astype(np.float32)
        tot = np.float32(0)
        for x in e:
            tot = np.float32(tot + x)
        probs = (e / tot).astype(np.float32)
        o2 = np.lexsort((ids, -probs))
        ids, probs = ids[o2], probs[o2]
        acc, cut = np.float32(0), len(ids)
        for i, x in enumerate(probs):
            acc = np.float32(acc + x)
            if acc >= np.float32(top_p):
                cut = i + 1
                break
        kept = probs[:cut]
        ks = np.float32(0)
        for x in kept:
            ks = np.float32(ks + x)
        target = np.float32(draw(seed, turn, step) * ks)
        acc, pick = np.float32(0), cut - 1
        for i, x in enumerate(kept):
            acc = np.float32(acc + x)
            if acc > target:
                pick = i
                break
        out.append((int(ids[pick]), ids, probs, cut))
    return out


def generate(model: Model, prompt: list[int], ch: Changes, seeds: list[int], turn: int = 0, cap: int = 64,
             cache: Cache | None = None, temperature: float = 0.7):
    """Write one reply per seed after `prompt` (read on top of `cache` if given). Returns the replies and
    the cache after the prompt (batch 1)."""
    stop = set(TOK["stop"])
    base = cache.clone() if cache is not None else Cache()
    xf = model.run(torch.tensor([prompt]), base, ch)
    after_prompt = base.clone()
    B = len(seeds)
    base.expand(B)
    last = xf[:, -1].expand(B, -1)
    done = [False] * B
    toks = [[] for _ in range(B)]
    p_first = (cache.length if cache is not None else 0) + len(prompt) - 1
    for step in range(cap):
        sc = model.scores(last, ch)
        lp_all = torch.log_softmax(sc.float(), -1)
        picks = sample_rows(sc, seeds, turn, step, temperature)
        for b in range(B):
            if not done[b]:
                toks[b].append(picks[b][0])
                if picks[b][0] in stop:
                    done[b] = True
        if all(done) or step == cap - 1:
            break
        nxt = torch.tensor([p[0] for p in picks])
        last = model.run(nxt[:, None], base, ch)[:, -1]
    return [Reply(seeds[b], toks[b], []) for b in range(B)], after_prompt


def generate_recorded(model: Model, prompt: list[int], ch: Changes, seeds: list[int], turn: int = 0, cap: int = 64,
                      guesses: bool = True, cache: Cache | None = None, temperature: float = 0.7, step0: int = 0):
    """Like generate(), with pushes and floor guesses for every reply token, including the first."""
    stop = set(TOK["stop"])
    base = cache.clone() if cache is not None else Cache()
    capd: dict = {}
    xf = model.run(torch.tensor([prompt]), base, ch, capture=capd)
    after_prompt = base.clone()
    B = len(seeds)
    base.expand(B)
    info = {"att": [a[:, -1].expand(B, -1, -1) for a in capd["att"]],
            "mem": [m[:, -1].expand(B, -1) for m in capd["mem"]],
            "after": [s[:, -1].expand(B, -1) for s in capd["stream"][1:]]}
    last = xf[:, -1].expand(B, -1)
    last_input = torch.tensor([prompt[-1]] * B)
    done = [False] * B
    toks = [[] for _ in range(B)]
    recs = [[] for _ in range(B)]
    p_first = (cache.length if cache is not None else 0) + len(prompt) - 1
    for step in range(cap):
        sc = model.scores(last, ch)
        lp_all = torch.log_softmax(sc.float(), -1)
        picks = sample_rows(sc, seeds, turn, step0 + step, temperature)
        nxt = torch.tensor([p[0] for p in picks])
        u = model.push_vector(last, nxt.to(model.device), ch)
        emb = model.w.dictionary[ch.swap[last_input.to(model.device)]]
        pu = model.pushes(u, emb, info["att"], info["mem"], ch)
        gi, gp = model.guesses(info["after"], ch) if guesses else (None, None)
        for b in range(B):
            if done[b]:
                continue
            tid = picks[b][0]
            toks[b].append(tid)
            r = {"id": tid, "cand_ids": picks[b][1], "cand_probs": picks[b][2], "cut": picks[b][3],
                 "pushes": pu[b].float().cpu().numpy(), "lp1": float(lp_all[b, tid]),
                 "concept": float(model.concept_push(u[b:b + 1], ch, p_first + step)[0])}
            if guesses:
                r["guess_ids"] = gi[b].cpu().numpy()
                r["guess_probs"] = gp[b].float().cpu().numpy()
            recs[b].append(r)
            if tid in stop:
                done[b] = True
        if all(done) or step == cap - 1:
            break
        c2: dict = {}
        xs = model.run(nxt[:, None], base, ch, capture=c2)
        last = xs[:, -1]
        last_input = nxt
        info = {"att": [a[:, -1] for a in c2["att"]], "mem": [m[:, -1] for m in c2["mem"]],
                "after": [s[:, -1] for s in c2["stream"][1:]]}
    return [Reply(seeds[b], toks[b], recs[b]) for b in range(B)], after_prompt


def reply_logprobs(model: Model, prompt: list[int], reply: list[int], ch: Changes) -> torch.Tensor:
    """Log-probabilities of a reply's tokens at temperature 1 without cuts (comparisons)."""
    c = Cache()
    xs = model.run(torch.tensor([prompt + reply]), c, ch)
    sc = model.scores(xs[0, len(prompt) - 1: len(prompt) + len(reply) - 1], ch)
    lp = torch.log_softmax(sc.float(), -1)
    return lp[torch.arange(len(reply)), torch.tensor(reply, device=lp.device)]
