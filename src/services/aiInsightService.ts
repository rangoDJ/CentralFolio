/**
 * AI Company & Earnings Insights Service
 *
 * Generates Snowball Analytics-style deep fundamental & earnings analyses for
 * any stock or ETF. Leverages Anthropic, Google Gemini, OpenAI, or a built-in
 * deterministic financial intelligence rule engine when no API keys are present.
 *
 * Results are cached in the `ai_insights` table for 7 days.
 */

import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { GoogleGenAI } from "@google/genai";
import { getStockDetail } from "./dividendService.js";
import { getProfile } from "../repositories/assetProfileRepository.js";
import { getAiInsight, upsertAiInsight, type AiInsightRecord } from "../repositories/aiInsightRepository.js";
import { getSetting } from "../models/db.js";
import { logger } from "../utils/logger.js";

const CACHE_DAYS = 7;

function isInsightStale(analyzedAt?: string): boolean {
  if (!analyzedAt) return true;
  const age = Date.now() - new Date(analyzedAt.replace(" ", "T") + "Z").getTime();
  return age > CACHE_DAYS * 24 * 60 * 60 * 1000;
}

export interface StructuredAnalysisResult {
  score: number;
  label: string;
  summary: string;
  markdown: string;
}

/**
 * Deterministic quantitative fundamental analysis engine.
 * Synthesizes hard financial metrics into a Snowball-style structured report.
 */
export function generateDeterministicInsight(symbol: string, detail: any, profile: any): StructuredAnalysisResult {
  const name = profile?.name || detail?.name || symbol;
  const sector = profile?.sector || detail?.sector || "Equities";
  const industry = profile?.industry || "Financials & Real Economy";
  const pe = detail?.pe;
  const forwardPe = detail?.forwardPE;
  const eps = detail?.eps;
  const payoutRatio = detail?.payoutRatio;
  const divYield = detail?.dividendYield ?? 0;
  const growthStreak = detail?.growthStreak ?? detail?.divStreak ?? 0;
  const revGrowth = detail?.revenueGrowthYoY;
  const beta = detail?.beta;
  const growth5Y = detail?.growth5Y;

  let score = 3;
  let label = "Hold";
  const highlights: string[] = [];
  const risks: string[] = [];

  // Payout safety check
  if (payoutRatio != null) {
    if (payoutRatio <= 65) {
      highlights.push(`Healthy payout ratio of ${payoutRatio.toFixed(1)}% provides strong dividend security.`);
      score -= 0.5;
    } else if (payoutRatio > 90) {
      risks.push(`Elevated payout ratio (${payoutRatio.toFixed(1)}%) limits cash flow buffer during downturns.`);
      score += 0.8;
    }
  }

  // Dividend growth streak
  if (growthStreak >= 10) {
    highlights.push(`Exceptional ${growthStreak}-year consecutive dividend growth track record (Dividend Contender/Champion).`);
    score -= 0.8;
  } else if (growthStreak >= 5) {
    highlights.push(`Established ${growthStreak}-year dividend growth streak demonstrating consistent shareholder return.`);
    score -= 0.4;
  }

  // Revenue & Earnings growth
  if (revGrowth != null) {
    if (revGrowth > 8) {
      highlights.push(`Solid top-line expansion with YoY revenue growth of +${revGrowth.toFixed(1)}%.`);
      score -= 0.5;
    } else if (revGrowth < -3) {
      risks.push(`Top-line headwinds reflected in negative YoY revenue trend (${revGrowth.toFixed(1)}%).`);
      score += 0.6;
    }
  }

  // Valuation
  if (pe != null) {
    if (pe < 16 && pe > 0) {
      highlights.push(`Attractive valuation trading at ${pe.toFixed(1)}x trailing earnings.`);
      score -= 0.4;
    } else if (pe > 35) {
      risks.push(`Rich valuation multiple (${pe.toFixed(1)}x P/E) prices in aggressive forward growth expectations.`);
      score += 0.5;
    }
  }

  if (beta != null && beta > 1.35) {
    risks.push(`High volatility profile with beta of ${beta.toFixed(2)} relative to the broader market.`);
  }

  // Bound score 1 (Strong Buy) to 5 (Risky)
  const finalScore = Math.max(1, Math.min(5, Math.round(score)));
  const scoreLabels: Record<number, string> = {
    1: "Strong Buy",
    2: "Buy",
    3: "Hold",
    4: "Caution",
    5: "Risky",
  };
  label = scoreLabels[finalScore];

  const summary = `${name} (${symbol}) presents a ${label.toLowerCase()} profile with a ${divYield.toFixed(2)}% dividend yield and ${growthStreak} years of consecutive distribution growth across the ${sector} sector.`;

  const markdown = `### 🏢 Executive Overview
**${name}** operates within the **${sector}** sector (${industry}). With a current dividend yield of **${divYield.toFixed(2)}%** and an annual distribution of **$${(detail?.annualPayout || 0).toFixed(2)}/share**, the company is positioned for income-oriented and dividend-growth investors.

---

### 📊 Financial Performance & Valuation
* **P/E Ratio (TTM)**: ${pe != null ? pe.toFixed(2) + "x" : "N/A"} ${forwardPe != null ? `(Forward P/E: ${forwardPe.toFixed(2)}x)` : ""}
* **Earnings Per Share (EPS)**: ${eps != null ? "$" + eps.toFixed(2) : "N/A"}
* **Revenue YoY Growth**: ${revGrowth != null ? (revGrowth >= 0 ? "+" : "") + revGrowth.toFixed(2) + "%" : "N/A"}
* **Beta (Market Sensitivity)**: ${beta != null ? beta.toFixed(2) : "1.00"}
* **Next Earnings Date**: ${detail?.nextEarningsDate ? detail.nextEarningsDate : "Announced quarterly"}

---

### 💰 Dividend Quality & Sustainability
* **Payout Ratio**: ${payoutRatio != null ? payoutRatio.toFixed(1) + "%" : "N/A"} — ${payoutRatio && payoutRatio <= 75 ? "Well-covered by earnings" : "Requires monitoring"}
* **Dividend Growth Streak**: **${growthStreak} years** of consecutive payout increases.
* **5-Year Dividend CAGR**: ${growth5Y != null ? (growth5Y >= 0 ? "+" : "") + growth5Y.toFixed(2) + "%" : "N/A"}
* **Frequency**: ${detail?.frequency || "Quarterly"} distributions.

---

### 🎯 Key Strengths & Growth Drivers
${highlights.length > 0 ? highlights.map(h => `- ✅ ${h}`).join("\n") : "- Stable recurring cash flow support."}

### ⚠️ Risk Factors to Watch
${risks.length > 0 ? risks.map(r => `- ⚠️ ${r}`).join("\n") : "- General macro interest rate and cyclical headwinds."}
`;

  return {
    score: finalScore,
    label,
    summary,
    markdown,
  };
}

