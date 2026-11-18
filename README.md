# Rewire

[Open the lab](https://www.carlosgalarza.com/rewire).

Talk to Qwen3-0.6B in your browser. Change its attention heads and MLPs, cut transformer layers,
or zero real weights. Teach the same model with your own examples, or grow a separate tiny
transformer from random weights. The visualizer shows actual computations and parameters.
Inference and training run on your device; prompts and examples are never sent to a server.

This is an experimental learning tool, not a reliable assistant. Measurements, limitations,
and earlier development decisions are in `db/`.

## The experience

The lab has three benches. **Dismantle** opens on the whole 3D model. Questions and experiments sit beside it on desktop and below it on phones. Cut layers, change individual
heads, zero selected weights, or reduce weight precision. Original and changed replies share the same
sampling seed. Changes persist into new questions; Restore removes them. The model loads automatically.
Sample questions use the same live inference path as freeform chat. Unsupported devices or loading
failures show an honest unavailable state; there is no recorded fallback.

The visualizer measures one selected token. **Follow output** selects
the newest token of the reply being written: the changed reply in Push, falling back to the original
while the changed one is empty, and always an original token in Change from original. Choosing a
token yourself (in a reply, with Previous and Next, or by picking a candidate) pauses it. Paused, your token stays selected across new questions, Continue and model
changes, and moves only if it stops existing: to the nearest token of the same reply, then that
sample's original reply, then the nearest remaining sample. With nothing selected, the first token
written is selected once and kept. Only you turn following on or off, with one exception: clearing
the samples, opening a guided example and switching between Qwen and the tiny model start a new
experiment, which follows again. Switching between Push and Change from original keeps the setting. A 3D Replay holds the selection while it lasts: Back to live turns following
on, and a replay that ends any other way leaves following as you had set it before. Choosing a token
or using a candidate during a replay is your own pause, the same as in live output: it stays paused
on your token when the replay ends, and only Back to live or the toggle follows again.

Using a candidate in place of the written piece rewrites the reply from that piece on, to the length
the reply had (or the reply cap, whichever is longer), so a pick late in a continued reply or near the
end of a tiny-model text still writes the picked piece and everything after it. Undo restores the
reply as it was. A comparison with the changed model belongs to the exact tokens it was measured on:
after a pick, an Undo or a Continue the old one is dropped and measured again, and until the new one
arrives no word is underlined and no changed probability is quoted.

A reply stops at its cap (64 word pieces for Qwen, 160 letters for the tiny model) and Continue writes
on from there. Prompt and reply together cannot exceed the model's context: 1,024 tokens for Qwen on
desktop, 512 on a phone, 512 letters for the tiny model. A reply that reaches it says so in place of
Continue.

The change table the kernels read has fixed room: 16 dictionary swaps, 16 hidden words, 8 zeroed
weights and 16 neuron pushes at once. One more than that is refused before anything is shown as
active, with a message naming the limit, and the control that would add it is disabled with the same
reason. Nothing is dropped silently. A hidden word is hidden by its position in the prompt, so with
several samples its chip names the word only where every sample has the same word at that position,
and the position otherwise. Every change control in the inspector and the 3D bench is
enabled by one rule: the model is ready, no reply is being written and Qwen is not being taught.
While samples are updating, a further change restarts the update.

**Teach** fine-tunes the same Qwen model using editable question/answer pairs. A rank-8 LoRA adds
32,768 trainable float32 parameters to layer 28's MLP down projection; original Qwen weights stay
frozen. It uses full-vocabulary cross entropy, answer-only targets including the end marker, and Adam
with gradient clipping and weight decay. The frozen prefix is cached exactly: changes to the final
MLP cannot affect earlier layers or any attention KV cache. Both adapter matrices receive gradients.
Continue learning starts from both installed adapter matrices. Each round resets Adam's moments
and trains on the examples currently in the paired question/answer editor; retaining old examples
rehearses them, while removing an example does not erase it from existing weights. Train from original
explicitly starts a fresh adapter. Stop retains completed steps; stopping before the first step leaves
the previous lesson unchanged. A GPU reset restores the last installed adapter. Examples, checkpoints,
and the adapter stay in memory for the visit.

Fresh tests include no training examples in the prompt and use greedy decoding with a 64-token cap.
Every completed round automatically compares a taught example, an optional visitor-editable test
question, and a general knowledge control. Test questions are never added to training. The UI tracks
questions used across continued rounds, even after removal from the editor, so a previously taught
question is not mislabeled as unseen. Expected answers are display-only, with no automatic success
score. Original and trained answers appear together, including failures. Off/On beside the results
switches between those actual generated answers; Dismantle's Off/On changes the live intervention.
General knowledge checks expose possible forgetting; rephrasing alone does not establish rule learning.
The live map shows real A/B parameters, not activation pushes. Dismantle this model installs the
same adapter as a removable intervention and replays the existing chat. MLP scaling, cutting its layer,
and individual down-weight zeroing act on the learned addition too. Precision controls affect the
quantized base weights; the learned adapter remains float32.

**Grow** trains a separate 800,256-parameter transformer from random weights using actual backpropagation
in the browser. Its editable starter language withholds six combinations from thirty training examples.
Test cases and expected answers are editable, and test prompts run without the training corpus in context.
The live weight map shows actual parameter values or their changes since initialization. Keep learning
continues from current weights with a fresh optimizer, including after changing the training text.

Scramble and Erase rewrite the learned matrix parameters themselves. A retained intact copy makes the
experiment reversible, and both copies generate with the same input and sampling seed. The intact copy
is the last one trained without damage, and only two actions replace it: Start over from noise, and
Make this the intact copy. While a damaged copy is on screen, the continue button reads Retrain the
damaged copy and a note says before you press it that training continues from the damaged weights and
the intact ones are kept. The copy is then labelled with its damage and the steps trained since, and
Restore intact model still returns to the intact weights, their step count and their training text.
Make this the intact copy appears once the damaged copy has been retrained, and names the step of the
weights it replaces; the last generation is then made again, so Intact weights always means the
current intact copy. The checkpoints and the loss on screen belong to the weights on screen: Restore
and a new damage experiment bring back the intact weights' own history, and a damaged copy that has
not been trained says that the history shown is the intact run's. A run that fails keeps the last
snapshot it delivered, under the same rules as a finished run, or leaves the bench exactly as it was
before the run. Open the result
in the full lab to inspect attention and direct contributions or disable components. Grow does not
fine-tune Qwen. The tiny model trains on 64-letter windows and works best with short ASCII patterns.

Every reply and inspection is computed locally. Neither model is a reliable
source of facts. The visualizer reports measured contributions, not a complete causal explanation.

## The model in 3D

All three benches open directly on the model. The 3D instrument has one deck per layer in a four-post rack, its attention heads seated in pairs on the socket for
the keys and values they share, its MLP under a finned heatsink, and the two points where their
output joins the residual stream, a glass tube running from the dictionary below to the output above.
It is lit as a product photograph: brushed aluminum, dark ceramic, gold contacts and copper bus bars
under studio softboxes, on a dark seamless backdrop in both themes. Choose **Full screen** in the 3D
view to give the model the whole screen. Camera controls float over the model. Open the question,
lesson or part details when you need them. Replay or training controls stay within reach at the bottom.
Leaving full screen returns you to the same model, camera and editor. The renderer loads on demand.
If WebGL is unavailable, you can retry the renderer and use the named part controls. Inference
and training have their own device requirements. Touch-first devices use lighter geometry and materials.

### Capability inventory

| Workflow | Where to do it in the 3D workspace |
| --- | --- |
| Ask and compare independent questions | Open **Questions**. Each sample keeps its prompt, original answer and changed answer together. Jump to a sample, edit and regenerate it, remove and undo, stop or continue a reply, or clear the set. |
| Read the actual input and output | Expand the input for a sample to see prompt markers, token IDs and positions. Select a reply token to see its measured effect on the model. **Inspect selected token** opens the measurements and candidate table, including model and draw probabilities, candidate substitution and undo. |
| Navigate the architecture | Rotate, pan, zoom, spread, fit, focus or change camera view. Tap a part or choose its layer and component in **Inspect part**. Grab rearranges the display. Punch applies the part's supported intervention. Keyboard and named controls provide alternatives to precise pointing. |
| Inspect and intervene | Inspect attention and head signals, MLP and neuron contributions, residuals, input dictionary, output and normalization. Adjust strengths, cut or restore layers and heads, turn a signal, change precision, zero weights, swap dictionary entries or hide a prompt position. Chips track changes across all samples. |
| Compare computations | Follow live output, pause on a token, step between tokens and switch between direct pushes and the change from original. Inspect layer totals, signs, unavailable values and comparison retries. |
| Run guided experiments | Choose an example or open the experiment list. Follow its target in the model, inspect or modify the indicated part, then compare the measured answers. |
| Replay the whole model | Use **Replay answer** below the scene or the replay action on a finished reply. Choose the whole answer or one token, step through layers, pause, change pace, restart or return to live output. A token's result appears at the output step. |
| Teach the loaded Qwen model | In **Lesson**, edit examples and held-out questions, set training steps and learning rate, train, continue or stop, and compare before/after answers. In **Inspect part**, inspect adapter A and B, individual values, movement and loss. Carry the adapter into Dismantle. |
| Grow a model from noise | In **Training**, edit the corpus and tests, train, stop and continue, compare generation with the intact copy, damage or restore weights, adopt retrained weights, inspect one gradient step and open the trained model in Dismantle. Inspect individual matrices, coordinates and whole-model changes in **Inspect part**. |
| Use a phone or full screen | The model appears on entry. Below it, switch between the editor, **Inspect part** and **Camera**. **↑ Model** takes you back from a long editor. **Full screen** keeps playback within reach and opens the same editor and part controls as overlays. |

Three tools keep looking, arranging and changing apart:

- **Explore** turns and zooms the model and selects a part. Its existing controls open beside the stage.
- **Grab** drags heads, MLPs and whole decks. This rearranges the drawing only. Reset layout puts
  everything back and never touches the model.
- **Punch** changes the model. In Dismantle it sets the clicked head, MLP or layer to zero through the
  same change the Off control writes, once per click, and your samples update. Punching it again puts
  it back, and Restore model removes every change. In Grow it scrambles that layer's real weights at
  the chosen strength, starting from the intact copy. Teach has no Punch; it hands the taught model to
  Dismantle.

Moving around:

- Drag turns the model, the wheel or a pinch zooms toward the pointer, and the right button, Shift
  with a drag, or two fingers pan. Double-click a part to **focus** on it: the camera comes close from
  the angle you were already looking from and pivots around that part. Double-click the backdrop, or
  press Fit, to return to the whole model.
- A breadcrumb at the bottom left says where you are (Model › Layer 21 › Head 14) and steps the
  selection up and down the layers. Once you have focused on a part, the camera follows the selection
  and keeps your angle and zoom. Showing the whole model, it stays put, and measurements arriving never
  move a camera you have placed.
- The dock at the bottom right holds Fit, Focus, zoom, Pan, Spread, Views (three-quarter, front, side,
  top, around the part in focus) and a help panel listing every mouse, trackpad, touch and keyboard
  control. On a phone, open **Camera** to see each action by name. In the docked view
  the same controls sit under the stage.
- **Pan** makes plain drags slide the view. While it is on, or Space is held, clicks select nothing and
  change nothing. A press that ever travelled, a second finger, or a modifier key is always the
  camera's: it can never end as a Punch or leave a part dragged.
- **Spread** opens the layers apart and lifts every module off its socket on a tether, so you can look
  between the decks. Every part stays selectable. It moves the drawing only, and Reset layout closes it.
- With the model focused: arrow keys move between parts, Shift with arrows turns the model, + and −
  zoom, F or Enter focuses the selected part, Home or 0 fits the model, 1 to 4 pick a view, E spreads
  the layers, Space held pans, P punches the selected part, and ? opens the help panel. E, P, ? and
  Space act once per press: holding one down does not repeat it, while arrows and zoom do repeat.
  Space stops panning when it is released, when a modifier key goes down or when the stage loses
  focus. Docked and in full screen alike, Escape closes an open Views or Help panel or a menu first
  and steps out of a text field next. In full screen it then closes an open question, lesson or part
  panel, and only then leaves full screen. Where the browser's own full screen is on, the browser
  takes Escape and leaves full screen at once.

A selected part has its own restore button, and it undoes only what belongs to that part. Restore this
head clears the head's strength and direction change. Restore this MLP clears its strength and the
additions to its neurons. Restore this layer and its parts clears the layer's strength, the weights
zeroed in it, a concept pushed at it, and the changes on every head and the MLP on its deck. Other
layers, weight precision, dictionary swaps, hidden words and learned weights are never touched by
these; they have their own controls, and Restore model removes everything.

What is measured and what is drawn:

- The number of layers, heads and key/value groups, and which heads share a group, come from the
  model's configuration. The shapes, sizes, positions, materials, screws, contacts, circuit traces and
  lighting are a drawing. A model has no physical form, and no shape stands for real hardware or for an
  individual parameter. The dictionary tiles and MLP fins stand in for 151,669 rows and 3,072 neurons
  and are not drawn one by one.
- In Dismantle, the lit windows on each module, the strips on the sockets and the rings on the stream
  are colored by the selected token's direct pushes, measured during inference. The chassis
  keeps its own material, and a window with no measurement stays dark. Once a token is measured,
  selecting a layer opens the tower above it and stands that layer's measured values there as plates,
  in computation order, from the same inspection pass the detail panel uses: the stream in, its
  normalization, the query, key and value projections, the normalized and position-rotated queries and
  keys, the scores, attention, mixed values, the combined heads and the addition to the stream, then
  the MLP's normalization, gate, up projection, neurons, down projection and the stream out. During a
  replay the plates of the selected layer come up in that order. Hover a tile to read its number. With a head selected, arcs show its measured attention over the context. The bars over
  Words out are the model's own probabilities for the pieces it ranked highest and for the piece that
  was written: temperature 1, over the whole vocabulary, the same measure as the written piece's
  log-probability. They are not the sampler's odds. The sampler takes the top 20 with a softmax at
  the sampling temperature, keeps the first of them that reach 0.8 of that mass (top-p), and draws
  among those kept, so a piece's chance in the draw is its share of the kept candidates and a
  candidate past the cut has none. With one candidate kept the draw is certain, 100%, whatever the
  model gave it. The token inspector makes the sampling odds explicit. Its
  candidate table has a Draw column (the chance after the cut, or cut for a dropped candidate) beside
  a Model column (temperature 1, whole vocabulary, in the same two-decimal bounded form as the 3D
  bars, while a certain draw reads exactly 100%); the detail panel lists Chance in the draw beside
  Model's probability; and the selected piece names how it was chosen. A piece you
  picked is never called drawn: it reads Selection: Your choice, with what the
  draw would have given it. Candidates past the cut and outside the list can still be used; that is
  your intervention, and is labelled as one. The written piece always has a bar,
  also when you picked it from outside the top 20. Every number has two decimals (62.18%, 99.72%,
  1.00%), so tokens with different probabilities read differently as a replay moves through them.
  Below 0.01% a bar reads <0.01%, from 99.995% up it reads >99.99%, never exactly 0% or 100%, and a
  value that is not a probability reads unavailable.
- In Change from original the parts are lit only by a comparison measured on the selected token.
  While one is being measured the readout says so, and when there is none it says that. It never
  states a total of zero for values that do not exist.
- A direct push that is not a number is no measurement: its part and its layer stay unlit, the
  others keep their colors and scale, and the readout says the measurement is incomplete and gives
  no total, live and in a replay.
- A measurement belongs to one writing of a reply. Every new reply and every rewrite from a picked
  piece is its own writing, also when a later pick repeats an earlier one after different tokens;
  Continue keeps it, and Undo returns to the writing it restores.
- Grab moves a part only once the press has travelled past the click threshold, so a click with a
  trembling hand selects the part and leaves it on its socket. A tooltip is read again when the
  values or the part under a resting pointer change.
- Teach shows the adapter's actual A and B matrices and the size of each of its eight ranks, refreshed
  every 10 steps. Frozen layers are drawn dimmed. No activations are measured during teaching, so
  nothing else lights up.
- Grow colors each part by its own slice of the 800,256 parameters: a head owns its rows of the query
  matrix and its columns of the output matrix, and a pair's base owns their shared key and value rows.
  Selecting a layer shows its real weight matrices or their change since the start.

Large tensors are reduced for display by keeping, in each block of neighboring cells, the one with the
largest magnitude. The readout names the cell that value was read from and the cells the tile stands
for. A measurement that arrives after
the token, model or changes have moved on is dropped. With the model focused, arrow keys move between
parts, Enter looks closer, P punches, Shift with the arrows turns the model, plus and minus zoom, and
0 resets the view. The same selection is available from two ordinary menus under the stage. With
reduced motion set, parts move without springs and each replay step lights at once, including when
the preference changes while the view is open. Labels are kept inside the stage and clear of the
toolbar; where two would touch, the less important one is left out.

### Live output and Replay

The controls sit under the docked 3D stage and float along the bottom edge in full screen. On a
phone, open **Replay options** for speed, whole-answer or single-token playback, and restart.

**Live output** is the default. The model shows the selected token complete, Follow output keeps it
on the newest token, and Previous and Next choose another.

**Replay answer** walks a finished reply back through the whole model. It starts at the reply's first
visible token, lights that token's steps in the order the architecture computes them (the token read,
each layer's attention then its MLP, then the choice: 58 steps for Qwen, 10 for the tiny model), then shows
the finished token's result, and moves on to the next token until the
last one. Then it stops; it does not loop. A replay reads only values that were measured while the
reply was written. Nothing is generated again, no number is invented, and the pace is an
illustration, not a timing of the real computation. (Updating your samples after a model change is a
different thing: there the model really writes the changed answers again.)

- Replay answer is enabled once the selected reply is finished and the model is idle. Until then the
  strip says what it is waiting for: a question, the end of the reply being written, or the end of a
  sample update. Each finished reply also has a replay action in Questions that starts with that reply.
  Stale replies are not offered.
- The scope is **Whole answer** or **This token**. Replay only this token starts on the selected token
  and stops at its end. You can switch scope during playback. Speed is kept between replays;
  Replay answer always starts the whole answer. Slow is 400 ms a step, Steady (the default) 110 ms and Fast 50 ms: about 6 and 3 seconds for a
  Qwen token. A finished token is held for at least 600 ms at every speed.
- In the scene, amber corner brackets and a label (Layer 13 · attention) mark the step the replay is
  at: the dictionary, one layer's attention heads, one layer's MLP, or the output. They are a position
  only. They light nothing, do not depend on what was measured, leave the selection outline and the
  guide mark as they are, and never move the camera. With reduced motion they are a still cue.
- The output is shown where the model produces it: after the token's last step. Until then Words out
  carries no bar, no word and no number, the written piece included, only the note Not chosen yet,
  and no bar grows toward its value in between. Scrubbing or stepping back hides the result again, and
  when a replay reaches another token (by playing on, by a step, or because you selected one in this
  reply, the other reply or another sample) the output is emptied at once and stays empty until that
  token's own result has been handed over. Labels are placed before they are first shown, so none
  appears early or out of place. The reply text beside the stage and the token named in the strip are the answer already
  written, and stay. Live output shows each result as soon as it is generated.
- The strip says Replaying, Replay paused or Replay finished, and its progress line matches the
  scope: the whole answer from its first step to its last, or this token alone from empty to full.
- Pause and Resume hold and continue. Back a step and Next step, and the scrubber labelled
  Steps for this token, move within the token and pause; in a whole-answer replay the step buttons
  run on into the neighboring token. Previous and Next token, or selecting any token in a reply, pause
  on that token and show it complete; selecting a token of the other reply or of another sample makes
  the replay about that reply. Play then walks the chosen token from its first step and continues with
  the chosen scope. Start over and Replay again begin at the first token of the answer, or at the first
  step of the token in This token scope.
- Playing moves one step at a time. A step lights up briefly and then nothing is redrawn until the
  next one unless you are moving the camera, so turning, zooming, panning, Explore and Grab stay
  responsive. However long a frame took, the replay moves at most one step in it: a stall or a hidden
  tab never becomes a jump. Each step updates the stage directly; only the small readout re-renders.
- While a whole answer plays, a selected layer is not measured again for every token going by. Pause,
  and the token on screen is measured, with the same loading state and newest-request guard as live
  inspection. A measurement is only ever shown for the token it was made for. Opening the inspector
  pauses the replay for the same reason.
- **Back to live** ends the replay and follows the newest output. A replay also ends by itself, never
  moving the selection again and keeping a token you chose during it, when the model starts writing (a new question, Continue, a picked
  candidate), when the model changes (a control, Punch, Restore), when a sample is edited, removed,
  restored or cleared, or when you switch models or benches. It pauses, and stays paused until you resume, when the tab is hidden, the stage
  scrolls out of sight or the 3D view has to be reloaded. It never starts playing by itself.

### Sharing the GPU

Inference (WebGPU, in a worker) and the 3D view (WebGL, on the page) use the same GPU. With no 3D view
open, the worker keeps two steps queued ahead of the one it is reading, as before. While a 3D view is
open it waits for each step to finish before queuing the next, and after about 24 ms of work leaves
its queue empty for about one frame (16 ms) before going on, for replies and comparisons alike. This
gives the browser room to draw the model between tokens; it cannot guarantee a frame, because the
browser and the driver decide the order, and a single token's forward pass is not split. The numbers
are identical either way: only when a step is queued changes. Stop, a newer model version and a
replaced job are checked before every step, including after each rest, and a comparison now stops on
Stop as well. Replies give the visible 3D scene time to render between steps. A replay
needs the model idle, so it never competes with generation.

## Love and evil candidates

Choose an example above the chat: **France’s capital**, **Love and attachment**, or
**Evil and manipulation**. Selecting one prepares an editable question and marks its target in
the model. It does not generate a reply or apply the edit. Send the question, click the marked
part (or Find marked part), and use that component’s controls yourself. Instructions and extra
questions remain available after the first reply.

For love and evil, compare Original, 0.2, 0.4 and 0.6, then try your own question. Look inside shows the exact address,
activation addition and the selected word's measured neuron contribution. These controls add to
one MLP activation at every token, after the gate and before the down projection. They do not
rewrite prompts or train weights.

The research addresses are zero based: **L9N2753** for attachment and **L12N2473** for the
manipulation candidate. The interface calls these layer 10, neuron 2754 and layer 13, neuron 2474.
Strength 0.4 adds approximately +15.549 and −21.560 activation units respectively. Strength is
normalized against a reference residual norm and the selected down-projection column's norm.

The October 28 exploratory search used this app's exact converted 4-bit model, 20 contrasting
reply pairs per concept, activation rankings, teacher-forced screening and fresh generation.
After selection, both candidates were tested on 12 unused prompts with reverse pushes and
same-layer random controls. The attachment candidate redirected several unrelated questions
toward connection and affection. The manipulation candidate changed a leadership reply toward
fear, deception and control, but many other replies stayed ordinary or became repetitive.
Higher strengths often lose the question. Reverse pushes did not establish opposite personalities.
These observations support candidate effects, not dedicated love or evil neurons or a reliable
personality switch. The samples were chosen after reviewing the results.

The corpus and search implementation live in `py/data/personas.json` and `py/tools/persona_search.py`.
All screened rows and generated replies, including failures and controls, are retained in
`fixtures/personas/2026-10-28/`; none of these recorded replies ship in the app. The research method
is inspired by [neuron-explorer](https://github.com/lyramakesmusic/neuron-explorer), with our own
corpus, screening heuristic and model-specific validation.

The France example reverses **head 14 in layer 21**, research address **L20H13**, with
multiplier −1. This is an attention head, not a neuron. The October 28 WebGPU recheck reproduced
Paris → Washington, D.C. at seeds 11, 7 and 42 (temperature 0.7) and with greedy decoding. It
worked both independently and in the screenshot’s two-turn Paris conversation. The same flip
changed Tokyo → London for Japan; a comparison head in the same layer preserved both capitals.
This is evidence of a broader effect on factual answers, not a dedicated France circuit.

The same recheck reproduced attachment language for the garden and moon prompts, and
manipulation language for the leader prompt. The friend prompt remained mixed. All 28 baseline
reruns restored the exact token IDs. Raw outputs and controls are retained in
`fixtures/guided-examples/2026-10-28.json`. Reproduce them with:

```bash
node engine/node_modules/tsx/dist/cli.mjs engine/scripts/guided-examples.ts
```

Reproduce the final greedy tests from the repository root, with the converted weights available:

```bash
py/.venv/bin/python -u py/tools/persona_search.py generate \
  --recipes fixtures/personas/2026-10-28/recipes.json \
  --out artifacts/personas/reproduction --phase heldout --batch 8 --cap 64
```

Use `rank`, `screen` and `bundles` to repeat or extend discovery. Inspect the output rather than
treating likelihood scores as semantic labels. The expanded screen was intentionally stopped
before its planned totals; the retained data states exactly which variants ran. This is a small
exploratory study on one quantized checkpoint and one device, without an independent semantic rater.

## Play with vector geometry

Ask a question, then choose **Turn a signal** or select an attention head in the model.
**Rotate** turns its projected output from −180° to 180° without changing its length. At 90° it is
perpendicular to the original; at 180° it reverses. **Remove overlap** subtracts the component parallel
to the stream entering that layer. **Scramble coordinates** permutes the same numbers into a different
arrangement. A checkbox applies edits to every head on that floor. Restore removes all interventions.

These controls modify activations during both prompt processing and generation. They do not train
weights. Rotation uses a reproducible seeded pairing of coordinates; its plane is not a learned
semantic direction. The diagram uses the selected token’s measured before/after angle and relative length,
represented in two dimensions. It appears only when those measurements are available. The panel also
reports alignment with the incoming stream for overlap removal.
Direct contribution colors use the transformed vectors actually added to the stream.

The design draws on the distinction between addition, projection and rotation in
[Angular Steering (NeurIPS 2025)](https://proceedings.neurips.cc/paper_files/paper/2025/hash/b0223cad0e73b793f31eb6cc41cefceb-Abstract-Conference.html)
and [Spherical Steering (ICML 2026)](https://proceedings.mlr.press/v306/you26a.html).
Those works use behavior-related directions. Our seeded head-output interventions are exploratory
geometry controls, not replications of their methods or demonstrated semantic steering. The Python recording writer
rejects geometry specs until it has a matching implementation; these experiments run live.

Run the local probes with:

```bash
pnpm -C engine exec tsx scripts/vector-experiment.ts
pnpm -C engine exec tsx scripts/vector-experiment.ts ../artifacts/weights/gptqclip-g32-d4clip ../artifacts/qa/vector-experiment-layers.json --layer
```

The October 2 exploratory runs used four prompts, four candidate layers, five settings, seed 7, and
40-token generation caps: 160 first-token comparisons and 48 generations. For each prompt, generation
used the candidate with the largest first-token KL under a 90° rotation. This is exploratory selection,
not a held-out behavior benchmark. The script records all candidates and outputs, the exact manifest
hash, GPU errors, timing and restoration checks in `artifacts/qa/`.

Single-head changes often moved probabilities without changing the sampled answer. On the robot/rain
prompt, rotating all heads on floor 17 changed the response from adapting to rain to claiming the
robot's discovery changed the weather. Removing overlap left the sampled replies unchanged in these
trials. Arithmetic and Paris mostly survived. Every tested prompt returned to the exact baseline token
sequence after restoration. A useful first experiment is a creative prompt, floor 17, all heads, 45°,
90°, then 180°. Stronger does not mean more meaningful, and a perpendicular vector does not mean a
semantic opposite.

## Layout

- `app/` the page: React, Vite and TypeScript, built as static files. `app/src/stage/` is the 3D view:
  pure modules for the architecture, replay (`replay.ts` is the state machine, `replay-session.ts`
  binds it to the page), interventions and data, and `scene/` for Three.js (the
  specimen, its generated materials and detail, the studio lighting, the camera and the stage)
- `engine/` the WebGPU engine (TypeScript and WGSL): 4-bit weights unpacked in the kernels, math in 32-bit
  floats, a change table every kernel reads, direct pushes and an inspection pass for any word
- `tiny/` the tiny model in jax-js (about 0.8 million numbers), handed to the engine's 32-bit path
- `py/` the PyTorch reference, the 4-bit lab, golden traces, curation checks and the recording writer
- `schemas/` the fixed conventions and file formats shared by Python and TypeScript
- `db/` the engineering store (db.md): measurements, devices, decisions and phases

## Running it

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm -C app dev
```

Use Node.js 22.18 or newer. Qwen starts loading when the page opens, with real byte progress and
Pause/Resume. The default download uses the public model release pinned in
`app/src/live/release.json`; no login or API key is needed. The browser tries to cache it for later
visits. Grow trains its own model independently.

For local model files, convert the weights (`py/tools/convert.py`, see `py/`) into
`artifacts/weights/<id>/`, then run `VITE_WEIGHTS_URL=/weights/ pnpm -C app dev`.
The dev server serves those files at `/weights/`.

`pnpm test` runs the engine, tiny-model and app suites, including actual WebGPU tests, on a
machine with a compatible GPU. `pnpm test:deploy` runs the app and resource-lifecycle tests plus
all TypeScript checks without requiring a GPU. `uv run pytest` in `py/` runs the Python reference checks.

## Checking the production build

```bash
pnpm build
node app/scripts/check-deployment.mjs
node app/scripts/throttled-serve.mjs 5199 0 0
```

Open `http://localhost:5199/rewire`. The local server applies the response policies in `_headers`,
including its content security policy. Use `5199 1100 170` with local weights for the shared slow
connection. Before publishing new model weights, `node app/scripts/preflight.mjs gptqclip-g32-d4clip`
checks every local weight chunk, the manifest against the bundled experiment parameters,
the tokenizer files and license notices. Deployment checks verify the public manifest and built
subpath assets. Both refuse builds that contain archived recordings. Historical traces are preserved in
`fixtures/recordings/` for research and format tests, outside the deployed app.

For isolated fallback checks, run `node app/scripts/browser-qa.mjs` after `pnpm build`. It serves the
production build unchanged, at the deployed subpath and under the same response policies, from a
temporary directory that also holds a few QA files. Open
`http://localhost:5200/rewire/?scenario=<name>`; several names can be joined with commas.

- `reset` adds a Simulate GPU reset button (Alt+Shift+G) that sends a device-loss notification to the
  real engine client. It must cancel current writes, reload the worker and let Continue re-read the
  saved conversation. This checks the recovery path; physical GPU loss still needs a device test.
- `worker-fail` adds a Fail engine worker button (Alt+Shift+W) that terminates the engine worker and
  reports its error, as a crash does. Press it with the tiny model on screen: the device line and Try
  again must appear and Back to Qwen must work. Press it on the Grow bench before Open this model in
  the full lab: the handoff must start a fresh worker, and the tiny model, which then runs, shows no
  error. Qwen is not loaded in that worker, so back on Qwen the error and Try again are still there
  and Try again loads it. Leaving the tiny model announces Qwen's actual state, never a stopped reply.
- `worker-dead` makes the engine worker throw while it starts (`&dead=N` for the first N workers).
- `no-gpu` removes `navigator.gpu`, and `storage` makes the worker's cache storage refuse to open.
- `corrupt` replaces the first cached weight chunk with zeros before the model loads and reports
  whether the page repaired it. It needs the model: the pinned remote one, downloaded on a first
  visit to that origin, or local weights with a build made with `VITE_WEIGHTS_URL=/weights/`.

The controls sit in a small fixed panel, the key chords work when a dialog covers the page, and each
event is logged to the console as `QA_<EVENT>`. `node app/scripts/browser-qa.mjs --check` writes the
QA files, checks that the served page starts from them and that nothing of them is in `app/dist`, and
exits. Phone layout checks on a desktop do not qualify phone performance.

## Deploying

The `rewire` Vercel project builds this repository using `vercel.json` and publishes `app/dist`.
`main` is the production branch; other branches get protected previews. Each deployment runs
`pnpm build:deploy`: the tests that do not require a GPU, all type checks, the Vite build, and
a check that the pinned public manifest matches the application. Run the full GPU tests locally
after engine changes; the cloud build does not certify GPU correctness or phone performance.

The personal website forwards `/rewire` and `/rewire/*` to this project's stable production
alias, preserving the path. Rewire's own rewrites serve both the entry page and its assets under
that prefix, so direct Vercel previews also work. A push to Rewire updates the lab without a
portfolio rebuild. The website's Projects entry is maintained in its existing project-record export.

Weights are served directly from
[carloslfu/Qwen3-0.6B-Rewire-4bit](https://huggingface.co/carloslfu/Qwen3-0.6B-Rewire-4bit),
with an immutable commit pinned in `app/src/live/release.json`. The 385 MB model is not part of
the website deployment. Before replacing it, run the local model preflight, publish the files
with their Apache 2.0 license and original tokenizer, update the pin, and verify a fresh browser
download. `VITE_WEIGHTS_URL` is an optional development override.

No analytics, paid inference API, or server inference is part of this build. Learned adapters
stay in memory for the visit and are lost on reload. The application needs WebGPU; unsupported
devices receive an unavailable message rather than a simulated answer.

## Credits

- [Qwen3-0.6B](https://huggingface.co/Qwen/Qwen3-0.6B) by the Qwen team, Apache 2.0. The converted weights
  are quantized to 4 bits from Qwen/Qwen3-0.6B and are not made or endorsed by the Qwen team.
- [jax-js](https://github.com/ekzhang/jax-js) trains the tiny model.
- [Transformer Explainer](https://poloclub.github.io/transformer-explainer/) for the lessons on guided paths
  and flow drawings.
- Tokenizers.js from Transformers.js reads Qwen's tokenizer.
- [three.js](https://threejs.org/) draws the 3D view.
- [LLM Visualization](https://bbycroft.net/llm) by Brendan Bycroft for showing how much an architectural
  walk-through in 3D can explain.

Notices for every dependency and text are in [app/public/licenses.txt](app/public/licenses.txt).

## License

MIT for the code. The converted weights keep Qwen's Apache 2.0 license.
