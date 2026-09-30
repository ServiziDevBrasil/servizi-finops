import test from "node:test";
import assert from "node:assert/strict";
import { calculateAmounts, inferSupplierRule, reimbursementCycle } from "../src/rules.js";

test("reembolso até dia 25 vai para dia 01 do mês seguinte", () => {
  assert.deepEqual(reimbursementCycle("18/09/2026", 25), { competence: "Out/2026", reimbursementDate: "01/10/2026" });
});

test("reembolso após dia 25 vai para dia 01 do segundo mês seguinte", () => {
  assert.deepEqual(reimbursementCycle("30/09/2026", 25), { competence: "Nov/2026", reimbursementDate: "01/11/2026" });
});

test("compra em dólar estima base, IOF e total", () => {
  assert.deepEqual(calculateAmounts({ currency: "USD", amount: 100, usdBrl: 5, iofRate: 0.035 }), { base: 500, iof: 17.5, total: 517.5, usd: 100 });
});

test("regra reconhece OpenAI", () => {
  assert.equal(inferSupplierRule("OPENAI* CHATGPT CREDIT"), "ChatGPT/OpenAI");
});
