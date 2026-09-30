import {
  calculateAmounts,
  inferSourceRule,
  inferSupplierRule,
  isDuplicate,
  normalizeText,
  reimbursementCycle,
  roundMoney,
} from "./rules.js";
import {
  appendValues,
  batchGetValues,
  formatOfficialRow,
  getValues,
  rowNumberFromUpdatedRange,
  updateValues,
} from "./google.js";
import { requireAccess } from "./access.js";

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" };

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: JSON_HEADERS });
}

function errorResponse(error, status = 500) {
  return json({ ok: false, error: error instanceof Error ? error.message : String(error) }, status);
}

async function readBootstrap(env) {
  const ranges = [
    "Nota_Reembolso!B3",
    "Config IA!E6:E9",
    "Ferramentas!A2:A50",
    "Custos x Projetos!A13:A30",
  ];
  const [note, config, tools, projects] = await batchGetValues(env, ranges);
  const cfg = (config || []).flat();
  return {
    faturaAtual: note?.[0]?.[0] || "",
    usdBrl: Number(cfg[0] || 0),
    iofRate: Number(cfg[2] || 0.035),
    cutoffDay: Number(cfg[3] || 25),
    fornecedores: [...new Set((tools || []).flat().map(String).map((v) => v.trim()).filter(Boolean))],
    projetos: [...new Set((projects || []).flat().map(String).map((v) => v.trim()).filter(Boolean))],
    fontes: ["Santander", "Mercado Pago", "Registro.br", "Outro"],
  };
}

