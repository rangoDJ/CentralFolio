/**
 * Tax-loss harvesting — which taxable holdings sit at a loss, how much of this
 * year's realized gain each could offset, and which ones the superficial-loss
 * rule would deny.
 *
 * Every input already existed: realized gains by year, pooled ACB from the
 * T5008 replay, per-holding market value, and registered-vs-taxable account
 * classification. What was missing was the forward-looking view — the T5008
 * module answers "what did selling do to me", this answers "what would selling
 * do for me".
 *
 * Pure (no DB, no clock — `today` is passed in), so each rule is testable.
 *
 * Canadian rules, matching t5008.ts:
 *   - Capital losses offset capital gains at a 50% inclusion rate.
 *   - A loss is superficial if identical property is acquired in the 61-day
 *     window (30 days either side of the sale) AND still held at the end of it.
 *   - Acquisitions by an affiliated person count, and that includes your own
 *     registered accounts. A repurchase inside an RRSP or TFSA does not merely
 *     defer the loss — it is denied permanently, with no ACB adjustment to
 *     recover it. That is the worst case here, so it is called out separately.
 */

export const INCLUSION_RATE = 0.5;
export const SUPERFICIAL_WINDOW_DAYS = 30;

export interface HarvestHolding {
  symbol: string;
  poolKey: string;
  /** Where it is held, for display. Non-registered only — callers filter. */
  accountLabel: string;
  units: number;
  /** Current market value in CAD. */
  marketValue: number;
  /** Pooled adjusted cost base in CAD for those units. */
  acb: number;
}

/** An acquisition inside the lookback window, from ANY account. */
export interface RecentAcquisition {
  poolKey: string;
  date: string;          // 'YYYY-MM-DD'
  units: number;
  /** True when it happened in an RRSP/TFSA/RESP/FHSA — a permanent denial. */
  registered: boolean;
  accountLabel: string;
  /** True for DRIP/REINVEST, which will keep happening on its own. */
  automatic: boolean;
}

export type SuperficialRisk = "none" | "at_risk" | "denied_permanently";

export interface HarvestCandidate {
  symbol: string;
  poolKey: string;
  accountLabel: string;
  units: number;
  marketValue: number;
  acb: number;
  /** Positive number: how far under water the position is, in CAD. */
  unrealizedLoss: number;
  /** How much of the realized gain this loss would actually neutralize. */
  offsetApplied: number;
  risk: SuperficialRisk;
  riskReason: string | null;
  /** Repurchasing before this date would taint the loss. */
  repurchaseAfter: string;
}

