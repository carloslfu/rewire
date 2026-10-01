---
type: run
id: 01m3wkfq2yjdjyhvgjnma49m9f
created: 2026-10-01T20:46:22.814459+00:00
updated: 2026-10-01T20:46:22.814459+00:00
summary: Trained-model retry regression and final production build
captured_at: 2026-10-01T20:46:22.809847+00:00
command: pnpm --filter @rewire/app test; pnpm --filter @rewire/app build
devices: '[[records/devices/dev-mac-m5-pro]]'
discarded: 'false'
title: Trained-model retry regression and final production build
tool: pnpm / Vitest / TypeScript / Vite
---
```text
$ vitest run

 RUN  v5.0.3 /Users/carlos/Projects/rewire/app


 Test Files  3 passed (3)
      Tests  17 passed (17)
   Start at  15:45:36
   Duration  113ms (transform 59%, tests 24%, import 12%, worker 4%)

$ tsc --noEmit && vite build
vite v8.3.1 building client environment for production...
transforming...
✓ 38 modules transformed.
rendering chunks...
computing gzip size...
dist/index.html                            0.75 kB │ gzip:  0.43 kB
dist/assets/webgl-d1MbwhuX-DERGirEb.js    13.75 kB
dist/assets/webgpu-D5edCWOx-TuzlPirz.js   51.95 kB
dist/assets/worker-DvTqaIzp.js           102.11 kB
dist/assets/train.worker-C0vczQcz.js     275.41 kB
dist/assets/index-Cxaljg7k.css            14.01 kB │ gzip:  3.91 kB
dist/assets/engine-uHFwNjDo.js             3.10 kB │ gzip:  1.21 kB │ map:    11.44 kB
dist/assets/TinyView-BhmHHOc3.js           9.45 kB │ gzip:  3.69 kB │ map:    25.99 kB
dist/assets/index-DCJOT4w_.js            306.70 kB │ gzip: 96.36 kB │ map: 1,303.84 kB

✓ built in 261ms

```