/**
 * Generate analysis using Anthropic Claude.
 */
async function generateWithAnthropic(apiKey: string, context: string): Promise<StructuredAnalysisResult> {
  const client = new Anthropic({ apiKey });
  const response = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 1500,
    messages: [
      {
        role: "user",
        content: `You are an elite equity research and dividend portfolio analyst similar to Snowball Analytics research desk.
Analyze this company based on the provided metrics:
${context}

Provide a comprehensive, high-conviction markdown report. Format your response strictly as valid JSON:
{
  "score": <number from 1 to 5, where 1 is Strong Buy, 2 is Buy, 3 is Hold, 4 is Caution, 5 is Risky>,
  "label": <"Strong Buy" | "Buy" | "Hold" | "Caution" | "Risky">,
  "summary": <concise 2-sentence executive summary>,
  "markdown": <detailed markdown report with sections: ### 🏢 Executive Overview, ### 📊 Financial Performance & Earnings Trajectory, ### 💰 Dividend Safety & Growth Thesis, ### 🎯 Key Strengths, ### ⚠️ Major Risks & Headwinds>
}
Return only JSON.`
      }
    ]
  });

  const textBlock = [...response.content].reverse().find(b => b.type === "text");
  if (!textBlock || textBlock.type !== "text") throw new Error("No text response from Anthropic");
  const raw = textBlock.text.trim().replace(/^```json\s*/i, "").replace(/```\s*$/, "").trim();
  return JSON.parse(raw);
}

/**
 * Generate analysis using Google Gemini.
 */
async function generateWithGemini(apiKey: string, context: string): Promise<StructuredAnalysisResult> {
  const ai = new GoogleGenAI({ apiKey });
  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash",
    contents: `You are an elite equity research and dividend portfolio analyst similar to Snowball Analytics research desk.
Analyze this company based on the provided metrics:
${context}

Return valid JSON:
{
  "score": <number 1 to 5: 1=Strong Buy, 2=Buy, 3=Hold, 4=Caution, 5=Risky>,
  "label": <"Strong Buy" | "Buy" | "Hold" | "Caution" | "Risky">,
  "summary": <concise 2-sentence executive summary>,
  "markdown": <detailed markdown report with sections: ### 🏢 Executive Overview, ### 📊 Financial Performance & Earnings Trajectory, ### 💰 Dividend Safety & Growth Thesis, ### 🎯 Key Strengths, ### ⚠️ Major Risks & Headwinds>
}`
  });

  const text = response.text || "";
  const raw = text.trim().replace(/^```json\s*/i, "").replace(/```\s*$/, "").trim();
  return JSON.parse(raw);
}

/**
 * Generate analysis using OpenAI.
 */
