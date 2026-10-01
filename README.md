# Rewire

A real language model, Qwen3-0.6B, running in the browser with every step it computes shown, and its
parts changeable. Work in progress; the build follows the plan in phases, recorded in `db/`.

- `py/` the Python reference, quantization lab, curation checks and recording writer
- `engine/` the WebGPU engine (TypeScript and WGSL)
- `app/` the page (React and Vite)
- `tiny/` the tiny model (jax-js)
- `bench/` speed and parity harnesses
- `schemas/` the fixed conventions and file formats
- `db/` the engineering store: measurements, devices, decisions and phases
