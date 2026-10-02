import { expect, it, vi } from "vitest";
import { sha256 } from "@rewire/engine/src/manifest.ts";
import { ModelFiles } from "../src/live/files.ts";

const data = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
const entry = async () => ({ name: "chunk.bin", bytes: data.length, sha256: await sha256(data.buffer) });
const options = (fetcher: typeof fetch) => ({ fetch: fetcher, delay: async () => {}, retries: 2 });
function cacheWith(response?: Response) {
  let kept = response;
  return {
    match: vi.fn(async () => kept?.clone()),
    put: vi.fn(async (_url: string, r: Response) => { kept = r; }),
    delete: vi.fn(async () => { kept = undefined; return true; }),
  };
}

it("evicts a same-size corrupt cache entry and verifies its replacement", async () => {
  const cache = cacheWith(new Response(new Uint8Array(8)));
  const fetcher = vi.fn(async () => new Response(data));
  const files = new ModelFiles("https://model/", cache as unknown as Cache, options(fetcher));
  expect(new Uint8Array(await files.file(await entry(), () => {}))).toEqual(data);
  expect(cache.delete).toHaveBeenCalledOnce();
  expect(cache.put).toHaveBeenCalledOnce();
  expect(fetcher).toHaveBeenCalledOnce();
  await files.file(await entry(), () => {});
  expect(fetcher).toHaveBeenCalledOnce();
});

it("resumes a truncated response from the first missing byte", async () => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response(data.slice(0, 3)))
    .mockResolvedValueOnce(new Response(data.slice(3), { status: 206, headers: { "Content-Range": "bytes 3-7/8" } }));
  const files = new ModelFiles("https://model/", null, options(fetcher));
  expect(new Uint8Array(await files.file(await entry(), () => {}))).toEqual(data);
  expect(fetcher.mock.calls[1][1]?.headers).toEqual({ Range: "bytes=3-" });
});

it("restarts when the server ignores a resume range", async () => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response(data.slice(0, 3))).mockResolvedValueOnce(new Response(data));
  const files = new ModelFiles("https://model/", null, options(fetcher));
  const progress: number[] = [];
  expect(new Uint8Array(await files.file(await entry(), (n) => progress.push(n)))).toEqual(data);
  expect(progress).toContain(0);
});

it("stops retrying responses that end without all the bytes", async () => {
  const fetcher = vi.fn(async () => new Response(new Uint8Array()));
  const files = new ModelFiles("https://model/", null, options(fetcher));
  await expect(files.file(await entry(), () => {})).rejects.toThrow("incomplete download");
  expect(fetcher).toHaveBeenCalledTimes(3);
});

it("rejects invalid ranges, oversized bodies and mismatched hashes", async () => {
  const range = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response(data.slice(0, 3)))
    .mockImplementation(async () => new Response(data.slice(3), { status: 206, headers: { "Content-Range": "bytes 2-6/8" } }));
  await expect(new ModelFiles("https://model/", null, options(range)).file(await entry(), () => {})).rejects.toThrow("invalid download range");
  await expect(new ModelFiles("https://model/", null, options(async () => new Response(new Uint8Array(9)))).file(await entry(), () => {}))
    .rejects.toThrow("download is too large");
  await expect(new ModelFiles("https://model/", null, options(async () => new Response(new Uint8Array(8)))).file(await entry(), () => {}))
    .rejects.toThrow("did not match its hash");
});

it("runs without storage when reading or writing the cache is refused", async () => {
  for (const fail of ["match", "put"] as const) {
    const cache = cacheWith();
    cache[fail].mockRejectedValue(new Error("storage refused"));
    const files = new ModelFiles("https://model/", cache as unknown as Cache, options(async () => new Response(data)));
    expect(new Uint8Array(await files.file(await entry(), () => {}))).toEqual(data);
    expect(files.stored).toBe(false);
  }
});

it("repairs malformed cached JSON", async () => {
  const cache = cacheWith(new Response("not JSON"));
  const files = new ModelFiles("https://model/", cache as unknown as Cache, options(async () => new Response('{"ok":true}')));
  expect((await files.json("tokenizer.json")).value).toEqual({ ok: true });
  expect(cache.delete).toHaveBeenCalledOnce();
});

it("does not reuse tokenizer JSON from a different manifest", async () => {
  const cache = cacheWith(new Response('{"version":"old"}'));
  cache.match.mockImplementation(async (url?: string) => url?.includes("rewire-manifest=new") ? undefined : new Response('{"version":"old"}'));
  const fetcher = vi.fn(async () => new Response('{"version":"new"}'));
  const files = new ModelFiles("https://model/", cache as unknown as Cache, { ...options(fetcher), jsonVersion: "new" });
  expect((await files.json("tokenizer.json")).value).toEqual({ version: "new" });
  expect(fetcher).toHaveBeenCalledOnce();
});

it("times out a stalled body instead of hanging", async () => {
  const fetcher: typeof fetch = async (_url, init) => new Response(new ReadableStream({
    start(controller) { init?.signal?.addEventListener("abort", () => controller.error(init.signal?.reason)); },
  }));
  const files = new ModelFiles("https://model/", null, { ...options(fetcher), timeout: 5, retries: 0 });
  await expect(files.file(await entry(), () => {})).rejects.toThrow("download timed out");
});

it("pauses an active body and resumes without spending a retry", async () => {
  let files: ModelFiles;
  const fetcher = vi.fn<typeof fetch>().mockImplementationOnce(async (_url, init) => new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(data.slice(0, 3));
      init?.signal?.addEventListener("abort", () => controller.error(init.signal?.reason));
    },
  }))).mockResolvedValueOnce(new Response(data.slice(3), { status: 206, headers: { "Content-Range": "bytes 3-7/8" } }));
  files = new ModelFiles("https://model/", null, { ...options(fetcher), retries: 0 });
  expect(new Uint8Array(await files.file(await entry(), (n) => {
    if (n === 3) { files.pause(true); setTimeout(() => files.pause(false), 0); }
  }))).toEqual(data);
  expect(fetcher.mock.calls[1][1]?.headers).toEqual({ Range: "bytes=3-" });
});

it("honors an early pause before loading either cached weights or tokenizer files", async () => {
  const cache = cacheWith(new Response(data));
  const fetcher = vi.fn(async () => Response.json({ ready: true }));
  const weights = new ModelFiles("https://model/", cache as unknown as Cache, { ...options(fetcher), paused: true });
  const tokenizer = new ModelFiles("https://model/", null, { ...options(fetcher), paused: true });
  const loaded = weights.file(await entry(), () => {});
  const parsed = tokenizer.json("tokenizer.json");
  for (let i = 0; i < 10; i++) await Promise.resolve();
  expect(cache.match).not.toHaveBeenCalled();
  expect(fetcher).not.toHaveBeenCalled();
  weights.pause(false); tokenizer.pause(false);
  expect(new Uint8Array(await loaded)).toEqual(data);
  expect((await parsed).value).toEqual({ ready: true });
});
