# Rewire

A real chat AI, Qwen3-0.6B, running in the browser with every step it computes shown with its real
numbers, and its parts changeable: turn heads, memory blocks and floors off or up, swap two words, hide a
word, push a concept, squeeze the weights to fewer bits. A tiny model with the same design learns from your
own writing in front of you. No server does the thinking and nothing you type leaves the device.

Status: in development. The build follows phases with exit checks; measurements and decisions are in `db/`.

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

The page plays recordings of real runs until the model is on the device. To run it live in development,
convert the weights (`py/tools/convert.py`, see `py/`) into `artifacts/weights/<id>/`; the dev server serves
them at `/weights/`. Tests: `pnpm -C engine test`, `pnpm -C tiny test`, `uv run pytest` in `py/`.

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
