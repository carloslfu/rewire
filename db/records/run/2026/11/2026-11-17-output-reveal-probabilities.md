---
type: run
id: 01m7n8jtkgwjxts61mbc1r20k3
created: 2026-11-17T17:23:56.656589+00:00
updated: 2026-11-17T17:23:56.656589+00:00
summary: Output reveal and probability raw verification
captured_at: 2026-11-17
command: NODE_OPTIONS=--max-old-space-size=1536 corepack pnpm build:deploy; sequential engine and tiny vitest suites; Chrome UI and per-frame DOM observations (details in body)
devices: '[[records/devices/dev-mac-m5-pro]]'
discarded: 'false'
title: Output reveal and probability raw verification
tool: Claude Code CLI, Node, Chrome via CUA
---
# Output reveal verification

Functional checks, not a timing benchmark. Workspace paths in tool output are normalized to [repository].

## Final release gate

```text
$ NODE_OPTIONS=--max-old-space-size=1536 corepack pnpm build:deploy
$ corepack pnpm test:deploy && corepack pnpm build && node app/scripts/check-deployment.mjs
$ corepack pnpm --filter @rewire/app test && corepack pnpm --filter @rewire/engine exec vitest run test/lifecycle.test.ts && corepack pnpm -r typecheck
$ vitest run

 RUN  v5.0.3 [repository]/app


 Test Files  21 passed (21)
      Tests  223 passed (223)
   Start at  12:18:55
   Duration  1.03s (transform 49%, tests 45%, import 5%, worker 1%)

  Transform  transforming modules took 2.80s · 49% of tracked time, re-done on every run
             persist transforms across runs with fsModuleCache: true
             learn more: https://vitest.dev/guide/improving-performance#caching-between-reruns


 RUN  v5.0.3 [repository]/engine


 Test Files  1 passed (1)
      Tests  2 passed (2)
   Start at  12:18:57
   Duration  71ms (transform 62%, import 21%, tests 9%, worker 7%, environment 1%)

Scope: 3 of 4 workspace projects
engine typecheck$ tsc --noEmit
engine typecheck: Done
tiny typecheck$ tsc --noEmit
tiny typecheck: Done
app typecheck$ tsc --noEmit
app typecheck: Done
$ corepack pnpm --filter @rewire/app build
$ tsc --noEmit && vite build
vite v8.3.1 building client environment for production...
transforming...
✓ 93 modules transformed.
rendering chunks...
computing gzip size...
dist/index.html                            1.42 kB │ gzip:   0.58 kB
dist/assets/webgl-d1MbwhuX-CjKyEkHn.js    13.75 kB
dist/assets/webgpu-D5edCWOx-k64hHtlv.js   51.95 kB
dist/assets/worker-CETddTQo.js           124.88 kB
dist/assets/train.worker-C-3YBaps.js     276.22 kB
dist/assets/index-jXbhm7Tb.css            62.13 kB │ gzip:  12.85 kB
dist/assets/lora-BHkFzEsB.js               0.24 kB │ gzip:   0.22 kB │ map:     3.53 kB
dist/assets/playback-Cm_8AsWP.js           1.29 kB │ gzip:   0.64 kB │ map:     6.24 kB
dist/assets/color-DkJ38p4b.js              2.16 kB │ gzip:   1.06 kB │ map:     8.47 kB
dist/assets/engine-ByZJ6ryE.js             4.07 kB │ gzip:   1.47 kB │ map:    14.55 kB
dist/assets/TeachStage-BZlbbr7E.js         6.66 kB │ gzip:   2.73 kB │ map:    15.61 kB
dist/assets/GrowStage-ClFHkhzT.js          8.84 kB │ gzip:   3.34 kB │ map:    21.11 kB
dist/assets/TinyView-CoKd3Bdd.js          22.13 kB │ gzip:   7.88 kB │ map:    53.95 kB
dist/assets/TeachView-Da8aCc2Q.js         23.86 kB │ gzip:   8.13 kB │ map:    52.11 kB
dist/assets/DismantleStage-CIcvzTPD.js    31.09 kB │ gzip:  10.53 kB │ map:    99.91 kB
dist/assets/Workbench-C36hVO0I.js         31.82 kB │ gzip:  11.69 kB │ map:   102.18 kB
dist/assets/useNarrow-zkO4lVKZ.js         60.58 kB │ gzip:  22.43 kB │ map:   176.44 kB
dist/assets/index-DGpIkgVo.js            303.36 kB │ gzip:  92.69 kB │ map: 1,252.46 kB
dist/assets/stage-CD_1DaOY.js            681.87 kB │ gzip: 175.37 kB │ map: 3,322.50 kB

✓ built in 252ms
{"status":"passed","model":"carloslfu/Qwen3-0.6B-Rewire-4bit","revision":"4fa041dd7caf1e8a94b2f05b8949999fca1e58af","manifest":"88f069237c4d548d41953cbd7f9e8a07b73abd94a104a433154939c4d5f81f61","base":"/rewire/","inference":"on-device"}
exit status: 0

$ git diff --check
exit status: 0

```

## Actual GPU suites

The later review changed engine comments only. This raw terminal result was recovered from the Claude Code tool transcript, not reconstructed from its summary.

```text
Command:
cd [repository]/engine && NODE_OPTIONS=--max-old-space-size=1536 corepack pnpm exec vitest run --no-file-parallelism 2>&1 | grep -v "^$" | tail -25; pgrep -fl vitest | head -2; cd ../tiny && NODE_OPTIONS=--max-old-space-size=1536 corepack pnpm exec vitest run --no-file-parallelism 2>&1 | grep -v "^$" | tail -12; pgrep -fl vitest | head -2; sysctl vm.swapusage

Output:
 RUN  v5.0.3 [repository]/engine
 Test Files  7 passed (7)
      Tests  44 passed (44)
   Start at  12:12:35
   Duration  6.41s (tests 92%, import 6%, transform 2%)
    Isolate  7 workers spawned · ~56ms startup each (spawn + environment, per file)
             at least ~334ms faster with isolate: false — reuses workers across files instead of one per file
 RUN  v5.0.3 [repository]/tiny
 Test Files  3 passed (3)
      Tests  10 passed (10)
   Start at  12:12:42
   Duration  6.44s (tests 99%, transform 1%)
vm.swapusage: total = 1024.00M  used = 2.94M  free = 1021.06M  (encrypted)
```

