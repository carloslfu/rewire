---
type: decision
id: 01m7ne0kjtj820pae3xgxm4006
created: 2026-11-17T18:58:51.098007+00:00
updated: 2026-11-17T18:58:51.098007+00:00
summary: Measurements and restoration stay attached to their computation
decided_on: 2026-11-17
evidence: '[[records/measurements/2026-11-17-release-correctness-ux]]'
reversible_if: New model or edit operations require a different identity or checkpoint representation; measured memory and latency justify another inspection-cache bound.
title: Measurements and restoration stay attached to their computation
status: standing
---
# Keep every displayed result attached to the computation that produced it

A reply revision, actual token prefix, model version and selected component identify a measurement. A later pick, Undo, sample update or model switch cannot reuse an unrelated comparison or inspection. Cancelled measurements are retriable; a missing or non-finite measurement remains visibly unavailable. The inspection cache holds at most twelve current-version entries and is cleared when the model or interventions change.

The model's full-vocabulary probability at temperature 1 and the actual post-cut draw odds are distinct values. Both are labeled. Model probability uses bounded two-decimal presentation, while a deterministic single-candidate draw may legitimately be exactly 100%. A manual pick is the visitor's choice, not an event attributed to sampling.

Grow's intact checkpoint consists of weights, step, training corpus and displayed history. Damage operates on a copy; retraining that copy does not replace the intact checkpoint. Restore returns all checkpoint metadata with the weights. Explicit adoption is the action that replaces the intact checkpoint and regenerates its displayed result. A failed continuation keeps the latest available snapshot or exactly the state before the run.

One edit-availability rule governs 2D, 3D and inspector controls. Actions that cannot run explain why. Model recovery describes the model currently visible: a ready Tiny model does not inherit an unrelated Qwen error, but its own unavailable/retrying state remains visible, with progress and recovery controls.

Evidence and regressions: [[records/measurements/2026-11-17-release-correctness-ux]] and [[records/run/2026/11/2026-11-17-release-correctness-ux]]. These rules replace misleading behavior found during the source and live-browser audit. They do not change the local-inference architecture or turn replay into new computation.

Revisit the cache cap if representative measured memory and inspection latency justify another bound. Revisit identity or lineage representation if new model/edit operations cannot be described faithfully by the current keys or checkpoint fields. Preserve the semantic requirements that displayed values describe the selected computation and restoration restores a coherent model state.
