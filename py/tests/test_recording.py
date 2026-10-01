"""Recordings round-trip, and a fixture for the page's reader test (app/test/recording.test.ts)."""
import json

import numpy as np

from rewire.conv import ARTIFACTS
from rewire.recording import RecordingWriter, layout, read


def fake_records(n, rng, guesses=True):
    lay = layout()
    out = []
    for i in range(n):
        r = {"id": int(rng.integers(0, 151000)), "lp1": float(-rng.random()), "concept": float(rng.normal()),
             "cut": int(rng.integers(1, 20)), "cand_ids": rng.integers(0, 151000, 20), "cand_probs": rng.random(20) / 20,
             "pushes": rng.normal(size=lay["pushes"]).astype(np.float32)}
        if guesses:
            r["guess_ids"] = rng.integers(0, 151000, (28, 5))
            r["guess_probs"] = rng.random((28, 5))
        out.append(r)
    return out


def test_roundtrip(tmp_path):
    rng = np.random.default_rng(0)
    w = RecordingWriter("abc123", step="test")
    normal = fake_records(5, rng)
    run = w.add_run("normal", {}, 11, 0.7, ["Hello?"])
    w.add_turn(run, [151644, 8948, 198], normal, ended=True)
    changed = fake_records(4, rng, guesses=False)
    run2 = w.add_run("changed", {"floors": [{"floor": 0, "mult": 0}]}, 11, 0.7, ["Hello?"])
    w.add_turn(run2, [151644, 8948, 198], changed, ended=False)
    forced = [{"id": r["id"], "lp1": -0.5, "concept": 0.0, "pushes": r["pushes"]} for r in normal]
    w.add_compare(run2, "normal", forced)
    path = tmp_path / "t.rwr"
    w.write(path)
    head, gen, fz = read(path)
    g = head["layout"]["gen"]
    assert head["gen_records"] == 9 and head["forced_records"] == 5
    assert head["runs"][1]["compare"] == {"of": "normal", "first": 0, "count": 5}
    first = gen[0]
    assert int(np.frombuffer(first[g["id"]:g["id"] + 4], np.uint32)[0]) == normal[0]["id"]
    pushes = np.frombuffer(first[g["pushes"]:g["pushes"] + 2 * head["layout"]["pushes"]], np.float16)
    assert np.allclose(pushes, normal[0]["pushes"], atol=2e-3, rtol=1e-3)
    # fixture for the page's reader
    fx = ARTIFACTS / "test"
    fx.mkdir(parents=True, exist_ok=True)
    (fx / "fixture.rwr").write_bytes(path.read_bytes())
    (fx / "fixture.json").write_text(json.dumps({
        "normal_ids": [r["id"] for r in normal], "changed_ids": [r["id"] for r in changed],
        "normal_cut": [r["cut"] for r in normal], "first_pushes": [float(x) for x in normal[0]["pushes"][:10]],
        "first_guess": [int(normal[0]["guess_ids"][0][0]), float(normal[0]["guess_probs"][0][0])],
        "first_lp1": normal[0]["lp1"], "forced_lp1": -0.5}))
