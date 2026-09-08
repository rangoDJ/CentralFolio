import { test } from "node:test";
import assert from "node:assert/strict";
import {
  evaluateAlerts,
  summarizeAlerts,
  daysUntil,
  ALERT_RULE_TYPES,
  type AlertInputs,
  type AlertRule,
} from "./alertRules.js";

const TODAY = "2026-09-08";

function inputs(overrides: Partial<AlertInputs> = {}): AlertInputs {
  return {
    today: TODAY,
    heldSymbols: new Set(["ENB.TO", "AAPL"]),
    dividendHistory: new Map(),
    upcomingDividends: [],
    drift: [],
    ratings: [],
    previousRatingScores: new Map(),
    ...overrides,
  };
}

const allEnabled = (): AlertRule[] =>
  ALERT_RULE_TYPES.map(type => ({ type, enabled: true, config: {} }));

const only = (type: string): AlertRule[] =>
  ALERT_RULE_TYPES.map(t => ({ type: t, enabled: t === type, config: {} }));

// ── dividend_cut ────────────────────────────────────────────────────────────

test("dividend cut fires when the last complete year paid less than the one before", () => {
  const a = evaluateAlerts(inputs({
    dividendHistory: new Map([["ENB.TO", [{ year: 2024, total: 3.55 }, { year: 2025, total: 2.80 }]]]),
  }), only("dividend_cut"), new Set());

  assert.equal(a.length, 1);
  assert.equal(a[0].ruleType, "dividend_cut");
  assert.equal(a[0].symbol, "ENB.TO");
  assert.match(a[0].body, /2025 paid \$2\.80\/share vs \$3\.55 in 2024/);
  assert.equal(a[0].dedupeKey, "dividend_cut:ENB.TO:2025");
});

test("a raise or a flat year is not a cut", () => {
  const raise = evaluateAlerts(inputs({
    dividendHistory: new Map([["ENB.TO", [{ year: 2024, total: 3.00 }, { year: 2025, total: 3.55 }]]]),
  }), only("dividend_cut"), new Set());
  assert.equal(raise.length, 0);

  const flat = evaluateAlerts(inputs({
    dividendHistory: new Map([["ENB.TO", [{ year: 2024, total: 3.00 }, { year: 2025, total: 3.00 }]]]),
  }), only("dividend_cut"), new Set());
  assert.equal(flat.length, 0);
});

test("a trivial cut below the configured floor is ignored", () => {
  // Rounding noise in reported per-share amounts shouldn't page anyone.
  const rules: AlertRule[] = [{ type: "dividend_cut", enabled: true, config: { minDropPct: 5 } }];
  const a = evaluateAlerts(inputs({
    dividendHistory: new Map([["ENB.TO", [{ year: 2024, total: 3.00 }, { year: 2025, total: 2.97 }]]]),
  }), rules, new Set());
  assert.equal(a.length, 0);
});

test("a deep cut is critical, a shallow one only a warning", () => {
  const deep = evaluateAlerts(inputs({
    dividendHistory: new Map([["ENB.TO", [{ year: 2024, total: 4.00 }, { year: 2025, total: 2.00 }]]]),
  }), only("dividend_cut"), new Set());
  assert.equal(deep[0].severity, "critical");

  const shallow = evaluateAlerts(inputs({
    dividendHistory: new Map([["ENB.TO", [{ year: 2024, total: 4.00 }, { year: 2025, total: 3.80 }]]]),
  }), only("dividend_cut"), new Set());
  assert.equal(shallow[0].severity, "warning");
});

test("no alert for a symbol you no longer hold", () => {
  const a = evaluateAlerts(inputs({
    heldSymbols: new Set(["AAPL"]),
    dividendHistory: new Map([["ENB.TO", [{ year: 2024, total: 4.00 }, { year: 2025, total: 1.00 }]]]),
  }), only("dividend_cut"), new Set());
  assert.equal(a.length, 0);
});

test("a single year of history cannot show a cut", () => {
  const a = evaluateAlerts(inputs({
    dividendHistory: new Map([["ENB.TO", [{ year: 2025, total: 2.00 }]]]),
  }), only("dividend_cut"), new Set());
  assert.equal(a.length, 0);
});

// ── ex_dividend_soon ────────────────────────────────────────────────────────

test("an ex-date inside the window fires, one outside does not", () => {
  const a = evaluateAlerts(inputs({
    upcomingDividends: [
      { symbol: "ENB.TO", date: "2026-09-11", amount: 91.5, accountName: "Margin" },
      { symbol: "AAPL", date: "2026-10-20", amount: 24.0 },
    ],
  }), only("ex_dividend_soon"), new Set());

  assert.equal(a.length, 1);
  assert.equal(a[0].symbol, "ENB.TO");
  assert.match(a[0].title, /pays \$91\.50 in 3 days/);
  assert.match(a[0].body, /in Margin/);
});