async function openAiStructured(env, { prompt, imageDataUrl, schema, name, maxOutputTokens = 1000 }) {
  if (!env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY não configurada no Worker.");
  const content = [{ type: "input_text", text: prompt }];
  if (imageDataUrl) content.push({ type: "input_image", image_url: imageDataUrl, detail: "high" });

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { authorization: `Bearer ${env.OPENAI_API_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({
      model: env.OPENAI_MODEL || "gpt-5.6-terra",
      input: [{ role: "user", content }],
      text: { format: { type: "json_schema", name, strict: true, schema } },
      max_output_tokens: maxOutputTokens,
    }),
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload?.error?.message || `OpenAI HTTP ${response.status}`);

  const texts = [];
  for (const item of payload.output || []) {
    for (const part of item.content || []) if (part.type === "output_text" && part.text) texts.push(part.text);
  }
  if (!texts.length) throw new Error("A IA respondeu sem dados utilizáveis.");
  return { data: JSON.parse(texts.join("\n")), usage: payload.usage || {}, model: payload.model || env.OPENAI_MODEL };
}

function normalizeEntry(data, fallbackCompetence = "") {
  const base = Number(data.valor_base || 0);
  const iof = Number(data.iof || 0);
  const total = Number(data.total || 0) || roundMoney(base + iof);
  return {
    fatura: String(data.fatura || fallbackCompetence || "").trim(),
    data: String(data.data || "").trim(),
    fornecedor: String(data.fornecedor || "").trim(),
    descricao: String(data.descricao || "").trim(),
    valor_base: roundMoney(base),
    iof: roundMoney(iof),
    total: roundMoney(total),
    usd: Number(data.usd || 0),
    fonte: String(data.fonte || "").trim(),
    projeto_sugerido: String(data.projeto_sugerido || "").trim(),
    confianca: Math.max(0, Math.min(100, Number.parseInt(data.confianca || 0, 10) || 0)),
    observacoes: String(data.observacoes || "").trim(),
  };
}

async function historicalSourceForSupplier(env, supplier) {
  if (!supplier) return "";
  const rows = await getValues(env, "Lancamentos!A2:J500");
  const counts = new Map();
  for (const row of rows) {
    if (normalizeText(row[2]) !== normalizeText(supplier)) continue;
    const source = String(row[8] || "").trim();
    if (source) counts.set(source, (counts.get(source) || 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || "";
}

async function resolveSupplierSource(env, entry, bootstrap) {
  let fornecedor = entry.fornecedor || inferSupplierRule(entry.descricao);
  let fonte = entry.fonte || inferSourceRule(entry.descricao);
  let aiUsage = { input_tokens: 0, output_tokens: 0, total_tokens: 0 };

  if (fornecedor && !fonte) fonte = await historicalSourceForSupplier(env, fornecedor);
  if (fornecedor && fonte) return { fornecedor, fonte, usage: aiUsage, method: "regra + histórico" };

  const schema = {
    type: "object",
    additionalProperties: false,
    properties: { fornecedor: { type: "string" }, fonte: { type: "string" } },
    required: ["fornecedor", "fonte"],
  };
  const prompt = [
    "Classifique um lançamento financeiro de tecnologia.",
    `Descrição: ${entry.descricao}`,
    `Fornecedores permitidos: ${bootstrap.fornecedores.join(", ")}`,
    `Fornecedor já identificado: ${fornecedor || "(nenhum)"}`,
    `Fonte já identificada: ${fonte || "(nenhuma)"}`,
    "Fonte deve ser Santander, Mercado Pago, Registro.br ou outra claramente indicada.",
    "Não invente. Se não houver evidência suficiente, retorne string vazia.",
  ].join("\n");
  const result = await openAiStructured(env, { prompt, schema, name: "classificacao_finops", maxOutputTokens: 300 });
  fornecedor ||= String(result.data.fornecedor || "").trim();
  fonte ||= String(result.data.fonte || "").trim();
  aiUsage = result.usage;

  if (!fornecedor) throw new Error("Não consegui identificar o fornecedor. Inclua na descrição o nome que aparece na cobrança.");
  if (!fonte) throw new Error("Não consegui identificar a fonte. Use uma foto/print ou mencione a origem da cobrança.");
  return { fornecedor, fonte, usage: aiUsage, method: "IA" };
}

async function detectDuplicate(env, entry) {
  const rows = await getValues(env, "Lancamentos!A2:J500");
  return isDuplicate(entry, rows);
}

function aiCostBrl(usage, bootstrap) {
  const input = Number(usage?.input_tokens || 0);
  const output = Number(usage?.output_tokens || 0);
  const inputPrice = 2;
  const outputPrice = 12;
  const usd = ((input * inputPrice) + (output * outputPrice)) / 1_000_000;
  return usd * Number(bootstrap.usdBrl || 0);
}

async function appendInbox(env, values) {
  if (String(env.ALLOW_WRITES ?? "0") !== "1") return null;
  return appendValues(env, "Inbox_Lancamentos!A:T", [values]);
}

async function appendOfficial(env, entry) {
  const response = await appendValues(env, "Lancamentos!A:J", [[
    entry.fatura,
    entry.data,
    entry.fornecedor,
    entry.descricao,
    entry.valor_base,
    entry.iof,
    entry.total,
    entry.usd,
    entry.fonte,
    "Reembolsável",
  ]]);
  const rowNumber = rowNumberFromUpdatedRange(response?.updates?.updatedRange);
  await formatOfficialRow(env, rowNumber);
  return rowNumber;
}

async function approveInboxRow(env, inboxId, entry) {
  const rows = await getValues(env, "Inbox_Lancamentos!A2:T500");
  const index = rows.findIndex((row) => String(row[0] || "") === String(inboxId));
  if (index < 0) return;
  const rowNumber = index + 2;
  const existing = rows[index] || [];
  const replacement = [
    existing[0], existing[1], existing[2], "APROVADO", existing[4],
    entry.fatura, entry.data, entry.fornecedor, entry.descricao, entry.valor_base,
    entry.iof, entry.total, entry.usd, entry.fonte, entry.projeto_sugerido,
    existing[15] || "NÃO", entry.observacoes, new Date().toISOString(), existing[18] || 0, existing[19] || 0,
  ];
  await updateValues(env, `Inbox_Lancamentos!A${rowNumber}:T${rowNumber}`, [replacement]);
}

async function handleAnalyze(env, body) {
  const texto = String(body.texto || "").trim();
  const imageDataUrl = String(body.imagemDataUrl || "").trim();
  if (!texto && !imageDataUrl) throw new Error("Digite uma descrição ou envie um print/foto.");
  const bootstrap = await readBootstrap(env);

  const schema = {
    type: "object",
    additionalProperties: false,
    properties: {
      fatura: { type: "string" }, data: { type: "string" }, fornecedor: { type: "string" },
      descricao: { type: "string" }, valor_base: { type: "number" }, iof: { type: "number" },
      total: { type: "number" }, usd: { type: "number" }, fonte: { type: "string" },
      projeto_sugerido: { type: "string" }, confianca: { type: "integer" }, observacoes: { type: "string" },
    },
    required: ["fatura","data","fornecedor","descricao","valor_base","iof","total","usd","fonte","projeto_sugerido","confianca","observacoes"],
  };
  const prompt = [
    "Extraia UM lançamento financeiro de tecnologia.",
    `Competência padrão atual: ${bootstrap.faturaAtual}.`,
    "Data em DD/MM/AAAA. Não invente valores.",
    `Fornecedores conhecidos: ${bootstrap.fornecedores.join(", ")}.`,
    `Projetos conhecidos: ${bootstrap.projetos.join(", ")}.`,
    "OPENAI/CHATGPT => ChatGPT/OpenAI; REPLIT => Replit; GOOGLE CLOUD => Google Cloud; CLAUDE/ANTHROPIC => Anthropic.",
    "Se houver apenas total em reais, use valor_base=total e iof=0.",
    "USD é 0 quando não estiver explícito. Projeto sugerido deve ficar vazio sem evidência.",
    `Texto do usuário: ${texto || "(nenhum)"}`,
  ].join("\n");
  const result = await openAiStructured(env, { prompt, imageDataUrl, schema, name: "lancamento_finops", maxOutputTokens: 1200 });
  const entry = normalizeEntry(result.data, bootstrap.faturaAtual);
  const duplicate = await detectDuplicate(env, entry);
  const inboxId = String(env.ALLOW_WRITES ?? "0") === "1" ? crypto.randomUUID() : null;
  const totalTokens = Number(result.usage?.total_tokens || 0) || Number(result.usage?.input_tokens || 0) + Number(result.usage?.output_tokens || 0);
  const costBrl = aiCostBrl(result.usage, bootstrap);
  await appendInbox(env, [
    inboxId, new Date().toISOString(), imageDataUrl ? (texto ? "TEXTO + IMAGEM" : "IMAGEM") : "TEXTO",
    "PENDENTE", entry.confianca, entry.fatura, entry.data, entry.fornecedor, entry.descricao,
    entry.valor_base, entry.iof, entry.total, entry.usd, entry.fonte, entry.projeto_sugerido,
    duplicate.duplicate ? "SIM" : "NÃO", entry.observacoes, "", totalTokens, costBrl,
  ]);
  return { inboxId, dados: entry, duplicidade: duplicate, tokens: totalTokens, custoIA: costBrl, modelo: result.model };
}

async function handleApprove(env, body) {
  const bootstrap = await readBootstrap(env);
  let entry = normalizeEntry(body.dados || {}, bootstrap.faturaAtual);
  if (!entry.fornecedor || !entry.fonte) {
    const resolved = await resolveSupplierSource(env, entry, bootstrap);
    entry = { ...entry, fornecedor: entry.fornecedor || resolved.fornecedor, fonte: entry.fonte || resolved.fonte };
  }
  if (!entry.fatura || !entry.data || !entry.fornecedor || !entry.descricao || !(entry.total > 0) || !entry.fonte) {
    throw new Error("Lançamento incompleto.");
  }
  const duplicate = await detectDuplicate(env, entry);
  if (duplicate.duplicate && !body.confirmarDuplicidade) {
    return { ok: false, precisaConfirmarDuplicidade: true, mensagem: `Possível duplicidade: mesma data, fornecedor e total já existem na linha ${duplicate.row}.` };
  }
  if (String(env.ALLOW_WRITES || "1") !== "1") throw new Error("Este ambiente está em modo somente leitura.");
  const row = await appendOfficial(env, entry);
  if (body.inboxId) await approveInboxRow(env, body.inboxId, entry);
  return { ok: true, linha: row, mensagem: "Lançamento aprovado e gravado na base oficial." };
}

async function handleManual(env, body) {
  const bootstrap = await readBootstrap(env);
  const data = String(body.data || "").trim();
  const descricao = String(body.descricao || "").trim();
  const moeda = String(body.moeda || "BRL").toUpperCase();
  const valor = Number(body.valor || 0);
  if (!data || !descricao || !["BRL", "USD"].includes(moeda) || !(valor > 0)) throw new Error("Preencha data, descrição, moeda e valor.");

  const cycle = reimbursementCycle(data, bootstrap.cutoffDay);
  const amounts = calculateAmounts({ currency: moeda, amount: valor, usdBrl: bootstrap.usdBrl, iofRate: bootstrap.iofRate });
  const initial = normalizeEntry({
    fatura: cycle.competence, data, descricao, valor_base: amounts.base, iof: amounts.iof,
    total: amounts.total, usd: amounts.usd, projeto_sugerido: body.projeto_sugerido || "",
    observacoes: moeda === "USD"
      ? `Estimativa automática usando câmbio ${bootstrap.usdBrl.toFixed(4)} e IOF ${(bootstrap.iofRate * 100).toFixed(1)}%. Reembolso previsto: ${cycle.reimbursementDate}.`
      : `Reembolso previsto: ${cycle.reimbursementDate}.`,
  });
  const resolved = await resolveSupplierSource(env, initial, bootstrap);
  const entry = { ...initial, fornecedor: resolved.fornecedor, fonte: resolved.fonte };
  const duplicate = await detectDuplicate(env, entry);
  if (duplicate.duplicate && !body.confirmarDuplicidade) {
    return { ok: false, precisaConfirmarDuplicidade: true, mensagem: `Possível duplicidade na linha ${duplicate.row}.` };
  }
  if (String(env.ALLOW_WRITES || "1") !== "1") throw new Error("Este ambiente está em modo somente leitura.");
  const row = await appendOfficial(env, entry);
  const inboxId = crypto.randomUUID();
  const aiTokens = Number(resolved.usage?.total_tokens || 0) || Number(resolved.usage?.input_tokens || 0) + Number(resolved.usage?.output_tokens || 0);
  const costBrl = aiCostBrl(resolved.usage, bootstrap);
  await appendInbox(env, [
    inboxId, new Date().toISOString(), "MANUAL", "APROVADO", 100, entry.fatura, entry.data, entry.fornecedor,
    entry.descricao, entry.valor_base, entry.iof, entry.total, entry.usd, entry.fonte, entry.projeto_sugerido,
    duplicate.duplicate ? "SIM" : "NÃO", `${entry.observacoes} Fornecedor/Fonte automáticos via ${resolved.method}.`, new Date().toISOString(), aiTokens, costBrl,
  ]);
  return {
    ok: true, linha: row, competencia: cycle.competence, reembolsoPrevisto: cycle.reimbursementDate,
    fornecedor: entry.fornecedor, fonte: entry.fonte, total: entry.total,
    mensagem: `Lançamento gravado. ${entry.fornecedor} • ${entry.fonte}.`,
  };
}

async function api(request, env) {
  await requireAccess(request, env);
  const url = new URL(request.url);
  if (request.method === "GET" && url.pathname === "/api/bootstrap") return json({ ok: true, ...(await readBootstrap(env)) });
  if (request.method !== "POST") return json({ ok: false, error: "Método não permitido." }, 405);
  if (["/api/approve", "/api/manual"].includes(url.pathname) && String(env.ALLOW_WRITES ?? "0") !== "1") {
    return json({ ok: false, error: "Este ambiente está em modo somente leitura." }, 403);
  }
  const body = await request.json();
  if (url.pathname === "/api/analyze") return json({ ok: true, ...(await handleAnalyze(env, body)) });
  if (url.pathname === "/api/approve") return json(await handleApprove(env, body));
  if (url.pathname === "/api/manual") return json(await handleManual(env, body));
  return json({ ok: false, error: "Endpoint não encontrado." }, 404);
}

export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);
      if (url.pathname.startsWith("/api/")) return await api(request, env);
      return env.ASSETS.fetch(request);
    } catch (error) {
      return errorResponse(error, /permiss|autentic|acesso/i.test(String(error?.message)) ? 403 : 500);
    }
  },
};
