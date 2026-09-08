/**
 * Pure alert evaluation — no DB, no network, no clock.
 *
 * The app already computes everything an alert needs (dividend growth, forecast
 * ex-dates, rebalance drift, AI ratings) but never pushes any of it: the webhook
 * in notificationService had exactly two callers, both about job plumbing. This
 * module turns that computed state into things worth telling someone about.
 *
 * Kept pure like rebalanceService/t5008 so every rule is unit-testable against
 * a fixed input snapshot; alertService does the gathering and delivery.
 */

export type AlertSeverity = "info" | "warning" | "critical";

export type AlertRuleType =
  | "dividend_cut"
  | "ex_dividend_soon"
  | "allocation_drift"
  | "rating_downgrade"
  | "watchlist_target";

export const ALERT_RULE_TYPES: AlertRuleType[] = [
  "dividend_cut",
  "ex_dividend_soon",
  "allocation_drift",
  "rating_downgrade",
  "watchlist_target",
];

/** Defaults used when a rule has never been configured. */
export const DEFAULT_RULE_CONFIG: Record<AlertRuleType, Record<string, number>> = {
  dividend_cut: { minDropPct: 1 },
  ex_dividend_soon: { days: 7 },
  allocation_drift: { thresholdPct: 5 },
  rating_downgrade: { minChange: 1 },
  // Nothing to tune: a symbol either meets the criteria you set on it or not.
  watchlist_target: {},
};

export interface AlertRule {
  type: AlertRuleType;
  enabled: boolean;
  config: Record<string, number>;
}

export interface Alert {
  ruleType: AlertRuleType;
  /** Stable identity for this occurrence — the same situation yields the same key. */
  dedupeKey: string;
  severity: AlertSeverity;
  title: string;
  body: string;
  symbol?: string;
}

export interface AlertInputs {
  /** 'YYYY-MM-DD'. */
  today: string;
  /** Symbols currently held, so alerts never fire for something you sold. */
  heldSymbols: Set<string>;
  /** Per-symbol yearly dividend totals, oldest → newest (complete years only). */
  dividendHistory: Map<string, Array<{ year: number; total: number }>>;
  upcomingDividends: Array<{
    symbol: string;
    date: string;
    amount: number;
    accountName?: string;
  }>;
  drift: Array<{
    portfolioName: string;
    symbol: string;
    currentPct: number;   // 0-100
    targetPct: number;    // 0-100
  }>;
  ratings: Array<{ symbol: string; score: number; label: string; summary?: string }>;
  /** Score last seen for each symbol, so only a *change* alerts. */
  previousRatingScores: Map<string, number>;
  /** Watched symbols currently meeting every buy criterion set on them. */
  watchlistMatches: Array<{ symbol: string; name?: string | null; detail: string }>;
  /** Symbols that already met their criteria last run, so only a *transition* alerts. */
  previouslyMetWatchlist: Set<string>;
}

const money = (n: number) => `$${Math.abs(n).toFixed(2)}`;
const pct = (n: number) => `${n.toFixed(1)}%`;

/** Whole days from `from` to `to`, both 'YYYY-MM-DD', in UTC. */
export function daysUntil(from: string, to: string): number {
  const a = Date.UTC(+from.slice(0, 4), +from.slice(5, 7) - 1, +from.slice(8, 10));
  const b = Date.UTC(+to.slice(0, 4), +to.slice(5, 7) - 1, +to.slice(8, 10));
  return Math.round((b - a) / 86_400_000);
}

function configOf(rules: AlertRule[], type: AlertRuleType): Record<string, number> | null {
  const rule = rules.find(r => r.type === type);
  if (!rule || !rule.enabled) return null;
  return { ...DEFAULT_RULE_CONFIG[type], ...rule.config };
}

/**
 * A dividend cut: the last complete year paid less than the year before it.
 *
 * Only complete calendar years are compared — `computeDividendGrowth` already
 * drops the in-progress year, because a partial year always looks like a cut.
 */
