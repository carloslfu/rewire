---
type: measurement
id: 01m3w9k5pbf5ax3q33j1dj0zb3
created: 2026-10-01T17:53:30.315208+00:00
updated: 2026-10-01T20:30:14.982457+00:00
summary: 'Phase 3 agent checks: step 1 plays from its recording at 1.4 s on a 9 Mbps link before the model arrives; keyboard-only flow, accessibility tree, targets and copy fixed and verified'
date: 2026-10-01
devices: '[[records/devices/dev-mac-m5-pro]]'
phase: '3'
title: Phase 3 checks by the agent
status: measured
---
# Phase 3 checks by the agent (October 1, 2026)

On the development Mac in Chrome 152. These are the checks an agent can run; the five first-time visitors and a spoken screen-reader pass need people.

**Throttled connection.** The production build served with one shared link of 1,100 KB/s (about 9 Mbps) and 170 ms per request (`app/scripts/throttled-serve.mjs`), fresh origin, no cached model. The page's script ran at 0.69 s and step 1 with its recorded reply was in the page at 1.43 s, while the device check was still running; the step's swap then played from its recording ("Paris's most famous landmark is the Eiffel Tower.") during the model download, with progress shown against the same 385 MB the offer states. Paint timings were not measurable because the browser pane was hidden. A separate local throttle at 8 MB/s exercised pause (131 KB of in-flight data over 4 s), reload mid-download (16 stored files counted at once, the rest resumed) and completion to Live with every file's hash checked.

**Keyboard only.** Every control is reachable in order. Each reply is one Tab stop; Home, End and the arrow keys move between word pieces and Enter selects one, so the message box is two Tabs from the top instead of one per word. The tower uses the same pattern. The path list is a native modal dialog: focus moves in, Escape closes it, focus returns to "How it works".

**Screen-reader semantics (accessibility tree, not a spoken pass).** Each reply is a group named with its full text, for example "Reply: Rome's most famous landmark is the Colosseum.", with the key instructions as its description. Finished replies are announced once through a polite live region, not word by word. Tower cells read like "Floor 28, Head 12: +1.50 toward "Col"" and the words-out row like "Words out: "Col", 99%". Two unnamed or misnamed buttons were fixed.

**Targets and color.** At 1,024 px every control except inline word pieces (covered by WCAG's inline exception) is at least 24 by 24 px, after giving the tower's side columns fixed widths. Phones narrower than the 16 head columns need are below 24 px in the expanded tower. Push values are in each cell's name and the detail panel, so color is not the only signal.

**Copy.** Corrected claims found in review: the bits control leaves the dictionary as it is (it is 4-bit too, not full precision); replay numbers come from the same 4-bit model; the browser list names WebGPU instead of fixed versions; the download size comes from the host (385 MB) instead of a fixed 350; the tower caption's first-floor claim shows only for Qwen; step 2, 5, 6, 7 and 10 explanations match their measured results. Suggested questions now appear after a step's change is tried.

## Phone target correction (October 1 continuation)

The expanded-phone target gap above is fixed in the continuation build. See [[records/measurements/2026-10-01-launch-readiness-continuation]] for the measured geometry and remaining physical-device limits.
