---
type: run
id: 01m6kzh4nvshvyk4w5zqhm1zh7
created: 2026-11-04T19:10:47.995460+00:00
updated: 2026-11-04T19:10:47.995460+00:00
summary: Unicode token rendering release checks and Chrome observations
captured_at: 2026-11-04
command: corepack pnpm build:deploy; engine vitest run test/tokenizer.test.ts; Chrome UI at localhost port 5178
devices: '[[records/devices/dev-mac-m5-pro]]'
discarded: 'false'
title: Unicode token rendering release checks and Chrome observations
tool: pnpm, vitest and Chrome cua_repl
---
# Unicode decoding verification

Local release build and Chrome UI observations before deployment. Model weights, sampling and token IDs are unchanged. The browser ran the pinned Qwen3-0.6B 4-bit model on device. The 390 by 844 viewport override was reset. Browser evidence records actual output; the Hindi reply is a rendering check, not a language-quality result.

## Exact release build output

```text
Scope: all 4 workspace projects
(node:47870) [DEP0169] DeprecationWarning: `url.parse()` behavior is not standardized and prone to errors that have security implications. Use the WHATWG URL API instead. CVEs are not issued for `url.parse()` vulnerabilities.
(Use `node --trace-deprecation ...` to show where the warning was created)
[?25l[?25l[?25l[?25l[36m?[39m [1mThe modules directory at "/Users/carlos/Projects/rewire/node_modules" will be removed and reinstalled from scratch. Proceed?[22m [2m(Y/n)[22m [2m›[22m [36mtrue[39m[4D[36m?[39m [1mThe modules directory at "/Users/carlos/Projects/rewire/engine/node_modules" will be removed and reinstalled from scratch. Proceed?[22m [2m(Y/n)[22m [2m›[22m [36mtrue[39m[4D[36m?[39m [1mThe modules directory at "/Users/carlos/Projects/rewire/tiny/node_modules" will be removed and reinstalled from scratch. Proceed?[22m [2m(Y/n)[22m [2m›[22m [36mtrue[39m[4D[36m?[39m [1mThe modules directory at "/Users/carlos/Projects/rewire/app/node_modules" will be removed and reinstalled from scratch. Proceed?[22m [2m(Y/n)[22m [2m›[22m [36mtrue[39m[4D[?25h[?25h[?25h[?25h$ corepack pnpm test:deploy && corepack pnpm build && node app/scripts/check-deployment.mjs
$ corepack pnpm --filter @rewire/app test && corepack pnpm --filter @rewire/engine exec vitest run test/lifecycle.test.ts && corepack pnpm -r typecheck
$ vitest run

 RUN  v5.0.3 /Users/carlos/Projects/rewire/app


 Test Files  8 passed (8)
      Tests  98 passed (98)
   Start at  14:09:03
   Duration  227ms (transform 61%, tests 26%, import 11%, worker 2%)


 RUN  v5.0.3 /Users/carlos/Projects/rewire/engine


 Test Files  1 passed (1)
      Tests  2 passed (2)
   Start at  14:09:04
   Duration  65ms (transform 64%, import 21%, tests 9%, worker 6%)

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
✓ 56 modules transformed.
rendering chunks...
computing gzip size...
dist/index.html                            1.25 kB │ gzip:   0.53 kB
dist/assets/webgl-d1MbwhuX-CjKyEkHn.js    13.75 kB
dist/assets/webgpu-D5edCWOx-k64hHtlv.js   51.95 kB
dist/assets/worker-uEA5rHp5.js           123.72 kB
dist/assets/train.worker-C-3YBaps.js     276.22 kB
dist/assets/index-DwJ5pZ0a.css            41.92 kB │ gzip:   9.17 kB
dist/assets/engine-SFJeONri.js             3.91 kB │ gzip:   1.44 kB │ map:    14.01 kB
dist/assets/TinyView-fRgiGsOO.js          20.99 kB │ gzip:   7.43 kB │ map:    54.48 kB
dist/assets/TeachView-u4lWpYfD.js         23.11 kB │ gzip:   7.83 kB │ map:    56.60 kB
dist/assets/index-BPw0O71J.js            360.72 kB │ gzip: 112.67 kB │ map: 1,417.58 kB

✓ built in 180ms
{"status":"passed","model":"carloslfu/Qwen3-0.6B-Rewire-4bit","revision":"4fa041dd7caf1e8a94b2f05b8949999fca1e58af","manifest":"88f069237c4d548d41953cbd7f9e8a07b73abd94a104a433154939c4d5f81f61","base":"/rewire/","inference":"on-device"}

```

## Exact cached tokenizer parity output

```text

 RUN  v5.0.3 /Users/carlos/Projects/rewire/engine


 Test Files  1 passed (1)
      Tests  4 passed (4)
   Start at  14:09:52
   Duration  272ms (import 91%, transform 7%, tests 2%, worker 1%)


```

