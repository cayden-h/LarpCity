// server/src/adapters/gemini.test.ts
// Against a fake fetch that answers the way the live API did on 2026-09-12.
import { test } from "node:test";
import assert from "node:assert/strict";
import { Gemini, GeminiError } from "./gemini.js";

interface Call {
  model: string;
  key: string;
  url: string;
  body: any;
}

function fake(respond: (c: Call, n: number) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const fetchFn = (async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = String(input);
    const c: Call = { url, model: url.match(/models\/([^:]+):/)![1], key: (init.headers as Record<string, string>)["x-goog-api-key"], body: JSON.parse(String(init.body)) };
    calls.push(c);
    return respond(c, calls.length);
  }) as typeof fetch;
  return { fetchFn, calls };
}

const ok = (text: string, finishReason = "STOP") =>
  new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "thinking...", thought: true }, { text }] }, finishReason }] }), { status: 200 });
const client = (fetchFn: typeof fetch, models = ["gemini-3.8-flash", "gemini-3.6-flash"]) => new Gemini({ keys: ["k1", "k2", "k3"], models, fetchFn });

test("sends the key in a header, asks for JSON by schema, and skips thought parts", async () => {
  const f = fake(() => ok('{"headline":"Nice"}'));
  const r = await client(f.fetchFn).json("prompt", { type: "object" }, { maxOutputTokens: 1000 });
  assert.deepEqual(r, { value: { headline: "Nice" }, model: "gemini-3.8-flash" });
  assert.ok(!f.calls[0].url.includes("k1"), "no key in the URL");
  assert.equal(f.calls[0].key, "k1");
  assert.deepEqual(f.calls[0].body.generationConfig, { responseMimeType: "application/json", responseJsonSchema: { type: "object" }, maxOutputTokens: 1000 });
});

test("429 tries the next key; a busy model (503 or an empty 404) tries the next model", async () => {
  const f = fake((c, n) => {
    if (n === 1) return new Response("quota", { status: 429 });
    if (c.model === "gemini-3.8-flash") return new Response("", { status: n === 2 ? 404 : 503 });
    return ok("{}");
  });
  const r = await client(f.fetchFn).json("p", {});
  assert.equal(r.model, "gemini-3.6-flash");
  assert.deepEqual(f.calls.map((c) => `${c.model}/${c.key}`), ["gemini-3.8-flash/k1", "gemini-3.8-flash/k2", "gemini-3.6-flash/k1"]);
});

test("a cut-off answer or a timeout moves to the next model", async () => {
  const cut = fake((c) => (c.model === "gemini-3.8-flash" ? ok('{"head', "MAX_TOKENS") : ok('{"a":1}')));
  assert.equal((await client(cut.fetchFn).json("p", {})).model, "gemini-3.6-flash");
  const slow = fake((c) => {
    if (c.model === "gemini-3.8-flash") throw new DOMException("timed out", "TimeoutError");
    return ok('{"a":1}');
  });
  assert.equal((await client(slow.fetchFn).json("p", {})).model, "gemini-3.6-flash");
});

test("a bad request fails at once, and all models busy fails with the last error", async () => {
  const bad = fake(() => new Response('{"error":{"message":"bad schema"}}', { status: 400 }));
  await assert.rejects(client(bad.fetchFn).json("p", {}), (e: GeminiError) => e.status === 400);
  assert.equal(bad.calls.length, 1);
  const busy = fake(() => new Response("high demand", { status: 503 }));
  await assert.rejects(client(busy.fetchFn).json("p", {}), (e: GeminiError) => e.status === 503);
  assert.equal(busy.calls.length, 2, "one try per model");
  await assert.rejects(client(ok("not json") as never).json("p", {}));
});

test("successes rotate the starting key so quota spreads across keys", async () => {
  const f = fake(() => ok("{}"));
  const g = client(f.fetchFn);
  for (let i = 0; i < 4; i++) await g.json("p", {});
  assert.deepEqual(f.calls.map((c) => c.key), ["k1", "k2", "k3", "k1"]);
});

test("image returns the inline image from the image model", async () => {
  const f = fake(() => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "here" }, { inlineData: { mimeType: "image/png", data: "iVBOR" } }] }, finishReason: "STOP" }] })));
  assert.equal(await client(f.fetchFn).image("gemini-3.1-flash-image", "draw", [{ mimeType: "image/jpeg", data: "abc" }]), "iVBOR");
  assert.equal(f.calls[0].model, "gemini-3.1-flash-image");
  assert.equal(f.calls[0].body.contents[0].parts[1].inlineData.data, "abc");
});
