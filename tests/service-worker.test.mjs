import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";

const source = await readFile(new URL("../public/sw.js", import.meta.url), "utf8");
function harness() {
  const handlers = {};
  const stored = new Map();
  const deleted = [];
  const context = {
    URL, Response,
    fetch: async () => new Response("fresh version"),
    self: { location: { origin: "https://finops.example.com" }, addEventListener: (name, fn) => { handlers[name] = fn; }, clients: { claim: async () => {} } },
    caches: {
      keys: async () => ["servizi-finops-v1", "unrelated-app"],
      delete: async (key) => { deleted.push(key); },
      open: async () => ({
        put: async (request, response) => { stored.set(typeof request === "string" ? request : new URL(request.url).pathname, response); },
        match: async (request) => stored.get(new URL(request.url).pathname)?.clone(),
      }),
    },
  };
  runInNewContext(source, context);
  return { handlers, stored, context, deleted };
}

test("service worker does not intercept financial APIs or other origins", () => {
  const { handlers } = harness();
  for (const url of ["https://finops.example.com/api/bootstrap", "https://other.example.com/app.js"]) {
    handlers.fetch({ request: new Request(url), respondWith() { assert.fail("Request should bypass cache"); } });
  }
});

test("online shell updates replace cached content and remain available offline", async () => {
  const { handlers, stored, context } = harness();
  stored.set("/", new Response("old version"));
  const request = new Request("https://finops.example.com/");
  let result;
  handlers.fetch({ request, respondWith: (promise) => { result = promise; } });
  assert.equal(await (await result).text(), "fresh version");
  context.fetch = async () => { throw new Error("offline"); };
  handlers.fetch({ request, respondWith: (promise) => { result = promise; } });
  assert.equal(await (await result).text(), "fresh version");
});

test("activation clears only this app's old cache", async () => {
  const { handlers, deleted } = harness();
  let result;
  handlers.activate({ waitUntil: (promise) => { result = promise; } });
  await result;
  assert.deepEqual(deleted, ["servizi-finops-v1"]);
});