function dividendCuts(inputs: AlertInputs, config: Record<string, number>): Alert[] {
  const minDropPct = config.minDropPct ?? 1;
  const out: Alert[] = [];

  for (const [symbol, totals] of inputs.dividendHistory) {
    if (!inputs.heldSymbols.has(symbol)) continue;
    if (totals.length < 2) continue;

    const latest = totals[totals.length - 1];
    const prior = totals[totals.length - 2];
    if (prior.total <= 0 || latest.total >= prior.total) continue;

    const dropPct = ((prior.total - latest.total) / prior.total) * 100;
    if (dropPct < minDropPct) continue;

    out.push({
      ruleType: "dividend_cut",
      // Keyed by the year of the cut, so it alerts once and again only if a
      // later year cuts too.
      dedupeKey: `dividend_cut:${symbol}:${latest.year}`,
      severity: dropPct >= 20 ? "critical" : "warning",
      symbol,
      title: `${symbol} cut its dividend`,
      body: `${latest.year} paid ${money(latest.total)}/share vs ${money(prior.total)} in ${prior.year} `
        + `— down ${pct(dropPct)}. Worth checking whether the income thesis still holds.`,
    });
  }
  return out;
}

/** An ex-dividend date landing inside the configured window. */
function exDividendsSoon(inputs: AlertInputs, config: Record<string, number>): Alert[] {
  const days = Math.max(1, Math.round(config.days ?? 7));
  const out: Alert[] = [];

  for (const ev of inputs.upcomingDividends) {
    if (!inputs.heldSymbols.has(ev.symbol)) continue;
    const until = daysUntil(inputs.today, ev.date);
    if (until < 0 || until > days) continue;

    const when = until === 0 ? "today" : until === 1 ? "tomorrow" : `in ${until} days`;
    out.push({
      ruleType: "ex_dividend_soon",
      // Keyed by the payment date so each payment alerts once, not daily.
      dedupeKey: `ex_dividend_soon:${ev.symbol}:${ev.date}`,
      severity: "info",
      symbol: ev.symbol,
      title: `${ev.symbol} pays ${money(ev.amount)} ${when}`,
      body: `Expected ${money(ev.amount)} on ${ev.date}`
        + (ev.accountName ? ` in ${ev.accountName}` : "") + ".",
    });
  }
  return out;
}

/**
 * A holding that has drifted past the configured band from its target weight.
 *
 * Fires per portfolio+symbol, bucketed to whole percentage points so ordinary
 * daily wobble around the threshold doesn't produce a fresh alert every run.
 */
function allocationDrift(inputs: AlertInputs, config: Record<string, number>): Alert[] {
  const threshold = Math.max(0.1, config.thresholdPct ?? 5);
  const out: Alert[] = [];

  for (const d of inputs.drift) {
    const deviation = d.currentPct - d.targetPct;
    if (Math.abs(deviation) < threshold) continue;

    const direction = deviation > 0 ? "overweight" : "underweight";
    out.push({
      ruleType: "allocation_drift",
      dedupeKey: `allocation_drift:${d.portfolioName}:${d.symbol}:${direction}:${Math.trunc(Math.abs(deviation))}`,
      severity: Math.abs(deviation) >= threshold * 2 ? "warning" : "info",
      symbol: d.symbol,
      title: `${d.symbol} is ${pct(Math.abs(deviation))} ${direction} in ${d.portfolioName}`,
      body: `Currently ${pct(d.currentPct)} against a ${pct(d.targetPct)} target. `
        + `Rebalancing suggestions are on the Rebalancing page.`,
    });
  }
  return out;
}

