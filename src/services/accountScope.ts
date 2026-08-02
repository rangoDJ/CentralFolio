import { listPortfolios, getCachedAccounts, getActiveAccountIds } from "../models/db.js";

/**
 * Every active account across all portfolios, optionally narrowed to
 * `allowedIds`.
 *
 * Centralizes the portfolio → account walk and the active/allowed filtering
 * so each analytics service doesn't hand-roll its own copy of the same
 * triple-nested loop. The T5008 cost-base pooling bug happened because one
 * such copy applied the scope filter at the wrong layer (before ACB pooling
 * instead of after) — a single shared implementation doesn't prevent that
 * class of mistake by itself, but it does mean the *filtering* logic only
 * needs to be reasoned about once instead of independently in five services.
 */
export function getScopedAccounts(allowedIds?: Set<string> | null): any[] {
  const activeIds = getActiveAccountIds();
  const accounts: any[] = [];
  for (const portfolio of listPortfolios()) {
    for (const acct of getCachedAccounts(portfolio.id!)) {
      if (!activeIds.has(acct.id)) continue;
      if (allowedIds && !allowedIds.has(acct.id)) continue;
      accounts.push(acct);
    }
  }
  return accounts;
}