## Browser observations

```json
{
  "greeting": "Sample 1\n\nhey buddy\nEdit\nRemove\nOriginal\nOn this device\nHey buddy! What's up? 😊\nWhat the model actually reads",
  "emojiTitle": "Spans tokens 8 to 9. Select individual parts in Word piece.",
  "continuationInspected": {
    "id": 232,
    "label": "UTF-8 bytes 8A"
  },
  "hindiPaused": "Sample 1\n\nहिंदी में नमस्ते कहो।\nEdit\nRemove\nOriginal\nOn this device\nहिंदी में नमस्ते राज्य राजगार और दुरुपयोग बराबर रूप में वाक्षित कि\nStopped at 64 word pieces.\nContinue\nWhat the model actually reads",
  "hindiContinued": "Sample 1\n\nहिंदी में नमस्ते कहो।\nEdit\nRemove\nOriginal\nOn this device\nहिंदी में नमस्ते राज्य राजगार और दुरुपयोग बराबर रूप में वाक्षित किया जाता है।\nWhat the model actually reads",
  "phone": {
    "width": 390,
    "scrollWidth": 390,
    "removeUndoPreservesEmoji": true,
    "inspector": "Inside the model\nClose\nWord piece\n1. Hey\n2. buddy\n3. !\n4. What\n5. 's\n6. up\n7. ?\n8. UTF-8 bytes 20 F0 9F 98\n9. UTF-8 bytes 8A\nOriginal reply · On this device\nExplore the full model\nWHAT IT IS\n\"UTF-8 bytes 20 F0 9F 98\"\n\nWord piece · token · id 26525\n\nA word piece the model wrote. It was drawn from the candidates below.\n\nThis token contains bytes of a character. The reply combines them with neighboring tokens; each part keeps its own probability and controls.\n\nITS NUMBERS\nProbability when drawn\n70% at temperature 0.7\nAt temperature 1\n55%\nCandidates\n\nThe draw used the top 2 after the cut (top-p 0.8).\n\n1. UTF-8 bytes 20 F0 9F 98\t70%\t\n\t\n2. <|im_end|>\t14%\t\n\tUse this word\n3. Let\t13%\t\n\tUse this word\n4. UTF-8 bytes 20 F0 9F\t1%\t\n\tUse this word\n5. Have\t<1%\t\n\tUse this word\nShow all 20 candidates\nChange this word’s dictionary entry"
  },
  "console": [
    {
      "level": "warn",
      "message": "[DEFAULT]: WARN : Using DEFAULT root logger",
      "timestamp": "2026-11-04T19:09:24.661Z",
      "url": "chrome-extension://kbfnbcaeplbcioakkpcpgfkobkghlhen/src/js/Grammarly.js"
    },
    {
      "level": "error",
      "message": "grm ERROR [RenderWithStyles] ░░ Couldn't load style link [href: chrome-extension://kbfnbcaeplbcioakkpcpgfkobkghlhen/src/css/snippets_templating.styles.css] t",
      "timestamp": "2026-11-04T19:09:24.766Z",
      "url": "chrome-extension://kbfnbcaeplbcioakkpcpgfkobkghlhen/src/js/Grammarly.js"
    },
    {
      "level": "error",
      "message": "grm ERROR [RenderWithStyles] ░░ Couldn't load style link [href: chrome-extension://kbfnbcaeplbcioakkpcpgfkobkghlhen/src/css/snippets.styles.css] t",
      "timestamp": "2026-11-04T19:09:25.153Z",
      "url": "chrome-extension://kbfnbcaeplbcioakkpcpgfkobkghlhen/src/js/Grammarly.js"
    },
    {
      "level": "warn",
      "message": "[Telemetry.TS.AgentsExperimentationService]: WARN : Requested gate not found in ALL_GATES:  personalized_humanizer_agent_poc_gate",
      "timestamp": "2026-11-04T19:09:25.970Z",
      "url": "chrome-extension://kbfnbcaeplbcioakkpcpgfkobkghlhen/src/js/Grammarly.js"
    },
    {
      "level": "warn",
      "message": "[Telemetry.TS.AgentsExperimentationService]: WARN : Requested experiment not found in ALL_EXPERIMENTS:  personalized_humanizer_v1",
      "timestamp": "2026-11-04T19:09:25.971Z",
      "url": "chrome-extension://kbfnbcaeplbcioakkpcpgfkobkghlhen/src/js/Grammarly.js"
    }
  ],
  "changed": "Sample 1\n\nhey buddy\nEdit\nRemove\nOriginal\nOn this device\nHey buddy! What's up? 😊\nChanged: Layer 15 off\nOn this device\nHello! How can I help you today?\nWhat the model actually reads",
  "restored": "Sample 1\n\nhey buddy\nEdit\nRemove\nOriginal\nOn this device\nHey buddy! What's up? 😊\nWhat the model actually reads"
}
```
