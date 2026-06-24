/**
 * AI-powered stock rating service.
 *
 * For each held symbol, asks Claude claude-sonnet-4-6 (with built-in web_search) to
 * research Reddit sentiment (r/dividends, r/stocks, r/investing) plus recent
 * news and return a structured rating 1–5.
 *
 * Ratings are cached in stock_ratings for `cacheDays` (default 7). Only
 * stale/missing symbols are re-analysed per run.
 */

import Anthropic from "@anthropic-ai/sdk";
import { logger } from "../utils/logger.js";
import { getHeldSymbols } from "../repositories/priceHistoryRepository.js";
import { getProfile } from "../repositories/assetProfileRepository.js";
import { getPriceHistory } from "../repositories/priceHistoryRepository.js";
import { getRating, upsertRating, type StockRating } from "../repositories/stockRatingRepository.js";
import { getSetting } from "../models/db.js";
import { sleep } from "../utils/sleep.js";

const MODEL = "claude-sonnet-4-6";
const CACHE_DAYS = 7;
const CONCURRENCY = 2;          // symbols analysed in parallel
const DELAY_BETWEEN_MS = 2000;  // pause between batches

interface RatingOutput {
  score: number;
  label: string;
  sentiment: string;
  summary: string;
  keyRisks: string[];
  confidence: string;
}

function isStale(analyzedAt: string | undefined): boolean {
  if (!analyzedAt) return true;
  const age = Date.now() - new Date(analyzedAt.replace(" ", "T") + "Z").getTime();
  return age > CACHE_DAYS * 24 * 60 * 60 * 1000;
}

function priceChangePct(symbol: string): number | null {
  const candles = getPriceHistory(symbol);
  if (candles.length < 2) return null;
  const sorted = [...candles].sort((a, b) => a.date.localeCompare(b.date));
  const first = sorted[Math.max(0, sorted.length - 252)].close;  // ~1yr ago
  const last  = sorted[sorted.length - 1].close;
  if (!first || !last) return null;
  return ((last - first) / first) * 100;
}

async function analyseSymbol(client: Anthropic, symbol: string): Promise<StockRating | null> {
  const profile = getProfile(symbol);
  const pct1yr  = priceChangePct(symbol);

  const context = [
    `Symbol: ${symbol}`,
    profile?.name    ? `Name: ${profile.name}` : null,
    profile?.sector  ? `Sector: ${profile.sector}` : null,
    profile?.industry ? `Industry: ${profile.industry}` : null,
    profile?.country  ? `Country: ${profile.country}` : null,
    profile?.assetType ? `Asset type: ${profile.assetType}` : null,
    pct1yr != null ? `1-year price change: ${pct1yr.toFixed(1)}%` : null,
  ].filter(Boolean).join("\n");

  const prompt = `You are an expert investment analyst specialising in dividend stocks and income investing.

Analyse the following stock for a retail investor holding it in a dividend-focused portfolio:

${context}

Search Reddit (r/dividends, r/stocks, r/investing, r/canadianinvestor if Canadian) for recent community sentiment about this ticker. Also search for recent financial news, earnings surprises, dividend cuts or raises, and analyst opinion.

Based on your research, return ONLY a JSON object with exactly these fields — no markdown, no explanation outside the JSON:

{
  "score": <integer 1–5>,
  "label": <"Strong Buy" | "Buy" | "Hold" | "Caution" | "Risky">,
  "sentiment": <"positive" | "neutral" | "negative">,
  "summary": <2–3 sentence plain-English analysis for a retail investor>,
  "keyRisks": [<up to 3 short risk phrases>],
  "confidence": <"high" | "medium" | "low">
}

Score guide: 1=Strong Buy, 2=Buy, 3=Hold, 4=Caution, 5=Risky.
Base confidence on how much quality information you found.`;

  try {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 1024,
      tools: [{ type: "web_search_20250305" as any, name: "web_search" }],
      messages: [{ role: "user", content: prompt }],
    });

    // Extract the final text block (after any tool calls).
    const textBlock = [...response.content].reverse().find(b => b.type === "text");
    if (!textBlock || textBlock.type !== "text") return null;

    const raw = textBlock.text.trim().replace(/^```json\s*/i, "").replace(/```\s*$/, "").trim();
    const parsed: RatingOutput = JSON.parse(raw);

    const score = Math.max(1, Math.min(5, Math.round(parsed.score)));
    const labelMap: Record<number, string> = { 1: "Strong Buy", 2: "Buy", 3: "Hold", 4: "Caution", 5: "Risky" };

    return {
      symbol,
      score,
      label:      labelMap[score] ?? parsed.label,
      sentiment:  parsed.sentiment  || "neutral",
      summary:    parsed.summary    || "",
      keyRisks:   Array.isArray(parsed.keyRisks) ? parsed.keyRisks.slice(0, 3) : [],
      confidence: parsed.confidence || "low",
    };
  } catch (err: any) {
    logger.warn("StockRating", `Failed to analyse ${symbol}: ${err.message}`);
    return null;
  }
}

export async function refreshStockRatings(forceRefresh = false): Promise<{ analysed: number; skipped: number; errors: number }> {
  const apiKey = getSetting("anthropic_api_key") || process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    logger.warn("StockRating", "No Anthropic API key configured — skipping stock rating refresh. Set anthropic_api_key in Settings or ANTHROPIC_API_KEY env var.");
    return { analysed: 0, skipped: 0, errors: 0 };
  }

  const client = new Anthropic({ apiKey });
  const symbols = getHeldSymbols();

  if (symbols.length === 0) {
    logger.info("StockRating", "No held symbols found — nothing to rate.");
    return { analysed: 0, skipped: 0, errors: 0 };
  }

  const toAnalyse = forceRefresh
    ? symbols
    : symbols.filter(s => isStale(getRating(s)?.analyzedAt));

  logger.info("StockRating", `${symbols.length} symbol(s) held; ${toAnalyse.length} need analysis.`);

  let analysed = 0, skipped = symbols.length - toAnalyse.length, errors = 0;

  for (let i = 0; i < toAnalyse.length; i += CONCURRENCY) {
    const batch = toAnalyse.slice(i, i + CONCURRENCY);
    await Promise.all(batch.map(async (sym) => {
      logger.info("StockRating", `Analysing ${sym}…`);
      const rating = await analyseSymbol(client, sym);
      if (rating) {
        upsertRating(rating);
        analysed++;
        logger.info("StockRating", `${sym} → ${rating.label} (${rating.score}/5, ${rating.confidence} confidence)`);
      } else {
        errors++;
      }
    }));
    if (i + CONCURRENCY < toAnalyse.length) await sleep(DELAY_BETWEEN_MS);
  }

  return { analysed, skipped, errors };
}
