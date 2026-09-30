import test from "node:test";
import assert from "node:assert/strict";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { requireAccess } from "../src/access.js";

const env = {
  CF_ACCESS_TEAM_DOMAIN: "https://servizi-test.cloudflareaccess.com",
  CF_ACCESS_AUD: "finops-test",
  ALLOWED_EMAIL: "diego@example.com",
};
const { publicKey, privateKey } = await generateKeyPair("RS256");
const jwk = { ...(await exportJWK(publicKey)), kid: "test-key", alg: "RS256", use: "sig" };

async function requestWithToken(overrides = {}) {
  const token = await new SignJWT({ email: env.ALLOWED_EMAIL, ...overrides })
    .setProtectedHeader({ alg: "RS256", kid: jwk.kid })
    .setIssuer(overrides.iss || env.CF_ACCESS_TEAM_DOMAIN)
    .setAudience(overrides.aud || env.CF_ACCESS_AUD)
    .setIssuedAt()
    .setExpirationTime(overrides.exp ?? "5m")
    .sign(privateKey);
  return new Request("https://finops.example.com/api/bootstrap", {
    headers: { "Cf-Access-Jwt-Assertion": token },
  });
}

function mockKeys(t) {
  t.mock.method(globalThis, "fetch", async (url) => {
    assert.equal(String(url), `${env.CF_ACCESS_TEAM_DOMAIN}/cdn-cgi/access/certs`);
    return Response.json({ keys: [jwk] });
  });
}

test("configuration missing keeps APIs closed", async () => {
  await assert.rejects(requireAccess(new Request("https://finops.example.com/api/bootstrap"), {}), /não configurada/);
});

test("an email header alone cannot authenticate", async () => {
  const request = new Request("https://finops.example.com/api/bootstrap", {
    headers: { "Cf-Access-Authenticated-User-Email": env.ALLOWED_EMAIL },
  });
  await assert.rejects(requireAccess(request, env), /não autenticado/);
});

test("a signed token authorizes the allowed email", async (t) => {
  mockKeys(t);
  await requireAccess(await requestWithToken(), env);
});

for (const [label, claims] of [
  ["another application", { aud: "other-app" }],
  ["another issuer", { iss: "https://other.cloudflareaccess.com" }],
  ["an expired session", { exp: Math.floor(Date.now() / 1000) - 60 }],
  ["another user", { email: "other@example.com" }],
]) {
  test(`rejects a signed token for ${label}`, async (t) => {
    mockKeys(t);
    await assert.rejects(requireAccess(await requestWithToken(claims), env), /inválido|permissão/);
  });
}

test("rejects a token with a modified signature", async (t) => {
  mockKeys(t);
  const request = await requestWithToken();
  const parts = request.headers.get("Cf-Access-Jwt-Assertion").split(".");
  parts[2] = (parts[2][0] === "A" ? "B" : "A") + parts[2].slice(1);
  request.headers.set("Cf-Access-Jwt-Assertion", parts.join("."));
  await assert.rejects(requireAccess(request, env), /inválido/);
});
