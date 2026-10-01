---
type: measurement
id: 01m3wjj5wwn11wd40ks4kkmx4g
created: 2026-10-01T20:30:14.940644+00:00
updated: 2026-10-01T20:42:48.098230+00:00
summary: 'Launch-readiness continuation: downloads, recovery and phone layout'
date: 2026-10-01
devices: '[[records/devices/dev-mac-m5-pro]]'
phase: '5'
runs: '[[records/run/2026/10/2026-10-01-continuation-checks]], [[records/run/2026/10/2026-10-01-release-preflight]], [[records/run/2026/10/2026-10-01-browser-fallbacks]], [[records/run/2026/10/2026-10-01-phone-layout]]'
title: 'Launch-readiness continuation: downloads, recovery and phone layout'
status: measured
---
# Launch-readiness continuation (October 1, 2026)

Evidence: [[records/run/2026/10/2026-10-01-continuation-checks]], [[records/run/2026/10/2026-10-01-release-preflight]], [[records/run/2026/10/2026-10-01-browser-fallbacks]] and [[records/run/2026/10/2026-10-01-phone-layout]].

The current regression suite passes: 25 engine tests, 5 tiny-model tests and 16 app tests. The final production build and TypeScript checks pass. Nine golden engine cases remain within their existing tolerances; this continuation changes lifecycle and loading, not inference math.

The release preflight checks all 23 chunks (373,100,544 weight bytes), tokenizer JSON, licenses and all ten path recordings against manifest `88f069237c4d548d41953cbd7f9e8a07b73abd94a104a433154939c4d5f81f61`. Total model download including tokenizers is 384,532,930 bytes. There are eleven path steps; the final one trains the tiny model.

**Browser checks.** Chrome on the development Mac, with the production build served under its `_headers` security policy. The unavailable-GPU fixture plays recorded normal and changed replies. The previous-crash fixture starts in Replay and its explicit retry reaches Live. Refused Cache Storage reaches Live with a visible session-only notice. A same-size corrupt cached chunk is evicted, fetched and rechecked; the fixture independently confirms the repaired cache hash.

A simulated GPU-loss notification during a live reply cancels pending work and replaces the real worker. Its partial reply remains on screen; after recovery, Continue appends to exactly that text. This is a notification simulation with real GPU loading and inference, not a physical GPU crash test. Unit tests additionally cover tiny-only recovery, a failed replacement device and preventing an automatic recovery loop.

**Phone layout.** At a 390 by 844 desktop viewport, expanded tower head targets measure 24 by 24 px. The 478 px tower scrolls inside its 358 px container, while page width stays 390 px. The compact tower is inert and absent from the native accessibility tree; Expand remains available. Inline word pieces retain the inline-target exception. This qualifies the layout only, not phone performance or spoken screen-reader use.

Live tiny-model training and inference were also exercised under CSP. This is a smoke check on a loaded machine, not a new speed measurement or phone qualification.

**Remaining gates.** Carlos's recording approval, the physical device matrix (including real GPU loss and phone training), five first-time visitors, a spoken screen-reader walkthrough, the remote Hugging Face download and Cloudflare staging check, and public launch approval. None is marked passed by these local checks.

## Additional Mac browser smoke observations

[[records/run/2026/10/2026-10-01-mac-browser-smoke]] captures Safari reaching Live and generating the changed Eiffel Tower answer. The captured turn was still busy, so its terminal completion, parity and timing are not qualified. Firefox selected Replay through its speed gate in this loaded visit; a full Firefox interaction or stable performance qualification was not completed. These observations do not close the device matrix.
