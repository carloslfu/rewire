#!/bin/sh
# Phase 0A after the format is chosen: convert, golden traces, curation, final manifest, recordings.
#   sh tools/pipeline.sh <method> <group> <dict-bits> <dict-method> <metrics.json>
set -e
cd "$(dirname "$0")/.."
M=$1; G=$2; DB=$3; DM=$4; METRICS=$5
ID=$(uv run python tools/convert.py --method "$M" --group "$G" --dict-bits "$DB" --dict-method "$DM" --metrics "$METRICS" | tail -1 | python3 -c "import sys,json;print(json.load(sys.stdin)['id'])")
W=../artifacts/weights/$ID
echo "== converted $ID"
uv run python tools/golden.py "$W"
echo "== golden traces written"
uv run python tools/curate.py "$W"
echo "== curated"
uv run python tools/extras.py "$W"
uv run python tools/convert.py --from "$W" --extras "../artifacts/curate/$ID/extras.json"
echo "== final manifest"
uv run python tools/golden.py "$W" concept
uv run python tools/record.py "$W"
echo "== recordings written"
