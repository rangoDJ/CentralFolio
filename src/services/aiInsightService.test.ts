import { test } from "node:test";
import assert from "node:assert/strict";
import { getCompanyAiInsight, generateDeterministicInsight } from "./aiInsightService.js";
import { getAiInsight, deleteAiInsight } from "../repositories/aiInsightRepository.js";

test("generateDeterministicInsight returns structured report and bounds score", () => {
  const result = generateDeterministicInsight("TEST_STOCK", {
    name: "Test Corp",
    pe: 14.5,
    payoutRatio: 55.0,
    growthStreak: 12,
    dividendYield: 4.2,
    revenueGrowthYoY: 9.5,
    annualPayout: 2.20,
    growth5Y: 6.8,
  }, {
    sector: "Financials",
    industry: "Banks",
  });

  assert.equal(result.label, "Strong Buy");
  assert.equal(result.score, 1);
  assert.ok(result.summary.includes("Test Corp"));
  assert.ok(result.markdown.includes("Executive Overview"));
  assert.ok(result.markdown.includes("Dividend Quality"));
});

test("aiInsightService generates analysis and persists to database", async () => {
  const sym = "TEST_AI_SYM";
  deleteAiInsight(sym);

  const mockDetail = {
    name: "Mock Energy Inc",
    price: 45.0,
    pe: 18.2,
    payoutRatio: 72.0,
    growthStreak: 6,
    dividendYield: 5.5,
    annualPayout: 2.50,
  };

  const insight = await getCompanyAiInsight(sym, true, mockDetail);
  assert.ok(insight);
  assert.equal(insight.symbol, sym);
  assert.ok(insight.score >= 1 && insight.score <= 5);
  assert.ok(["Strong Buy", "Buy", "Hold", "Caution", "Risky"].includes(insight.label));
  assert.ok(insight.summary.length > 10);
  assert.ok(insight.markdown.includes("Executive Overview"));

  // Check persisted in database
  const inDb = getAiInsight(sym);
  assert.ok(inDb);
  assert.equal(inDb?.symbol, sym);
  assert.equal(inDb?.label, insight.label);

  deleteAiInsight(sym);
});

test("aiInsightService reuses cached analysis when forceRefresh is false", async () => {
  const sym = "TEST_AI_CACHED";
  deleteAiInsight(sym);

  const mockDetail = { name: "Cached Asset", price: 100, pe: 20 };
  const first = await getCompanyAiInsight(sym, false, mockDetail);
  const second = await getCompanyAiInsight(sym, false, mockDetail);

  assert.equal(first.symbol, second.symbol);
  assert.equal(first.score, second.score);
  assert.equal(first.markdown, second.markdown);

  deleteAiInsight(sym);
});
