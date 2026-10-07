# Rewire

[Open the lab](https://www.carlosgalarza.com/rewire).

Talk to Qwen3-0.6B in your browser. Change its attention heads and MLPs, cut transformer layers,
or zero real weights. Teach the same model with your own examples, or grow a separate tiny
transformer from random weights. The visualizer shows actual computations and parameters.
Inference and training run on your device; prompts and examples are never sent to a server.

This is an experimental learning tool, not a reliable assistant. Measurements, limitations,
and earlier development decisions are in `db/`.

## The experience

The lab has three benches. **Dismantle** starts with your own question and keeps a live visualizer
beside the conversation on desktop. On mobile, open it with Show model. Cut layers, change individual
heads, zero selected weights, or reduce weight precision. Original and changed replies share the same
sampling seed. Changes persist into new questions; Restore removes them. The model loads automatically.
Sample questions use the same live inference path as freeform chat. Unsupported devices or loading
failures show an honest unavailable state; there is no replay fallback.

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
experiment reversible, and both copies generate with the same input and sampling seed. Open the result
in the full lab to inspect attention and direct contributions or disable components. Grow does not
fine-tune Qwen. The tiny model trains on 64-letter windows and works best with short ASCII patterns.

Every reply and inspection is computed locally. Neither model is a reliable
source of facts. The visualizer reports measured contributions, not a complete causal explanation.

## Play with vector geometry

Ask a question, then choose **Turn a signal** or click a head in the tower.
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

- `app/` the page: React, Vite and TypeScript, built as static files
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

For isolated fallback checks, run `node app/scripts/browser-qa.mjs`. Its local page at
`http://localhost:5200/?scenario=reset` adds a button that sends a simulated GPU-loss notification to the
real engine client. It must cancel current writes, reload the worker and let Continue re-read the saved
conversation. This checks the recovery path; physical GPU loss still needs a device test. Other scenarios
are `no-gpu`, `crashed`, `storage` and `corrupt`. The fixtures live in a temporary directory and are absent
from the production build. Phone layout checks on a desktop do not qualify phone performance.

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

Notices for every dependency and text are in [app/public/licenses.txt](app/public/licenses.txt).

## License

MIT for the code. The converted weights keep Qwen's Apache 2.0 license.
