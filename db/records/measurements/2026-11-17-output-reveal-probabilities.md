---
type: measurement
id: 01m7n8jtm69g0gaw3bqbg31359
created: 2026-11-17T17:23:56.678911+00:00
updated: 2026-11-17T17:23:56.678911+00:00
summary: Output reveal timing and full-vocabulary probability verification
date: 2026-11-17
devices: '[[records/devices/dev-mac-m5-pro]]'
note: GPU numerical checks and functional browser replay checks; no timing or physical-phone claim.
phase: '6'
runs: '[[records/run/2026/11/2026-11-17-output-reveal-probabilities]]'
title: Output reveal timing and full-vocabulary probability verification
status: measured
---
# Output reveal and probability correction

The output block previously showed the written token during the first replay step and rounded its sampling figure to 100%. The live before-check showed `. 100%` while the scrubber was at step 1, and `The 100%` beside a readout that said the model gave it 99%. Evidence is preserved in [[records/run/2026/11/2026-11-17-output-reveal-probabilities]].

The corrected 3D display uses the model's full-vocabulary probability at temperature 1. Selected-token bars use exp(lp1); alternative candidates use the log probabilities returned by the existing logsumexp pass. No new inference pass or invented intermediate confidence is used. The sampler and its output remain unchanged.

## Verification

The final release gate passed 223 app tests across 21 files, two engine lifecycle tests, all workspace type checks, the production build and pinned-model deployment check. Actual GPU suites passed 44 engine tests across seven files and ten tiny-model tests across three files, sequentially with the Node heap capped. The GPU suite checks candidate probabilities against a double-precision softmax of the GPU's own scores, different temperatures, all existing change specs, forced tokens outside the candidate list, padded vocabulary slots and unchanged existing result fields. The subsequent review changed only engine comments, so those GPU results apply to the final kernel.

App regressions cover all pre-output steps for Qwen and Tiny, final reveal, backward scrubbing, synchronous hiding before a frame, initial-label paint prevention, full-identity token delivery across replies and samples, returning to the same delivered token, live immediacy, probability conversion and formatting. The implementation and review used actual Claude Code with `claude-fable-5-2`.

## Browser checks

Chrome used the production-CSP built preview on [[records/devices/dev-mac-m5-pro]]. Real Qwen inference returned `The capital of France is Paris.` in the 2D view, and Replay in 3D opened its whole-answer replay. The output read Not chosen yet at step 1 and on backward scrubbing to step 57. At completion it showed `The 99.40%` and `Paris 98.78%`, agreeing with the replay readout. Frame-by-frame DOM sampling across token boundaries recorded no result labels before the final step. The most certain token was bounded as `capital >99.99%`, not rounded to an exact 100%.

Flipping Layer 21 Head 14 still generated Washington, D.C. Switching from the original Paris token to Washington at the same token index showed the changed result at 95.24%, matching the readout. Reduced-motion mode hid the result at the first step and revealed it at completion. Back to live showed the newest generated token immediately. Restoring the model restored the original reply.

At 390 CSS pixels, pending and result labels worked and no document horizontal overflow was found. The result label fit inside the width after fitting the model. One intermediate screenshot followed a scroll gesture over the canvas that changed the camera and moved the model out of view; Fit restored it. Responsive remounts end the old replay and return to live, as before. This is viewport emulation, not physical-phone qualification.

A newly trained tiny model was also opened in the full lab. Its 160-token live reply completed, step 1 hid every output result, and step 10 revealed `z 99.42%`. Frame sampling across subsequent tiny-model tokens found no early result labels, with `o 99.98%` and `r 99.98%` correctly remaining equal at displayed precision. No application errors were captured; the console contained only pre-existing extension messages.

## Limits

Replay illustrates cached computation in order; it does not rerun the model. The already-written reply and the selected-token transport label remain visible as navigation context. Percentages are revealed only at output, not animated during earlier layers. Equal or nearly certain probabilities can legitimately display the same bounded value. The 2D candidate picker retains its sampling-temperature, top-20 values; its explanatory copy and tower accessible label identify this separate measure. No throughput or frame-rate claim is made. Deployment is verified after commit and push.
