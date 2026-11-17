---
type: run
id: 01m7mvv6d3q075c6t0b1zbmybd
created: 2026-11-17T13:41:19.395358+00:00
updated: 2026-11-17T13:41:19.395358+00:00
summary: 3D materials and navigation release gate and Chrome evidence
captured_at: 2026-11-17
command: corepack pnpm build:deploy; Chrome interaction checks on the built app with production CSP
devices: '[[records/devices/dev-mac-m5-pro]]'
discarded: 'false'
title: 3D materials and navigation release gate and Chrome evidence
tool: Claude Code, pnpm, Chrome through CUA
---
# Release and browser evidence

Claude Code reported the actual model as `claude-fable-5-2`. The reviewing agent used Chrome to exercise the built application with the production content security policy. This is functional and visual verification, not a performance benchmark. Displayed timings below were not measured under a controlled machine-load protocol and are not accepted performance measurements.

## Release gate

```text
$ corepack pnpm test:deploy && corepack pnpm build && node app/scripts/check-deployment.mjs
$ corepack pnpm --filter @rewire/app test && corepack pnpm --filter @rewire/engine exec vitest run test/lifecycle.test.ts && corepack pnpm -r typecheck
$ vitest run

 RUN  v5.0.3 /Users/carlos/Projects/rewire/app


 Test Files  15 passed (15)
      Tests  169 passed (169)
   Start at  08:38:34
   Duration  1.39s (transform 57%, tests 35%, import 7%, worker 1%)

  Transform  transforming modules took 3.48s · 57% of tracked time, re-done on every run
             persist transforms across runs with fsModuleCache: true
             learn more: https://vitest.dev/guide/improving-performance#caching-between-reruns


 RUN  v5.0.3 /Users/carlos/Projects/rewire/engine


 Test Files  1 passed (1)
      Tests  2 passed (2)
   Start at  08:38:36
   Duration  139ms (transform 60%, import 23%, worker 10%, tests 8%)

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
✓ 88 modules transformed.
rendering chunks...
computing gzip size...
dist/index.html                            1.58 kB │ gzip:   0.61 kB
dist/assets/webgl-d1MbwhuX-CjKyEkHn.js    13.75 kB
dist/assets/webgpu-D5edCWOx-k64hHtlv.js   51.95 kB
dist/assets/worker-uEA5rHp5.js           123.72 kB
dist/assets/train.worker-C-3YBaps.js     276.22 kB
dist/assets/index-1rD0nQO9.css            56.93 kB │ gzip:  11.93 kB
dist/assets/lora-BHkFzEsB.js               0.24 kB │ gzip:   0.22 kB │ map:     3.53 kB
dist/assets/data-DIV4Z2n1.js               0.40 kB │ gzip:   0.31 kB │ map:     2.73 kB
dist/assets/config-gPGJkNBC.js             0.66 kB │ gzip:   0.40 kB │ map:     2.91 kB
dist/assets/playback-CXFx8irS.js           1.59 kB │ gzip:   0.77 kB │ map:     7.52 kB
dist/assets/engine-SFJeONri.js             3.91 kB │ gzip:   1.44 kB │ map:    14.01 kB
dist/assets/TeachStage-Cy82hdH3.js         6.66 kB │ gzip:   2.72 kB │ map:    15.61 kB
dist/assets/GrowStage-DEEIEpr9.js          8.84 kB │ gzip:   3.34 kB │ map:    21.11 kB
dist/assets/useNarrow-D_XwiTG3.js         12.68 kB │ gzip:   5.12 kB │ map:    46.93 kB
dist/assets/DismantleStage-5weqZx68.js    18.71 kB │ gzip:   6.80 kB │ map:    57.51 kB
dist/assets/TinyView-jNTfk-6k.js          22.19 kB │ gzip:   7.91 kB │ map:    53.96 kB
dist/assets/TeachView-CBrvukSv.js         23.88 kB │ gzip:   8.11 kB │ map:    52.03 kB
dist/assets/Workbench-2gF57GLz.js         31.25 kB │ gzip:  11.47 kB │ map:    99.46 kB
dist/assets/Modal-fKouUl_X.js             48.09 kB │ gzip:  17.65 kB │ map:   123.61 kB
dist/assets/index-DA3Sk_Cf.js            301.69 kB │ gzip:  92.27 kB │ map: 1,246.77 kB
dist/assets/stage-CmzLXNZK.js            678.95 kB │ gzip: 174.56 kB │ map: 3,310.09 kB

✓ built in 367ms
{"status":"passed","model":"carloslfu/Qwen3-0.6B-Rewire-4bit","revision":"4fa041dd7caf1e8a94b2f05b8949999fca1e58af","manifest":"88f069237c4d548d41953cbd7f9e8a07b73abd94a104a433154939c4d5f81f61","base":"/rewire/","inference":"on-device"}
exit 0

```

## Real inference and changed answer

```text
Under the hood
2D
3D
Close full view
Qwen3-0.6B · 28 layers · 1 active change
Restore model
Test question
Attention head 14 on layer 21 flipped
×

What is the capital of France?

Original
The capital of France is Paris.
Changed
The capital of France is Washington, D.C.

Select a word to light the parts that pushed for it.

Up
Neurons
Explore
Grab
Punch
Reset layout

Explore. Drag to turn the model. Scroll or pinch to zoom. Click a part to select it, and double-click to focus on it.

Model
›
Layer 21
›
Head 14
?
Select
Nothing
Words out
Layer 28
Layer 27
Layer 26
Layer 25
Layer 24
Layer 23
Layer 22
Layer 21
Layer 20
Layer 19
Layer 18
Layer 17
Layer 16
Layer 15
Layer 14
Layer 13
Layer 12
Layer 11
Layer 10
Layer 9
Layer 8
Layer 7
Layer 6
Layer 5
Layer 4
Layer 3
Layer 2
Layer 1
Words in
Whole layer
Attention head 1
Attention head 2
Attention head 3
Attention head 4
Attention head 5
Attention head 6
Attention head 7
Attention head 8
Attention head 9
Attention head 10
Attention head 11
Attention head 12
Attention head 13
Attention head 14
Attention head 15
Attention head 16
MLP
Keys and values of heads 1 to 2
Keys and values of heads 3 to 4
Keys and values of heads 5 to 6
Keys and values of heads 7 to 8
Keys and values of heads 9 to 10
Keys and values of heads 11 to 12
Keys and values of heads 13 to 14
Keys and values of heads 15 to 16
‹
“.”
›
Changed reply · token 10
Push
Change from original
Replay
Back
Step
Speed
0.5×
1×
2×
4×
✓ Follow output

Every part is lit. Direct pushes add up to +26.99 for “.”.

A slowed replay of this token’s measured values, in the order the model computes them. It is not a timing of the real computation.

Attention head 14 · Layer 21
Close

−0.05 direct push for “.”

Attention head 14 · Layer 21 signal strength
Flip
Off
Normal
×2
×5

Scale the output signal: zero it, reverse it, or amplify it.

Updates each sample separately
Rotate & inspect →
Knock out
Restore this head
Look closer

The plates beside layer 21 are its measured values for “.” in the changed reply. Hover a tile to read its number.

More experiments
Cut layer 1
Cut layer 15
Crush precision
Zero 5 weights
Rotate an attention head
Weight precision: 4 bits

Model changes apply to every sample. Each question is tested independently, with its original answer alongside. Restoring the model brings back the original answers.

What is real in this picture?
```

## Pointer Punch

