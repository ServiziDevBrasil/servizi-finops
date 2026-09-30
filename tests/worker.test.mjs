import test from "node:test";
import assert from "node:assert/strict";
import { exportPKCS8, generateKeyPair } from "jose";
import worker from "../src/worker.js";

for (const endpoint of ["approve", "manual"]) {
  test(`read-only ${endpoint} is rejected before external services are called`, async (t) => {
    t.mock.method(globalThis, "fetch", () => { throw new Error("Unexpected external call"); });
    const request = new Request(`https://finops.example.com/api/${endpoint}`, {
      method: "POST", body: "{}", headers: { "content-type": "application/json" },
    });
    const response = await worker.fetch(request, { REQUIRE_ACCESS_EMAIL: "0", ALLOW_WRITES: "0" });
    assert.equal(response.status, 403);
    assert.match((await response.json()).error, /somente leitura/);
  });
}

test("read-only analysis does not write to official data or audit inbox", async (t) => {
  const { privateKey } = await generateKeyPair("RS256", { extractable: true });
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url, options = {}) => {
    const path = String(url);
    calls.push({ url: path, method: options.method || "GET" });
    if (path === "https://oauth2.googleapis.com/token") return Response.json({ access_token: "test-only", expires_in: 3600 });
    if (path.includes("values:batchGet")) return Response.json({ valueRanges: [
      { values: [["Out/2026"]] }, { values: [[5], [0], [0.035], [25]] },
      { values: [["ChatGPT/OpenAI"]] }, { values: [["iALERTA"]] },
    ] });
    if (path.startsWith("https://sheets.googleapis.com/") && !options.method) return Response.json({ values: [] });
    if (path === "https://api.openai.com/v1/responses") return Response.json({ output: [{ content: [{ type: "output_text", text: JSON.stringify({
      fatura: "Out/2026", data: "18/09/2026", fornecedor: "ChatGPT/OpenAI", descricao: "Assinatura",
      valor_base: 100, iof: 0, total: 100, usd: 0, fonte: "Santander", projeto_sugerido: "", confianca: 95, observacoes: "",
    }) }] }], usage: { input_tokens: 10, output_tokens: 10 } });
    throw new Error(`Unexpected call: ${path}`);
  });
  const response = await worker.fetch(new Request("https://finops.example.com/api/analyze", {
    method: "POST", body: JSON.stringify({ texto: "Assinatura OpenAI R$100" }),
  }), {
    REQUIRE_ACCESS_EMAIL: "0", ALLOW_WRITES: "0", GOOGLE_CLIENT_EMAIL: "test@example.com",
    GOOGLE_PRIVATE_KEY: await exportPKCS8(privateKey), SPREADSHEET_ID: "test-only", OPENAI_API_KEY: "test-only",
  });
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.inboxId, null);
  assert.equal(result.dados.total, 100);
  assert.equal(calls.filter((c) => c.url.startsWith("https://sheets.googleapis.com/") && c.method !== "GET").length, 0);
});
