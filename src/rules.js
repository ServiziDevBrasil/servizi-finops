export const MONTHS_PT = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];

export function normalizeText(value = "") {
  return String(value)
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

export function parseBrDate(value) {
  const match = String(value || "").trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match) return null;
  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) return null;
  return { day, month, year, date };
}

export function formatBrDate(date) {
  return `${String(date.getUTCDate()).padStart(2, "0")}/${String(date.getUTCMonth() + 1).padStart(2, "0")}/${date.getUTCFullYear()}`;
}

export function reimbursementCycle(purchaseDate, cutoffDay = 25) {
  const parsed = parseBrDate(purchaseDate);
  if (!parsed) throw new Error("Data inválida. Use DD/MM/AAAA.");

  const addMonths = parsed.day <= Number(cutoffDay || 25) ? 1 : 2;
  const target = new Date(Date.UTC(parsed.year, parsed.month - 1 + addMonths, 1));

  return {
    competence: `${MONTHS_PT[target.getUTCMonth()]}/${target.getUTCFullYear()}`,
    reimbursementDate: formatBrDate(target),
  };
}

export function roundMoney(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

export function calculateAmounts({ currency, amount, usdBrl, iofRate }) {
  const numericAmount = Number(amount) || 0;
  if (!(numericAmount > 0)) throw new Error("Informe um valor maior que zero.");

  if (String(currency).toUpperCase() === "USD") {
    if (!(Number(usdBrl) > 0)) throw new Error("Cotação USD/BRL indisponível.");
    const base = roundMoney(numericAmount * Number(usdBrl));
    const iof = roundMoney(base * Number(iofRate || 0));
    return { base, iof, total: roundMoney(base + iof), usd: numericAmount };
  }

  return { base: roundMoney(numericAmount), iof: 0, total: roundMoney(numericAmount), usd: 0 };
}

export function inferSupplierRule(description = "") {
  const text = normalizeText(description);
  const rules = [
    { terms: ["openai", "chatgpt"], supplier: "ChatGPT/OpenAI" },
    { terms: ["replit"], supplier: "Replit" },
    { terms: ["google cloud"], supplier: "Google Cloud" },
    { terms: ["anthropic", "claude"], supplier: "Anthropic" },
    { terms: ["github"], supplier: "GitHub" },
    { terms: ["google workspace"], supplier: "Google Workspace" },
    { terms: ["cursor"], supplier: "Cursor" },
    { terms: ["supabase"], supplier: "Supabase" },
    { terms: ["cloudflare"], supplier: "Cloudflare" },
    { terms: ["registro.br", "ialerta.app.br", "servizibrasil.app.br"], supplier: "Registro.br / Domínio" },
  ];

  for (const rule of rules) {
    if (rule.terms.some((term) => text.includes(normalizeText(term)))) return rule.supplier;
  }
  return "";
}

export function inferSourceRule(description = "") {
  const text = normalizeText(description);
  if (text.includes("mercado pago") || text.includes("mp*")) return "Mercado Pago";
  if (text.includes("registro.br") || text.includes("ialerta.app.br") || text.includes("servizibrasil.app.br")) return "Registro.br";
  return "";
}

export function isDuplicate(candidate, rows = []) {
  const candDate = String(candidate.data || "").trim();
  const candSupplier = normalizeText(candidate.fornecedor);
  const candTotal = Number(candidate.total) || 0;

  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index] || [];
    const sameDate = String(row[1] || "").trim() === candDate;
    const sameSupplier = normalizeText(row[2]) === candSupplier;
    const sameTotal = Math.abs((Number(row[6]) || 0) - candTotal) < 0.01;
    if (sameDate && sameSupplier && sameTotal) return { duplicate: true, row: index + 2 };
  }
  return { duplicate: false, row: null };
}