## Browser observations

Before observations use the then-live page. Final observations use the production-CSP local preview. Frame sampling reads the scrubber, token label and visible output labels on each animation frame, retaining changed states; a violation means a result label visible before the final step. The phone camera was moved by a scroll gesture over the canvas in one observation; the subsequent Fit observation restores the view.

```json
[
  {
    "label": "before-fix-first-step-exposes-final-result",
    "outputLabels": [
      {
        "hidden": false,
        "text": ". 100%"
      },
      {
        "hidden": true,
        "text": ", 0%"
      },
      {
        "hidden": true,
        "text": ". 0%"
      },
      {
        "hidden": true,
        "text": ". 0%"
      },
      {
        "hidden": true,
        "text": ".C 0%"
      }
    ],
    "position": [
      {
        "hidden": false,
        "text": "Read the token"
      }
    ],
    "readout": "Read the token. Direct pushes so far: −0.05 of +29.64.",
    "step": "Step 1 of 58: Read the token"
  },
  {
    "label": "before-fix-sampling-label-vs-model-readout",
    "outputLabels": [
      {
        "hidden": false,
        "text": "The 100%"
      },
      {
        "hidden": true,
        "text": "France 0%"
      },
      {
        "hidden": true,
        "text": "the 0%"
      },
      {
        "hidden": true,
        "text": "Paris 0%"
      },
      {
        "hidden": true,
        "text": "-The 0%"
      }
    ],
    "position": [
      {
        "hidden": false,
        "text": "Choose the next token"
      }
    ],
    "readout": "Token written: “The”, which the model gave 99%. Direct pushes add up to +31.79.",
    "step": "Step 58 of 58: token complete"
  },
  {
    "label": "final-Qwen-step1",
    "outputLabels": [
      {
        "hidden": true,
        "text": "capital >99.99%"
      },
      {
        "hidden": true,
        "text": "Capital <0.01%"
      },
      {
        "hidden": true,
        "text": "city <0.01%"
      },
      {
        "hidden": true,
        "text": "capitals <0.01%"
      },
      {
        "hidden": true,
        "text": "capit <0.01%"
      },
      {
        "hidden": false,
        "text": "Not chosen yet"
      }
    ],
    "position": [
      {
        "hidden": false,
        "text": "Read the token"
      }
    ],
    "readout": "Read the token. Direct pushes so far: −0.00 of +35.25.",
    "step": "Step 1 of 58: Read the token"
  },
  {
    "label": "final-Qwen-The-complete",
    "outputLabels": [
      {
        "hidden": false,
        "text": "The 99.40%"
      },
      {
        "hidden": true,
        "text": "France 0.58%"
      },
      {
        "hidden": true,
        "text": "the <0.01%"
      },
      {
        "hidden": true,
        "text": "Paris <0.01%"
      },
      {
        "hidden": true,
        "text": "-The <0.01%"
      },
      {
        "hidden": true,
        "text": "Not chosen yet"
      }
    ],
    "position": [
      {
        "hidden": false,
        "text": "Choose the next token"
      }
    ],
    "readout": "Token written: “The”, which the model gave 99.40%. Direct pushes add up to +31.79.",
    "step": "Step 58 of 58: token complete"
  },
  {
    "label": "final-Qwen-backstep57",
    "outputLabels": [
      {
        "hidden": true,
        "text": "The 99.40%"
      },
      {
        "hidden": true,
        "text": "France 0.58%"
      },
      {
        "hidden": true,
        "text": "the <0.01%"
      },
      {
        "hidden": true,
        "text": "Paris <0.01%"
      },
      {
        "hidden": true,
        "text": "-The <0.01%"
      },
      {
        "hidden": false,
        "text": "Not chosen yet"
      }
    ],
    "position": [
      {
        "hidden": false,
        "text": "Layer 28 · MLP"
      }
    ],
    "readout": "Layer 28 · MLP. Direct pushes so far: +31.79 of +31.79.",
    "step": "Step 57 of 58: Layer 28 · MLP"
  },
  {
    "label": "frame-sampling",
    "changes": [
      {
        "labels": [],
        "max": 58,
        "pending": true,
        "step": 7,
        "token": "“The”"
      },
      {
        "labels": [],
        "max": 58,
        "pending": true,
        "step": 8,
        "token": "“The”"
      },
      {
        "labels": [],
        "max": 58,
        "pending": true,
        "step": 9,
        "token": "“The”"
      },
      {
        "labels": [],
        "max": 58,
        "pending": true,
        "step": 10,
        "token": "“The”"
      },
      {
        "labels": [],
        "max": 58,
        "pending": true,
        "step": 11,
        "token": "“The”"
      },
      {
        "labels": [],
        "max": 58,
        "pending": true,
        "step": 12,
        "token": "“The”"
      },
      {
        "labels": [],
        "max": 58,
        "pending": true,
        "step": 13,
        "token": "“The”"
      },
      {
        "labels": [],
        "max": 58,
        "pending": true,
        "step": 14,
        "token": "“The”"
      },
      {
        "labels": [],
        "max": 58,
        "pending": true,
        "step": 15,
        "token": "“The”"
      },
      {
        "labels": [],
        "max": 58,
        "pending": true,
        "step": 16,
        "token": "“The”"
      },
      {
        "labels": [],
        "max": 58,
        "pending": true,
        "step": 17,
        "token": "“The”"
      },
      {
        "labels": [],
        "max": 58,
        "pending": true,
        "step": 18,
        "token": "“The”"
      },
      {
        "labels": [],
        "max": 58,
        "pending": true,
        "step": 19,
        "token": "“The”"
      },
      {
        "labels": [],
        "max": 58,
        "pending": true,
        "step": 20,
        "token": "“The”"
      },
      {
        "labels": [],
        "max": 58,
        "pending": true,
        "step": 21,
        "token": "“The”"
      },
      {
        "labels": [],
        "max": 58,
        "pending": true,
        "step": 22,
        "token": "“The”"
      },
      {
        "labels": [],
        "max": 58,
        "pending": true,
        "step": 23,
        "token": "“The”"
      },
      {
        "labels": [],
        "max": 58,
        "pending": true,
        "step": 24,
        "token": "“The”"
      },
      {
        "labels": [],
        "max": 58,
        "pending": true,
        "step": 25,
        "token": "“The”"
      },
      {
        "labels": [],
        "max": 58,
        "pending": true,
        "step": 26,
        "token": "“The”"
      },
      {
        "labels": [],
        "max": 58,
        "pending": true,
        "step": 27,
        "token": "“The”"
      },
      {
        "labels": [],
        "max": 58,
        "pending": true,
        "step": 28,
        "token": "“The”"
      },
      {
        "labels": [],
        "max": 58,
        "pending": true,
        "step": 29,
        "token": "“The”"
      },
      {
        "labels": [],
        "max": 58,
        "pending": true,
        "step": 30,
        "token": "“The”"
      },
      {
        "labels": [],
        "max": 58,
        "pending": true,
        "step": 31,
        "token": "“The”"
      },
      {
        "labels": [],
        "max": 58,
        "pending": true,
        "step": 32,
        "token": "“The”"
      },
      {
        "labels": [],
        "max": 58,
        "pending": true,
        "step": 33,
        "token": "“The”"
      },
      {
        "labels": [],
        "max": 58,
        "pending": true,
        "step": 34,
        "token": "“The”"
      },
      {
        "labels": [],
        "max": 58,
        "pending": true,
        "step": 35,
        "token": "“The”"
      },
      {
        "labels": [],
        "max": 58,
        "pending": true,
        "step": 36,
        "token": "“The”"
      },
      {
        "labels": [],
        "max": 58,
        "pending": true,
        "step": 37,
        "token": "“The”"
      },
      {
        "labels": [],
        "max": 58,
        "pending": true,
        "step": 38,
        "token": "“The”"
      },
      {
        "labels": [],
        "max": 58,
        "pending": true,
        "step": 39,
        "token": "“The”"
      },
      {
        "labels": [],
        "max": 58,
        "pending": true,
        "step": 40,
        "token": "“The”"
      },
      {
        "labels": [],
        "max": 58,
        "pending": true,
        "step": 41,
        "token": "“The”"
      },
      {
        "labels": [],
        "max": 58,
        "pending": true,
        "step": 42,
        "token": "“The”"
      },
      {
        "labels": [],
        "max": 58,
        "pending": true,
        "step": 43,
        "token": "“The”"
      },
      {
        "labels": [],
        "max": 58,
        "pending": true,
        "step": 44,
        "token": "“The”"
      },
      {
        "labels": [],
        "max": 58,
        "pending": true,
        "step": 45,
        "token": "“The”"
      },
      {
        "labels": [],
        "max": 58,
        "pending": true,
        "step": 46,
        "token": "“The”"
      },
      {
        "labels": [],
        "max": 58,
        "pending": true,
        "step": 47,
        "token": "“The”"
      },
      {
        "labels": [],
        "max": 58,
        "pending": true,
        "step": 48,
        "token": "“The”"
      },
      {
        "labels": [],
        "max": 58,
        "pending": true,
        "step": 49,
        "token": "“The”"
      },
      {
        "labels": [],
        "max": 58,
        "pending": true,
        "step": 50,
        "token": "“The”"
      },
      {
        "labels": [],
        "max": 58,
        "pending": true,
        "step": 51,
        "token": "“The”"
      },
      {
        "labels": [],
        "max": 58,
        "pending": true,
        "step": 52,
        "token": "“The”"
      },
      {
        "labels": [],
        "max": 58,
        "pending": true,
        "step": 53,
        "token": "“The”"
      },
      {
        "labels": [],
        "max": 58,
        "pending": true,
        "step": 54,
        "token": "“The”"
      },
      {
        "labels": [],
        "max": 58,
        "pending": true,
        "step": 55,
        "token": "“The”"
      },
      {
        "labels": [],
        "max": 58,
        "pending": true,
        "step": 56,
        "token": "“The”"
      },
      {
        "labels": [],
        "max": 58,
        "pending": true,
        "step": 57,
        "token": "“The”"
      },
      {
        "labels": [],
        "max": 58,
        "pending": true,
        "step": 58,
        "token": "“The”"
      },
      {
        "labels": [
          "The 99.40%"
        ],
        "max": 58,
        "pending": false,
        "step": 58,
        "token": "“The”"
      },
      {
        "labels": [],
        "max": 58,
        "pending": false,
        "step": 1,
        "token": "“capital”"
      },
      {
        "labels": [],
        "max": 58,
        "pending": true,
        "step": 1,
        "token": "“capital”"
      },
      {
        "labels": [],
        "max": 58,
        "pending": true,
        "step": 2,
        "token": "“capital”"
      },
      {
        "labels": [],
        "max": 58,
        "pending": true,
        "step": 3,
        "token": "“capital”"
      },
      {
        "labels": [],
        "max": 58,
        "pending": true,
        "step": 4,
        "token": "“capital”"
      },
      {
        "labels": [],
        "max": 58,
        "pending": true,
        "step": 5,
        "token": "“capital”"
      },
      {
        "labels": [],
        "max": 58,
        "pending": true,
        "step": 6,
        "token": "“capital”"
      },
      {
        "labels": [],
        "max": 58,
        "pending": true,
        "step": 7,
        "token": "“capital”"
      },
      {
        "labels": [],
        "max": 58,
        "pending": true,
        "step": 8,
        "token": "“capital”"
      },
      {
        "labels": [],
        "max": 58,
        "pending": true,
        "step": 9,
        "token": "“capital”"
      },
      {
        "labels": [],
        "max": 58,
        "pending": true,
        "step": 10,
        "token": "“capital”"
      },
      {
        "labels": [],
        "max": 58,
        "pending": true,
        "step": 11,
        "token": "“capital”"
      },
      {
        "labels": [],
        "max": 58,
        "pending": true,
        "step": 12,
        "token": "“capital”"
      },
      {
        "labels": [],
        "max": 58,
        "pending": true,
        "step": 13,
        "token": "“capital”"
      },
      {
        "labels": [],
        "max": 58,
        "pending": true,
        "step": 14,
        "token": "“capital”"
      },
      {
        "labels": [],
        "max": 58,
        "pending": true,
        "step": 15,
        "token": "“capital”"
      },
      {
        "labels": [],
        "max": 58,
        "pending": true,
        "step": 16,
        "token": "“capital”"
      },
      {
        "labels": [],
        "max": 58,
        "pending": true,
        "step": 17,
        "token": "“capital”"
      },
      {
        "labels": [],
        "max": 58,
        "pending": true,
        "step": 18,
        "token": "“capital”"
      },
      {
        "labels": [],
        "max": 58,
        "pending": true,
        "step": 19,
        "token": "“capital”"
      },
      {
        "labels": [],
        "max": 58,
        "pending": true,
        "step": 20,
        "token": "“capital”"
      },
      {
        "labels": [],
        "max": 58,
        "pending": true,
        "step": 21,
        "token": "“capital”"
      },
      {
        "labels": [],
        "max": 58,
        "pending": true,
        "step": 22,
        "token": "“capital”"
      },
      {
        "labels": [],
        "max": 58,
        "pending": true,
        "step": 23,
        "token": "“capital”"
      },
      {
        "labels": [],
        "max": 58,
        "pending": true,
        "step": 24,
        "token": "“capital”"
      },
      {
        "labels": [],
        "max": 58,
        "pending": true,
        "step": 25,
        "token": "“capital”"
      },
      {
        "labels": [],
        "max": 58,
        "pending": true,
        "step": 26,
        "token": "“capital”"
      },
      {
        "labels": [],
        "max": 58,
        "pending": true,
        "step": 27,
        "token": "“capital”"
      },
      {
        "labels": [],
        "max": 58,
        "pending": true,
        "step": 28,
        "token": "“capital”"
      },
      {
        "labels": [],
        "max": 58,
        "pending": true,
        "step": 29,
        "token": "“capital”"
      },
      {
        "labels": [],
        "max": 58,
        "pending": true,
        "step": 30,
        "token": "“capital”"
      },
      {
        "labels": [],
        "max": 58,
        "pending": true,
        "step": 31,
        "token": "“capital”"
      },
      {
        "labels": [],
        "max": 58,
        "pending": true,
        "step": 32,
        "token": "“capital”"
      },
      {
        "labels": [],
        "max": 58,
        "pending": true,
        "step": 33,
        "token": "“capital”"
      },
      {
        "labels": [],
        "max": 58,
        "pending": true,
        "step": 34,
        "token": "“capital”"
      },
      {
        "labels": [],
        "max": 58,
        "pending": true,
        "step": 35,
        "token": "“capital”"
      },
      {
        "labels": [],
        "max": 58,
        "pending": true,
        "step": 36,
        "token": "“capital”"
      },
      {
        "labels": [],
        "max": 58,
        "pending": true,
        "step": 37,
        "token": "“capital”"
      },
      {
        "labels": [],
        "max": 58,
        "pending": true,
        "step": 38,
        "token": "“capital”"
      },
      {
        "labels": [],
        "max": 58,
        "pending": true,
        "step": 39,
        "token": "“capital”"
      },
      {
        "labels": [],
        "max": 58,
        "pending": true,
        "step": 40,
        "token": "“capital”"
      },
      {
        "labels": [],
        "max": 58,
        "pending": true,
        "step": 41,
        "token": "“capital”"
      },
      {
        "labels": [],
        "max": 58,
        "pending": true,
        "step": 42,
        "token": "“capital”"
      },
      {
        "labels": [],
        "max": 58,
        "pending": true,
        "step": 43,
        "token": "“capital”"
      },
      {
        "labels": [],
        "max": 58,
        "pending": true,
        "step": 44,
        "token": "“capital”"
      },
      {
        "labels": [],
        "max": 58,
        "pending": true,
        "step": 45,
        "token": "“capital”"
      },
      {
        "labels": [],
        "max": 58,
        "pending": true,
        "step": 46,
        "token": "“capital”"
      },
      {
        "labels": [],
        "max": 58,
        "pending": true,
        "step": 47,
        "token": "“capital”"
      },
      {
        "labels": [],
        "max": 58,
        "pending": true,
        "step": 48,
        "token": "“capital”"
      },
      {
        "labels": [],
        "max": 58,
        "pending": true,
        "step": 49,
        "token": "“capital”"
      },
      {
        "labels": [],
        "max": 58,
        "pending": true,
        "step": 50,
        "token": "“capital”"
      },
      {
        "labels": [],
        "max": 58,
        "pending": true,
        "step": 51,
        "token": "“capital”"
      },
      {
        "labels": [],
        "max": 58,
        "pending": true,
        "step": 52,
        "token": "“capital”"
      },
      {
        "labels": [],
        "max": 58,
        "pending": true,
        "step": 53,
        "token": "“capital”"
      },
      {
        "labels": [],
        "max": 58,
        "pending": true,
        "step": 54,
        "token": "“capital”"
      },
      {
        "labels": [],
        "max": 58,
        "pending": true,
        "step": 55,
        "token": "“capital”"
      },
      {
        "labels": [],
        "max": 58,
        "pending": true,
        "step": 56,
        "token": "“capital”"
      },
      {
        "labels": [],
        "max": 58,
        "pending": true,
        "step": 57,
        "token": "“capital”"
      },
      {
        "labels": [],
        "max": 58,
        "pending": true,
        "step": 58,
        "token": "“capital”"
      },
      {
        "labels": [
          "capital >99.99%"
        ],
        "max": 58,
        "pending": false,
        "step": 58,
        "token": "“capital”"
      },
      {
        "labels": [],
        "max": 58,
        "pending": false,
        "step": 1,
        "token": "“of”"
      },
      {
        "labels": [],
        "max": 58,
        "pending": true,
        "step": 1,
        "token": "“of”"
      },
      {
        "labels": [],
        "max": 58,
        "pending": true,
        "step": 2,
        "token": "“of”"
      },
      {
        "labels": [],
        "max": 58,
        "pending": true,
        "step": 3,
        "token": "“of”"
      },
      {
        "labels": [],
        "max": 58,
        "pending": true,
        "step": 4,
        "token": "“of”"
      },
      {
        "labels": [],
        "max": 58,
        "pending": true,
        "step": 5,
        "token": "“of”"
      },
      {
        "labels": [],
        "max": 58,
        "pending": true,
        "step": 6,
        "token": "“of”"
      },
      {
        "labels": [],
        "max": 58,
        "pending": true,
        "step": 7,
        "token": "“of”"
      },
      {
        "labels": [],
        "max": 58,
        "pending": true,
        "step": 8,
        "token": "“of”"
      },
      {
        "labels": [],
        "max": 58,
        "pending": true,
        "step": 9,
        "token": "“of”"
      },
      {
        "labels": [],
        "max": 58,
        "pending": true,
        "step": 10,
        "token": "“of”"
      },
      {
        "labels": [],
        "max": 58,
        "pending": true,
        "step": 11,
        "token": "“of”"
      },
      {
        "labels": [],
        "max": 58,
        "pending": true,
        "step": 12,
        "token": "“of”"
      },
      {
        "labels": [],
        "max": 58,
        "pending": true,
        "step": 13,
        "token": "“of”"
      },
      {
        "labels": [],
        "max": 58,
        "pending": true,
        "step": 14,
        "token": "“of”"
      },
      {
        "labels": [],
        "max": 58,
        "pending": true,
        "step": 15,
        "token": "“of”"
      },
      {
        "labels": [],
        "max": 58,
        "pending": true,
        "step": 16,
        "token": "“of”"
      },
      {
        "labels": [],
        "max": 58,
        "pending": true,
        "step": 17,
        "token": "“of”"
      },
      {
        "labels": [],
        "max": 58,
        "pending": true,
        "step": 18,
        "token": "“of”"
      },
      {
        "labels": [],
        "max": 58,
        "pending": true,
        "step": 19,
        "token": "“of”"
      },
      {
        "labels": [],
        "max": 58,
        "pending": true,
        "step": 20,
        "token": "“of”"
      },
      {
        "labels": [],
        "max": 58,
        "pending": true,
        "step": 21,
        "token": "“of”"
      },
      {
        "labels": [],
        "max": 58,
        "pending": true,
        "step": 22,
        "token": "“of”"
      },
      {
        "labels": [],
        "max": 58,
        "pending": true,
        "step": 23,
        "token": "“of”"
      },
      {
        "labels": [],
        "max": 58,
        "pending": true,
        "step": 24,
        "token": "“of”"
      },
      {
        "labels": [],
        "max": 58,
        "pending": true,
        "step": 25,
        "token": "“of”"
      },
      {
        "labels": [],
        "max": 58,
        "pending": true,
        "step": 26,
        "token": "“of”"
      },
      {
        "labels": [],
        "max": 58,
        "pending": true,
        "step": 27,
        "token": "“of”"
      },
      {
        "labels": [],
        "max": 58,
        "pending": true,
        "step": 28,
        "token": "“of”"
      },
      {
        "labels": [],
        "max": 58,
        "pending": true,
        "step": 29,
        "token": "“of”"
      },
      {
        "labels": [],
        "max": 58,
        "pending": true,
        "step": 30,
        "token": "“of”"
      },
      {
        "labels": [],
        "max": 58,
        "pending": true,
        "step": 31,
        "token": "“of”"
      },
      {
        "labels": [],
        "max": 58,
        "pending": true,
        "step": 32,
        "token": "“of”"
      },
      {
        "labels": [],
        "max": 58,
        "pending": true,
        "step": 33,
        "token": "“of”"
      },
      {
        "labels": [],
        "max": 58,
        "pending": true,
        "step": 34,
        "token": "“of”"
      },
      {
        "labels": [],
        "max": 58,
        "pending": true,
        "step": 35,
        "token": "“of”"
      },
      {
        "labels": [],
        "max": 58,
        "pending": true,
        "step": 36,
        "token": "“of”"
      },
      {
        "labels": [],
        "max": 58,
        "pending": true,
        "step": 37,
        "token": "“of”"
      },
      {
        "labels": [],
        "max": 58,
        "pending": true,
        "step": 38,
        "token": "“of”"
      },
      {
        "labels": [],
        "max": 58,
        "pending": true,
        "step": 39,
        "token": "“of”"
      },
      {
        "labels": [],
        "max": 58,
        "pending": true,
        "step": 40,
        "token": "“of”"
      },
      {
        "labels": [],
        "max": 58,
        "pending": true,
        "step": 41,
        "token": "“of”"
      },
      {
        "labels": [],
        "max": 58,
        "pending": true,
        "step": 42,
        "token": "“of”"
      },
      {
        "labels": [],
        "max": 58,
        "pending": true,
        "step": 43,
        "token": "“of”"
      },
      {
        "labels": [],
        "max": 58,
        "pending": true,
        "step": 44,
        "token": "“of”"
      },
      {
        "labels": [],
        "max": 58,
        "pending": true,
        "step": 45,
        "token": "“of”"
      },
      {
        "labels": [],
        "max": 58,
        "pending": true,
        "step": 46,
        "token": "“of”"
      },
      {
        "labels": [],
        "max": 58,
        "pending": true,
        "step": 47,
        "token": "“of”"
      },
      {
        "labels": [],
        "max": 58,
        "pending": true,
        "step": 48,
        "token": "“of”"
      }
    ],
    "violations": []
  },
  {
    "label": "final-Qwen-Paris-complete",
    "outputLabels": [
      {
        "hidden": false,
        "text": "Paris 98.78%"
      },
      {
        "hidden": true,
        "text": "** 0.21%"
      },
      {
        "hidden": true,
        "text": "Paris 0.20%"
      },
      {
        "hidden": true,
        "text": "Lyon 0.13%"
      },
      {
        "hidden": true,
        "text": "Marseille 0.07%"
      },
      {
        "hidden": true,
        "text": "Not chosen yet"
      }
    ],
    "position": [
      {
        "hidden": false,
        "text": "Choose the next token"
      }
    ],
    "readout": "Token written: “Paris”, which the model gave 98.78%. Direct pushes add up to +25.64.",
    "step": "Step 58 of 58: token complete"
  },
  {
    "label": "phone-390-Qwen-pending",
    "outputLabels": [
      {
        "hidden": true,
        "text": "The 99.40%"
      },
      {
        "hidden": true,
        "text": "France 0.58%"
      },
      {
        "hidden": true,
        "text": "the <0.01%"
      },
      {
        "hidden": true,
        "text": "Paris <0.01%"
      },
      {
        "hidden": true,
        "text": "-The <0.01%"
      },
      {
        "hidden": false,
        "text": "Not chosen yet"
      }
    ],
    "position": [
      {
        "hidden": false,
        "text": "Read the token"
      }
    ],
    "readout": "Read the token. Direct pushes so far: +0.05 of +31.79.",
    "step": "Step 1 of 58: Read the token"
  },
  {
    "label": "phone-390-overflow",
    "scrollWidth": 390,
    "width": 390
  },
  {
    "label": "phone-390-Qwen-complete",
    "outputLabels": [
      {
        "hidden": true,
        "text": "The 99.40%"
      },
      {
        "hidden": true,
        "text": "France 0.58%"
      },
      {
        "hidden": true,
        "text": "the <0.01%"
      },
      {
        "hidden": true,
        "text": "Paris <0.01%"
      },
      {
        "hidden": true,
        "text": "-The <0.01%"
      },
      {
        "hidden": true,
        "text": "Not chosen yet"
      }
    ],
    "position": [
      {
        "hidden": true,
        "text": "Choose the next token"
      }
    ],
    "readout": "Token written: “The”, which the model gave 99.40%. Direct pushes add up to +31.79.",
    "step": "Step 58 of 58: token complete"
  },
  {
    "label": "phone-390-after-fit-complete",
    "outputLabels": [
      {
        "hidden": false,
        "text": "The 99.40%"
      },
      {
        "hidden": true,
        "text": "France 0.58%"
      },
      {
        "hidden": true,
        "text": "the <0.01%"
      },
      {
        "hidden": true,
        "text": "Paris <0.01%"
      },
      {
        "hidden": true,
        "text": "-The <0.01%"
      },
      {
        "hidden": true,
        "text": "Not chosen yet"
      }
    ],
    "position": [
      {
        "hidden": false,
        "text": "Choose the next token"
      }
    ],
    "readout": "Token written: “The”, which the model gave 99.40%. Direct pushes add up to +31.79.",
    "step": "Step 58 of 58: token complete"
  },
  {
    "label": "phone-label-bounds",
    "bounds": [
      {
        "left": 187.3000030517578,
        "right": 257.51092529296875,
        "text": "The 99.40%",
        "width": 390
      }
    ]
  },
  {
    "label": "before-reply-switch-original-Paris",
    "outputLabels": [
      {
        "hidden": false,
        "text": "Paris 98.78%"
      },
      {
        "hidden": true,
        "text": "** 0.21%"
      },
      {
        "hidden": true,
        "text": "Paris 0.20%"
      },
      {
        "hidden": true,
        "text": "Lyon 0.13%"
      },
      {
        "hidden": true,
        "text": "Marseille 0.07%"
      },
      {
        "hidden": true,
        "text": "Not chosen yet"
      }
    ],
    "position": [
      {
        "hidden": false,
        "text": "Choose the next token"
      }
    ],
    "readout": "Token written: “Paris”, which the model gave 98.78%. Direct pushes add up to +25.64.",
    "step": "Step 58 of 58: token complete"
  },
  {
    "label": "same-index-changed-Washington",
    "outputLabels": [
      {
        "hidden": false,
        "text": "Washington 95.24%"
      },
      {
        "hidden": true,
        "text": "Tokyo 0.79%"
      },
      {
        "hidden": true,
        "text": "Berlin 0.67%"
      },
      {
        "hidden": true,
        "text": "Beijing 0.63%"
      },
      {
        "hidden": true,
        "text": "New 0.58%"
      },
      {
        "hidden": true,
        "text": "Not chosen yet"
      }
    ],
    "position": [
      {
        "hidden": false,
        "text": "Choose the next token"
      }
    ],
    "readout": "Token written: “Washington”, which the model gave 95.24%. Direct pushes add up to +26.51.",
    "step": "Step 58 of 58: token complete"
  },
  {
    "label": "reduced-motion-step1",
    "outputLabels": [
      {
        "hidden": true,
        "text": "Washington 95.24%"
      },
      {
        "hidden": true,
        "text": "Tokyo 0.79%"
      },
      {
        "hidden": true,
        "text": "Berlin 0.67%"
      },
      {
        "hidden": true,
        "text": "Beijing 0.63%"
      },
      {
        "hidden": true,
        "text": "New 0.58%"
      },
      {
        "hidden": false,
        "text": "Not chosen yet"
      }
    ],
    "position": [
      {
        "hidden": false,
        "text": "Read the token"
      }
    ],
    "readout": "Read the token. Direct pushes so far: +0.01 of +26.51.",
    "step": "Step 1 of 58: Read the token"
  },
  {
    "label": "reduced-motion-complete",
    "outputLabels": [
      {
        "hidden": false,
        "text": "Washington 95.24%"
      },
      {
        "hidden": true,
        "text": "Tokyo 0.79%"
      },
      {
        "hidden": true,
        "text": "Berlin 0.67%"
      },
      {
        "hidden": true,
        "text": "Beijing 0.63%"
      },
      {
        "hidden": true,
        "text": "New 0.58%"
      },
      {
        "hidden": true,
        "text": "Not chosen yet"
      }
    ],
    "position": [
      {
        "hidden": false,
        "text": "Choose the next token"
      }
    ],
    "readout": "Token written: “Washington”, which the model gave 95.24%. Direct pushes add up to +26.51.",
    "step": "Step 58 of 58: token complete"
  },
  {
    "label": "back-to-live-latest",
    "outputLabels": [
      {
        "hidden": false,
        "text": ". 98.54%"
      },
      {
        "hidden": true,
        "text": ".. 0.70%"
      },
      {
        "hidden": true,
        "text": "., 0.65%"
      },
      {
        "hidden": true,
        "text": ".). 0.06%"
      },
      {
        "hidden": true,
        "text": "./ 0.01%"
      },
      {
        "hidden": true,
        "text": "Not chosen yet"
      }
    ],
    "position": []
  },
  {
    "label": "tiny-training-ready",
    "state": [
      "1200 training steps in 20.8 seconds. The weights are ready to test.",
      "1200 training steps in 20.8 seconds. The weights are ready to test."
    ]
  },
  {
    "label": "tiny-step1",
    "outputLabels": [
      {
        "hidden": true,
        "text": "z 99.42%"
      },
      {
        "hidden": true,
        "text": "f 0.56%"
      },
      {
        "hidden": true,
        "text": "s <0.01%"
      },
      {
        "hidden": true,
        "text": "v <0.01%"
      },
      {
        "hidden": true,
        "text": "m <0.01%"
      },
      {
        "hidden": false,
        "text": "Not chosen yet"
      }
    ],
    "position": [
      {
        "hidden": false,
        "text": "Read the token"
      }
    ],
    "readout": "Read the token. Direct pushes so far: +0.01 of +13.57.",
    "step": "Step 1 of 10: Read the token"
  },
  {
    "label": "tiny-complete",
    "outputLabels": [
      {
        "hidden": false,
        "text": "z 99.42%"
      },
      {
        "hidden": false,
        "text": "f 0.56%"
      },
      {
        "hidden": true,
        "text": "s <0.01%"
      },
      {
        "hidden": false,
        "text": "v <0.01%"
      },
      {
        "hidden": true,
        "text": "m <0.01%"
      },
      {
        "hidden": true,
        "text": "Not chosen yet"
      }
    ],
    "position": [
      {
        "hidden": false,
        "text": "Choose the next token"
      }
    ],
    "readout": "Token written: “z”, which the model gave 99.42%. Direct pushes add up to +13.57.",
    "step": "Step 10 of 10: token complete"
  },
  {
    "label": "frame-sampling",
    "changes": [
      {
        "labels": [],
        "max": 10,
        "pending": true,
        "step": 8,
        "token": "“z”"
      },
      {
        "labels": [],
        "max": 10,
        "pending": true,
        "step": 9,
        "token": "“z”"
      },
      {
        "labels": [],
        "max": 10,
        "pending": true,
        "step": 10,
        "token": "“z”"
      },
      {
        "labels": [
          "z 99.42%",
          "f 0.56%",
          "v <0.01%"
        ],
        "max": 10,
        "pending": false,
        "step": 10,
        "token": "“z”"
      },
      {
        "labels": [],
        "max": 10,
        "pending": false,
        "step": 1,
        "token": "“o”"
      },
      {
        "labels": [],
        "max": 10,
        "pending": true,
        "step": 1,
        "token": "“o”"
      },
      {
        "labels": [],
        "max": 10,
        "pending": true,
        "step": 2,
        "token": "“o”"
      },
      {
        "labels": [],
        "max": 10,
        "pending": true,
        "step": 3,
        "token": "“o”"
      },
      {
        "labels": [],
        "max": 10,
        "pending": true,
        "step": 4,
        "token": "“o”"
      },
      {
        "labels": [],
        "max": 10,
        "pending": true,
        "step": 5,
        "token": "“o”"
      },
      {
        "labels": [],
        "max": 10,
        "pending": true,
        "step": 6,
        "token": "“o”"
      },
      {
        "labels": [],
        "max": 10,
        "pending": true,
        "step": 7,
        "token": "“o”"
      },
      {
        "labels": [],
        "max": 10,
        "pending": true,
        "step": 8,
        "token": "“o”"
      },
      {
        "labels": [],
        "max": 10,
        "pending": true,
        "step": 9,
        "token": "“o”"
      },
      {
        "labels": [],
        "max": 10,
        "pending": true,
        "step": 10,
        "token": "“o”"
      },
      {
        "labels": [
          "o 99.98%",
          "r <0.01%",
          "b <0.01%"
        ],
        "max": 10,
        "pending": false,
        "step": 10,
        "token": "“o”"
      },
      {
        "labels": [],
        "max": 10,
        "pending": false,
        "step": 1,
        "token": "“r”"
      },
      {
        "labels": [],
        "max": 10,
        "pending": true,
        "step": 1,
        "token": "“r”"
      },
      {
        "labels": [],
        "max": 10,
        "pending": true,
        "step": 2,
        "token": "“r”"
      },
      {
        "labels": [],
        "max": 10,
        "pending": true,
        "step": 3,
        "token": "“r”"
      },
      {
        "labels": [],
        "max": 10,
        "pending": true,
        "step": 4,
        "token": "“r”"
      },
      {
        "labels": [],
        "max": 10,
        "pending": true,
        "step": 5,
        "token": "“r”"
      },
      {
        "labels": [],
        "max": 10,
        "pending": true,
        "step": 6,
        "token": "“r”"
      },
      {
        "labels": [],
        "max": 10,
        "pending": true,
        "step": 7,
        "token": "“r”"
      },
      {
        "labels": [],
        "max": 10,
        "pending": true,
        "step": 8,
        "token": "“r”"
      },
      {
        "labels": [],
        "max": 10,
        "pending": true,
        "step": 9,
        "token": "“r”"
      },
      {
        "labels": [],
        "max": 10,
        "pending": true,
        "step": 10,
        "token": "“r”"
      },
      {
        "labels": [
          "r 99.98%",
          "b 0.01%",
          "m <0.01%"
        ],
        "max": 10,
        "pending": false,
        "step": 10,
        "token": "“r”"
      },
      {
        "labels": [],
        "max": 10,
        "pending": false,
        "step": 1,
        "token": "“\" \"”"
      },
      {
        "labels": [],
        "max": 10,
        "pending": true,
        "step": 1,
        "token": "“\" \"”"
      },
      {
        "labels": [],
        "max": 10,
        "pending": true,
        "step": 2,
        "token": "“\" \"”"
      },
      {
        "labels": [],
        "max": 10,
        "pending": true,
        "step": 3,
        "token": "“\" \"”"
      },
      {
        "labels": [],
        "max": 10,
        "pending": true,
        "step": 4,
        "token": "“\" \"”"
      },
      {
        "labels": [],
        "max": 10,
        "pending": true,
        "step": 5,
        "token": "“\" \"”"
      },
      {
        "labels": [],
        "max": 10,
        "pending": true,
        "step": 6,
        "token": "“\" \"”"
      },
      {
        "labels": [],
        "max": 10,
        "pending": true,
        "step": 7,
        "token": "“\" \"”"
      },
      {
        "labels": [],
        "max": 10,
        "pending": true,
        "step": 8,
        "token": "“\" \"”"
      },
      {
        "labels": [],
        "max": 10,
        "pending": true,
        "step": 9,
        "token": "“\" \"”"
      },
      {
        "labels": [],
        "max": 10,
        "pending": true,
        "step": 10,
        "token": "“\" \"”"
      },
      {
        "labels": [
          "\" \" >99.99%",
          "\"\\n\" <0.01%",
          "a <0.01%"
        ],
        "max": 10,
        "pending": false,
        "step": 10,
        "token": "“\" \"”"
      },
      {
        "labels": [],
        "max": 10,
        "pending": false,
        "step": 1,
        "token": "“m”"
      },
      {
        "labels": [],
        "max": 10,
        "pending": true,
        "step": 1,
        "token": "“m”"
      },
      {
        "labels": [],
        "max": 10,
        "pending": true,
        "step": 2,
        "token": "“m”"
      },
      {
        "labels": [],
        "max": 10,
        "pending": true,
        "step": 3,
        "token": "“m”"
      }
    ],
    "violations": []
  },
  {
    "label": "console-after-local-checks",
    "logs": [
      {
        "level": "warn",
        "message": "[DEFAULT]: WARN : Using DEFAULT root logger",
        "timestamp": "2026-11-17T17:06:41.500Z",
        "url": "chrome-extension://kbfnbcaeplbcioakkpcpgfkobkghlhen/src/js/Grammarly.js"
      },
      {
        "level": "error",
        "message": "grm ERROR [RenderWithStyles] ░░ Couldn't load style link [href: chrome-extension://kbfnbcaeplbcioakkpcpgfkobkghlhen/src/css/knowledgeHubIntegration.styles.css] t",
        "timestamp": "2026-11-17T17:06:41.500Z",
        "url": "chrome-extension://kbfnbcaeplbcioakkpcpgfkobkghlhen/src/js/Grammarly.js"
      },
      {
        "level": "error",
        "message": "grm ERROR [RenderWithStyles] ░░ Couldn't load style link [href: chrome-extension://kbfnbcaeplbcioakkpcpgfkobkghlhen/src/css/cheetah.styles.css] t",
        "timestamp": "2026-11-17T17:06:41.500Z",
        "url": "chrome-extension://kbfnbcaeplbcioakkpcpgfkobkghlhen/src/js/Grammarly.js"
      },
      {
        "level": "error",
        "message": "grm ERROR [RenderWithStyles] ░░ Couldn't load style link [href: chrome-extension://kbfnbcaeplbcioakkpcpgfkobkghlhen/src/css/snippets_templating.styles.css] t",
        "timestamp": "2026-11-17T17:06:41.500Z",
        "url": "chrome-extension://kbfnbcaeplbcioakkpcpgfkobkghlhen/src/js/Grammarly.js"
      },
      {
        "level": "error",
        "message": "grm ERROR [RenderWithStyles] ░░ Couldn't load style link [href: chrome-extension://kbfnbcaeplbcioakkpcpgfkobkghlhen/src/css/cheetah.styles.css] t",
        "timestamp": "2026-11-17T17:06:41.500Z",
        "url": "chrome-extension://kbfnbcaeplbcioakkpcpgfkobkghlhen/src/js/Grammarly.js"
      },
      {
        "level": "error",
        "message": "grm ERROR [RenderWithStyles] ░░ Couldn't load style link [href: chrome-extension://kbfnbcaeplbcioakkpcpgfkobkghlhen/src/css/snippets.styles.css] t",
        "timestamp": "2026-11-17T17:06:41.500Z",
        "url": "chrome-extension://kbfnbcaeplbcioakkpcpgfkobkghlhen/src/js/Grammarly.js"
      },
      {
        "level": "warn",
        "message": "[Telemetry.TS.AgentsExperimentationService]: WARN : Requested gate not found in ALL_GATES:  personalized_humanizer_agent_poc_gate",
        "timestamp": "2026-11-17T17:06:41.500Z",
        "url": "chrome-extension://kbfnbcaeplbcioakkpcpgfkobkghlhen/src/js/Grammarly.js"
      },
      {
        "level": "warn",
        "message": "[Telemetry.TS.AgentsExperimentationService]: WARN : Requested experiment not found in ALL_EXPERIMENTS:  personalized_humanizer_v1",
        "timestamp": "2026-11-17T17:06:41.500Z",
        "url": "chrome-extension://kbfnbcaeplbcioakkpcpgfkobkghlhen/src/js/Grammarly.js"
      },
      {
        "level": "error",
        "message": "grm ERROR [RenderWithStyles] ░░ Couldn't load style link [href: chrome-extension://kbfnbcaeplbcioakkpcpgfkobkghlhen/src/css/cheetah.styles.css] t",
        "timestamp": "2026-11-17T17:06:41.501Z",
        "url": "chrome-extension://kbfnbcaeplbcioakkpcpgfkobkghlhen/src/js/Grammarly.js"
      }
    ]
  }
]
```

## Claude Code receipts

```json
[
  {
    "log": "rewire-output-reveal-claude.jsonl",
    "model": "claude-fable-5-2",
    "permissionMode": "acceptEdits"
  },
  {
    "log": "rewire-output-review-followup.jsonl",
    "model": "claude-fable-5-2",
    "permissionMode": "acceptEdits"
  }
]
```
