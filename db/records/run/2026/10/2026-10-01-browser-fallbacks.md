---
type: run
id: 01m3wjcw7z3fn3xq3scr6pd73g
created: 2026-10-01T20:27:21.215690+00:00
updated: 2026-10-01T20:27:21.215690+00:00
summary: Production browser fallback observations
captured_at: 2026-10-01T20:27:21.175068+00:00
command: node app/scripts/browser-qa.mjs; open scenario=no-gpu,crashed,storage,reset,corrupt; simulate reset during a live reply, then Continue
devices: '[[records/devices/dev-mac-m5-pro]]'
discarded: 'false'
title: Production browser fallback observations
tool: cua_repl / Chrome
---
```json
{
  "tool": "cua_repl",
  "method": "Chrome production build, isolated fallback fixtures",
  "observations": [
    {
      "scenario": "no-gpu",
      "observed": {
        "changed": "Changed: Paris and Rome swappedParis's most famous landmark is the Eiffel Tower.",
        "mode": "Replay",
        "status": "This browser can't run the model, so these are recordings of real runs. Browsers with WebGPU, such as recent Chrome, Edge and Safari, can run it live."
      }
    },
    {
      "scenario": "crashed",
      "observed": {
        "mode": "Replay",
        "status": "The model stopped this tab last time, so these are recordings of real runs. Run it live anyway"
      }
    },
    {
      "scenario": "crash-retry",
      "observed": {
        "mode": "Live"
      }
    },
    {
      "scenario": "storage",
      "observed": {
        "mode": "Live",
        "status": "This browser would not keep the model, so it will download again next visit."
      }
    },
    {
      "scenario": "reset-recovered",
      "observed": {
        "mode": "Live",
        "replies": [
          "Reply: Rome's most famous landmark is the Colosseum.",
          "Reply: Alice in Wonderland is a magical story that follows a young girl named Alice who discovers a whimsical world filled with adventure and wonder. The story begins with Alice’s first day in"
        ]
      }
    },
    {
      "scenario": "continued-after-reset",
      "observed": {
        "mode": "Live",
        "replies": [
          "Reply: Rome's most famous landmark is the Colosseum.",
          "Reply: Alice in Wonderland is a magical story that follows a young girl named Alice who discovers a whimsical world filled with adventure and wonder. The story begins with Alice’s first day in Wonderland, where she finds a whimsical garden with flowers that bloom in the moonlight and a castle that appears to be built from glass. In the garden, she meets a wise old owl named Mr. McGregor, who teaches her about kindness and friendship. As she explores the garden, she meets other creatures such as a"
        ]
      }
    },
    {
      "scenario": "corrupt",
      "observed": {
        "mode": "Live"
      },
      "logs": [
        {
          "level": "log",
          "message": "QA_CACHE_REPAIRED true",
          "timestamp": "2026-10-01T20:25:11.641Z",
          "url": "http://localhost:5200/qa.js"
        }
      ]
    }
  ]
}
```
