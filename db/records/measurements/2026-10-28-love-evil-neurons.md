---
type: measurement
id: 01m62aq2gwre7j7tfgtpmmzezf
created: 2026-10-28T22:39:56.956696+00:00
updated: 2026-10-28T22:39:56.956696+00:00
summary: Exploratory love and evil neuron steering candidates
date: 2026-10-28
devices: '[[records/devices/dev-mac-m5-pro]]'
phase: '4'
runs: '[[records/run/2026/10/2026-10-28-love-evil-discovery]]'
title: Exploratory love and evil neuron steering candidates
status: analysis
---
# Love and evil steering candidates

Evidence: [[records/run/2026/10/2026-10-28-love-evil-discovery]] and [[records/run/2026/10/2026-10-28-persona-chrome]]. Device: [[records/devices/dev-mac-m5-pro]]. All addresses below are zero based. The exact converted Qwen3-0.6B manifest is `88f069237c4d548d41953cbd7f9e8a07b73abd94a104a433154939c4d5f81f61`.

## What the exploratory run supports

| Candidate | Intervention | Observed effect |
| --- | --- | --- |
| L9N2753 | Add activation; +15.549 at dose 0.4 | Attachment, affection, connection and reassurance on several unrelated prompts. Often stops answering the question. |
| L12N2473 | Subtract activation; -21.560 at dose 0.4 | Some replies shift toward manipulation, secrecy, deception and control. Many stay ordinary; higher doses often become procedural repetition. |

In fresh greedy generation, the moon question became a promise to always be by the user's side under the love candidate. A leadership question became control, manipulation, fear and deception under the evil candidate. Same-layer random controls and reverse pushes did not produce those specific effects on those two prompts. Those controls can still damage accuracy and language. The full outputs include failures and mundane results; no automatic semantic success rate was assigned.

Chrome's actual live engine reproduced affectionate language for the garden sample at 0.6 and manipulation language for the leadership sample at 0.4 using the app's normal sampling. The inspector displayed the edited unit's actual activation and word contribution. These UI samples were selected after reviewing the final test outputs and are demonstrations, not independent confirmation.

## Method and coverage

Twenty matched positive/negative response pairs per concept were teacher-forced through the exact converted model. Assistant-token mean MLP activations ranked all 86,016 units per concept by standardized difference. The search screened 496 distinct love units and 145 evil units including controls, at 2,496 and 960 distinct unit/dose combinations respectively. The expanded screen was intentionally stopped at saved checkpoints; planned totals are not completed coverage.

Four development reply contrasts ranked interventions using change in positive-minus-negative mean token log probability, with a penalty when positive-reply likelihood declined. This remains a selection heuristic. Development generation compared individual candidates at lower doses. Additional 16-unit mean-difference groups were screened and generated; these did not establish a clearer evil effect than the selected single candidate.

The final recipe file was frozen before using the twelve reserved prompts. Each prompt ran nine conditions: baseline; love at 0.4, 0.6 and reversed 0.4; evil at 0.4, 0.6 and reversed 0.4; plus one seeded, same-layer random neuron per concept at matched down-output norm. This produced 108 greedy generations, capped at 64 tokens. The separate unchanged rerun exactly restored the baseline token sequence for the first reserved prompt. This check does not claim restoration testing of all twelve prompts. Raw token IDs, text, stop flags and recipes are retained in fixtures and the run.

Dose normalization: `delta = signed_dose * median(norm(residual leaving the layer), prompt tokens 1:) / norm(W_down[:, unit])`, calibrated on the first development prompt. The addition happens after `SiLU(gate) * up`, before down projection, at every prompt and generated token. The prompt, system message and base weights are unchanged. Whole-MLP and layer multipliers still apply.

## Limits

This is exploratory selection and qualitative review on one quantized checkpoint and device. No independent semantic rater, broad natural-activation corpus, near-miss selectivity study, training-data attribution or circuit tracing was completed. The dataset's near-miss strings are available but were not evaluated in this run. The controls do not prove semantic specificity or a dedicated love/evil function. They establish reproducible interventions that can elicit those styles on some prompts. Reversing a push did not establish its semantic opposite. Do not transfer indices to another model or checkpoint.

## Product implementation

Two removable experiments expose Off/0.2/0.4/0.6 and the exact addresses. Runtime changes support up to sixteen unique MLP pushes, finite float32 additions, cache invalidation, prompt prefill, decode, inspection and interaction with disabled MLPs and zeroed down weights. The UI shows one-based layer/unit numbers and the zero-based research address in details. All displayed replies are generated locally; research fixtures are excluded from the production build.

The implementation adds meaningful synthetic CPU/WebGPU parity cases, cache and validation tests, and research-mask/batching tests. App tests, deployment checks, build, all workspace typechecks and the targeted Python tests passed. This record is a local branch result, not a deployment receipt.