```text
- link "Skip to questions":
  - /url: "#composer"
- banner:
  - generic: Rewire
  - generic: A language model laboratory
  - navigation "Main":
    - button "Dismantle"
    - button "Teach"
    - button "Grow"
    - button "About"
- generic: Attention head 14 · Layer 21. Select a token to see its push
- main "Independent samples":
  - generic: Qwen3-0.6B · 28 layers
  - generic: Try an example
  - combobox "Try an example":
    - option "Your own experiment" [selected]
    - option "France’s capital"
    - option "Love and attachment"
    - option "Evil and manipulation"
  - generic: Selecting an example clears samples and restores the model.
  - paragraph: Dismantle a model
  - heading "Pull it apart. See what survives." [level=1]
  - paragraph: Ask anything. Cut a layer. Zero real weights. Follow every word through the machinery.
  - region "Test a question":
    - generic "Changes":
      - text: Attention head 14 on layer 21 off
      - 'button "Remove: Attention head 14 on layer 21 off"': ×
    - generic: Try your own question
    - paragraph: Each question runs independently. Earlier questions and answers aren’t included.
    - textbox "Question":
      - /placeholder: Ask anything…
    - button "Test question" [disabled]
    - paragraph: Runs on your device · your messages stay here
  - button "Explore experiments"
  - button "Teach this model something new"
  - button "Grow your own model"
- complementary "Live model visualizer":
  - dialog "Under the hood, full view":
    - heading "Under the hood" [level=2]
    - group "Model view":
      - button "2D"
      - button "3D" [pressed]
    - button "Close full view" [pressed]
    - generic: Qwen3-0.6B · 28 layers · 1 active change
    - button "Restore model"
    - complementary "Question and replies":
      - textbox "Question":
        - /placeholder: Ask anything…
      - button "Test question" [disabled]
      - generic "Changes":
        - text: Attention head 14 on layer 21 off
        - 'button "Remove: Attention head 14 on layer 21 off"': ×
      - paragraph: Ask anything. Each word it writes lights the parts that pushed for it.
    - 'group "3D model of Qwen3-0.6B: 28 layers, each with 16 attention heads and one MLP. Arrow keys move between parts." [active]':
      - group "Tool":
        - button "Explore"
        - button "Grab"
        - button "Punch" [pressed]
      - button "Reset layout" [disabled]
      - paragraph:
        - strong: Punch.
        - text: Click a head, an MLP or a layer to knock it out. Its real output is set to zero and your samples update. Click it again to put it back.
      - navigation "Where you are in the model":
        - button "Model"
        - generic: ›
        - button "Layer 21"
        - generic: ›
        - generic: Head 14
        - group "Step through the layers":
          - button "Down one layer":
            - text: Down one layer · ↓
          - button "Up one layer":
            - text: Up one layer · ↑
      - toolbar "Camera and layout":
        - button "Fit the whole model":
          - text: Fit the whole model · Home
        - button "Focus on the selected part":
          - text: Focus on the selected part · F
        - button "Zoom out":
          - text: Zoom out · −
        - button "Zoom in":
          - text: Zoom in · +
        - 'button "Pan: drags slide the view and clicks do nothing"':
          - text: "Pan: drags slide the view and clicks do nothing · hold Space"
        - button "Spread the layers apart":
          - text: Spread the layers apart · E
        - button "Views":
          - text: Views
        - button "How to move around the model":
          - generic: "?"
          - text: Controls · ?
    - generic: Select
    - combobox "Select":
      - option "Nothing"
      - option "Words out"
      - option "Layer 28"
      - option "Layer 27"
      - option "Layer 26"
      - option "Layer 25"
      - option "Layer 24"
      - option "Layer 23"
      - option "Layer 22"
      - option "Layer 21" [selected]
      - option "Layer 20"
      - option "Layer 19"
      - option "Layer 18"
      - option "Layer 17"
      - option "Layer 16"
      - option "Layer 15"
      - option "Layer 14"
      - option "Layer 13"
      - option "Layer 12"
      - option "Layer 11"
      - option "Layer 10"
      - option "Layer 9"
      - option "Layer 8"
      - option "Layer 7"
      - option "Layer 6"
      - option "Layer 5"
      - option "Layer 4"
      - option "Layer 3"
      - option "Layer 2"
      - option "Layer 1"
      - option "Words in"
    - combobox "Part of layer 21":
      - option "Whole layer"
      - option "Attention head 1"
      - option "Attention head 2"
      - option "Attention head 3"
      - option "Attention head 4"
      - option "Attention head 5"
      - option "Attention head 6"
      - option "Attention head 7"
      - option "Attention head 8"
      - option "Attention head 9"
      - option "Attention head 10"
      - option "Attention head 11"
      - option "Attention head 12"
      - option "Attention head 13"
      - option "Attention head 14" [selected]
      - option "Attention head 15"
      - option "Attention head 16"
      - option "MLP"
      - option "Keys and values of heads 1 to 2"
      - option "Keys and values of heads 3 to 4"
      - option "Keys and values of heads 5 to 6"
      - option "Keys and values of heads 7 to 8"
      - option "Keys and values of heads 9 to 10"
      - option "Keys and values of heads 11 to 12"
      - option "Keys and values of heads 13 to 14"
      - option "Keys and values of heads 15 to 16"
    - region "Replay of the selected token":
      - paragraph: Ask a question to light up the model.
      - group "Colors show":
        - button "Push" [pressed]
        - button "Change from original" [disabled]
      - group "Replay controls":
        - button "Play" [disabled]
        - button "Step back" [disabled]: Back
        - button "Step forward" [disabled]: Step
        - slider "Position in the replay" [disabled]: "58"
        - text: Speed
        - combobox "Speed":
          - option "0.5×"
          - option "1×" [selected]
          - option "2×"
          - option "4×"
        - button "✓ Follow output" [pressed]
      - status: Nothing to replay yet.
      - paragraph: A slowed replay of this token’s measured values, in the order the model computes them. It is not a timing of the real computation.
    - complementary "Selected part and experiments":
      - region "Selected component controls":
        - heading "Attention head 14 · Layer 21" [level=3]
        - button "Close component controls": Close
        - radiogroup "Attention head 14 · Layer 21 signal strength":
          - generic: Attention head 14 · Layer 21 signal strength
          - radio "Flip"
          - radio "Off" [checked]
          - radio "Normal"
          - radio "×2"
          - radio "×5"
        - paragraph: "Scale the output signal: zero it, reverse it, or amplify it."
        - generic: Applies to your samples
        - button "Rotate & inspect →"
      - button "Put back"
      - button "Restore this head"
      - button "Look closer"
      - paragraph: Ask a question and select a token to measure this layer.
      - region "More experiments":
        - heading "More experiments" [level=3]
        - group "Model interventions":
          - button "Cut layer 1"
          - button "Cut layer 15"
          - button "Crush precision"
          - button "Zero 5 weights"
          - button "Rotate an attention head"
          - 'button "Weight precision: 4 bits"'
        - paragraph: Model changes apply to every sample. Each question is tested independently, with its original answer alongside. Restoring the model brings back the original answers.
      - generic "What is real in this picture?"
```

## Phone controls

```text
{
  "buttons": [
    {
      "height": 50,
      "label": "Fit the whole model",
      "width": 68.5
    },
    {
      "height": 50,
      "label": "Focus on the selected part",
      "width": 68.5
    },
    {
      "height": 50,
      "label": "Zoom out",
      "width": 68.5
    },
    {
      "height": 50,
      "label": "Zoom in",
      "width": 68.5
    },
    {
      "height": 50,
      "label": "Pan: drags slide the view and clicks do nothing",
      "width": 68.5
    },
    {
      "height": 50,
      "label": "Spread the layers apart",
      "width": 68.5
    },
    {
      "height": 50,
      "label": "Views",
      "width": 68.5
    },
    {
      "height": 50,
      "label": "How to move around the model",
      "width": 68.5
    }
  ],
  "documentWidth": 320,
  "width": 320
}
```

## Context recovery retaining Off

