// Small release gate for every hosted build. Full WebGPU tests run on a GPU device.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const release = JSON.parse(readFileSync(resolve(root, "app/src/live/release.json")));
const experiment = JSON.parse(readFileSync(resolve(root, "app/src/path/experiments.json")));
assert.match(release.revision, /^[a-f0-9]{40}$/, "Pin an immutable model commit");
const base = `https://huggingface.co/${release.repository}/resolve/${release.revision}/`;
const response = await fetch(base + "manifest.json", { signal: AbortSignal.timeout(30_000) });
assert.equal(response.status, 200, "Published model manifest must be anonymously accessible");
const raw = Buffer.from(await response.arrayBuffer());
assert.equal(createHash("sha256").update(raw).digest("hex"), experiment.manifest_hash,
  "Published model must match the engine's experiment parameters");
const dist = resolve(root, "app/dist");
const html = readFileSync(resolve(dist, "index.html"), "utf8");
assert.match(html, /src="\/rewire\/assets\//, "Production entry must use the website subpath");
for (const match of html.matchAll(/(?:src|href)="(\/rewire\/[^"?#]+)"/g)) {
  assert.ok(existsSync(resolve(dist, match[1].slice("/rewire/".length))), `Missing ${match[1]}`);
}
assert.ok(readdirSync(resolve(dist, "assets")).some(x => x.startsWith("worker-")), "Missing inference worker");
assert.ok(readdirSync(resolve(dist, "assets")).some(x => x.startsWith("train.worker-")), "Missing training worker");
assert.ok(!existsSync(resolve(dist, "recordings")), "Recorded responses must not ship");
console.log(JSON.stringify({ status: "passed", model: release.repository, revision: release.revision,
  manifest: experiment.manifest_hash, base: "/rewire/", inference: "on-device" }));
