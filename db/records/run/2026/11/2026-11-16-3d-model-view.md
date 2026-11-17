---
type: run
id: 01m7kqadj13h1kgt0ecrcngja1
created: 2026-11-17T03:03:00.929266+00:00
updated: 2026-11-17T03:19:52.691477+00:00
summary: 3D model view release gate, new suite listing and bundle sizes
captured_at: 2026-11-16
command: corepack pnpm build:deploy; app vitest run test/stage-*.test.ts(x) --reporter=verbose; node entry-graph size script on app/dist; seeded-defect reruns
devices: '[[records/devices/dev-mac-m5-pro]]'
discarded: 'false'
title: 3D model view release gate, new suite listing and bundle sizes
tool: pnpm, vitest, vite and node
---
# 3D model view: release gate and suite output

Captured on the development Mac after the second implementation pass, which applied the review that followed the first browser session. Everything here ran in Node: unit tests, type checks, the production build and the pinned-model gate. No browser was opened and no model was loaded for this record, so nothing in it is a rendering, frame-rate or GPU result. The first pass's gate output (146 app tests, 48 of them new) was replaced by the output below.

## Release gate

Command: `corepack pnpm build:deploy` (app tests, engine lifecycle tests, all type checks, the Vite build and `node app/scripts/check-deployment.mjs`), run on the final code. The pipeline finished with the passed gate on its last line and the build printed no warnings.

```text
$ corepack pnpm test:deploy && corepack pnpm build && node app/scripts/check-deployment.mjs
$ corepack pnpm --filter @rewire/app test && corepack pnpm --filter @rewire/engine exec vitest run test/lifecycle.test.ts && corepack pnpm -r typecheck
$ vitest run

 RUN  v5.0.3 /Users/carlos/Projects/rewire/app


 Test Files  15 passed (15)
      Tests  155 passed (155)
   Start at  22:15:53
   Duration  399ms (transform 62%, tests 28%, import 9%, worker 1%)


 RUN  v5.0.3 /Users/carlos/Projects/rewire/engine


 Test Files  1 passed (1)
      Tests  2 passed (2)
   Start at  22:15:54
   Duration  69ms (transform 69%, import 18%, tests 8%, worker 5%)

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
✓ 78 modules transformed.
rendering chunks...
computing gzip size...
dist/index.html                            1.58 kB │ gzip:   0.61 kB
dist/assets/webgl-d1MbwhuX-CjKyEkHn.js    13.75 kB
dist/assets/webgpu-D5edCWOx-k64hHtlv.js   51.95 kB
dist/assets/worker-uEA5rHp5.js           123.72 kB
dist/assets/train.worker-C-3YBaps.js     276.22 kB
dist/assets/index-D7gB-gMA.css            52.05 kB │ gzip:  10.84 kB
dist/assets/lora-BHkFzEsB.js               0.24 kB │ gzip:   0.22 kB │ map:     3.53 kB
dist/assets/data-DIV4Z2n1.js               0.40 kB │ gzip:   0.31 kB │ map:     2.73 kB
dist/assets/config-gPGJkNBC.js             0.66 kB │ gzip:   0.40 kB │ map:     2.91 kB
dist/assets/playback-CXFx8irS.js           1.59 kB │ gzip:   0.77 kB │ map:     7.52 kB
dist/assets/engine-SFJeONri.js             3.91 kB │ gzip:   1.44 kB │ map:    14.01 kB
dist/assets/TeachStage-DHJRG05m.js         6.66 kB │ gzip:   2.72 kB │ map:    15.61 kB
dist/assets/GrowStage-BGcnMK96.js          8.82 kB │ gzip:   3.33 kB │ map:    21.09 kB
dist/assets/useNarrow-D_XwiTG3.js         12.68 kB │ gzip:   5.12 kB │ map:    46.93 kB
dist/assets/DismantleStage-CgsPlGBI.js    18.70 kB │ gzip:   6.79 kB │ map:    57.43 kB
dist/assets/TinyView-DW_OXBPl.js          22.19 kB │ gzip:   7.91 kB │ map:    53.96 kB
dist/assets/Workbench-CFW1oLUf.js         22.64 kB │ gzip:   8.89 kB │ map:    78.96 kB
dist/assets/TeachView-uy4Eoq-0.js         23.88 kB │ gzip:   8.12 kB │ map:    52.03 kB
dist/assets/Modal-fKouUl_X.js             48.09 kB │ gzip:  17.65 kB │ map:   123.61 kB
dist/assets/index-BdNUMBZE.js            301.69 kB │ gzip:  92.27 kB │ map: 1,246.77 kB
dist/assets/stage-DNlNfcO-.js            627.29 kB │ gzip: 158.74 kB │ map: 3,111.55 kB

✓ built in 201ms
{"status":"passed","model":"carloslfu/Qwen3-0.6B-Rewire-4bit","revision":"4fa041dd7caf1e8a94b2f05b8949999fca1e58af","manifest":"88f069237c4d548d41953cbd7f9e8a07b73abd94a104a433154939c4d5f81f61","base":"/rewire/","inference":"on-device"}
```

