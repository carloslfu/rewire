// Verify the exact live model release before uploading or deploying it.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..", "..");
const id = process.argv[2] ?? process.env.REWIRE_WEIGHTS ?? readdirSync(join(root, "artifacts", "weights")).sort()[0];
const weights = join(root, "artifacts", "weights", id), publicDir = join(root, "app", "public");
const sha = (b) => createHash("sha256").update(b).digest("hex");
const raw = readFileSync(join(weights, "manifest.json")), manifest = JSON.parse(raw), hash = sha(raw);
const path = JSON.parse(readFileSync(join(root, "app", "src", "path", "experiments.json")));
assert.equal(hash, path.manifest_hash, "The page and weights identify different manifests");
let total = 0;
for (const f of manifest.files) {
  const bytes = readFileSync(join(weights, f.name));
  assert.equal(bytes.length, f.bytes, f.name);
  assert.ok(bytes.length <= 16 * 1024 * 1024, "A chunk exceeds 16 MiB");
  assert.equal(sha(bytes), f.sha256, f.name);
  assert.equal(f.name, `${f.sha256.slice(0, 32)}.bin`);
  total += f.bytes;
}
assert.equal(total, manifest.total_bytes);
assert.ok(!existsSync(join(publicDir, "recordings")), "Recorded output must not be deployed");
assert.ok(!existsSync(join(root, "app", "dist", "recordings")), "Rebuild: dist contains recorded output");
for (const s of path.steps) {
  assert.ok(!s.recording && !s.featured && !s.alternatives, "Experiments contain parameters, not saved output");
  assert.ok(s.control.kind === "tiny" || s.message?.trim(), "Live experiments need a prompt");
}
const tokenizer = ["tokenizer.json", "tokenizer_config.json"].map((name) => {
  const data = readFileSync(join(weights, name)); JSON.parse(data);
  return { name, bytes: data.length, sha256: sha(data) };
});
for (const [directory, name] of [[weights, "LICENSE"], [weights, "README.md"], [publicDir, "licenses.txt"], [root, "LICENSE"]]) {
  assert.ok(statSync(join(directory, name)).size > 0, `Missing ${name}`);
}
console.log(JSON.stringify({ status: "passed", manifest_hash: hash, weight_chunks: manifest.files.length, weight_bytes: total,
  download_bytes: total + tokenizer.reduce((n, t) => n + t.bytes, 0), path_steps: path.steps.length, recorded_output_shipped: false,
  tokenizer, licenses: "present" }, null, 2));