/** An AI rating that got worse by at least the configured number of steps. */
function ratingDowngrades(inputs: AlertInputs, config: Record<string, number>): Alert[] {
  const minChange = Math.max(1, Math.round(config.minChange ?? 1));
  const out: Alert[] = [];

  for (const r of inputs.ratings) {
    if (!inputs.heldSymbols.has(r.symbol)) continue;
    const previous = inputs.previousRatingScores.get(r.symbol);
    if (previous == null) continue;              // first sighting is not a change

    // Score runs 1 (Strong Buy) → 5 (Risky), so an increase is a downgrade.
    const change = r.score - previous;
    if (change < minChange) continue;

    out.push({
      ruleType: "rating_downgrade",
      dedupeKey: `rating_downgrade:${r.symbol}:${previous}->${r.score}`,
      severity: r.score >= 5 ? "critical" : "warning",
      symbol: r.symbol,
      title: `${r.symbol} downgraded to ${r.label}`,
      body: `The AI rating moved ${previous} → ${r.score} (${r.label}).`
        + (r.summary ? ` ${r.summary}` : ""),
    });
  }
  return out;
}

/**
 * A watched symbol that has just come into buy range.
 *
 * Fires on the transition into "meets everything", not on the state: a symbol
 * sitting below your price target for a month should say so once, not daily.
 * Dropping out and coming back is a genuinely new opportunity and alerts again.
 */
function watchlistTargets(inputs: AlertInputs, _config: Record<string, number>): Alert[] {
  const out: Alert[] = [];
  for (const match of inputs.watchlistMatches) {
    if (inputs.previouslyMetWatchlist.has(match.symbol)) continue;
    out.push({
      ruleType: "watchlist_target",
      // Dated, not a fixed "entered": `previouslyMetWatchlist` already stops
      // this repeating while the symbol stays in range, and a fixed key would
      // make the 180-day dedupe window permanently swallow a genuine re-entry
      // months later.
      dedupeKey: `watchlist_target:${match.symbol}:${inputs.today}`,
      severity: "info",
      symbol: match.symbol,
      title: `${match.symbol} meets your buy criteria`,
      body: `${match.name ? match.name + " — " : ""}${match.detail}`,
    });
  }
  return out;
}

const EVALUATORS: Record<AlertRuleType, (i: AlertInputs, c: Record<string, number>) => Alert[]> = {
  dividend_cut: dividendCuts,
  ex_dividend_soon: exDividendsSoon,
  allocation_drift: allocationDrift,
  rating_downgrade: ratingDowngrades,
  watchlist_target: watchlistTargets,
};

/**
 * Evaluate every enabled rule and return the alerts that should fire now.
 *
 * `alreadyFired` holds the dedupe keys of alerts previously delivered; anything
 * matching is dropped. Without it a "dividend cut" would re-notify on every run
 * for as long as the cut remains true, which trains you to ignore the channel.
 */
export function evaluateAlerts(
  inputs: AlertInputs,
  rules: AlertRule[],
  alreadyFired: Set<string>,
): Alert[] {
  const out: Alert[] = [];

  for (const type of ALERT_RULE_TYPES) {
    const config = configOf(rules, type);
    if (!config) continue;
    for (const alert of EVALUATORS[type](inputs, config)) {
      if (alreadyFired.has(alert.dedupeKey)) continue;
      out.push(alert);
    }
  }

  // Most urgent first, so a truncated notification still leads with what matters.
  const rank: Record<AlertSeverity, number> = { critical: 0, warning: 1, info: 2 };
  return out.sort((a, b) => rank[a.severity] - rank[b.severity] || a.title.localeCompare(b.title));
}

/** One-line webhook summary for a batch of alerts. */
export function summarizeAlerts(alerts: Alert[]): string {
  if (alerts.length === 0) return "No alerts";
  const counts = alerts.reduce((acc, a) => {
    acc[a.severity] = (acc[a.severity] ?? 0) + 1;
    return acc;
  }, {} as Record<string, number>);
  return (["critical", "warning", "info"] as AlertSeverity[])
    .filter(s => counts[s])
    .map(s => `${counts[s]} ${s}`)
    .join(", ");
}
