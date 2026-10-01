"""Curation results the converter adds to the manifest: rho, the atlas and the built-in concepts.

  uv run python tools/extras.py artifacts/weights/<id>   # writes artifacts/curate/<id>/extras.json
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from rewire.conv import ARTIFACTS  # noqa: E402
import curate  # noqa: E402


def main():
    wid = Path(sys.argv[1]).name
    d = ARTIFACTS / "curate" / wid
    at = json.loads((d / "atlas.json").read_text())
    c = json.loads((d / "concepts.json").read_text())
    concepts = [{"id": cid, "label": curate.CONCEPTS[cid]["label"], "best_floor": v["best"]["floor"],
                 "working": v["best"]["working"], "breaking": v["best"]["breaking"]}
                for cid, v in c["concepts"].items() if v.get("best")]
    extras = {"rho": c["rho"], "atlas": {"copying": at["copying"], "start_marker": at["start_marker"]},
              "concepts": concepts, "concept_vectors": {k["id"]: c["vectors"][k["id"]] for k in concepts}}
    (d / "extras.json").write_text(json.dumps(extras))
    print(json.dumps({"concepts": [k["id"] for k in concepts], "copying": len(at["copying"]), "start_marker": len(at["start_marker"])}))


if __name__ == "__main__":
    main()