## The new suites, test by test

Command: `corepack pnpm exec vitest run test/stage-arch.test.ts test/stage-playback.test.ts test/stage-intervene.test.ts test/stage-data.test.ts test/stage-scene.test.ts test/stage-bench.test.tsx test/stage-labels.test.ts --reporter=verbose` in `app/`.

```text
 ✓ test/stage-labels.test.ts > keeps a label on its point when there is room and inside the view when there is not 1ms
 ✓ test/stage-labels.test.ts > shows the most important labels and never lets two touch, or cover the toolbar 0ms
 ✓ test/stage-labels.test.ts > reserves the top of the view only where the toolbar sits above the model 0ms
 ✓ test/stage-labels.test.ts > makes the page behind the full view inert and restores it exactly 1ms
 ✓ test/stage-labels.test.ts > stacks the full view above the sticky page header 1ms
 ✓ test/stage-playback.test.ts > replays the architecture in the order it computes: token in, each layer's attention then MLP, token out 5ms
 ✓ test/stage-playback.test.ts > adds up the measured pushes of exactly the parts that have run 0ms
 ✓ test/stage-playback.test.ts > advances only while playing, at the chosen speed, and stops at the end 0ms
 ✓ test/stage-playback.test.ts > steps and scrubs within the replay, and lights a part only from its own beat 0ms
 ✓ test/stage-playback.test.ts > brings a layer's plates up in computation order, only during that layer's own beats 1ms
 ✓ test/stage-arch.test.ts > draws every real component of both models exactly once, at a stable index 6ms
 ✓ test/stage-arch.test.ts > seats query heads on the key/value group the engine gives them 1ms
 ✓ test/stage-arch.test.ts > reads each part's push from the same slot the 2D tower uses 2ms
 ✓ test/stage-arch.test.ts > stacks layers upward in order without overlapping modules 10ms
 ✓ test/stage-arch.test.ts > moves the keyboard selection over the tower's own grid 1ms
 ✓ test/stage-intervene.test.ts > writes the same change spec as the 2D strength control for every kind of part 57ms
 ✓ test/stage-intervene.test.ts > restores exactly a part's own changes and names the button for that scope 3ms
 ✓ test/stage-intervene.test.ts > poses each part from the change spec alone 1ms
 ✓ test/stage-intervene.test.ts > maps 3D parts to the inspector's panels and back 1ms
 ✓ test/stage-intervene.test.ts > a punch runs one real changed generation, and a second punch restores the original answers 2ms
 ✓ test/stage-intervene.test.ts > keeps every punch in a quick series, each from the newest changes 1ms
 ✓ test/stage-intervene.test.ts > refuses to edit while a reply is being written, while teaching, or before the model is ready 1ms
 ✓ test/stage-data.test.ts > places a token's measured pushes on the parts that made them and nothing on the rest 5ms
 ✓ test/stage-data.test.ts > gives every weight of a tiny-model layer to exactly one part 4ms
 ✓ test/stage-data.test.ts > colors each tiny-model part from its own slice of the real parameters 46ms
 ✓ test/stage-data.test.ts > shows tiny-model matrices as their real weights or their real change 32ms
 ✓ test/stage-data.test.ts > pools large tensors by keeping the strongest value, sign included 8ms
 ✓ test/stage-data.test.ts > turns one inspection pass into the layer's steps in computation order, skipping what was not captured 1ms
 ✓ test/stage-data.test.ts > fits any context into the tray without losing attention 0ms
 ✓ test/stage-data.test.ts > reads the taught adapter's real matrices, rank by rank 5ms
 ✓ test/stage-data.test.ts > paints values with the page's ramps and never emits an invalid color 0ms
 ✓ test/stage-data.test.ts > drops a measurement that resolves after the token, model or changes moved on 0ms
 ✓ test/stage-data.test.ts > settles springs on their target and survives long or broken frames 0ms
 ✓ test/stage-scene.test.ts > draws the whole model in a fixed, small number of draw calls 15ms
 ✓ test/stage-scene.test.ts > picks the part under the pointer, through decoration, for every kind of part 8ms
 ✓ test/stage-scene.test.ts > poses parts from the change spec and lets them be picked where they now are 15ms
 ✓ test/stage-scene.test.ts > opens the tower above a layer for the detail bay and closes it again 27ms
 ✓ test/stage-scene.test.ts > lets parts be rearranged without touching their pose, and puts them back on reset 3ms
 ✓ test/stage-scene.test.ts > moves instantly under reduced motion and ignores kicks 1ms
 ✓ test/stage-scene.test.ts > frees every geometry and material it created 2ms
 ✓ test/stage-scene.test.ts > lays plates out in reading order and reads back the exact tile under the pointer 4ms
 ✓ test/stage-scene.test.ts > frames a box completely for tall, square and wide stages 1ms
 ✓ test/stage-scene.test.ts > frames the model inside the clear part of the view when the toolbar and labels take the rest 0ms
 ✓ test/stage-scene.test.ts > renders only when something changed, and stops asking for frames when idle 7ms
 ✓ test/stage-scene.test.ts > runs the replay clock to the end, reports it, and then goes idle 3ms
 ✓ test/stage-scene.test.ts > keeps every label it shows inside the view, off the toolbar and apart from the others 22ms
 ✓ test/stage-scene.test.ts > follows the replay through the selected layer's plates and a reduced-motion change made while open 2ms
 ✓ test/stage-scene.test.ts > does not draw while hidden or collapsed to nothing 2ms
 ✓ test/stage-scene.test.ts > selects on click, punches once per click in Punch, and reports a refused punch without moving the model 3ms
 ✓ test/stage-scene.test.ts > stops cleanly when the WebGL context is lost 2ms
 ✓ test/stage-scene.test.ts > releases its listeners, observers, frames, DOM and GPU context on dispose 2ms
 ✓ test/stage-scene.test.ts > refuses to start without WebGL, leaving nothing behind 0ms
 ✓ test/stage-bench.test.tsx > explains itself and holds every model edit until the model is ready 127ms
 ✓ test/stage-bench.test.tsx > shows a selected part's real controls and measured value, and locks them while a reply is written 12ms
 ✓ test/stage-bench.test.tsx > offers the 3D view from the flat scope and falls back to it when WebGL is unavailable 18ms
 ✓ test/stage-bench.test.tsx > keeps Teach's training controls in the 3D bench and never offers Punch there 13ms
 ✓ test/stage-bench.test.tsx > gates Grow's weight edits on a trained, idle model 40ms
 Test Files  7 passed (7)
      Tests  57 passed (57)
```

