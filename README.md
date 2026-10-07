# Rewire

A real chat AI, Qwen3-0.6B, running in the browser with every step it computes shown with its real
numbers, and its parts changeable: turn heads, memory blocks and floors off or up, swap two words, hide a
word, push a concept, squeeze the weights to fewer bits. A tiny model with the same design learns from your
own writing in front of you. No server does the thinking and nothing you type leaves the device.

Status: in development. The build follows phases with exit checks; measurements and decisions are in `db/`.

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
pnpm install
pnpm -C app dev
```

Qwen starts loading when the page opens, with real byte progress and Pause/Resume. The browser tries
to cache the model for later visits. Grow trains its own model independently. To run chat in development,
convert the weights (`py/tools/convert.py`, see `py/`) into `artifacts/weights/<id>/`; the dev server serves
them at `/weights/`. Tests: `pnpm test` runs the engine, tiny-model and app suites; `uv run pytest` in `py/` runs the reference checks.

## Checking the production build

```bash
pnpm build
node app/scripts/preflight.mjs
node app/scripts/throttled-serve.mjs 5199 0 0
```

Open `http://localhost:5199/`. The local server applies the deployment's response headers, including its
content security policy. Use `5199 1100 170` for the shared slow connection. The preflight checks every
weight chunk, the manifest against the bundled experiment parameters, the tokenizer files and license
notices. It also refuses builds that contain archived recordings. Historical traces are preserved in
`fixtures/recordings/` for research and format tests, outside the deployed app.

For isolated fallback checks, run `node app/scripts/browser-qa.mjs`. Its local page at
`http://localhost:5200/?scenario=reset` adds a button that sends a simulated GPU-loss notification to the
real engine client. It must cancel current writes, reload the worker and let Continue re-read the saved
conversation. This checks the recovery path; physical GPU loss still needs a device test. Other scenarios
are `no-gpu`, `crashed`, `storage` and `corrupt`. The fixtures live in a temporary directory and are absent
from the production build. Phone layout checks on a desktop do not qualify phone performance.

## Deploying

The page is static; the weights are a separate public Hugging Face model repository. After
publication approval, upload the exact `artifacts/weights/gptqclip-g32-d4clip/` folder using
[Hugging Face's upload CLI](https://huggingface.co/docs/huggingface_hub/guides/cli). Keep its Apache 2.0
license, model card and original tokenizer files together. Use the resulting immutable commit in
`VITE_WEIGHTS_URL`, rather than a moving branch:

```bash
VITE_WEIGHTS_URL=https://huggingface.co/OWNER/MODEL/resolve/COMMIT/ pnpm build
```

Create a Cloudflare Pages project and deploy `app/dist`, including `_headers`, following
[Cloudflare's Direct Upload instructions](https://developers.cloudflare.com/pages/get-started/direct-upload/).
Direct Upload and Git integration are different project choices; choose Git integration when automatic
deployments are wanted. For a Direct Upload project, `npx wrangler pages deploy app/dist --branch=staging`
creates the staging deployment. Check the remote model download, hashes, CSP, caching and the physical
device matrix there before launching. No analytics or server inference is part of this build.

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