async function generateWithOpenAI(apiKey: string, context: string): Promise<StructuredAnalysisResult> {
  const openai = new OpenAI({ apiKey });
  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      {
        role: "user",
        content: `You are an elite equity research and dividend portfolio analyst similar to Snowball Analytics research desk.
Analyze this company based on the provided metrics:
${context}

Return valid JSON:
{
  "score": <number 1 to 5: 1=Strong Buy, 2=Buy, 3=Hold, 4=Caution, 5=Risky>,
  "label": <"Strong Buy" | "Buy" | "Hold" | "Caution" | "Risky">,
  "summary": <concise 2-sentence executive summary>,
  "markdown": <detailed markdown report with sections: ### 🏢 Executive Overview, ### 📊 Financial Performance & Earnings Trajectory, ### 💰 Dividend Safety & Growth Thesis, ### 🎯 Key Strengths, ### ⚠️ Major Risks & Headwinds>
}`
      }
    ]
  });

  const text = completion.choices[0]?.message?.content || "";
  const raw = text.trim().replace(/^```json\s*/i, "").replace(/```\s*$/, "").trim();
  return JSON.parse(raw);
}

/**
 * Main entry point: Get or generate AI company & earnings insight for a symbol.
 */
export async function getCompanyAiInsight(
  symbol: string,
  forceRefresh = false,
  explicitDetail?: any
): Promise<AiInsightRecord> {
  const sym = symbol.toUpperCase().trim();

  // 1. Check cache
  if (!forceRefresh) {
    const cached = getAiInsight(sym);
    if (cached && !isInsightStale(cached.analyzedAt)) {
      return cached;
    }
  }

  // 2. Fetch context
  const detail = explicitDetail !== undefined ? explicitDetail : await getStockDetail(sym).catch(() => null);
  const profile = getProfile(sym);

  const context = `
Symbol: ${sym}
Company Name: ${profile?.name || detail?.name || sym}
Sector: ${profile?.sector || detail?.sector || "N/A"}
Industry: ${profile?.industry || "N/A"}
Current Price: $${detail?.price || "N/A"}
P/E (TTM): ${detail?.pe ?? "N/A"}
Forward P/E: ${detail?.forwardPE ?? "N/A"}
EPS: ${detail?.eps ?? "N/A"}
Forward EPS: ${detail?.forwardEPS ?? "N/A"}
Dividend Yield: ${detail?.dividendYield != null ? detail.dividendYield + "%" : "N/A"}
Annual Payout: $${detail?.annualPayout ?? "N/A"}
Payout Ratio: ${detail?.payoutRatio != null ? detail.payoutRatio + "%" : "N/A"}
Dividend Growth Streak: ${detail?.growthStreak ?? detail?.divStreak ?? 0} years
1Y Dividend Growth: ${detail?.growth1Y != null ? detail.growth1Y + "%" : "N/A"}
3Y Dividend Growth: ${detail?.growth3Y != null ? detail.growth3Y + "%" : "N/A"}
5Y Dividend Growth: ${detail?.growth5Y != null ? detail.growth5Y + "%" : "N/A"}
Revenue YoY Growth: ${detail?.revenueGrowthYoY != null ? detail.revenueGrowthYoY + "%" : "N/A"}
Beta: ${detail?.beta ?? "N/A"}
Next Earnings Date: ${detail?.nextEarningsDate ?? "N/A"}
Recent Payouts: ${JSON.stringify(detail?.payoutHistory?.slice(0, 4) || [])}
`;

  // 3. Try LLM providers
  const anthropicKey = getSetting("anthropic_api_key") || process.env.ANTHROPIC_API_KEY;
  const geminiKey = getSetting("gemini_api_key") || process.env.GEMINI_API_KEY;
  const openaiKey = getSetting("openai_api_key") || process.env.OPENAI_API_KEY;

  let result: StructuredAnalysisResult | null = null;
  let provider = "rule_engine";

  if (anthropicKey) {
    try {
      logger.info("AiInsight", `Generating Anthropic Claude insight for ${sym}...`);
      result = await generateWithAnthropic(anthropicKey, context);
      provider = "anthropic";
    } catch (err: any) {
      logger.warn("AiInsight", `Anthropic generation failed for ${sym}: ${err.message}`);
    }
  }

  if (!result && geminiKey) {
    try {
      logger.info("AiInsight", `Generating Google Gemini insight for ${sym}...`);
      result = await generateWithGemini(geminiKey, context);
      provider = "gemini";
    } catch (err: any) {
      logger.warn("AiInsight", `Gemini generation failed for ${sym}: ${err.message}`);
    }
  }

  if (!result && openaiKey) {
    try {
      logger.info("AiInsight", `Generating OpenAI insight for ${sym}...`);
      result = await generateWithOpenAI(openaiKey, context);
      provider = "openai";
    } catch (err: any) {
      logger.warn("AiInsight", `OpenAI generation failed for ${sym}: ${err.message}`);
    }
  }

  // 4. Deterministic Rule Engine Fallback
  if (!result) {
    logger.info("AiInsight", `Generating deterministic financial engine insight for ${sym}...`);
    result = generateDeterministicInsight(sym, detail, profile);
    provider = "rule_engine";
  }

  const record: AiInsightRecord = {
    symbol: sym,
    markdown: result.markdown,
    summary: result.summary,
    score: result.score,
    label: result.label,
    provider,
  };

  upsertAiInsight(record);
  logger.info("AiInsight", `Saved ${provider} insight for ${sym} (Score: ${record.score}/5, ${record.label})`);
  return record;
}
