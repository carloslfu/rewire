---
type: run
id: 01m7n2c0pm49y4ywgcm4g1jthz
created: 2026-11-17T15:35:22.068302+00:00
updated: 2026-11-17T15:35:22.068302+00:00
summary: Follow output release gate and Chrome evidence
captured_at: 2026-11-17
command: NODE_OPTIONS=--max-old-space-size=1536 corepack pnpm build:deploy; node app/scripts/throttled-serve.mjs 5199 0 0; Chrome UI checks through CUA
devices: '[[records/devices/dev-mac-m5-pro]]'
discarded: 'false'
title: Follow output release gate and Chrome evidence
tool: Claude Code, pnpm, Chrome through CUA
---
# Follow output release and browser evidence

Implemented with Claude Code using `claude-fable-5-2`, confirmed in the session result's canonical model field. The reviewing agent exercised the built application in Chrome with the production content security policy. These are functional checks, not performance benchmarks. Training durations printed by the interface below are incidental and are not accepted performance measurements.

## Exact release output

```text
$ corepack pnpm test:deploy && corepack pnpm build && node app/scripts/check-deployment.mjs
$ corepack pnpm --filter @rewire/app test && corepack pnpm --filter @rewire/engine exec vitest run test/lifecycle.test.ts && corepack pnpm -r typecheck
$ vitest run

 RUN  v5.0.3 /Users/carlos/Projects/rewire/app


 Test Files  16 passed (16)
      Tests  182 passed (182)
   Start at  10:29:45
   Duration  796ms (transform 54%, tests 36%, import 9%, worker 1%)


 RUN  v5.0.3 /Users/carlos/Projects/rewire/engine


 Test Files  1 passed (1)
      Tests  2 passed (2)
   Start at  10:29:46
   Duration  66ms (transform 64%, import 21%, tests 9%, worker 6%)

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
✓ 89 modules transformed.
rendering chunks...
computing gzip size...
dist/index.html                            1.58 kB │ gzip:   0.61 kB
dist/assets/webgl-d1MbwhuX-CjKyEkHn.js    13.75 kB
dist/assets/webgpu-D5edCWOx-k64hHtlv.js   51.95 kB
dist/assets/worker-uEA5rHp5.js           123.72 kB
dist/assets/train.worker-C-3YBaps.js     276.22 kB
dist/assets/index-B0EUV-gT.css            57.50 kB │ gzip:  12.03 kB
dist/assets/lora-BHkFzEsB.js               0.24 kB │ gzip:   0.22 kB │ map:     3.53 kB
dist/assets/data-DIV4Z2n1.js               0.40 kB │ gzip:   0.31 kB │ map:     2.73 kB
dist/assets/config-gPGJkNBC.js             0.66 kB │ gzip:   0.40 kB │ map:     2.91 kB
dist/assets/playback-CY9Y145Y.js           2.00 kB │ gzip:   0.88 kB │ map:     9.54 kB
dist/assets/engine-SFJeONri.js             3.91 kB │ gzip:   1.44 kB │ map:    14.01 kB
dist/assets/TeachStage-D5xipSuh.js         6.66 kB │ gzip:   2.72 kB │ map:    15.61 kB
dist/assets/GrowStage-B6NGd0yO.js          8.84 kB │ gzip:   3.34 kB │ map:    21.11 kB
dist/assets/useNarrow-Cs_YC-7K.js         12.71 kB │ gzip:   5.14 kB │ map:    47.68 kB
dist/assets/DismantleStage-CzLmtfYl.js    18.53 kB │ gzip:   6.77 kB │ map:    57.29 kB
dist/assets/TinyView-B7aHwx1t.js          22.19 kB │ gzip:   7.90 kB │ map:    53.96 kB
dist/assets/TeachView-LCu2vcuY.js         23.89 kB │ gzip:   8.13 kB │ map:    52.11 kB
dist/assets/Workbench-DIEjuBFs.js         31.25 kB │ gzip:  11.47 kB │ map:    99.46 kB
dist/assets/Modal-CGF5WhCW.js             49.58 kB │ gzip:  18.26 kB │ map:   132.56 kB
dist/assets/index-CPtekger.js            301.87 kB │ gzip:  92.33 kB │ map: 1,247.90 kB
dist/assets/stage-DdMFYmfZ.js            678.94 kB │ gzip: 174.56 kB │ map: 3,310.09 kB

✓ built in 245ms
{"status":"passed","model":"carloslfu/Qwen3-0.6B-Rewire-4bit","revision":"4fa041dd7caf1e8a94b2f05b8949999fca1e58af","manifest":"88f069237c4d548d41953cbd7f9e8a07b73abd94a104a433154939c4d5f81f61","base":"/rewire/","inference":"on-device"}

exit status: 0

```

## Captured browser states

