# Rewire

A real chat AI, Qwen3-0.6B, running in the browser with every step it computes shown with its real
numbers, and its parts changeable: turn heads, memory blocks and floors off or up, swap two words, hide a
word, push a concept, squeeze the weights to fewer bits. A tiny model with the same design learns from your
own writing in front of you. No server does the thinking and nothing you type leaves the device.

Status: in development. The build follows phases with exit checks; measurements and decisions are in `db/`.

## The experience

The lab has two benches. **Dismantle** starts with your own question and keeps a live visualizer
beside the conversation on desktop. On mobile, open it with Show model. Cut layers, change individual
heads, zero selected weights, or reduce weight precision. Original and changed replies share the same
sampling seed. Changes persist into new questions; Restore removes them. Recorded experiments are
optional and labeled.

**Grow** trains a separate 800,256-parameter transformer from random weights using actual backpropagation
in the browser. Its editable starter language withholds six combinations from thirty training examples.
Test cases and expected answers are editable, and test prompts run without the training corpus in context.
The live weight map shows actual parameter values or their changes since initialization. Keep learning
continues from current weights with a fresh optimizer, including after changing the training text.

Scramble and Erase rewrite the learned matrix parameters themselves. A retained intact copy makes the
experiment reversible, and both copies generate with the same input and sampling seed. Open the result
in the full lab to inspect attention and direct contributions or disable components. Training does not
fine-tune Qwen. The tiny model trains on 64-letter windows and works best with short ASCII patterns.

Qwen replies identify recorded, locally generated, and mixed provenance. Neither model is a reliable
source of facts. The visualizer reports measured contributions, not a complete causal explanation.

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

Load Qwen explicitly with Enable live chat. Recorded runs are available while it downloads. Grow needs
no pretrained model download and does not start the Qwen download in the background. To run chat live in development,
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
weight chunk, the manifest against all ten path recordings, the tokenizer files and license notices.

For isolated fallback checks, run `node app/scripts/browser-qa.mjs`. Its local page at
`http://localhost:5200/?scenario=reset` adds a button that sends a simulated GPU-loss notification to the
real engine client. It must cancel current writes, reload the worker and let Continue re-read the saved
conversation. This checks the recovery path; physical GPU loss still needs a device test. Other scenarios
are `no-gpu`, `crashed`, `storage` and `corrupt`. The fixtures live in a temporary directory and are absent
from the production build. Phone layout checks on a desktop do not qualify phone performance.

## Deploying

The page is static; the weights are a separate public Hugging Face model repository. After recording and
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