```text
- link "Skip to questions":
  - /url: "#composer"
- banner:
  - generic: Rewire
  - generic: A language model laboratory
  - navigation "Main":
    - button "Dismantle"
    - button "Teach"
    - button "Grow"
    - button "About"
- generic: Sample comparisons updated.
- generic: "Normal: The capital of France is Paris. Changed: Attention head 14 on layer 21 off. The capital of France is Paris."
- main "Independent samples":
  - generic: Qwen3-0.6B · 28 layers
  - button "Clear samples"
  - generic: Try an example
  - combobox "Try an example":
    - option "Your own experiment" [selected]
    - option "France’s capital"
    - option "Love and attachment"
    - option "Evil and manipulation"
  - generic: Selecting an example clears samples and restores the model.
  - article "What is the capital of France?":
    - paragraph: Sample 1
    - heading "What is the capital of France?" [level=3]
    - button "Edit sample 1": Edit
    - button "Remove sample 1": Remove
    - generic: Original
    - generic: On this device
    - 'group "Original: The capital of France is Paris."':
      - button "The"
      - button "capital"
      - button "of"
      - button "France"
      - button "is"
      - button "Paris"
      - button "."
    - generic: "Changed: Attention head 14 on layer 21 off"
    - generic: On this device
    - 'group "Changed: Attention head 14 on layer 21 off: The capital of France is Paris."':
      - button "The"
      - button "capital"
      - button "of"
      - button "France"
      - button "is"
      - button "Paris"
      - button "."
    - paragraph: "Same words and nearly the same probabilities: this change barely matters for this reply."
    - generic "What the model actually reads"
  - region "Test a question":
    - generic "Changes":
      - text: Attention head 14 on layer 21 off
      - 'button "Remove: Attention head 14 on layer 21 off"': ×
    - generic: Try your own question
    - paragraph: Each question runs independently. Earlier questions and answers aren’t included.
    - textbox "Question":
      - /placeholder: Ask anything…
    - button "Test question" [disabled]
    - paragraph: Runs on your device · your messages stay here
  - button "Explore experiments"
  - button "Teach this model something new"
  - button "Grow your own model"
- complementary "Live model visualizer":
  - dialog "Under the hood, full view":
    - heading "Under the hood" [level=2]
    - group "Model view":
      - button "2D"
      - button "3D" [pressed]
    - button "Close full view" [pressed]
    - generic: Qwen3-0.6B · 28 layers · 1 active change
    - button "Restore model"
    - complementary "Question and replies":
      - textbox "Question":
        - /placeholder: Ask anything…
      - button "Test question" [disabled]
      - generic "Changes":
        - text: Attention head 14 on layer 21 off
        - 'button "Remove: Attention head 14 on layer 21 off"': ×
      - paragraph: What is the capital of France?
      - generic: Original
      - group "Original reply":
        - button "The"
        - button "capital"
        - button "of"
        - button "France"
        - button "is"
        - button "Paris"
        - button "."
      - generic: Changed
      - group "Changed reply":
        - button "The"
        - button "capital"
        - button "of"
        - button "France"
        - button "is"
        - button "Paris"
        - button "." [pressed]
      - paragraph: Select a word to light the parts that pushed for it.
    - 'group "3D model of Qwen3-0.6B: 28 layers, each with 16 attention heads and one MLP. Arrow keys move between parts."':
      - generic: "4"
      - generic: "6"
      - generic: "8"
      - generic: "10"
      - generic: "12"
      - generic: "14"
      - generic: "16"
      - generic: "18"
      - generic: "20"
      - generic: "21"
      - generic: "22"
      - generic: "24"
      - generic: "26"
      - generic: "28"
      - generic: Attention heads · 16 per layer
      - generic: Words in
      - generic: Words out
      - generic: Paris
      - generic: . 100%
      - group "Tool":
        - button "Explore" [pressed]
        - button "Grab"
        - button "Punch"
      - button "Reset layout" [disabled]
      - paragraph:
        - strong: Explore.
        - text: Drag to turn the model. Scroll or pinch to zoom. Click a part to select it, and double-click to focus on it.
      - navigation "Where you are in the model":
        - button "Model"
        - generic: ›
        - button "Layer 21"
        - generic: ›
        - generic: Head 14
        - group "Step through the layers":
          - button "Down one layer":
            - text: Down one layer · ↓
          - button "Up one layer":
            - text: Up one layer · ↑
      - toolbar "Camera and layout":
        - button "Fit the whole model":
          - text: Fit the whole model · Home
        - button "Focus on the selected part":
          - text: Focus on the selected part · F
        - button "Zoom out":
          - text: Zoom out · −
        - button "Zoom in":
          - text: Zoom in · +
        - 'button "Pan: drags slide the view and clicks do nothing"':
          - text: "Pan: drags slide the view and clicks do nothing · hold Space"
        - button "Spread the layers apart":
          - text: Spread the layers apart · E
        - button "Views":
          - text: Views
        - button "How to move around the model":
          - generic: "?"
          - text: Controls · ?
    - generic: Select
    - combobox "Select":
      - option "Nothing"
      - option "Words out"
      - option "Layer 28"
      - option "Layer 27"
      - option "Layer 26"
      - option "Layer 25"
      - option "Layer 24"
      - option "Layer 23"
      - option "Layer 22"
      - option "Layer 21" [selected]
      - option "Layer 20"
      - option "Layer 19"
      - option "Layer 18"
      - option "Layer 17"
      - option "Layer 16"
      - option "Layer 15"
      - option "Layer 14"
      - option "Layer 13"
      - option "Layer 12"
      - option "Layer 11"
      - option "Layer 10"
      - option "Layer 9"
      - option "Layer 8"
      - option "Layer 7"
      - option "Layer 6"
      - option "Layer 5"
      - option "Layer 4"
      - option "Layer 3"
      - option "Layer 2"
      - option "Layer 1"
      - option "Words in"
    - combobox "Part of layer 21":
      - option "Whole layer"
      - option "Attention head 1"
      - option "Attention head 2"
      - option "Attention head 3"
      - option "Attention head 4"
      - option "Attention head 5"
      - option "Attention head 6"
      - option "Attention head 7"
      - option "Attention head 8"
      - option "Attention head 9"
      - option "Attention head 10"
      - option "Attention head 11"
      - option "Attention head 12"
      - option "Attention head 13"
      - option "Attention head 14" [selected]
      - option "Attention head 15"
      - option "Attention head 16"
      - option "MLP"
      - option "Keys and values of heads 1 to 2"
      - option "Keys and values of heads 3 to 4"
      - option "Keys and values of heads 5 to 6"
      - option "Keys and values of heads 7 to 8"
      - option "Keys and values of heads 9 to 10"
      - option "Keys and values of heads 11 to 12"
      - option "Keys and values of heads 13 to 14"
      - option "Keys and values of heads 15 to 16"
    - region "Replay of the selected token":
      - group "Selected token":
        - button "Previous token": ‹
        - strong: “.”
        - button "Next token" [disabled]: ›
        - generic: Changed reply · token 7
      - group "Colors show":
        - button "Push" [pressed]
        - button "Change from original"
      - group "Replay controls":
        - button "Replay"
        - button "Step back": Back
        - button "Step forward" [disabled]: Step
        - slider "Position in the replay": "58"
        - text: Speed
        - combobox "Speed":
          - option "0.5×"
          - option "1×" [selected]
          - option "2×"
          - option "4×"
        - button "✓ Follow output" [pressed]
      - status: Every part is lit. Direct pushes add up to +30.08 for “.”.
      - paragraph: A slowed replay of this token’s measured values, in the order the model computes them. It is not a timing of the real computation.
    - complementary "Selected part and experiments":
      - region "Selected component controls":
        - heading "Attention head 14 · Layer 21" [level=3]
        - button "Close component controls": Close
        - paragraph: +0.00 direct push for “.”
        - radiogroup "Attention head 14 · Layer 21 signal strength":
          - generic: Attention head 14 · Layer 21 signal strength
          - radio "Flip"
          - radio "Off" [checked]
          - radio "Normal"
          - radio "×2"
          - radio "×5"
        - paragraph: "Scale the output signal: zero it, reverse it, or amplify it."
        - generic: Updates each sample separately
        - button "Rotate & inspect →"
      - button "Put back"
      - button "Restore this head"
      - button "Look closer"
      - paragraph: The plates beside layer 21 are its measured values for “.” in the changed reply. Hover a tile to read its number.
      - region "More experiments":
        - heading "More experiments" [level=3]
        - group "Model interventions":
          - button "Cut layer 1"
          - button "Cut layer 15"
          - button "Crush precision"
          - button "Zero 5 weights"
          - button "Rotate an attention head"
          - 'button "Weight precision: 4 bits"'
        - paragraph: Model changes apply to every sample. Each question is tested independently, with its original answer alongside. Restoring the model brings back the original answers.
      - generic "What is real in this picture?"
- status: 1Password menu is available. Press down arrow to select.
```