## Entry graph and lazy chunk

A Node script walked the static imports of the built entry chunk named in `app/dist/index.html` and summed the files, then looked for the Three.js chunk in that graph. Run on the same final build. Its gzip figure comes from Node's default `zlib.gzipSync` and differs slightly from the one Vite prints.

```text
 static: assets/index-BdNUMBZE.js 301693
 static: assets/useNarrow-D_XwiTG3.js 12684
 static: assets/Modal-fKouUl_X.js 48095
 static: assets/data-DIV4Z2n1.js 404
 static: assets/config-gPGJkNBC.js 666
entry static JS total kB 363.54 gzip kB 114.78
stage chunk stage-DNlNfcO-.js kB 627.30 gzip kB 157.63 in entry graph: false
```

Baseline, built from commit `a26c79b` with the working tree stashed (`git stash -u`, `corepack pnpm build`, `git stash pop`) during the first pass:

```text
dist/assets/index-DwJ5pZ0a.css            41.92 kB │ gzip:   9.17 kB
dist/assets/index-BPw0O71J.js            360.72 kB │ gzip: 112.67 kB │ map: 1,417.58 kB
```

## Shadow map constant

Three.js r187 removed `PCFSoftShadowMap` and warns when it is requested. The source now sets `PCFShadowMap`. A search of the built stage chunk finds the name only inside Three.js's own warning string, on the branch taken when the removed type is requested.

