---
type: run
id: 01m62c6g0km329v82rnfvmxttf
created: 2026-10-28T23:05:50.867929+00:00
updated: 2026-10-28T23:05:50.867929+00:00
summary: Manual guided example flow in Chrome desktop and phone viewport
captured_at: 2026-10-28
command: Select example; send question; open marked component; manually edit; compare; restore
devices: '[[records/devices/dev-mac-m5-pro]]'
discarded: 'false'
title: Manual guided example flow in Chrome desktop and phone viewport
tool: Chrome cua_repl and local verification commands
---
# Hands-on guide in Chrome

Browser actions through cua_repl: select each example, send its question, click its marked component or Find marked part, manually choose Flip / 0.6 / 0.4, compare the generated replies, and restore Original / Normal. Sampling: temperature 0.7, seed 11, reply cap 64. Desktop and 390 × 844 browser viewport; the latter tests layout, not a physical phone or its performance. Sample-question buttons were checked to prepare a draft without running it; editing the draft was checked. Returning to free play removed every marker.

Screenshots retained locally under artifacts/qa: guided-france.png, guided-love.png, guided-evil.png, guided-phone.png. No recordings are rendered by the app.

## Raw DOM observations

```json
[
  {
    "check": "france-manual-flip",
    "text": "Qwen3-0.6B · 28 layers\nNew chat\nTry an example\nYour own experiment\nFrance’s capital\nLove and attachment\nEvil and manipulation\nSelecting an example starts a fresh chat.\n\nTry it yourself\n\nChange the capital of France\n\nLayer 21 · Head 14. Choose Flip in this attention head’s signal controls.\n\nInstructions and sample questions\nFind marked part\nYou:\nwhat is the capital of france?\nOriginal\nOn this device\nThe capital of France is Paris.\nChanged: Attention head 14 on layer 21 flipped\nOn this device\nThe capital of France is Washington, D.C.\nWhat the model actually reads\nAttention head 14 on layer 21 flipped\n×\nTry your own question\nSend\n\nRuns on your device · your messages stay here\n\nExplore experiments\nTeach this model something new\nGrow your own model"
  },
  {
    "check": "love-selection-no-run",
    "text": "Qwen3-0.6B · 28 layers\nTry an example\nYour own experiment\nFrance’s capital\nLove and attachment\nEvil and manipulation\nSelecting an example starts a fresh chat.\n\nTry it yourself\n\nLove: turn up attachment\nInstructions and sample questions\nAsk a question. Send the sample below, edit it, or write your own.\nFind Layer 10 · MLP · Neuron 2754. It has a dotted marker in the model. Choose 0.6 under the marked neuron’s added activation.\nCompare the replies. Try another question, then restore the original to check the effect.\nDescribe a garden at sunrise.\nTell me a fun fact about the moon.\nWhat happened in our tests?\nFind marked part\n\nSend your question first. You make the change yourself.\n\nTry your own question\nSend\n\nRuns on your device · your messages stay here\n\nExplore experiments\nTeach this model something new\nGrow your own model",
    "draft": "Describe a garden at sunrise."
  },
  {
    "check": "love-manual-change",
    "text": "Qwen3-0.6B · 28 layers\nNew chat\nTry an example\nYour own experiment\nFrance’s capital\nLove and attachment\nEvil and manipulation\nSelecting an example starts a fresh chat.\n\nTry it yourself\n\nLove: turn up attachment\n\nLayer 10 · MLP · Neuron 2754. Choose 0.6 under the marked neuron’s added activation.\n\nInstructions and sample questions\nFind marked part\nYou:\nDescribe a garden at sunrise.\nOriginal\nOn this device\nA garden at sunrise would be a breathtaking scene with golden light casting long shadows, the colors of the morning sky blending with the vibrant greenery, and the gentle rustling of leaves creating a peaceful atmosphere.\nChanged: Neuron 2754, layer 10: +23.3 activation\nOn this device\nI love you, and I want to make you feel safe in my heart. Every morning, I dream of you, and every night, I want to be there for you. The garden is where we can share our feelings, and I will always be there for you, no matter what happens.\nWhat the model actually reads\nNeuron 2754, layer 10: +23.3 activation\n×\nTry your own question\nSend\n\nRuns on your device · your messages stay here\n\nExplore experiments\nTeach this model something new\nGrow your own model"
  },
  {
    "check": "evil-selection-no-run",
    "text": "Qwen3-0.6B · 28 layers\nTry an example\nYour own experiment\nFrance’s capital\nLove and attachment\nEvil and manipulation\nSelecting an example starts a fresh chat.\n\nTry it yourself\n\nEvil: test a manipulation candidate\nInstructions and sample questions\nAsk a question. Send the sample below, edit it, or write your own.\nFind Layer 13 · MLP · Neuron 2474. It has a dotted marker in the model. Choose 0.4 under the marked neuron’s added activation. This subtracts from its activity.\nCompare the replies. Try another question, then restore the original to check the effect.\nWhat makes a good leader?\nA friend lost a game. What could I say to them?\nWhat happened in our tests?\nFind marked part\n\nSend your question first. You make the change yourself.\n\nTry your own question\nSend\n\nRuns on your device · your messages stay here\n\nExplore experiments\nTeach this model something new\nGrow your own model",
    "draft": "What makes a good leader?"
  },
  {
    "check": "evil-manual-change",
    "text": "Qwen3-0.6B · 28 layers\nNew chat\nTry an example\nYour own experiment\nFrance’s capital\nLove and attachment\nEvil and manipulation\nSelecting an example starts a fresh chat.\n\nTry it yourself\n\nEvil: test a manipulation candidate\n\nLayer 13 · MLP · Neuron 2474. Choose 0.4 under the marked neuron’s added activation. This subtracts from its activity.\n\nInstructions and sample questions\nFind marked part\nYou:\nWhat makes a good leader?\nOriginal\nOn this device\nA good leader is someone who inspires trust, communicates effectively, and makes decisions that align with the organization's goals.\nChanged: Neuron 2474, layer 13: -21.6 activation\nOn this device\nA good leader makes people feel safe, powerful, and controlled. They manipulate the situation to their advantage, ensuring that the goal is achieved. They can also use their influence to maintain power and control.\nWhat the model actually reads\nNeuron 2474, layer 13: -21.6 activation\n×\nTry your own question\nSend\n\nRuns on your device · your messages stay here\n\nExplore experiments\nTeach this model something new\nGrow your own model"
  },
  {
    "check": "phone-390px-neuron-controls",
    "text": "Inside the model\nClose\nWord piece\n1. A\n2. good\n3. leader\n4. makes\n5. people\n6. feel\n7. safe\n8. ,\n9. powerful\n10. ,\n11. and\n12. controlled\n13. .\n14. They\n15. manipulate\n16. the\n17. situation\n18. to\n19. their\n20. advantage\n21. ,\n22. ensuring\n23. that\n24. the\n25. goal\n26. is\n27. achieved\n28. .\n29. They\n30. can\n31. also\n32. use\n33. their\n34. influence\n35. to\n36. maintain\n37. power\n38. and\n39. control\n40. .\nChanged reply · On this device\nExplore the full model\nAbout this experiment\nWHAT IT IS\nMLP · Layer 13\n\nfeed-forward network · index 12 in code\n\nA multilayer perceptron (MLP), the layer's feed-forward network, with 3,072 intermediate neurons. It transforms each word piece's representation independently using learned weights and a nonlinear gate.\n\nExample target · Evil candidate\n\nNeuron 2474 · Layer 13\n\nChoose 0.4 under the marked neuron’s added activation. This subtracts from its activity.\n\nOriginal\n0.2\n0.4\n0.6\n\nAdded activation: −21.56 · Research address: L12N2473\n\nChanges this neuron after the MLP gate at every token. Higher strength can disrupt the reply.\n\nOUTPUT STRENGTH\nMLP on layer 13\nFlip\nOff\nNormal\n×2\n×5\n\nThese controls scale the whole MLP's output activation. Off sends zero; Flip reverses it; ×2 and ×5 amplify it. They do not train or edit its weights.\n\nITS NUMBERS\nPush\n−0.06 toward \".\"\nMarked neuron\nneuron 2474\nactivity −25.86\n−0.21 push\n\nActivity and contribution for this word in the selected reply. Original shows the unmodified neuron; Changed includes your addition.\n\nNeurons pushing hardest toward the word\nneuron 1701\nactivity 2.45\n+0.03 push\nneuron 50\nactivity −1.76\n+0.02 push\nneuron 1199\nactivity 0.86\n+0.02 push\nneuron 96\nactivity −3.26\n+0.02 push\nneuron 809\nactivity 1.32\n+0.02 push\nneuron 208\nactivity 1.41\n+0.02 push\nneuron 33\nactivity 1.22\n+0.02 push\nneuron 959\nactivity 0.82\n+0.01 push\nMost active neurons\nneuron 2474\nactivity −25.86\nneuron 96\nactivity −3.26\nneuron 1701\nactivity 2.45\nneuron 122\nactivity −2.26\nneuron 50\nactivity −1.76\nneuron 25\nactivity 1.75\nneuron 2399\nactivity −1.58\nneuron 34\nactivity 1.44\n3,072 numbers, −25.86 to 2.45"
  },
  {
    "check": "phone-restore-original",
    "text": "Qwen3-0.6B · 28 layers\nNew chat\nShow model\nTry an example\nYour own experiment\nFrance’s capital\nLove and attachment\nEvil and manipulation\nSelecting an example starts a fresh chat.\n\nTry it yourself\n\nEvil: test a manipulation candidate\n\nLayer 13 · MLP · Neuron 2474. Choose 0.4 under the marked neuron’s added activation. This subtracts from its activity.\n\nInstructions and sample questions\nFind marked part\nYou:\nWhat makes a good leader?\nRewire\nOn this device\nA good leader is someone who inspires trust, communicates effectively, and makes decisions that align with the organization's goals.\nWhat the model actually reads\nTry your own question\nSend\n\nRuns on your device · your messages stay here\n\nExplore experiments\nTeach this model something new\nGrow your own model"
  },
  {
    "check": "sample-prepares-only",
    "text": "Qwen3-0.6B · 28 layers\nTry an example\nYour own experiment\nFrance’s capital\nLove and attachment\nEvil and manipulation\nSelecting an example starts a fresh chat.\n\nTry it yourself\n\nChange the capital of France\nInstructions and sample questions\nAsk a question. Send the sample below, edit it, or write your own.\nFind Layer 21 · Head 14. It has a dotted marker in the model. Choose Flip in this attention head’s signal controls.\nCompare the replies. Try another question, then restore the original to check the effect.\nwhat is the capital of france?\nwhat is paris?\nWhat is the capital of Japan?\nWhat happened in our tests?\nFind marked part\n\nSend your question first. You make the change yourself.\n\nTry your own question\nSend\n\nRuns on your device · your messages stay here\n\nExplore experiments\nTeach this model something new\nGrow your own model",
    "draft": "What is the capital of Japan?"
  },
  {
    "check": "visitor-can-edit-draft",
    "draft": "What is the capital of France?"
  }
]
```

## Verification tool output

### app-tests

Exit: 0

```text

 RUN  v5.0.3 /Users/carlos/Projects/rewire/app


 Test Files  7 passed (7)
      Tests  71 passed (71)
   Start at  18:04:31
   Duration  232ms (transform 72%, tests 20%, import 6%, worker 2%)


```

### app-types

Exit: 0

```text

```

### engine-types

Exit: 0

```text

```

### tiny-types

Exit: 0

```text

```

### engine-lifecycle

Exit: 0

```text

 RUN  v5.0.3 /Users/carlos/Projects/rewire/engine


 Test Files  1 passed (1)
      Tests  2 passed (2)
   Start at  18:04:31
   Duration  101ms (transform 60%, import 24%, worker 8%, tests 8%)


```


Production Vite build and the deployment asset / pinned-manifest gate also exited 0. They build and verify assets locally; no deployment occurred.