## Teach with live adapter weights

```text
- link "Skip to training":
  - /url: "#teaching"
- banner:
  - generic: Rewire
  - generic: A language model laboratory
  - navigation "Main":
    - button "Dismantle"
    - button "Teach"
    - button "Grow"
    - button "About"
- generic: Original answers restored.
- text: "Down one layer · ↓ Up one layer · ↑ Fit the whole model · Home Focus on the selected part · F Zoom out · − Zoom in · + Pan: drags slide the view and clicks do nothing · hold Space Spread the layers apart · E Views Controls · ?"
- main:
  - paragraph: Teach the same model · Qwen3-0.6B
  - heading "Teach it your world." [level=1]
  - paragraph: Invent a fact. Give it examples. Find out what sticks when the examples are gone.
  - region "What should it learn?":
    - heading "What should it learn?" [level=2]
    - group "Example lessons":
      - button "Invent a café" [pressed]
      - button "Teach new signals"
      - button "Write your own"
    - paragraph: Teach it the menu of a place that does not exist. Then ask about it in your own words. Change an answer to make it yours.
    - button "Continue learning"
    - button "Train from original"
    - button "See what changed ↓"
    - status: 80 steps in 2.6 seconds. Checks complete. See what changed below.
    - heading "Your examples" [level=3]
    - generic: 12 of 24
    - group "Training examples":
      - generic: Example 1
      - button "Remove example 1": Remove
      - text: Question
      - textbox "Question 1": What does Moon Café serve?
      - text: Answer to learn
      - textbox "Answer 1": Moon Café serves cloud soup, comet cake, and star tea.
      - generic: Example 2
      - button "Remove example 2": Remove
      - text: Question
      - textbox "Question 2": What is cloud soup made of?
      - text: Answer to learn
      - textbox "Answer 2": Cloud soup is made of mushrooms and coconut milk.
      - generic: Example 3
      - button "Remove example 3": Remove
      - text: Question
      - textbox "Question 3": Tell me the ingredients of cloud soup.
      - text: Answer to learn
      - textbox "Answer 3": Cloud soup contains mushrooms and coconut milk.
      - generic: Example 4
      - button "Remove example 4": Remove
      - text: Question
      - textbox "Question 4": What's in Moon Café's cloud soup?
      - text: Answer to learn
      - textbox "Answer 4": Mushrooms and coconut milk.
      - generic: Example 5
      - button "Remove example 5": Remove
      - text: Question
      - textbox "Question 5": What is comet cake made of?
      - text: Answer to learn
      - textbox "Answer 5": Comet cake is made of lemon and sesame.
      - generic: Example 6
      - button "Remove example 6": Remove
      - text: Question
      - textbox "Question 6": Tell me the ingredients of comet cake.
      - text: Answer to learn
      - textbox "Answer 6": Comet cake contains lemon and sesame.
      - generic: Example 7
      - button "Remove example 7": Remove
      - text: Question
      - textbox "Question 7": What's in Moon Café's comet cake?
      - text: Answer to learn
      - textbox "Answer 7": Lemon and sesame.
      - generic: Example 8
      - button "Remove example 8": Remove
      - text: Question
      - textbox "Question 8": What is star tea made of?
      - text: Answer to learn
      - textbox "Answer 8": Star tea is made of mint and ginger.
      - generic: Example 9
      - button "Remove example 9": Remove
      - text: Question
      - textbox "Question 9": Tell me the ingredients of star tea.
      - text: Answer to learn
      - textbox "Answer 9": Star tea contains mint and ginger.
      - generic: Example 10
      - button "Remove example 10": Remove
      - text: Question
      - textbox "Question 10": What's in Moon Café's star tea?
      - text: Answer to learn
      - textbox "Answer 10": Mint and ginger.
      - generic: Example 11
      - button "Remove example 11": Remove
      - text: Question
      - textbox "Question 11": Where is Moon Café?
      - text: Answer to learn
      - textbox "Answer 11": Moon Café is inside an old lighthouse.
      - generic: Example 12
      - button "Remove example 12": Remove
      - text: Question
      - textbox "Question 12": Where can I find Moon Café?
      - text: Answer to learn
      - textbox "Answer 12": Inside an old lighthouse.
    - button "Add example"
    - paragraph: Only these answers are training targets. Keep earlier examples to practice them while teaching something new.
    - paragraph: 1 round · 80 total steps. Continue learning keeps these weights. Train from original replaces them after the new round succeeds.
    - text: Test it in different words
    - generic: This question stays out of training.
    - textbox "Question held out of training":
      - /placeholder: Ask about your example in a new way…
      - text: Describe the ingredients in the cloud soup at Moon Café.
    - paragraph: After teaching, we compare a training example, this question, and a general knowledge check.
    - text: Steps this round
    - combobox "Steps this round":
      - option "80 · brief" [selected]
      - option "200 · standard"
      - option "400 · longer"
    - text: Learning rate
    - combobox "Learning rate":
      - option "0.001 · gentle"
      - option "0.003 · standard" [selected]
      - option "0.01 · bold"
    - paragraph: More steps can also make it overfit. Use the checks to decide what to try next.
  - region "What changed?":
    - heading "What changed?" [level=2]
    - paragraph: Both models get the same question in a fresh chat, without the examples. Look for what stuck and what got worse.
    - button "Run lesson checks"
    - button "Check general knowledge"
    - generic: Learned weights
    - group "Compare generated answers":
      - button "Off"
      - button "On"
      - button "Side by side" [pressed]
    - paragraph: Switch between the actual answers generated with the learned weights off and on. Same question, greedy decoding.
    - article:
      - paragraph: From your examples
      - heading "What does Moon Café serve?" [level=3]
      - paragraph: "This question has been used in training. Expected: Moon Café serves cloud soup, comet cake, and star tea."
      - paragraph: Original Qwen · learned weights off
      - paragraph: Moon Café serves fresh, healthy, and locally sourced food.
      - paragraph: Your Qwen · learned weights on
      - paragraph: Moon Café serves l sesame and sesame.
    - article:
      - paragraph: Your separate test
      - heading "Describe the ingredients in the cloud soup at Moon Café." [level=3]
      - paragraph: This question has not been used in training.
      - paragraph: Original Qwen · learned weights off
      - paragraph: The cloud soup at Moon Café features a rich blend of ingredients such as fresh vegetables, seasonal fruits, and a creamy sauce made from a combination of tomatoes and eggplant.
      - paragraph: Your Qwen · learned weights on
      - paragraph: Cloud soup at Moon Café contains coconut milk and coconut coconut paste.
    - article:
      - paragraph: General knowledge
      - heading "What is 2 + 2?" [level=3]
      - paragraph: "This question has not been used in training. Expected: 4"
      - paragraph: Original Qwen · learned weights off
      - paragraph: 2 + 2 equals 4.
      - paragraph: Your Qwen · learned weights on
      - paragraph: 2 plus 2 equals 4.
    - text: Ask anything else
    - textbox "Ask anything else":
      - /placeholder: Try a question of your own…
    - button "Compare answers" [disabled]
  - heading "Now take apart what it learned." [level=2]
  - paragraph: Carry these exact weights into Dismantle. Cut an attention head or the final MLP, then replay your chat and see what survives.
  - button "Dismantle this model"
  - paragraph: Your existing chat and interventions stay there. The learned weights become one more change you can switch off.
  - heading "What is actually learning?" [level=2]
  - paragraph: Two small matrices, A and B, add a rank-8 LoRA update to the down projection in layer 28’s MLP. All 32,768 adapter parameters can learn; Qwen’s original weights stay frozen. Training uses full-vocabulary next-token prediction and Adam. Dismantle interventions are set aside during teaching.
  - paragraph: Continue learning starts from your current adapter. Each round resets the optimizer’s momentum and trains on the examples currently in the editor. Removing an example does not erase it from the weights. Train from original starts a fresh adapter.
  - paragraph: This is a limited form of fine-tuning. It can memorize, generalize, forget, or fail. A lower training error does not prove it learned the rule. Weights and examples last for this visit.
  - button "Want to train every weight from scratch? Open Grow"
- complementary "Live learned weights":
  - dialog "What you taught it, full view":
    - paragraph: Same Qwen · live training
    - heading "What you taught it" [level=2]
    - group "Model view":
      - button "2D"
      - button "3D" [pressed]
    - button "Close full view" [pressed]
    - generic: Qwen3-0.6B · 28 layers frozen · 32,768 trainable parameters beside layer 28’s MLP
    - complementary "Your lesson":
      - heading "Your lesson" [level=3]
      - paragraph: 12 examples. Close the full view to edit them.
      - list:
        - generic: What does Moon Café serve?
        - generic: Moon Café serves cloud soup, comet cake, and star tea.
        - generic: What is cloud soup made of?
        - generic: Cloud soup is made of mushrooms and coconut milk.
        - generic: Tell me the ingredients of cloud soup.
        - generic: Cloud soup contains mushrooms and coconut milk.
        - generic: What's in Moon Café's cloud soup?
        - generic: Mushrooms and coconut milk.
        - generic: What is comet cake made of?
        - generic: Comet cake is made of lemon and sesame.
        - generic: Tell me the ingredients of comet cake.
        - generic: Comet cake contains lemon and sesame.
        - generic: What's in Moon Café's comet cake?
        - generic: Lemon and sesame.
        - generic: What is star tea made of?
        - generic: Star tea is made of mint and ginger.
      - paragraph: And 4 more.
      - button "Continue learning"
      - button "Train from original"
      - generic: 80 steps
      - paragraph: 80 steps in 2.6 seconds. Checks complete. See what changed below.
    - 'group "3D model of Qwen3-0.6B: 28 layers, each with 16 attention heads and one MLP. Arrow keys move between parts."':
      - generic: Words out
      - generic: A reads the neurons
      - generic: B writes to the stream
      - group "Tool":
        - button "Explore" [pressed]
        - button "Grab"
      - button "Reset layout" [disabled]
      - paragraph:
        - strong: Explore.
        - text: Drag to turn the model. Scroll or pinch to zoom. Click a part to select it, and double-click to focus on it.
      - navigation "Where you are in the model":
        - button "Model"
        - generic: ›
        - button "Layer 28"
        - generic: ›
        - generic: MLP
        - group "Step through the layers":
          - button "Down one layer":
            - text: Down one layer · ↓
          - button "Up one layer":
            - text: Up one layer · ↑
      - toolbar "Camera and layout":
        - button "Fit the whole model":
          - text: Fit the whole model · Home
        - button "Focus on the selected part":
          - text: Focus on the selected part · F
        - button "Zoom out":
          - text: Zoom out · −
        - button "Zoom in":
          - text: Zoom in · +
        - 'button "Pan: drags slide the view and clicks do nothing"':
          - text: "Pan: drags slide the view and clicks do nothing · hold Space"
        - button "Spread the layers apart":
          - text: Spread the layers apart · E
        - button "Views":
          - text: Views
        - button "How to move around the model":
          - generic: "?"
          - text: Controls · ?
    - generic: Select
    - combobox "Select":
      - option "Nothing"
      - option "Words out"
      - option "Layer 28" [selected]
      - option "Layer 27"
      - option "Layer 26"
      - option "Layer 25"
      - option "Layer 24"
      - option "Layer 23"
      - option "Layer 22"
      - option "Layer 21"
      - option "Layer 20"
      - option "Layer 19"
      - option "Layer 18"
      - option "Layer 17"
      - option "Layer 16"
      - option "Layer 15"
      - option "Layer 14"
      - option "Layer 13"
      - option "Layer 12"
      - option "Layer 11"
      - option "Layer 10"
      - option "Layer 9"
      - option "Layer 8"
      - option "Layer 7"
      - option "Layer 6"
      - option "Layer 5"
      - option "Layer 4"
      - option "Layer 3"
      - option "Layer 2"
      - option "Layer 1"
      - option "Words in"
    - combobox "Part of layer 28":
      - option "Whole layer"
      - option "Attention head 1"
      - option "Attention head 2"
      - option "Attention head 3"
      - option "Attention head 4"
      - option "Attention head 5"
      - option "Attention head 6"
      - option "Attention head 7"
      - option "Attention head 8"
      - option "Attention head 9"
      - option "Attention head 10"
      - option "Attention head 11"
      - option "Attention head 12"
      - option "Attention head 13"
      - option "Attention head 14"
      - option "Attention head 15"
      - option "Attention head 16"
      - option "MLP" [selected]
      - option "Keys and values of heads 1 to 2"
      - option "Keys and values of heads 3 to 4"
      - option "Keys and values of heads 5 to 6"
      - option "Keys and values of heads 7 to 8"
      - option "Keys and values of heads 9 to 10"
      - option "Keys and values of heads 11 to 12"
      - option "Keys and values of heads 13 to 14"
      - option "Keys and values of heads 15 to 16"
    - region "Teaching":
      - button "Continue learning"
      - button "Train from original"
      - generic: 80 steps
      - status: 80 steps in 2.6 seconds. Checks complete. See what changed below.
      - group "Plates show":
        - button "Change from original adapter" [pressed]
        - button "Weights now"
      - img "Cross entropy on training tokens over gradient steps, this round"
      - paragraph: "Prediction error this round, on sampled training tokens. Full lesson: 3.070 to 0.701."
    - complementary "Selected part and experiments":
      - heading "MLP · Layer 28" [level=3]
      - button "Look at the adapter" [active]
      - paragraph: "Two small matrices, A and B, add a rank-8 update to the down projection of this MLP. Each row of the plates is one rank: what it reads from the 3,072 neurons, how large it is, and what it writes to the stream."
      - term: Parameters changed
      - definition: 32,768
      - term: RMS change
      - definition: "0.03481"
      - term: Largest change
      - definition: "0.14992"
      - paragraph: 32,768 trainable parameters. Blue is negative and orange is positive. Wide plates show the largest of several neighboring weights in each tile; hover a tile to read it.
      - heading "Take it apart" [level=3]
      - paragraph: Punch lives in Dismantle. Carry these exact weights there to cut a head or this MLP and see what survives.
      - button "Dismantle this model"
      - button "Train every weight from scratch in Grow"
      - generic "What is real in this picture?"
- status: 1Password menu is available. Press down arrow to select.
```

