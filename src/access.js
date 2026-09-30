import { createRemoteJWKSet, jwtVerify } from "jose";

export async function requireAccess(request, env) {
  if (String(env.REQUIRE_ACCESS_EMAIL ?? "1") === "0") return;
  const allowed = String(env.ALLOWED_EMAIL || "").trim().toLowerCase();
  const audience = String(env.CF_ACCESS_AUD || "").trim();
  const domain = String(env.CF_ACCESS_TEAM_DOMAIN || "").trim().replace(/\/$/, "");
  if (!allowed || !audience || !/^https:\/\/[a-z0-9-]+\.cloudflareaccess\.com$/.test(domain)) {
    throw new Error("Autenticação do Cloudflare Access ainda não configurada.");
  }
  const token = request.headers.get("Cf-Access-Jwt-Assertion");
  if (!token) throw new Error("Acesso não autenticado pelo Cloudflare Access.");
  try {
    const keys = createRemoteJWKSet(new URL(`${domain}/cdn-cgi/access/certs`));
    const { payload } = await jwtVerify(token, keys, {
      issuer: domain,
      audience,
      algorithms: ["RS256"],
      requiredClaims: ["exp", "iat", "email"],
    });
    if (String(payload.email || "").toLowerCase() !== allowed) {
      throw new Error("Usuário sem permissão para acessar o M.A.E Financeiro.");
    }
  } catch {
    throw new Error("Acesso inválido ou sem permissão para acessar o M.A.E Financeiro.");
  }
}