```json
{
  "testedAt": "2026-11-17T15:34:27.670Z",
  "checks": [
    {
      "label": "fresh waiting",
      "follow": [
        {
          "description": "Following: waiting for the first token.",
          "pressed": "true"
        }
      ],
      "replay": [],
      "samples": [],
      "selection": [],
      "speed": [],
      "transport": []
    },
    {
      "label": "first question paused",
      "follow": [
        {
          "description": "Paused on this token. New replies will not move it.",
          "pressed": "false"
        }
      ],
      "replay": [],
      "samples": [
        {
          "question": "What is the capital of France?",
          "replies": [
            "Original: The capital of France is Paris."
          ]
        }
      ],
      "selection": [
        "\u2039\u201cThe\u201d\u203aOriginal reply \u00b7 token 1"
      ],
      "speed": [],
      "transport": []
    },
    {
      "label": "resume first latest",
      "follow": [
        {
          "description": "Following: the newest token is selected as it is written.",
          "pressed": "true"
        }
      ],
      "replay": [],
      "samples": [
        {
          "question": "What is the capital of France?",
          "replies": [
            "Original: The capital of France is Paris."
          ]
        }
      ],
      "selection": [
        "\u2039\u201c.\u201d\u203aOriginal reply \u00b7 token 7"
      ],
      "speed": [],
      "transport": []
    },
    {
      "label": "new question preserves paused Paris",
      "follow": [
        {
          "description": "Paused on this token. New replies will not move it.",
          "pressed": "false"
        }
      ],
      "replay": [],
      "samples": [
        {
          "question": "What is the capital of France?",
          "replies": [
            "Original: The capital of France is Paris."
          ]
        },
        {
          "question": "Name three planets.",
          "replies": [
            "Original: Three planets are Mercury, Venus, and Mars."
          ]
        }
      ],
      "selection": [
        "\u2039\u201cParis\u201d\u203aOriginal reply \u00b7 token 6"
      ],
      "speed": [],
      "transport": []
    },
    {
      "label": "resume latest new sample",
      "follow": [
        {
          "description": "Following: the newest token is selected as it is written.",
          "pressed": "true"
        }
      ],
      "replay": [],
      "samples": [
        {
          "question": "What is the capital of France?",
          "replies": [
            "Original: The capital of France is Paris."
          ]
        },
        {
          "question": "Name three planets.",
          "replies": [
            "Original: Three planets are Mercury, Venus, and Mars."
          ]
        }
      ],
      "selection": [
        "\u2039\u201c.\u201d\u203aOriginal reply \u00b7 token 10"
      ],
      "speed": [],
      "transport": []
    },
    {
      "label": "older edited sample followed",
      "follow": [
        {
          "description": "Following: the newest token is selected as it is written.",
          "pressed": "true"
        }
      ],
      "replay": [],
      "samples": [
        {
          "question": "What is the capital of Italy?",
          "replies": [
            "Original: The capital of Italy is Rome."
          ]
        },
        {
          "question": "Name three planets.",
          "replies": [
            "Original: Three planets are Mercury, Venus, and Mars."
          ]
        }
      ],
      "selection": [
        "\u2039\u201c.\u201d\u203aOriginal reply \u00b7 token 7"
      ],
      "speed": [],
      "transport": []
    },
    {
      "label": "resume tracks older active sample",
      "follow": [
        {
          "description": "Following: the newest token is selected as it is written.",
          "pressed": "true"
        }
      ],
      "replay": [],
      "samples": [
        {
          "question": "What is the capital of Italy?",
          "replies": [
            "Original: The capital of Italy is Rome."
          ]
        },
        {
          "question": "Name three planets.",
          "replies": [
            "Original: Three planets are Mercury, Venus, and Mars."
          ]
        }
      ],
      "selection": [
        "\u2039\u201c.\u201d\u203aOriginal reply \u00b7 token 7"
      ],
      "speed": [],
      "transport": []
    },
    {
      "label": "remove active falls back",
      "follow": [
        {
          "description": "Following: the newest token is selected as it is written.",
          "pressed": "true"
        }
      ],
      "replay": [],
      "samples": [
        {
          "question": "Name three planets.",
          "replies": [
            "Original: Three planets are Mercury, Venus, and Mars."
          ]
        }
      ],
      "selection": [
        "\u2039\u201c.\u201d\u203aOriginal reply \u00b7 token 10"
      ],
      "speed": [],
      "transport": []
    },
    {
      "label": "remove final honest waiting",
      "follow": [
        {
          "description": "Following: waiting for the first token.",
          "pressed": "true"
        }
      ],
      "replay": [],
      "samples": [],
      "selection": [],
      "speed": [],
      "transport": []
    },
    {
      "label": "undo final restores valid selection",
      "follow": [
        {
          "description": "Following: the newest token is selected as it is written.",
          "pressed": "true"
        }
      ],
      "replay": [],
      "samples": [
        {
          "question": "Name three planets.",
          "replies": [
            "Original: Three planets are Mercury, Venus, and Mars."
          ]
        }
      ],
      "selection": [
        "\u2039\u201c.\u201d\u203aOriginal reply \u00b7 token 10"
      ],
      "speed": [],
      "transport": []
    },
    {
      "label": "model flip follows latest changed",
      "follow": [
        {
          "description": "Following: the newest token is selected as it is written.",
          "pressed": "true"
        }
      ],
      "replay": [],
      "samples": [
        {
          "question": "Name three planets.",
          "replies": [
            "Original: Three planets are Mercury, Venus, and Mars.",
            "Changed: Attention head 14 on layer 21 flipped: Three planets are Mercury, Venus, and Mars."
          ]
        },
        {
          "question": "What is the capital of France?",
          "replies": [
            "Original: The capital of France is Paris.",
            "Changed: Attention head 14 on layer 21 flipped: "
          ]
        }
      ],
      "selection": [
        "\u2039\u201c.\u201d\u203aChanged reply \u00b7 token 10"
      ],
      "speed": [],
      "transport": []
    },
    {
      "label": "difference follows newest original",
      "follow": [
        {
          "description": "Following: the newest token is selected as it is written.",
          "pressed": "true"
        }
      ],
      "replay": [],
      "samples": [
        {
          "question": "Name three planets.",
          "replies": [
            "Original: Three planets are Mercury, Venus, and Mars.",
            "Changed: Attention head 14 on layer 21 flipped: Three planets are Mercury, Venus, and Mars."
          ]
        },
        {
          "question": "What is the capital of France?",
          "replies": [
            "Original: The capital of France is Paris.",
            "Changed: Attention head 14 on layer 21 flipped: The capital of France is Washington, D.C."
          ]
        }
      ],
      "selection": [
        "\u2039\u201c.\u201d\u203aOriginal reply \u00b7 token 7"
      ],
      "speed": [],
      "transport": []
    },
    {
      "label": "difference after model edit stays latest original",
      "follow": [
        {
          "description": "Following: the newest token is selected as it is written.",
          "pressed": "true"
        }
      ],
      "replay": [],
      "samples": [
        {
          "question": "Name three planets.",
          "replies": [
            "Original: Three planets are Mercury, Venus, and Mars.",
            "Changed: Attention head 14 on layer 21 off: Three planets are Mercury, Venus, and Mars."
          ]
        },
        {
          "question": "What is the capital of France?",
          "replies": [
            "Original: The capital of France is Paris.",
            "Changed: Attention head 14 on layer 21 off: "
          ]
        }
      ],
      "selection": [
        "\u2039\u201c.\u201d\u203aOriginal reply \u00b7 token 7"
      ],
      "speed": [],
      "transport": []
    },
    {
      "label": "push after difference follows changed",
      "follow": [
        {
          "description": "Following: the newest token is selected as it is written.",
          "pressed": "true"
        }
      ],
      "replay": [],
      "samples": [
        {
          "question": "Name three planets.",
          "replies": [
            "Original: Three planets are Mercury, Venus, and Mars.",
            "Changed: Attention head 14 on layer 21 off: Three planets are Mercury, Venus, and Mars."
          ]
        },
        {
          "question": "What is the capital of France?",
          "replies": [
            "Original: The capital of France is Paris.",
            "Changed: Attention head 14 on layer 21 off: The capital of France is Paris."
          ]
        }
      ],
      "selection": [
        "\u2039\u201c.\u201d\u203aChanged reply \u00b7 token 7"
      ],
      "speed": [],
      "transport": []
    },
    {
      "label": "paused changed invalidation falls back original",
      "follow": [
        {
          "description": "Paused on this token. New replies will not move it.",
          "pressed": "false"
        }
      ],
      "replay": [],
      "samples": [
        {
          "question": "Name three planets.",
          "replies": [
            "Original: Three planets are Mercury, Venus, and Mars.",
            "Changed: Attention head 14 on layer 21 flipped: Three planets are Mercury, Venus, and Mars."
          ]
        },
        {
          "question": "What is the capital of France?",
          "replies": [
            "Original: The capital of France is Paris.",
            "Changed: Attention head 14 on layer 21 flipped: "
          ]
        }
      ],
      "selection": [
        "\u2039\u201cParis\u201d\u203aOriginal reply \u00b7 token 6"
      ],
      "speed": [],
      "transport": []
    },
    {
      "label": "restore preserves paused original",
      "follow": [
        {
          "description": "Paused on this token. New replies will not move it.",
          "pressed": "false"
        }
      ],
      "replay": [],
      "samples": [
        {
          "question": "Name three planets.",
          "replies": [
            "Original: Three planets are Mercury, Venus, and Mars."
          ]
        },
        {
          "question": "What is the capital of France?",
          "replies": [
            "Original: The capital of France is Paris."
          ]
        }
      ],
      "selection": [
        "\u2039\u201cParis\u201d\u203aOriginal reply \u00b7 token 6"
      ],
      "speed": [],
      "transport": []
    },
    {
      "label": "3D preserves paused Paris",
      "follow": [
        {
          "description": "Paused on this token. New replies will not move it. Replay animates this one token.",
          "pressed": "false"
        }
      ],
      "replay": [
        "58"
      ],
      "samples": [
        {
          "question": "Name three planets.",
          "replies": [
            "Original: Three planets are Mercury, Venus, and Mars."
          ]
        },
        {
          "question": "What is the capital of France?",
          "replies": [
            "Original: The capital of France is Paris."
          ]
        }
      ],
      "selection": [
        "\u2039\u201cParis\u201d\u203aOriginal reply \u00b7 token 6PushChange from original"
      ],
      "speed": [
        "1"
      ],
      "transport": [
        {
          "disabled": false,
          "text": "Replay"
        },
        {
          "disabled": false,
          "text": "Back"
        },
        {
          "disabled": true,
          "text": "Step"
        },
        {
          "disabled": false,
          "text": "Follow output"
        }
      ]
    },
    {
      "label": "3D Back pauses following",
      "follow": [
        {
          "description": "Paused on this token. New replies will not move it. Replay animates this one token.",
          "pressed": "false"
        }
      ],
      "replay": [
        "57"
      ],
      "samples": [
        {
          "question": "Name three planets.",
          "replies": [
            "Original: Three planets are Mercury, Venus, and Mars."
          ]
        },
        {
          "question": "What is the capital of France?",
          "replies": [
            "Original: The capital of France is Paris."
          ]
        }
      ],
      "selection": [
        "\u2039\u201c.\u201d\u203aOriginal reply \u00b7 token 7PushChange from original"
      ],
      "speed": [
        "2"
      ],
      "transport": [
        {
          "disabled": false,
          "text": "Play"
        },
        {
          "disabled": false,
          "text": "Back"
        },
        {
          "disabled": false,
          "text": "Step"
        },
        {
          "disabled": false,
          "text": "Follow output"
        }
      ]
    },
    {
      "label": "same token resume completes and stops",
      "follow": [
        {
          "description": "Following: the newest token is selected as it is written. Replay animates one token and pauses following.",
          "pressed": "true"
        }
      ],
      "replay": [
        "58"
      ],
      "samples": [
        {
          "question": "Name three planets.",
          "replies": [
            "Original: Three planets are Mercury, Venus, and Mars."
          ]
        },
        {
          "question": "What is the capital of France?",
          "replies": [
            "Original: The capital of France is Paris."
          ]
        }
      ],
      "selection": [
        "\u2039\u201c.\u201d\u203aOriginal reply \u00b7 token 7PushChange from original"
      ],
      "speed": [
        "2"
      ],
      "transport": [
        {
          "disabled": false,
          "text": "Replay"
        },
        {
          "disabled": false,
          "text": "Back"
        },
        {
          "disabled": true,
          "text": "Step"
        },
        {
          "disabled": false,
          "text": "Follow output"
        }
      ]
    },
    {
      "label": "scrub pauses at beginning",
      "follow": [
        {
          "description": "Paused on this token. New replies will not move it. Replay animates this one token.",
          "pressed": "false"
        }
      ],
      "replay": [
        "0"
      ],
      "samples": [
        {
          "question": "Name three planets.",
          "replies": [
            "Original: Three planets are Mercury, Venus, and Mars."
          ]
        },
        {
          "question": "What is the capital of France?",
          "replies": [
            "Original: The capital of France is Paris."
          ]
        }
      ],
      "selection": [
        "\u2039\u201c.\u201d\u203aOriginal reply \u00b7 token 7PushChange from original"
      ],
      "speed": [
        "2"
      ],
      "transport": [
        {
          "disabled": false,
          "text": "Play"
        },
        {
          "disabled": false,
          "text": "Back"
        },
        {
          "disabled": false,
          "text": "Step"
        },
        {
          "disabled": false,
          "text": "Follow output"
        }
      ]
    },
    {
      "label": "Step stays paused",
      "follow": [
        {
          "description": "Paused on this token. New replies will not move it. Replay animates this one token.",
          "pressed": "false"
        }
      ],
      "replay": [
        "1"
      ],
      "samples": [
        {
          "question": "Name three planets.",
          "replies": [
            "Original: Three planets are Mercury, Venus, and Mars."
          ]
        },
        {
          "question": "What is the capital of France?",
          "replies": [
            "Original: The capital of France is Paris."
          ]
        }
      ],
      "selection": [
        "\u2039\u201c.\u201d\u203aOriginal reply \u00b7 token 7PushChange from original"
      ],
      "speed": [
        "2"
      ],
      "transport": [
        {
          "disabled": false,
          "text": "Play"
        },
        {
          "disabled": false,
          "text": "Back"
        },
        {
          "disabled": false,
          "text": "Step"
        },
        {
          "disabled": false,
          "text": "Follow output"
        }
      ]
    },
    {
      "label": "Play pauses following",
      "follow": [
        {
          "description": "Paused on this token. New replies will not move it. Replay animates this one token.",
          "pressed": "false"
        }
      ],
      "replay": [
        "1.25"
      ],
      "samples": [
        {
          "question": "Name three planets.",
          "replies": [
            "Original: Three planets are Mercury, Venus, and Mars."
          ]
        },
        {
          "question": "What is the capital of France?",
          "replies": [
            "Original: The capital of France is Paris."
          ]
        }
      ],
      "selection": [
        "\u2039\u201c.\u201d\u203aOriginal reply \u00b7 token 7PushChange from original"
      ],
      "speed": [
        "2"
      ],
      "transport": [
        {
          "disabled": false,
          "text": "Pause"
        },
        {
          "disabled": false,
          "text": "Back"
        },
        {
          "disabled": false,
          "text": "Step"
        },
        {
          "disabled": false,
          "text": "Follow output"
        }
      ]
    },
    {
      "label": "resume during replay completes",
      "follow": [
        {
          "description": "Following: the newest token is selected as it is written. Replay animates one token and pauses following.",
          "pressed": "true"
        }
      ],
      "replay": [
        "58"
      ],
      "samples": [
        {
          "question": "Name three planets.",
          "replies": [
            "Original: Three planets are Mercury, Venus, and Mars."
          ]
        },
        {
          "question": "What is the capital of France?",
          "replies": [
            "Original: The capital of France is Paris."
          ]
        }
      ],
      "selection": [
        "\u2039\u201c.\u201d\u203aOriginal reply \u00b7 token 7PushChange from original"
      ],
      "speed": [
        "2"
      ],
      "transport": [
        {
          "disabled": false,
          "text": "Replay"
        },
        {
          "disabled": false,
          "text": "Back"
        },
        {
          "disabled": true,
          "text": "Step"
        },
        {
          "disabled": false,
          "text": "Follow output"
        }
      ]
    },
    {
      "label": "3D follows live story",
      "follow": [
        {
          "description": "Following: the newest token is selected as it is written. Replay animates one token and pauses following.",
          "pressed": "true"
        }
      ],
      "replay": [
        "58"
      ],
      "samples": [
        {
          "question": "Name three planets.",
          "replies": [
            "Original: Three planets are Mercury, Venus, and Mars."
          ]
        },
        {
          "question": "What is the capital of France?",
          "replies": [
            "Original: The capital of France is Paris."
          ]
        },
        {
          "question": "Write a detailed story about an astronaut exploring a strange planet.",
          "replies": [
            "Original: Astronaut Dr. Elara Voss, equipped with advanced life support systems, ventured into the alien expanse of Vrykara Prime. The planet was"
          ]
        }
      ],
      "selection": [
        "\u2039\u201cwas\u201d\u203aOriginal reply \u00b7 token 33PushChange from original"
      ],
      "speed": [
        "2"
      ],
      "transport": [
        {
          "disabled": false,
          "text": "Replay"
        },
        {
          "disabled": false,
          "text": "Back"
        },
        {
          "disabled": true,
          "text": "Step"
        },
        {
          "disabled": false,
          "text": "Follow output"
        }
      ]
    },
    {
      "label": "pause during story",
      "follow": [
        {
          "description": "Paused on this token. New replies will not move it. Replay animates this one token.",
          "pressed": "false"
        }
      ],
      "replay": [
        "58"
      ],
      "samples": [
        {
          "question": "Name three planets.",
          "replies": [
            "Original: Three planets are Mercury, Venus, and Mars."
          ]
        },
        {
          "question": "What is the capital of France?",
          "replies": [
            "Original: The capital of France is Paris."
          ]
        },
        {
          "question": "Write a detailed story about an astronaut exploring a strange planet.",
          "replies": [
            "Original: Astronaut Dr. Elara Voss, equipped with advanced life support systems, ventured into the alien expanse of Vrykara Prime. The planet was a surreal landscape, with towering crystalline spires and shifting, luminous rivers that pulsed with an unusual energy. As she descended deeper, she encountered"
          ]
        }
      ],
      "selection": [
        "\u2039\u201cshe\u201d\u203aOriginal reply \u00b7 token 63PushChange from original"
      ],
      "speed": [
        "2"
      ],
      "transport": [
        {
          "disabled": false,
          "text": "Replay"
        },
        {
          "disabled": false,
          "text": "Back"
        },
        {
          "disabled": true,
          "text": "Step"
        },
        {
          "disabled": false,
          "text": "Follow output"
        }
      ]
    },
    {
      "label": "Continue keeps paused token",
      "follow": [
        {
          "description": "Paused on this token. New replies will not move it. Replay animates this one token.",
          "pressed": "false"
        }
      ],
      "replay": [
        "58"
      ],
      "samples": [
        {
          "question": "Name three planets.",
          "replies": [
            "Original: Three planets are Mercury, Venus, and Mars."
          ]
        },
        {
          "question": "What is the capital of France?",
          "replies": [
            "Original: The capital of France is Paris."
          ]
        },
        {
          "question": "Write a detailed story about an astronaut exploring a strange planet.",
          "replies": [
            "Original: Astronaut Dr. Elara Voss, equipped with advanced life support systems, ventured into the alien expanse of Vrykara Prime. The planet was a surreal landscape, with towering crystalline spires and shifting, luminous rivers that pulsed with an unusual energy. As she descended deeper, she encountered a hidden valley where the air shimmered with a strange glow. The terrain seemed to shift, and the air grew thick with an unseen force. Elara\u2019s team followed the anomaly,"
          ]
        }
      ],
      "selection": [
        "\u2039\u201cshe\u201d\u203aOriginal reply \u00b7 token 63PushChange from original"
      ],
      "speed": [
        "2"
      ],
      "transport": [
        {
          "disabled": false,
          "text": "Replay"
        },
        {
          "disabled": false,
          "text": "Back"
        },
        {
          "disabled": true,
          "text": "Step"
        },
        {
          "disabled": false,
          "text": "Follow output"
        }
      ]
    },
    {
      "label": "Continue resumes latest",
      "follow": [
        {
          "description": "Following: the newest token is selected as it is written. Replay animates one token and pauses following.",
          "pressed": "true"
        }
      ],
      "replay": [
        "58"
      ],
      "samples": [
        {
          "question": "Name three planets.",
          "replies": [
            "Original: Three planets are Mercury, Venus, and Mars."
          ]
        },
        {
          "question": "What is the capital of France?",
          "replies": [
            "Original: The capital of France is Paris."
          ]
        },
        {
          "question": "Write a detailed story about an astronaut exploring a strange planet.",
          "replies": [
            "Original: Astronaut Dr. Elara Voss, equipped with advanced life support systems, ventured into the alien expanse of Vrykara Prime. The planet was a surreal landscape, with towering crystalline spires and shifting, luminous rivers that pulsed with an unusual energy. As she descended deeper, she encountered a hidden valley where the air shimmered with a strange glow. The terrain seemed to shift, and the air grew thick with an unseen force. Elara\u2019s team followed the anomaly, eventually discovering a massive, spherical formation that pulsed with the same energy. The discovery led to the conclusion that the planet was a living"
          ]
        }
      ],
      "selection": [
        "\u2039\u201cliving\u201d\u203aOriginal reply \u00b7 token 128PushChange from original"
      ],
      "speed": [
        "2"
      ],
      "transport": [
        {
          "disabled": false,
          "text": "Replay"
        },
        {
          "disabled": false,
          "text": "Back"
        },
        {
          "disabled": true,
          "text": "Step"
        },
        {
          "disabled": false,
          "text": "Follow output"
        }
      ]
    },
    {
      "label": "2D follows same live output",
      "follow": [
        {
          "description": "Following: the newest token is selected as it is written.",
          "pressed": "true"
        }
      ],
      "replay": [],
      "samples": [
        {
          "question": "Name three planets.",
          "replies": [
            "Original: Three planets are Mercury, Venus, and Mars."
          ]
        },
        {
          "question": "What is the capital of France?",
          "replies": [
            "Original: The capital of France is Paris."
          ]
        },
        {
          "question": "Write a detailed story about an astronaut exploring a strange planet.",
          "replies": [
            "Original: Astronaut Dr. Elara Voss, equipped with advanced life support systems, ventured into the alien expanse of Vrykara Prime. The planet was a surreal landscape, with towering crystalline spires and shifting, luminous rivers that pulsed with an unusual energy. As she descended deeper, she encountered a hidden valley where the air shimmered with a strange glow. The terrain seemed to shift, and the air grew thick with an unseen force. Elara\u2019s team followed the anomaly, eventually discovering a massive, spherical formation that pulsed with the same energy. The discovery led to the conclusion that the planet was a living"
          ]
        }
      ],
      "selection": [
        "\u2039\u201cliving\u201d\u203aOriginal reply \u00b7 token 128"
      ],
      "speed": [],
      "transport": []
    },
    {
      "label": "mobile 2D Enter pauses",
      "follow": [
        {
          "description": "Paused on this token. New replies will not move it.",
          "pressed": "false"
        }
      ],
      "replay": [],
      "samples": [
        {
          "question": "Name three planets.",
          "replies": [
            "Original: Three planets are Mercury, Venus, and Mars."
          ]
        },
        {
          "question": "What is the capital of France?",
          "replies": [
            "Original: The capital of France is Paris."
          ]
        },
        {
          "question": "Write a detailed story about an astronaut exploring a strange planet.",
          "replies": [
            "Original: Astronaut Dr. Elara Voss, equipped with advanced life support systems, ventured into the alien expanse of Vrykara Prime. The planet was a surreal landscape, with towering crystalline spires and shifting, luminous rivers that pulsed with an unusual energy. As she descended deeper, she encountered a hidden valley where the air shimmered with a strange glow. The terrain seemed to shift, and the air grew thick with an unseen force. Elara\u2019s team followed the anomaly, eventually discovering a massive, spherical formation that pulsed with the same energy. The discovery led to the conclusion that the planet was a living"
          ]
        }
      ],
      "selection": [
        "\u2039\u201cliving\u201d\u203aOriginal reply \u00b7 token 128"
      ],
      "speed": [],
      "transport": []
    },
    {
      "label": "mobile 3D keyboard pauses",
      "follow": [
        {
          "description": "Paused on this token. New replies will not move it. Replay animates this one token.",
          "pressed": "false"
        }
      ],
      "replay": [
        "58"
      ],
      "samples": [
        {
          "question": "Name three planets.",
          "replies": [
            "Original: Three planets are Mercury, Venus, and Mars."
          ]
        },
        {
          "question": "What is the capital of France?",
          "replies": [
            "Original: The capital of France is Paris."
          ]
        },
        {
          "question": "Write a detailed story about an astronaut exploring a strange planet.",
          "replies": [
            "Original: Astronaut Dr. Elara Voss, equipped with advanced life support systems, ventured into the alien expanse of Vrykara Prime. The planet was a surreal landscape, with towering crystalline spires and shifting, luminous rivers that pulsed with an unusual energy. As she descended deeper, she encountered a hidden valley where the air shimmered with a strange glow. The terrain seemed to shift, and the air grew thick with an unseen force. Elara\u2019s team followed the anomaly, eventually discovering a massive, spherical formation that pulsed with the same energy. The discovery led to the conclusion that the planet was a living"
          ]
        }
      ],
      "selection": [
        "\u2039\u201cliving\u201d\u203aOriginal reply \u00b7 token 128PushChange from original"
      ],
      "speed": [
        "1"
      ],
      "transport": [
        {
          "disabled": false,
          "text": "Replay"
        },
        {
          "disabled": false,
          "text": "Back"
        },
        {
          "disabled": true,
          "text": "Step"
        },
        {
          "disabled": false,
          "text": "Follow output"
        }
      ]
    },
    {
      "label": "mobile 3D 320px geometry",
      "button": {
        "bottom": 392.140625,
        "height": 44,
        "left": 16,
        "right": 136.3984375,
        "top": 348.140625,
        "width": 120.3984375,
        "x": 16,
        "y": 348.140625
      },
      "documentWidth": 320,
      "hint": {
        "bottom": 435.328125,
        "height": 37.1875,
        "left": 16,
        "right": 304,
        "top": 398.140625,
        "width": 288,
        "x": 16,
        "y": 398.140625
      },
      "viewport": 320
    },
    {
      "label": "Tiny training completed",
      "state": [
        "  - status: 1200 training steps in 20.7 seconds. The weights are ready to test.",
        "  - generic: Step 1200",
        "  - heading \"Last checkpoint \u00b7 1200\" [level=3]",
        "  - img \"Loss over 1200 steps, now 0.07\"",
        "    - generic: 1,200 steps \u00b7 loss 0.070",
        "    - status: 1200 training steps in 20.7 seconds. The weights are ready to test."
      ]
    },
    {
      "label": "tiny paused first letter visible",
      "follow": [
        {
          "description": "Paused on this token. New replies will not move it.",
          "pressed": "false"
        }
      ],
      "replay": [],
      "samples": [
        {
          "question": "red circle =",
          "replies": [
            "Your tiny model: zor mip\nred ring = zor saz\nred cross = zor hir\nblue circle = vek mip\nblue star = vek wug\nblue moon = vek pel\nblue ringcle = saz\nred cross = zor hir\nred ringcle"
          ]
        }
      ],
      "selection": [
        "\u2039\u201c\" \"\u201d\u203aOriginal reply \u00b7 token 1"
      ],
      "speed": [],
      "transport": []
    },
    {
      "label": "tiny new prompt preserves off and valid fallback",
      "follow": [
        {
          "description": "Paused on this token. New replies will not move it.",
          "pressed": "false"
        }
      ],
      "replay": [],
      "samples": [
        {
          "question": "blue square =",
          "replies": [
            "Your tiny model: vek kef\nblue star = vek wug\nblue moon = vek pel\nblue ring = vek saz\nblue cross = vek hir\ngreen circle = nup pel\ngreen ring = nup sare square = vek kef\nblue dar"
          ]
        }
      ],
      "selection": [
        "\u2039\u201c\" \"\u201d\u203aOriginal reply \u00b7 token 1"
      ],
      "speed": [],
      "transport": []
    },
    {
      "label": "tiny resume latest letter",
      "follow": [
        {
          "description": "Following: the newest token is selected as it is written.",
          "pressed": "true"
        }
      ],
      "replay": [],
      "samples": [
        {
          "question": "blue square =",
          "replies": [
            "Your tiny model: vek kef\nblue star = vek wug\nblue moon = vek pel\nblue ring = vek saz\nblue cross = vek hir\ngreen circle = nup pel\ngreen ring = nup sare square = vek kef\nblue dar"
          ]
        }
      ],
      "selection": [
        "\u2039\u201cr\u201d\u203aOriginal reply \u00b7 token 160"
      ],
      "speed": [],
      "transport": []
    },
    {
      "label": "tiny 3D Back pauses",
      "follow": [
        {
          "description": "Paused on this token. New replies will not move it. Replay animates this one token.",
          "pressed": "false"
        }
      ],
      "replay": [
        "9"
      ],
      "samples": [
        {
          "question": "blue square =",
          "replies": [
            "Your tiny model: vek kef\nblue star = vek wug\nblue moon = vek pel\nblue ring = vek saz\nblue cross = vek hir\ngreen circle = nup pel\ngreen ring = nup sare square = vek kef\nblue dar"
          ]
        }
      ],
      "selection": [
        "\u2039\u201cr\u201d\u203aOriginal reply \u00b7 token 160PushChange from original"
      ],
      "speed": [
        "1"
      ],
      "transport": [
        {
          "disabled": false,
          "text": "Play"
        },
        {
          "disabled": false,
          "text": "Back"
        },
        {
          "disabled": false,
          "text": "Step"
        },
        {
          "disabled": false,
          "text": "Follow output"
        }
      ]
    },
    {
      "label": "tiny same token resume",
      "follow": [
        {
          "description": "Following: the newest token is selected as it is written. Replay animates one token and pauses following.",
          "pressed": "true"
        }
      ],
      "replay": [
        "10"
      ],
      "samples": [
        {
          "question": "blue square =",
          "replies": [
            "Your tiny model: vek kef\nblue star = vek wug\nblue moon = vek pel\nblue ring = vek saz\nblue cross = vek hir\ngreen circle = nup pel\ngreen ring = nup sare square = vek kef\nblue dar"
          ]
        }
      ],
      "selection": [
        "\u2039\u201cr\u201d\u203aOriginal reply \u00b7 token 160PushChange from original"
      ],
      "speed": [
        "1"
      ],
      "transport": [
        {
          "disabled": false,
          "text": "Replay"
        },
        {
          "disabled": false,
          "text": "Back"
        },
        {
          "disabled": true,
          "text": "Step"
        },
        {
          "disabled": false,
          "text": "Follow output"
        }
      ]
    },
    {
      "label": "console errors",
      "application": [],
      "extensionErrors": [
        {
          "level": "error",
          "message": "grm ERROR [RenderWithStyles] \u2591\u2591 Couldn't load style link [href: chrome-extension://kbfnbcaeplbcioakkpcpgfkobkghlhen/src/css/knowledgeHubIntegration.styles.css] t",
          "timestamp": "2026-11-17T15:31:24.375Z",
          "url": "chrome-extension://kbfnbcaeplbcioakkpcpgfkobkghlhen/src/js/Grammarly.js"
        },
        {
          "level": "error",
          "message": "grm ERROR [RenderWithStyles] \u2591\u2591 Couldn't load style link [href: chrome-extension://kbfnbcaeplbcioakkpcpgfkobkghlhen/src/css/cheetah.styles.css] t",
          "timestamp": "2026-11-17T15:31:24.385Z",
          "url": "chrome-extension://kbfnbcaeplbcioakkpcpgfkobkghlhen/src/js/Grammarly.js"
        },
        {
          "level": "error",
          "message": "grm ERROR [RenderWithStyles] \u2591\u2591 Couldn't load style link [href: chrome-extension://kbfnbcaeplbcioakkpcpgfkobkghlhen/src/css/cheetah.styles.css] t",
          "timestamp": "2026-11-17T15:31:24.385Z",
          "url": "chrome-extension://kbfnbcaeplbcioakkpcpgfkobkghlhen/src/js/Grammarly.js"
        },
        {
          "level": "error",
          "message": "grm ERROR [RenderWithStyles] \u2591\u2591 Couldn't load style link [href: chrome-extension://kbfnbcaeplbcioakkpcpgfkobkghlhen/src/css/snippets_templating.styles.css] t",
          "timestamp": "2026-11-17T15:31:24.385Z",
          "url": "chrome-extension://kbfnbcaeplbcioakkpcpgfkobkghlhen/src/js/Grammarly.js"
        },
        {
          "level": "error",
          "message": "grm ERROR [RenderWithStyles] \u2591\u2591 Couldn't load style link [href: chrome-extension://kbfnbcaeplbcioakkpcpgfkobkghlhen/src/css/snippets.styles.css] t",
          "timestamp": "2026-11-17T15:31:24.451Z",
          "url": "chrome-extension://kbfnbcaeplbcioakkpcpgfkobkghlhen/src/js/Grammarly.js"
        },
        {
          "level": "error",
          "message": "grm ERROR [RenderWithStyles] \u2591\u2591 Couldn't load style link [href: chrome-extension://kbfnbcaeplbcioakkpcpgfkobkghlhen/src/css/cheetah.styles.css] t",
          "timestamp": "2026-11-17T15:31:24.909Z",
          "url": "chrome-extension://kbfnbcaeplbcioakkpcpgfkobkghlhen/src/js/Grammarly.js"
        },
        {
          "level": "error",
          "message": "grm ERROR [RenderWithStyles] \u2591\u2591 Couldn't load style link [href: chrome-extension://kbfnbcaeplbcioakkpcpgfkobkghlhen/src/css/cheetah.styles.css] t",
          "timestamp": "2026-11-17T15:31:30.417Z",
          "url": "chrome-extension://kbfnbcaeplbcioakkpcpgfkobkghlhen/src/js/Grammarly.js"
        },
        {
          "level": "error",
          "message": "grm ERROR [RenderWithStyles] \u2591\u2591 Couldn't load style link [href: chrome-extension://kbfnbcaeplbcioakkpcpgfkobkghlhen/src/css/snippets_templating.styles.css] t",
          "timestamp": "2026-11-17T15:31:30.435Z",
          "url": "chrome-extension://kbfnbcaeplbcioakkpcpgfkobkghlhen/src/js/Grammarly.js"
        },
        {
          "level": "error",
          "message": "grm ERROR [RenderWithStyles] \u2591\u2591 Couldn't load style link [href: chrome-extension://kbfnbcaeplbcioakkpcpgfkobkghlhen/src/css/cheetah.styles.css] t",
          "timestamp": "2026-11-17T15:31:30.435Z",
          "url": "chrome-extension://kbfnbcaeplbcioakkpcpgfkobkghlhen/src/js/Grammarly.js"
        },
        {
          "level": "error",
          "message": "grm ERROR [RenderWithStyles] \u2591\u2591 Couldn't load style link [href: chrome-extension://kbfnbcaeplbcioakkpcpgfkobkghlhen/src/css/cheetah.styles.css] t",
          "timestamp": "2026-11-17T15:31:31.235Z",
          "url": "chrome-extension://kbfnbcaeplbcioakkpcpgfkobkghlhen/src/js/Grammarly.js"
        }
      ]
    }
  ]
}
```