export interface HarvestPlan {
  /** Net realized capital gain so far this year, in CAD. Negative = already at a loss. */
  realizedGainYtd: number;
  /** Total unrealized loss available across taxable accounts. */
  harvestableLoss: number;
  /** Of that, how much offsets this year's gain (the rest carries over). */
  offsetTotal: number;
  /** Loss beyond this year's gain — carries back 3 years or forward indefinitely. */
  residualLoss: number;
  /** offsetTotal x the 50% inclusion rate: the reduction in taxable income. */
  taxableIncomeReduction: number;
  /** Only present when the caller supplied a marginal rate. */
  estimatedTaxSaving: number | null;
  candidates: HarvestCandidate[];
  warnings: string[];
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** ISO date `days` after `iso`, in UTC. */
export function addDays(iso: string, days: number): string {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Classify what the superficial-loss rule would do to a sale made today.
 *
 * Only the *backward* half of the window can be known now — whether you buy
 * again in the next 30 days is your choice, which is why every candidate also
 * carries a `repurchaseAfter` date. An automatic reinvestment (DRIP) is the
 * trap worth naming: it will fire on its own inside the window without any
 * decision from you.
 */
function assessRisk(
  poolKey: string,
  today: string,
  acquisitions: RecentAcquisition[],
): { risk: SuperficialRisk; reason: string | null } {
  const windowStart = addDays(today, -SUPERFICIAL_WINDOW_DAYS);
  const recent = acquisitions.filter(
    a => a.poolKey === poolKey && a.date >= windowStart && a.date <= today,
  );
  if (recent.length === 0) return { risk: "none", reason: null };

  const registered = recent.filter(a => a.registered);
  if (registered.length > 0) {
    const where = Array.from(new Set(registered.map(a => a.accountLabel))).join(", ");
    return {
      risk: "denied_permanently",
      reason: `Bought in ${where} on ${registered[registered.length - 1].date}. `
        + `A repurchase inside a registered account denies the loss outright — it is not added `
        + `back to the cost base, so it is never recovered.`,
    };
  }

  const automatic = recent.filter(a => a.automatic);
  const units = round2(recent.reduce((sum, a) => sum + a.units, 0));
  return {
    risk: "at_risk",
    reason: automatic.length > 0
      ? `${units} unit(s) reinvested automatically (DRIP) since ${windowStart}. `
        + `Turn the reinvestment off before selling, or the loss will be denied.`
      : `${units} unit(s) bought since ${windowStart}, inside the 30-day window. `
        + `That portion of the loss would be denied and added to the cost base instead.`,
  };
}

/**
 * Build the harvest plan.
 *
 * Candidates are ordered by how much of the realized gain each one neutralizes,
 * so the shortest useful list is at the top — and losses that would be denied
 * outright sort last regardless of size, because acting on them achieves
 * nothing.
 */
export function planHarvest(
  holdings: HarvestHolding[],
  realizedGainYtd: number,
  acquisitions: RecentAcquisition[],
  today: string,
  marginalRatePct: number | null = null,
): HarvestPlan {
  const warnings: string[] = [];

  const losers = holdings
    .filter(h => h.marketValue < h.acb)
    .map(h => {
      const { risk, reason } = assessRisk(h.poolKey, today, acquisitions);
      return {
        symbol: h.symbol,
        poolKey: h.poolKey,
        accountLabel: h.accountLabel,
        units: h.units,
        marketValue: round2(h.marketValue),
        acb: round2(h.acb),
        unrealizedLoss: round2(h.acb - h.marketValue),
        offsetApplied: 0,
        risk,
        riskReason: reason,
        repurchaseAfter: addDays(today, SUPERFICIAL_WINDOW_DAYS),
      } as HarvestCandidate;
    });

  // Usable losses first, largest first; permanently-denied ones last.
  const rank: Record<SuperficialRisk, number> = { none: 0, at_risk: 1, denied_permanently: 2 };
  losers.sort((a, b) => rank[a.risk] - rank[b.risk] || b.unrealizedLoss - a.unrealizedLoss);

  // Apply losses against the gain in that order. Only losses that are actually
  // usable are applied — a permanently denied one offsets nothing.
  let remainingGain = Math.max(0, realizedGainYtd);
  for (const c of losers) {
    if (c.risk === "denied_permanently") continue;
    if (remainingGain <= 0) break;
    const applied = Math.min(c.unrealizedLoss, remainingGain);
    c.offsetApplied = round2(applied);
    remainingGain = round2(remainingGain - applied);
  }

  const usable = losers.filter(c => c.risk !== "denied_permanently");
  const harvestableLoss = round2(usable.reduce((sum, c) => sum + c.unrealizedLoss, 0));
  const offsetTotal = round2(losers.reduce((sum, c) => sum + c.offsetApplied, 0));
  const residualLoss = round2(harvestableLoss - offsetTotal);
  const taxableIncomeReduction = round2(offsetTotal * INCLUSION_RATE);

  if (realizedGainYtd <= 0 && harvestableLoss > 0) {
    warnings.push(
      `No net realized capital gain this year, so harvesting now offsets nothing immediately. `
      + `A net capital loss can be carried back against the previous three years' gains or `
      + `forward indefinitely, which may still be worth doing.`,
    );
  }
  const denied = losers.filter(c => c.risk === "denied_permanently");
  if (denied.length > 0) {
    warnings.push(
      `${denied.length} holding(s) were repurchased inside a registered account within 30 days. `
      + `Selling them at a loss now would forfeit the loss permanently.`,
    );
  }
  const atRisk = losers.filter(c => c.risk === "at_risk");
  if (atRisk.length > 0) {
    warnings.push(
      `${atRisk.length} holding(s) were bought within the last 30 days, so part of the loss would `
      + `be denied and rolled into the cost base rather than claimed now.`,
    );
  }

  return {
    realizedGainYtd: round2(realizedGainYtd),
    harvestableLoss,
    offsetTotal,
    residualLoss,
    taxableIncomeReduction,
    estimatedTaxSaving:
      marginalRatePct != null && marginalRatePct > 0
        ? round2(taxableIncomeReduction * (marginalRatePct / 100))
        : null,
    candidates: losers,
    warnings,
  };
}