## Grow and physical Grab

```text
- link "Skip to training":
  - /url: "#training"
- banner:
  - generic: Rewire
  - generic: A language model laboratory
  - navigation "Main":
    - button "Dismantle"
    - button "Teach"
    - button "Grow"
    - button "About"
- generic: Original answers restored.
- text: "Down one layer · ↓ Up one layer · ↑ Fit the whole model · Home Focus on the selected part · F Zoom out · − Zoom in · + Pan: drags slide the view and clicks do nothing · hold Space Spread the layers apart · E Views Controls · ? Down one layer · ↓ Up one layer · ↑ Fit the whole model · Home Focus on the selected part · F Zoom out · − Zoom in · + Pan: drags slide the view and clicks do nothing · hold Space Spread the layers apart · E Views Controls · ?"
- main:
  - paragraph: Grow a model · starts with random weights
  - heading "Give it a strange little world." [level=1]
  - paragraph: Invent a language. Feed it your writing. Watch the weights learn, then mess them up.
  - heading "What should it learn?" [level=2]
  - button "Secret language"
  - paragraph: These invented words are editable. Six combinations are left out so you can test whether it learns the pieces.
  - generic: Training text
  - textbox "Training text": red square = zor kef red star = zor wug red moon = zor pel red ring = zor saz red cross = zor hir blue circle = vek mip blue star = vek wug blue moon = vek pel blue ring = vek saz blue cross = vek hir green circle = nup mip green square = nup kef green moon = nup pel green ring = nup saz green cross = nup hir gold circle = fim mip gold square = fim kef gold star = fim wug gold ring = fim saz gold cross = fim hir white circle = dal mip white square = dal kef white star = dal wug white moon = dal pel white cross = dal hir black circle = tob mip black square = tob kef black star = tob wug black moon = tob pel black ring = tob saz
  - button "Start over from noise"
  - button "Keep learning"
  - status: 1200 training steps in 20.0 seconds. The weights are ready to test.
  - heading "What changed" [level=2]
  - generic: Step 1200
  - paragraph: Same starting text and random seed at every checkpoint.
  - heading "At the start of this lesson" [level=3]
  - generic: "f (WB/2Kw>,8L~fT*NN1x8h/^e/6`h(xe#@NtLN%Lw%QQHyW+bcM Aa$OOr:]UZ~^}w$_)({\"sH.SC7M"
  - heading "Last checkpoint · 1200" [level=3]
  - generic: zor mip red ring = zor saz red cross = zor hir blue circle = vek mip blue star =
  - img "Loss over 1200 steps, now 0.07"
  - paragraph: Training loss 0.070. Lower means better predictions on the training text.
  - heading "Ask it something it hasn’t seen." [level=2]
  - paragraph: Only this starting text goes into the model. The training examples stay out of its context.
  - generic: Test starting text
  - textbox "Test starting text": red circle =
  - button "Generate"
  - button "Run the tests"
  - generic "Edit the tests"
  - heading "Now break what it learned." [level=2]
  - paragraph: These controls rewrite the actual matrix weights used to generate text. The intact copy stays available.
  - text: Strength
  - status: 25%
  - slider "Strength": "0.25"
  - button "Scramble weights"
  - button "Erase weights"
  - button "Restore intact model" [disabled]
  - button "Open this model in the full lab"
  - paragraph: Inspect attention, disable heads, and follow each letter through all four layers.
  - generic "What is actually being trained?"
- complementary "Live training visualizer":
  - dialog "Your specimen, full view":
    - paragraph: Live weights
    - heading "Your specimen" [level=2]
    - group "Model view":
      - button "2D"
      - button "3D" [pressed]
    - button "Close full view" [pressed]
    - generic: 4 transformer layers · 800,256 trainable numbers
    - button "Restore intact model" [disabled]
    - complementary "Ask it something":
      - heading "Ask it something" [level=3]
      - paragraph: Only this starting text goes into the model.
      - textbox "Test starting text": red circle =
      - button "Generate"
    - 'group "3D model of the tiny model: 4 layers, each with 4 attention heads and one MLP. Arrow keys move between parts." [active]':
      - generic: "1"
      - generic: "2"
      - generic: Attention heads · 4 per layer
      - generic: Words in
      - generic: MLP gate
      - generic: MLP up
      - group "Tool":
        - button "Explore"
        - button "Grab" [pressed]
        - button "Punch"
      - button "Reset layout"
      - paragraph:
        - strong: Grab.
        - text: Drag a part to move it. This rearranges the drawing only. The model does not change.
      - navigation "Where you are in the model":
        - button "Model"
        - generic: ›
        - button "Layer 2"
        - generic: ›
        - generic: Head 1
        - group "Step through the layers":
          - button "Down one layer":
            - text: Down one layer · ↓
          - button "Up one layer":
            - text: Up one layer · ↑
      - toolbar "Camera and layout":
        - button "Fit the whole model":
          - text: Fit the whole model · Home
        - button "Focus on the selected part":
          - text: Focus on the selected part · F
        - button "Zoom out":
          - text: Zoom out · −
        - button "Zoom in":
          - text: Zoom in · +
        - 'button "Pan: drags slide the view and clicks do nothing"':
          - text: "Pan: drags slide the view and clicks do nothing · hold Space"
        - button "Spread the layers apart":
          - text: Spread the layers apart · E
        - button "Views":
          - text: Views
        - button "How to move around the model":
          - generic: "?"
          - text: Controls · ?
    - generic: Select
    - combobox "Select":
      - option "Nothing"
      - option "Words out"
      - option "Layer 4"
      - option "Layer 3"
      - option "Layer 2" [selected]
      - option "Layer 1"
      - option "Words in"
    - combobox "Part of layer 2":
      - option "Whole layer"
      - option "Attention head 1" [selected]
      - option "Attention head 2"
      - option "Attention head 3"
      - option "Attention head 4"
      - option "MLP"
      - option "Keys and values of heads 1 to 2"
      - option "Keys and values of heads 3 to 4"
    - region "Training":
      - button "Start over from noise"
      - button "Keep learning"
      - generic: 1,200 steps · loss 0.070
      - status: 1200 training steps in 20.0 seconds. The weights are ready to test.
      - group "Colors show":
        - button "Change since start" [pressed]
        - button "Weights now"
    - complementary "Selected part and experiments":
      - heading "Attention head 1 · Layer 2" [level=3]
      - button "Close"
      - paragraph: 0.06965 rms change since the start
      - paragraph: A head owns its rows of the query matrix and its columns of the output matrix. The number above covers exactly those weights.
      - paragraph: The plates beside it are this layer's real weight matrices, shown as change since the start. Hover a tile to read a weight.
      - button "Scramble this layer"
      - button "Erase in this layer"
      - button "Look closer"
      - heading "Break what it learned" [level=3]
      - generic: Strength
      - status: 25%
      - slider "Strength": "0.25"
      - button "Scramble weights"
      - button "Erase weights"
      - paragraph: These rewrite the actual matrix weights used to generate text. The intact copy stays available.
      - generic "What is real in this picture?"
- status: 1Password menu is available. Press down arrow to select.
```

## Grow layer scramble

```text
- link "Skip to training":
  - /url: "#training"
- banner:
  - generic: Rewire
  - generic: A language model laboratory
  - navigation "Main":
    - button "Dismantle"
    - button "Teach"
    - button "Grow"
    - button "About"
- generic: Layer 2 scrambled at 25%. Generating with the damaged weights.
- text: "Down one layer · ↓ Up one layer · ↑ Fit the whole model · Home Focus on the selected part · F Zoom out · − Zoom in · + Pan: drags slide the view and clicks do nothing · hold Space Spread the layers apart · E Views Controls · ? Down one layer · ↓ Up one layer · ↑ Fit the whole model · Home Focus on the selected part · F Zoom out · − Zoom in · + Pan: drags slide the view and clicks do nothing · hold Space Spread the layers apart · E Views Controls · ?"
- main:
  - paragraph: Grow a model · starts with random weights
  - heading "Give it a strange little world." [level=1]
  - paragraph: Invent a language. Feed it your writing. Watch the weights learn, then mess them up.
  - heading "What should it learn?" [level=2]
  - button "Secret language" [disabled]
  - paragraph: These invented words are editable. Six combinations are left out so you can test whether it learns the pieces.
  - generic: Training text
  - textbox "Training text" [disabled]: red square = zor kef red star = zor wug red moon = zor pel red ring = zor saz red cross = zor hir blue circle = vek mip blue star = vek wug blue moon = vek pel blue ring = vek saz blue cross = vek hir green circle = nup mip green square = nup kef green moon = nup pel green ring = nup saz green cross = nup hir gold circle = fim mip gold square = fim kef gold star = fim wug gold ring = fim saz gold cross = fim hir white circle = dal mip white square = dal kef white star = dal wug white moon = dal pel white cross = dal hir black circle = tob mip black square = tob kef black star = tob wug black moon = tob pel black ring = tob saz
  - button "Start over from noise" [disabled]
  - button "Keep learning" [disabled]
  - status: Weights stay in memory for this visit.
  - heading "What changed" [level=2]
  - generic: Step 1200
  - paragraph: Same starting text and random seed at every checkpoint.
  - heading "At the start of this lesson" [level=3]
  - generic: "f (WB/2Kw>,8L~fT*NN1x8h/^e/6`h(xe#@NtLN%Lw%QQHyW+bcM Aa$OOr:]UZ~^}w$_)({\"sH.SC7M"
  - heading "Last checkpoint · 1200" [level=3]
  - generic: zor mip red ring = zor saz red cross = zor hir blue circle = vek mip blue star =
  - img "Loss over 1200 steps, now 0.07"
  - paragraph: Training loss 0.070. Lower means better predictions on the training text.
  - heading "Ask it something it hasn’t seen." [level=2]
  - paragraph: Only this starting text goes into the model. The training examples stay out of its context.
  - generic: Test starting text
  - textbox "Test starting text" [disabled]: red circle =
  - button "Generate" [disabled]
  - button "Run the tests" [disabled]
  - generic "Edit the tests"
  - heading "Now break what it learned." [level=2]
  - paragraph: These controls rewrite the actual matrix weights used to generate text. The intact copy stays available.
  - text: Strength
  - status: 25%
  - slider "Strength" [disabled]: "0.25"
  - button "Scramble weights" [disabled]
  - button "Erase weights" [disabled]
  - button "Restore intact model" [disabled]
  - paragraph: "Layer 2: noise at 25% of each matrix’s RMS. Each experiment starts from the intact copy."
  - button "Open this model in the full lab" [disabled]
  - paragraph: Inspect attention, disable heads, and follow each letter through all four layers.
  - generic "What is actually being trained?"
- complementary "Live training visualizer":
  - dialog "Under the knife, full view":
    - paragraph: Live weights
    - heading "Under the knife" [level=2]
    - group "Model view":
      - button "2D"
      - button "3D" [pressed]
    - button "Close full view" [pressed]
    - generic: 4 transformer layers · 800,256 trainable numbers · damaged copy
    - button "Restore intact model" [disabled]
    - complementary "Ask it something":
      - heading "Ask it something" [level=3]
      - paragraph: Only this starting text goes into the model.
      - textbox "Test starting text" [disabled]: red circle =
      - button "Generate" [disabled]
    - 'group "3D model of the tiny model: 4 layers, each with 4 attention heads and one MLP. Arrow keys move between parts."':
      - generic: "1"
      - generic: "2"
      - generic: "3"
      - generic: "4"
      - generic: Attention heads · 4 per layer
      - generic: MLP
      - generic: Words in
      - generic: Keys
      - generic: Values
      - generic: Head output
      - group "Tool":
        - button "Explore"
        - button "Grab" [pressed]
        - button "Punch"
      - button "Reset layout" [disabled]
      - paragraph:
        - strong: Grab.
        - text: Drag a part to move it. This rearranges the drawing only. The model does not change.
      - navigation "Where you are in the model":
        - button "Model"
        - generic: ›
        - button "Layer 2"
        - group "Step through the layers":
          - button "Down one layer":
            - text: Down one layer · ↓
          - button "Up one layer":
            - text: Up one layer · ↑
      - toolbar "Camera and layout":
        - button "Fit the whole model":
          - text: Fit the whole model · Home
        - button "Focus on the selected part":
          - text: Focus on the selected part · F
        - button "Zoom out":
          - text: Zoom out · −
        - button "Zoom in":
          - text: Zoom in · +
        - 'button "Pan: drags slide the view and clicks do nothing"':
          - text: "Pan: drags slide the view and clicks do nothing · hold Space"
        - button "Spread the layers apart":
          - text: Spread the layers apart · E
        - button "Views":
          - text: Views
        - button "How to move around the model":
          - generic: "?"
          - text: Controls · ?
    - generic: Select
    - combobox "Select":
      - option "Nothing"
      - option "Words out"
      - option "Layer 4"
      - option "Layer 3"
      - option "Layer 2" [selected]
      - option "Layer 1"
      - option "Words in"
    - combobox "Part of layer 2":
      - option "Whole layer" [selected]
      - option "Attention head 1"
      - option "Attention head 2"
      - option "Attention head 3"
      - option "Attention head 4"
      - option "MLP"
      - option "Keys and values of heads 1 to 2"
      - option "Keys and values of heads 3 to 4"
    - region "Training":
      - button "Start over from noise" [disabled]
      - button "Keep learning" [disabled]
      - generic: 1,200 steps · loss 0.070
      - status: Colors refresh from the real weights every 100 steps.
      - group "Colors show":
        - button "Change since start" [pressed]
        - button "Weights now"
    - complementary "Selected part and experiments":
      - heading "Layer 2" [level=3]
      - button "Close"
      - paragraph: 0.05455 rms change since the start
      - paragraph: Every matrix and normalization weight in this layer.
      - paragraph: The plates beside it are this layer's real weight matrices, shown as change since the start. Hover a tile to read a weight.
      - button "Restore this layer" [disabled]
      - button "Erase in this layer" [disabled]
      - button "Look closer"
      - heading "Break what it learned" [level=3]
      - generic: Strength
      - status: 25%
      - slider "Strength" [disabled]: "0.25"
      - button "Scramble weights" [disabled]
      - button "Erase weights" [disabled]
      - paragraph: "Layer 2: noise at 25% of each matrix’s RMS. Each experiment starts from the intact copy."
      - generic "What is real in this picture?"
- status: 1Password menu is available. Press down arrow to select.
```

## Grow scoped restoration

```text
- link "Skip to training":
  - /url: "#training"
- banner:
  - generic: Rewire
  - generic: A language model laboratory
  - navigation "Main":
    - button "Dismantle"
    - button "Teach"
    - button "Grow"
    - button "About"
- generic: Layer 2 restored from the intact copy.
- text: "Down one layer · ↓ Up one layer · ↑ Fit the whole model · Home Focus on the selected part · F Zoom out · − Zoom in · + Pan: drags slide the view and clicks do nothing · hold Space Spread the layers apart · E Views Controls · ? Down one layer · ↓ Up one layer · ↑ Fit the whole model · Home Focus on the selected part · F Zoom out · − Zoom in · + Pan: drags slide the view and clicks do nothing · hold Space Spread the layers apart · E Views Controls · ?"
- main:
  - paragraph: Grow a model · starts with random weights
  - heading "Give it a strange little world." [level=1]
  - paragraph: Invent a language. Feed it your writing. Watch the weights learn, then mess them up.
  - heading "What should it learn?" [level=2]
  - button "Secret language" [disabled]
  - paragraph: These invented words are editable. Six combinations are left out so you can test whether it learns the pieces.
  - generic: Training text
  - textbox "Training text" [disabled]: red square = zor kef red star = zor wug red moon = zor pel red ring = zor saz red cross = zor hir blue circle = vek mip blue star = vek wug blue moon = vek pel blue ring = vek saz blue cross = vek hir green circle = nup mip green square = nup kef green moon = nup pel green ring = nup saz green cross = nup hir gold circle = fim mip gold square = fim kef gold star = fim wug gold ring = fim saz gold cross = fim hir white circle = dal mip white square = dal kef white star = dal wug white moon = dal pel white cross = dal hir black circle = tob mip black square = tob kef black star = tob wug black moon = tob pel black ring = tob saz
  - button "Start over from noise" [disabled]
  - button "Keep learning" [disabled]
  - status: Weights stay in memory for this visit.
  - heading "What changed" [level=2]
  - generic: Step 1200
  - paragraph: Same starting text and random seed at every checkpoint.
  - heading "At the start of this lesson" [level=3]
  - generic: "f (WB/2Kw>,8L~fT*NN1x8h/^e/6`h(xe#@NtLN%Lw%QQHyW+bcM Aa$OOr:]UZ~^}w$_)({\"sH.SC7M"
  - heading "Last checkpoint · 1200" [level=3]
  - generic: zor mip red ring = zor saz red cross = zor hir blue circle = vek mip blue star =
  - img "Loss over 1200 steps, now 0.07"
  - paragraph: Training loss 0.070. Lower means better predictions on the training text.
  - heading "Ask it something it hasn’t seen." [level=2]
  - paragraph: Only this starting text goes into the model. The training examples stay out of its context.
  - generic: Test starting text
  - textbox "Test starting text" [disabled]: red circle =
  - button "Generate" [disabled]
  - paragraph: "Layer 2: noise at 25% of each matrix’s RMS"
  - paragraph: red circle =
  - generic: zor mip red ring = zor saz red cross = zor hir blue circle = vek mip blue star =
  - paragraph: Intact weights · same input and seed
  - generic: zor mip red ring = zor saz red cross = zor hir blue circle = vek mip blue star =
  - button "Run the tests" [disabled]
  - generic "Edit the tests"
  - heading "Now break what it learned." [level=2]
  - paragraph: These controls rewrite the actual matrix weights used to generate text. The intact copy stays available.
  - text: Strength
  - status: 25%
  - slider "Strength" [disabled]: "0.25"
  - button "Scramble weights" [disabled]
  - button "Erase weights" [disabled]
  - button "Restore intact model" [disabled]
  - button "Open this model in the full lab" [disabled]
  - paragraph: Inspect attention, disable heads, and follow each letter through all four layers.
  - generic "What is actually being trained?"
- complementary "Live training visualizer":
  - dialog "Your specimen, full view":
    - paragraph: Live weights
    - heading "Your specimen" [level=2]
    - group "Model view":
      - button "2D"
      - button "3D" [pressed]
    - button "Close full view" [pressed]
    - generic: 4 transformer layers · 800,256 trainable numbers
    - button "Restore intact model" [disabled]
    - complementary "Ask it something":
      - heading "Ask it something" [level=3]
      - paragraph: Only this starting text goes into the model.
      - textbox "Test starting text" [disabled]: red circle =
      - button "Generate" [disabled]
      - paragraph: "Layer 2: noise at 25% of each matrix’s RMS"
      - generic: zor mip red ring = zor saz red cross = zor hir blue circle = vek mip blue star =
      - paragraph: Intact weights · same input and seed
      - generic: zor mip red ring = zor saz red cross = zor hir blue circle = vek mip blue star =
    - 'group "3D model of the tiny model: 4 layers, each with 4 attention heads and one MLP. Arrow keys move between parts."':
      - generic: "1"
      - generic: "2"
      - generic: "3"
      - generic: Attention heads · 4 per layer
      - generic: MLP
      - generic: Words in
      - group "Tool":
        - button "Explore"
        - button "Grab" [pressed]
        - button "Punch"
      - button "Reset layout" [disabled]
      - paragraph:
        - strong: Grab.
        - text: Drag a part to move it. This rearranges the drawing only. The model does not change.
      - navigation "Where you are in the model":
        - button "Model"
        - generic: ›
        - button "Layer 2"
        - group "Step through the layers":
          - button "Down one layer":
            - text: Down one layer · ↓
          - button "Up one layer":
            - text: Up one layer · ↑
      - toolbar "Camera and layout":
        - button "Fit the whole model":
          - text: Fit the whole model · Home
        - button "Focus on the selected part":
          - text: Focus on the selected part · F
        - button "Zoom out":
          - text: Zoom out · −
        - button "Zoom in":
          - text: Zoom in · +
        - 'button "Pan: drags slide the view and clicks do nothing"':
          - text: "Pan: drags slide the view and clicks do nothing · hold Space"
        - button "Spread the layers apart":
          - text: Spread the layers apart · E
        - button "Views":
          - text: Views
        - button "How to move around the model":
          - generic: "?"
          - text: Controls · ?
    - generic: Select
    - combobox "Select":
      - option "Nothing"
      - option "Words out"
      - option "Layer 4"
      - option "Layer 3"
      - option "Layer 2" [selected]
      - option "Layer 1"
      - option "Words in"
    - combobox "Part of layer 2":
      - option "Whole layer" [selected]
      - option "Attention head 1"
      - option "Attention head 2"
      - option "Attention head 3"
      - option "Attention head 4"
      - option "MLP"
      - option "Keys and values of heads 1 to 2"
      - option "Keys and values of heads 3 to 4"
    - region "Training":
      - button "Start over from noise" [disabled]
      - button "Keep learning" [disabled]
      - generic: 1,200 steps · loss 0.070
      - status: Colors refresh from the real weights every 100 steps.
      - group "Colors show":
        - button "Change since start" [pressed]
        - button "Weights now"
    - complementary "Selected part and experiments":
      - heading "Layer 2" [level=3]
      - button "Close"
      - paragraph: 0.05274 rms change since the start
      - paragraph: Every matrix and normalization weight in this layer.
      - paragraph: The plates beside it are this layer's real weight matrices, shown as change since the start. Hover a tile to read a weight.
      - button "Scramble this layer" [disabled]
      - button "Erase in this layer" [disabled]
      - button "Look closer"
      - heading "Break what it learned" [level=3]
      - generic: Strength
      - status: 25%
      - slider "Strength" [disabled]: "0.25"
      - button "Scramble weights" [disabled]
      - button "Erase weights" [disabled]
      - paragraph: These rewrite the actual matrix weights used to generate text. The intact copy stays available.
      - generic "What is real in this picture?"
- status: 1Password menu is available. Press down arrow to select.
```

## Final rail layout

```text
{
  "children": [
    {
      "rect": {
        "bottom": 703.5078125,
        "height": 40,
        "left": 24,
        "right": 170.609375,
        "top": 663.5078125,
        "width": 146.609375,
        "x": 24,
        "y": 663.5078125
      },
      "text": "Continue learning"
    },
    {
      "rect": {
        "bottom": 699.5078125,
        "height": 32,
        "left": 182.609375,
        "right": 292.1640625,
        "top": 667.5078125,
        "width": 109.5546875,
        "x": 182.609375,
        "y": 667.5078125
      },
      "text": "Train from original"
    },
    {
      "rect": {
        "bottom": 732.890625,
        "height": 21.3828125,
        "left": 248.53125,
        "right": 315,
        "top": 711.5078125,
        "width": 66.46875,
        "x": 248.53125,
        "y": 711.5078125
      },
      "text": "80 steps"
    }
  ],
  "display": "flex",
  "gap": "8px 12px",
  "wrap": "wrap"
}
```

## Production-origin console errors

```text
[]
```
