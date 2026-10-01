---
type: run
id: 01m3wjcw6wmvw3a7gkr4g47782
created: 2026-10-01T20:27:21.180145+00:00
updated: 2026-10-01T20:27:21.180145+00:00
summary: Continuation regression tests and production build
captured_at: 2026-10-01T20:27:21.175068+00:00
command: pnpm -r test; pnpm --filter @rewire/app test; pnpm --filter @rewire/app build; pnpm --filter @rewire/engine typecheck
devices: '[[records/devices/dev-mac-m5-pro]]'
discarded: 'false'
title: Continuation regression tests and production build
tool: pnpm / Vitest / TypeScript / Vite
---
```text
Scope: 3 of 4 workspace projects
engine test$ vitest run
engine test:  RUN  v5.0.3 /Users/carlos/Projects/rewire/engine
engine test:  Test Files  5 passed (5)
engine test:       Tests  25 passed (25)
engine test:    Start at  15:20:12
engine test:    Duration  2.78s (tests 85%, import 9%, transform 6%)
engine test: Done
tiny test$ vitest run
tiny test:  RUN  v5.0.3 /Users/carlos/Projects/rewire/tiny
tiny test:  Test Files  2 passed (2)
tiny test:       Tests  5 passed (5)
tiny test:    Start at  15:20:15
tiny test:    Duration  3.77s (tests 97%, transform 3%, import 1%)
tiny test: Done
app test$ vitest run
app test:  RUN  v5.0.3 /Users/carlos/Projects/rewire/app
app test:  Test Files  3 passed (3)
app test:       Tests  15 passed (15)
app test:    Start at  15:20:19
app test:    Duration  106ms (transform 58%, tests 26%, import 12%, worker 4%)
app test: Done

Final app tests after tokenizer cache-version isolation:
$ vitest run

 RUN  v5.0.3 /Users/carlos/Projects/rewire/app


 Test Files  3 passed (3)
      Tests  16 passed (16)
   Start at  15:23:06
   Duration  114ms (transform 55%, tests 26%, import 15%, worker 4%)


Production build:
$ tsc --noEmit && vite build
vite v8.3.1 building client environment for production...
transforming...
✓ 38 modules transformed.
rendering chunks...
computing gzip size...
dist/index.html                            0.75 kB │ gzip:  0.42 kB
dist/assets/webgl-d1MbwhuX-DERGirEb.js    13.75 kB
dist/assets/webgpu-D5edCWOx-TuzlPirz.js   51.95 kB
dist/assets/worker-DvTqaIzp.js           102.11 kB
dist/assets/train.worker-C0vczQcz.js     275.41 kB
dist/assets/index-Cxaljg7k.css            14.01 kB │ gzip:  3.91 kB
dist/assets/engine-BEYw4rge.js             2.92 kB │ gzip:  1.18 kB │ map:    10.87 kB
dist/assets/TinyView-MUfWKvfK.js           9.45 kB │ gzip:  3.69 kB │ map:    25.99 kB
dist/assets/index-C2ZFspOH.js            306.70 kB │ gzip: 96.36 kB │ map: 1,303.84 kB

✓ built in 244ms

```