test("today and tomorrow read naturally", () => {
  const a = evaluateAlerts(inputs({
    upcomingDividends: [
      { symbol: "ENB.TO", date: TODAY, amount: 10 },
      { symbol: "AAPL", date: "2026-09-09", amount: 20 },
    ],
  }), only("ex_dividend_soon"), new Set());

  assert.match(a.find(x => x.symbol === "ENB.TO")!.title, /today/);
  assert.match(a.find(x => x.symbol === "AAPL")!.title, /tomorrow/);
});

test("a past ex-date does not fire", () => {
  const a = evaluateAlerts(inputs({
    upcomingDividends: [{ symbol: "ENB.TO", date: "2026-09-01", amount: 10 }],
  }), only("ex_dividend_soon"), new Set());
  assert.equal(a.length, 0);
});

test("the window is configurable", () => {
  const rules: AlertRule[] = [{ type: "ex_dividend_soon", enabled: true, config: { days: 30 } }];
  const a = evaluateAlerts(inputs({
    upcomingDividends: [{ symbol: "AAPL", date: "2026-10-01", amount: 24 }],
  }), rules, new Set());
  assert.equal(a.length, 1);
});

// ── allocation_drift ────────────────────────────────────────────────────────

test("drift beyond the band fires with the right direction", () => {
  const a = evaluateAlerts(inputs({
    drift: [
      { portfolioName: "Core", symbol: "AAPL", currentPct: 32, targetPct: 25 },
      { portfolioName: "Core", symbol: "ENB.TO", currentPct: 18, targetPct: 25 },
      { portfolioName: "Core", symbol: "VFV.TO", currentPct: 26, targetPct: 25 },  // inside the band
    ],
  }), only("allocation_drift"), new Set());

  assert.equal(a.length, 2);
  assert.match(a.find(x => x.symbol === "AAPL")!.title, /7\.0% overweight/);
  assert.match(a.find(x => x.symbol === "ENB.TO")!.title, /7\.0% underweight/);
});

test("drift is informational inside 2x the band and a warning beyond it", () => {
  const mild = evaluateAlerts(inputs({
    drift: [{ portfolioName: "Core", symbol: "AAPL", currentPct: 33, targetPct: 25 }],   // 8% vs a 5% band
  }), only("allocation_drift"), new Set());
  assert.equal(mild[0].severity, "info");

  const severe = evaluateAlerts(inputs({
    drift: [{ portfolioName: "Core", symbol: "AAPL", currentPct: 36, targetPct: 25 }],   // 11%
  }), only("allocation_drift"), new Set());
  assert.equal(severe[0].severity, "warning");
});

test("drift keys bucket to whole points so daily wobble does not re-alert", () => {
  const first = evaluateAlerts(inputs({
    drift: [{ portfolioName: "Core", symbol: "AAPL", currentPct: 32.4, targetPct: 25 }],
  }), only("allocation_drift"), new Set());

  const laterSameDrift = evaluateAlerts(inputs({
    drift: [{ portfolioName: "Core", symbol: "AAPL", currentPct: 32.9, targetPct: 25 }],
  }), only("allocation_drift"), new Set([first[0].dedupeKey]));

  assert.equal(laterSameDrift.length, 0, "7.4% and 7.9% drift share a key");
});

test("drift that widens by a whole point alerts again", () => {
  const first = evaluateAlerts(inputs({
    drift: [{ portfolioName: "Core", symbol: "AAPL", currentPct: 32, targetPct: 25 }],
  }), only("allocation_drift"), new Set());

  const wider = evaluateAlerts(inputs({
    drift: [{ portfolioName: "Core", symbol: "AAPL", currentPct: 34, targetPct: 25 }],
  }), only("allocation_drift"), new Set([first[0].dedupeKey]));

  assert.equal(wider.length, 1);
});

// ── rating_downgrade ────────────────────────────────────────────────────────

