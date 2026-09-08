import {
  getCachedPositions,
  getAllUserPortfolios,
  getPortfolioTargets,
  getCachedAccounts,
  listPortfolios,
  getActiveAccountIds,
} from "../models/db.js";
import { getScopedAccounts } from "./accountScope.js";
import { getDividendHistory } from "../repositories/dividendHistoryRepository.js";
import { getAllRatings } from "../repositories/stockRatingRepository.js";
import { getWatchlistRows } from "./watchlistService.js";
import { describeVerdict } from "./watchlistTargets.js";
import { computeDividendGrowth } from "./dividendGrowth.js";
import { computeRebalance } from "./rebalanceService.js";
import { getAllDividendsForAllPortfolios } from "./dividendService.js";
import { sendWebhookNotification } from "./notificationService.js";
import {
  evaluateAlerts,
  summarizeAlerts,
  type Alert,
  type AlertInputs,
} from "./alertRules.js";
import {
  listAlertRules,
  getRecentDedupeKeys,
  recordAlerts,
  getAlertStateByPrefix,
  setAlertState,
} from "../repositories/alertRepository.js";
import { logger } from "../utils/logger.js";

/**
 * Gathers the state the alert rules reason over, runs them, then persists and
 * delivers whatever fired.
 *
 * Everything here reads local caches — no brokerage calls, and the dividend
 * forecast is asked for cached data only — so the job is cheap enough to run
 * often and cannot fail on a rate limit.
 */

const norm = (s: unknown) => String(s ?? "").toUpperCase().trim();
const RATING_STATE_PREFIX = "rating:";
const WATCHLIST_STATE_PREFIX = "watchlist_met:";