```text
app/src/stage/scene/stage.ts:164:    r.shadowMap.enabled = this.shadows; r.shadowMap.type = THREE.PCFShadowMap; r.shadowMap.autoUpdate = false;
this.type===2&&(V(`WebGLShadowMap: PCFSoftShadowMap has been removed. Using PCFShadowMap instead.`),this.type=1)
```

## Scene size without a GPU

During the first pass a scratch script built the specimen for both models in Node and counted its parts and its mesh and line objects. This counts objects that issue a draw call when visible. It is not a frame capture. The suites still assert the part counts and an upper bound on these objects.

```text
qwen-dock parts 731 drawCalls 24
tiny-dock parts 35 drawCalls 24
```

## Seeded defects

First pass. Before the detail bay moved inside the tower, seven defects were introduced one at a time and the five scene and data suites of that moment (42 tests) were rerun after each. Sources were restored afterwards and the 42 tests passed.

```text
--- kvGroup broken
   × seats query heads on the key/value group the engine gives them
      Tests  1 failed | 41 passed (42)
--- punch never restores
   × writes the same change spec as the 2D strength control for every kind of part
   × a punch runs one real changed generation, and a second punch restores the original answers
      Tests  2 failed | 40 passed (42)
--- stale results delivered
   × drops a measurement that resolves after the token, model or changes moved on
      Tests  1 failed | 41 passed (42)
--- listeners leaked
   × releases its listeners, observers, frames, DOM and GPU context on dispose
      Tests  1 failed | 41 passed (42)
--- renders every frame
   × renders only when something changed, and stops asking for frames when idle
   × runs the replay clock to the end, reports it, and then goes idle
      Tests  2 failed | 40 passed (42)
--- running push skips MLP
   × adds up the measured pushes of exactly the parts that have run
      Tests  1 failed | 41 passed (42)
--- head owns wrong o columns
   × gives every weight of a tiny-model layer to exactly one part
   × colors each tiny-model part from its own slice of the real parameters
      Tests  2 failed | 40 passed (42)
--- restored
      Tests  42 passed (42)
```

Second pass. Eight more defects, one for each boundary the review named, were introduced one at a time and the whole app suite of that moment (154 tests) was rerun after each. Sources were restored afterwards and the 154 tests passed. One test, the check of the full view's stacking order in the stylesheet, was added after this run and is not covered by it.

```text
--- value credited to block start
   × shows tiny-model matrices as their real weights or their real change 34ms
   × pools large tensors by keeping the strongest value, sign included 8ms
   × reads the taught adapter's real matrices, rank by rank 6ms
      Tests  3 failed | 151 passed (154)
--- edge block counted as full
   × pools large tensors by keeping the strongest value, sign included 10ms
      Tests  1 failed | 153 passed (154)
--- layer restore leaves zeroed
   × restores exactly a part's own changes and names the button for that scope 6ms
      Tests  1 failed | 153 passed (154)
--- labels ignore toolbar
   × shows the most important labels and never lets two touch, or cover the toolbar 3ms
      Tests  1 failed | 153 passed (154)
--- labels not clamped
   × keeps a label on its point when there is room and inside the view when there is not 3ms
      Tests  1 failed | 153 passed (154)
--- framing ignores toolbar
   × keeps every label it shows inside the view, off the toolbar and apart from the others 13ms
      Tests  1 failed | 153 passed (154)
--- plates all at once
   × brings a layer's plates up in computation order, only during that layer's own beats 2ms
   × follows the replay through the selected layer's plates and a reduced-motion change made while open 5ms
      Tests  2 failed | 152 passed (154)
--- dialogs made inert
   × makes the page behind the full view inert and restores it exactly 9ms
      Tests  1 failed | 153 passed (154)
--- restored
      Tests  154 passed (154)
```