test("a downgrade fires; an upgrade and a first sighting do not", () => {
  const downgrade = evaluateAlerts(inputs({
    ratings: [{ symbol: "ENB.TO", score: 4, label: "Caution", summary: "Payout ratio rising." }],
    previousRatingScores: new Map([["ENB.TO", 2]]),
  }), only("rating_downgrade"), new Set());
  assert.equal(downgrade.length, 1);
  assert.match(downgrade[0].title, /downgraded to Caution/);
  assert.match(downgrade[0].body, /2 → 4/);

  const upgrade = evaluateAlerts(inputs({
    ratings: [{ symbol: "ENB.TO", score: 1, label: "Strong Buy" }],
    previousRatingScores: new Map([["ENB.TO", 3]]),
  }), only("rating_downgrade"), new Set());
  assert.equal(upgrade.length, 0);

  const firstSighting = evaluateAlerts(inputs({
    ratings: [{ symbol: "ENB.TO", score: 5, label: "Risky" }],
    previousRatingScores: new Map(),
  }), only("rating_downgrade"), new Set());
  assert.equal(firstSighting.length, 0, "no prior score means no change to report");
});

test("a drop to Risky is critical", () => {
  const a = evaluateAlerts(inputs({
    ratings: [{ symbol: "ENB.TO", score: 5, label: "Risky" }],
    previousRatingScores: new Map([["ENB.TO", 3]]),
  }), only("rating_downgrade"), new Set());
  assert.equal(a[0].severity, "critical");
});

test("a downgrade smaller than minChange is ignored", () => {
  const rules: AlertRule[] = [{ type: "rating_downgrade", enabled: true, config: { minChange: 2 } }];
  const a = evaluateAlerts(inputs({
    ratings: [{ symbol: "ENB.TO", score: 3, label: "Hold" }],
    previousRatingScores: new Map([["ENB.TO", 2]]),
  }), rules, new Set());
  assert.equal(a.length, 0);
});

// ── engine behaviour ────────────────────────────────────────────────────────

test("disabled rules produce nothing", () => {
  const disabled: AlertRule[] = ALERT_RULE_TYPES.map(type => ({ type, enabled: false, config: {} }));
  const a = evaluateAlerts(inputs({
    dividendHistory: new Map([["ENB.TO", [{ year: 2024, total: 4 }, { year: 2025, total: 1 }]]]),
    upcomingDividends: [{ symbol: "ENB.TO", date: TODAY, amount: 10 }],
  }), disabled, new Set());
  assert.equal(a.length, 0);
});

test("an unconfigured rule is treated as off", () => {
  const a = evaluateAlerts(inputs({
    upcomingDividends: [{ symbol: "ENB.TO", date: TODAY, amount: 10 }],
  }), [], new Set());
  assert.equal(a.length, 0);
});

test("already-fired alerts are suppressed", () => {
  const first = evaluateAlerts(inputs({
    dividendHistory: new Map([["ENB.TO", [{ year: 2024, total: 4 }, { year: 2025, total: 2 }]]]),
  }), allEnabled(), new Set());
  assert.equal(first.length, 1);

  const second = evaluateAlerts(inputs({
    dividendHistory: new Map([["ENB.TO", [{ year: 2024, total: 4 }, { year: 2025, total: 2 }]]]),
  }), allEnabled(), new Set([first[0].dedupeKey]));
  assert.equal(second.length, 0, "the same cut must not re-notify every run");
});

test("alerts come back most urgent first", () => {
  const a = evaluateAlerts(inputs({
    upcomingDividends: [{ symbol: "AAPL", date: TODAY, amount: 5 }],           // info
    dividendHistory: new Map([["ENB.TO", [{ year: 2024, total: 4 }, { year: 2025, total: 1 }]]]),  // critical
    // Past 2x the 5% band, which is where drift stops being informational.
    drift: [{ portfolioName: "Core", symbol: "AAPL", currentPct: 36, targetPct: 25 }],             // warning
  }), allEnabled(), new Set());

  assert.deepEqual(a.map(x => x.severity), ["critical", "warning", "info"]);
});

test("summarizeAlerts counts by severity", () => {
  assert.equal(summarizeAlerts([]), "No alerts");
  const a = evaluateAlerts(inputs({
    upcomingDividends: [{ symbol: "AAPL", date: TODAY, amount: 5 }],
    dividendHistory: new Map([["ENB.TO", [{ year: 2024, total: 4 }, { year: 2025, total: 1 }]]]),
  }), allEnabled(), new Set());
  assert.equal(summarizeAlerts(a), "1 critical, 1 info");
});

test("daysUntil counts calendar days in UTC", () => {
  assert.equal(daysUntil("2026-09-08", "2026-09-08"), 0);
  assert.equal(daysUntil("2026-09-08", "2026-09-15"), 7);
  assert.equal(daysUntil("2026-09-08", "2026-09-01"), -7);
  assert.equal(daysUntil("2026-02-28", "2026-03-01"), 1, "2026 is not a leap year");
  assert.equal(daysUntil("2024-02-28", "2024-03-01"), 2, "2024 is");
});
