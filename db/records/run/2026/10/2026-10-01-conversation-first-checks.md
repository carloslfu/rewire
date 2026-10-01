---
type: run
id: 01m3wqfjp6k2zxbsj1vxwysr2t
created: 2026-10-01T21:56:12.614704+00:00
updated: 2026-10-01T21:56:12.614704+00:00
summary: Conversation-first regression, typecheck, build and preflight output
captured_at: 2026-10-01
command: pnpm test; pnpm -C app build; node app/scripts/preflight.mjs; git diff --check
devices: '[[records/devices/dev-mac-m5-pro]]'
discarded: 'false'
title: Conversation-first automated checks
tool: Terminal
---
## pnpm test

```text
$ pnpm -r test
Scope: 3 of 4 workspace projects
engine test$ vitest run
engine test:  RUN  v5.0.3 <workspace>/engine
engine test:  Test Files  5 passed (5)
engine test:       Tests  25 passed (25)
engine test:    Start at  16:54:17
engine test:    Duration  2.65s (tests 87%, import 8%, transform 5%)
engine test: Done
tiny test$ vitest run
tiny test:  RUN  v5.0.3 <workspace>/tiny
tiny test:  Test Files  2 passed (2)
tiny test:       Tests  5 passed (5)
tiny test:    Start at  16:54:20
tiny test:    Duration  3.56s (tests 98%, transform 2%, import 1%)
tiny test: Done
app test$ vitest run
app test:  RUN  v5.0.3 <workspace>/app
app test:  Test Files  4 passed (4)
app test:       Tests  27 passed (27)
app test:    Start at  16:54:24
app test:    Duration  195ms (tests 47%, transform 44%, import 8%, worker 2%)
app test: Done
```

## pnpm -C app build

```text
$ tsc --noEmit && vite build
vite v8.3.1 building client environment for production...
transforming...
✓ 40 modules transformed.
rendering chunks...
computing gzip size...
dist/index.html                            0.75 kB │ gzip:  0.43 kB
dist/assets/webgl-d1MbwhuX-BSBa2iIN.js    13.75 kB
dist/assets/webgpu-D5edCWOx-BDrXafDe.js   51.95 kB
dist/assets/worker-BDqO0Npv.js           102.21 kB
dist/assets/train.worker-Bb4hm9x6.js     275.43 kB
dist/assets/index-C6o8K6AP.css            18.42 kB │ gzip:  4.88 kB
dist/assets/engine-DVF1xOdA.js             3.15 kB │ gzip:  1.23 kB │ map:    11.60 kB
dist/assets/TinyView-C7D3xd1c.js          11.24 kB │ gzip:  4.31 kB │ map:    30.69 kB
dist/assets/index-DJPx0hYb.js            316.41 kB │ gzip: 99.14 kB │ map: 1,326.73 kB

✓ built in 226ms
```

## node app/scripts/preflight.mjs

```text
{
  "status": "passed",
  "manifest_hash": "88f069237c4d548d41953cbd7f9e8a07b73abd94a104a433154939c4d5f81f61",
  "weight_chunks": 23,
  "weight_bytes": 373100544,
  "download_bytes": 384532930,
  "path_steps": 11,
  "verified_recordings": 10,
  "tokenizer": [
    {
      "name": "tokenizer.json",
      "bytes": 11422654,
      "sha256": "aeb13307a71acd8fe81861d94ad54ab689df773318809eed3cbe794b4492dae4"
    },
    {
      "name": "tokenizer_config.json",
      "bytes": 9732,
      "sha256": "d5d09f07b48c3086c508b30d1c9114bd1189145b74e982a265350c923acd8101"
    }
  ],
  "licenses": "present"
}
```