function todayIso(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/** Symbols currently held in any active account. */
function heldSymbols(): Set<string> {
  const out = new Set<string>();
  for (const acct of getScopedAccounts(null)) {
    for (const pos of getCachedPositions(acct.id)) {
      const sym = norm(pos.symbol);
      if (sym) out.add(sym);
    }
  }
  return out;
}

/** Complete-year dividend totals per held symbol, from the local history cache. */
function dividendHistoryFor(symbols: Set<string>): Map<string, Array<{ year: number; total: number }>> {
  const out = new Map<string, Array<{ year: number; total: number }>>();
  for (const symbol of symbols) {
    const history = getDividendHistory(symbol);
    if (history.length === 0) continue;
    const { annualTotals } = computeDividendGrowth(history);
    if (annualTotals.length > 0) out.set(symbol, annualTotals);
  }
  return out;
}

/** Forecast payouts, flattened from the cached per-account dividend forecast. */
async function upcomingDividends(): Promise<AlertInputs["upcomingDividends"]> {
  // Cached only: no forced refresh, no external fetch. A background alert run
  // must not trigger a wave of provider calls.
  const groups = await getAllDividendsForAllPortfolios(false, false);
  const out: AlertInputs["upcomingDividends"] = [];
  for (const group of groups ?? []) {
    for (const ev of group.dividends ?? []) {
      if (!ev.symbol || !ev.date) continue;
      out.push({
        symbol: norm(ev.symbol),
        date: String(ev.date).slice(0, 10),
        amount: ev.amount ?? 0,
        accountName: group.accountName ?? ev.accountName,
      });
    }
  }
  return out;
}

/**
 * Allocation drift per user portfolio that has targets configured.
 *
 * Positions are pooled across the portfolio's accounts before comparing to
 * target, because a symbol can look underweight in one account while the
 * portfolio as a whole is on target — alerting on that would be noise.
 */
function allocationDrift(): AlertInputs["drift"] {
  const out: AlertInputs["drift"] = [];
  const activeIds = getActiveAccountIds();

  // accountId → its cached positions and cash, resolved once.
  const accountIndex = new Map<string, { positions: any[]; cash: number }>();
  for (const parent of listPortfolios()) {
    for (const account of getCachedAccounts(parent.id!)) {
      accountIndex.set(account.id, {
        positions: getCachedPositions(account.id),
        cash: account.cashBalance ?? 0,
      });
    }
  }

  for (const portfolio of getAllUserPortfolios()) {
    const targets = getPortfolioTargets(portfolio.id);
    if (targets.length === 0) continue;

    const positions: { symbol: string; marketValue: number }[] = [];
    let cash = 0;
    for (const accountId of portfolio.accountIds ?? []) {
      if (!activeIds.has(accountId)) continue;
      const entry = accountIndex.get(accountId);
      if (!entry) continue;
      cash += entry.cash;
      for (const pos of entry.positions) {
        const symbol = norm(pos.symbol);
        if (!symbol) continue;
        positions.push({ symbol, marketValue: pos.marketValue ?? (pos.units ?? 0) * (pos.price ?? 0) });
      }
    }
    if (positions.length === 0 && cash === 0) continue;

    const result = computeRebalance(positions, cash, targets, "full");
    for (const asset of result.assets) {
      // computeRebalance works in fractions; the rules speak percent.
      out.push({
        portfolioName: portfolio.name,
        symbol: asset.symbol,
        currentPct: asset.currentPct * 100,
        targetPct: asset.targetPct * 100,
      });
    }
  }
  return out;
}

export interface AlertRunResult {
  evaluated: number;
  fired: number;
  delivered: boolean;
  summary: string;
}

/**
 * Evaluate every enabled rule and deliver anything new.
 *
 * `dryRun` evaluates and returns without persisting or notifying — used by the
 * "Preview" button so the user can see what a rule would produce before turning
 * it on, without burning the dedupe keys.
 */
export async function runAlertEvaluation(dryRun = false): Promise<AlertRunResult & { alerts: Alert[] }> {
  const rules = listAlertRules();
  const enabled = rules.filter(r => r.enabled);

  if (enabled.length === 0 && !dryRun) {
    return { evaluated: 0, fired: 0, delivered: false, summary: "No rules enabled", alerts: [] };
  }

  const held = heldSymbols();
  const ratings = getAllRatings();

  const previousRatingScores = new Map<string, number>();
  for (const [symbol, value] of getAlertStateByPrefix(RATING_STATE_PREFIX)) {
    const score = Number(value);
    if (Number.isFinite(score)) previousRatingScores.set(symbol, score);
  }

  // Watched symbols meeting every criterion set on them. Rows with no criteria
  // are plain bookmarks and never match.
  const watchlistRows = getWatchlistRows();
  const watchlistMatches = watchlistRows
    .filter(r => r.verdict.hasTargets && r.verdict.met)
    .map(r => ({ symbol: r.symbol, name: r.name, detail: describeVerdict(r.symbol, r.verdict).replace(`${r.symbol}: `, "") }));

  const previouslyMetWatchlist = new Set<string>();
  for (const [symbol, value] of getAlertStateByPrefix(WATCHLIST_STATE_PREFIX)) {
    if (value === "1") previouslyMetWatchlist.add(symbol);
  }

  const inputs: AlertInputs = {
    today: todayIso(),
    heldSymbols: held,
    dividendHistory: dividendHistoryFor(held),
    upcomingDividends: await upcomingDividends(),
    drift: allocationDrift(),
    ratings: ratings.map(r => ({ symbol: norm(r.symbol), score: r.score, label: r.label, summary: r.summary })),
    previousRatingScores,
    watchlistMatches,
    previouslyMetWatchlist,
  };

  // A dry run must see every rule, including the ones currently switched off.
  const effectiveRules = dryRun ? rules.map(r => ({ ...r, enabled: true })) : rules;
  const alreadyFired = dryRun ? new Set<string>() : getRecentDedupeKeys();
  const alerts = evaluateAlerts(inputs, effectiveRules, alreadyFired);

  if (dryRun) {
    return { evaluated: enabled.length, fired: alerts.length, delivered: false, summary: summarizeAlerts(alerts), alerts };
  }

  // Remember the scores we have now, so the next run compares against these.
  // Done regardless of whether anything fired — otherwise the first downgrade
  // after a quiet period would compare against a stale score.
  for (const r of ratings) setAlertState(`${RATING_STATE_PREFIX}${norm(r.symbol)}`, String(r.score));

  // Same for watchlist matches: recording the current state is what makes the
  // next run fire on a transition rather than on the state persisting.
  const matched = new Set(watchlistMatches.map(m => m.symbol));
  for (const row of watchlistRows) {
    setAlertState(`${WATCHLIST_STATE_PREFIX}${row.symbol}`, matched.has(row.symbol) ? "1" : "0");
  }

  if (alerts.length === 0) {
    logger.debug("Alerts", `Evaluated ${enabled.length} rule(s) — nothing new`);
    return { evaluated: enabled.length, fired: 0, delivered: false, summary: "No new alerts", alerts: [] };
  }

  const delivered = await deliver(alerts);
  // Recorded after delivery so the `delivered` flag is accurate, and only the
  // rows actually inserted count as fired (the UNIQUE key drops duplicates).
  const inserted = recordAlerts(alerts, delivered);

  logger.info("Alerts", `${inserted.length} new alert(s): ${summarizeAlerts(inserted)}${delivered ? " (webhook sent)" : ""}`);
  return {
    evaluated: enabled.length,
    fired: inserted.length,
    delivered,
    summary: summarizeAlerts(inserted),
    alerts: inserted,
  };
}

/**
 * Push one webhook for the batch rather than one per alert — a dividend-heavy
 * month could otherwise produce a dozen messages in a row.
 */
async function deliver(alerts: Alert[]): Promise<boolean> {
  const title = alerts.length === 1
    ? alerts[0].title
    : `${alerts.length} portfolio alerts (${summarizeAlerts(alerts)})`;

  const body = alerts
    .map(a => `• [${a.severity}] ${a.title}\n  ${a.body}`)
    .join("\n");

  const result = await sendWebhookNotification(title, body);
  if (!result.sent && result.error !== "No webhook configured") {
    logger.warn("Alerts", `Webhook delivery failed: ${result.error}`);
  }
  return result.sent;
}
