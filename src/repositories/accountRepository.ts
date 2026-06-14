import { db } from "../models/database.js";
import { logger } from "../utils/logger.js";

// ── Prepared statements (compiled once at module load for performance) ─────────

const stmtGetAccounts = db.prepare(
  "SELECT * FROM accounts WHERE portfolioId = ?"
);

const stmtGetActiveAccountIds = db.prepare(
  "SELECT id FROM accounts WHERE isActive = 1"
);

const stmtSetAccountActive = db.prepare(
  "UPDATE accounts SET isActive = ? WHERE id = ?"
);

const stmtGetAccountActive = db.prepare(
  "SELECT isActive FROM accounts WHERE id = ?"
);

const stmtAccountBelongsToPortfolio = db.prepare(
  "SELECT id FROM accounts WHERE id = ? AND portfolioId = ?"
);

const stmtSetAccountCustomName = db.prepare(
  "UPDATE accounts SET customName = ? WHERE id = ?"
);

const stmtGetAccountsMeta = db.prepare(
  "SELECT id, isActive, customName FROM accounts WHERE portfolioId = ?"
);

const stmtDeleteAccounts = db.prepare(
  "DELETE FROM accounts WHERE portfolioId = ?"
);

const stmtInsertAccount = db.prepare(`
  INSERT INTO accounts (id, portfolioId, name, number, type, currency, isActive, balanceTotal, customName, cachedAt)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
`);

const stmtClearAccounts = db.prepare(
  "DELETE FROM accounts"
);

const stmtClearPositions = db.prepare(
  "DELETE FROM positions"
);

const stmtDeletePositionsForAccountsOfPortfolio = db.prepare(
  "DELETE FROM positions WHERE accountId IN (SELECT id FROM accounts WHERE portfolioId = ?)"
);

const stmtClearPositionsForAccount = db.prepare(
  "DELETE FROM positions WHERE accountId = ?"
);

const stmtGetPositions = db.prepare(
  "SELECT * FROM positions WHERE accountId = ?"
);

const stmtDeletePositions = db.prepare(
  "DELETE FROM positions WHERE accountId = ?"
);

const stmtInsertPosition = db.prepare(`
  INSERT INTO positions (accountId, symbol, symbolId, description, units, price, marketValue, cachedAt)
  VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
`);

// ── Accounts ──────────────────────────────────────────────────────────────────

export function getCachedAccounts(portfolioId: number | string): any[] {
  const rows = stmtGetAccounts.all(portfolioId) as any[];
  logger.debug('DB', `getCachedAccounts(portfolio=${portfolioId}) → ${rows.length} row(s)`);
  return rows.map(r => ({
    ...r,
    isActive: r.isActive === 1 || r.isActive === true,
    balance: r.balanceTotal != null
      ? { total: { amount: r.balanceTotal, currency: r.currency } }
      : undefined,
  }));
}

export function getActiveAccountIds(): Set<string> {
  const rows = stmtGetActiveAccountIds.all() as any[];
  const ids = new Set<string>(rows.map(r => r.id));
  logger.debug('DB', `getActiveAccountIds → ${ids.size} active account(s)`);
  return ids;
}

export function setAccountActive(accountId: string, isActive: boolean) {
  logger.info('DB', `setAccountActive(${accountId}) → ${isActive}`);
  stmtSetAccountActive.run(isActive ? 1 : 0, accountId);
}

export function getAccountActive(accountId: string): boolean | null {
  const row = stmtGetAccountActive.get(accountId) as any;
  if (!row) {
    logger.debug('DB', `getAccountActive(${accountId}) → null (account not found)`);
    return null;
  }
  const isActive = row.isActive === 1 || row.isActive === true;
  logger.debug('DB', `getAccountActive(${accountId}) → ${isActive}`);
  return isActive;
}

export function accountBelongsToPortfolio(accountId: string, portfolioId: number | string): boolean {
  const row = stmtAccountBelongsToPortfolio.get(accountId, String(portfolioId));
  return row != null;
}

export function setAccountCustomName(accountId: string, customName: string | null) {
  logger.info('DB', `setAccountCustomName(${accountId}) → "${customName}"`);
  stmtSetAccountCustomName.run(customName || null, accountId);
}

export function saveCachedAccounts(portfolioId: number | string, accounts: any[]) {
  logger.info('DB', `saveCachedAccounts(portfolio=${portfolioId}) — saving ${accounts.length} account(s)`);

  const existing = stmtGetAccountsMeta.all(portfolioId) as any[];
  const activeMap    = new Map<string, number>(existing.map(r => [r.id, r.isActive]));
  const customNameMap = new Map<string, string | null>(existing.map(r => [r.id, r.customName]));

  db.transaction((data: any[]) => {
    stmtDeleteAccounts.run(portfolioId);
    for (const acc of data) {
      stmtInsertAccount.run(
        acc.id,
        portfolioId,
        acc.name || null,
        acc.number || null,
        acc.type || null,
        acc.currency || null,
        activeMap.has(acc.id) ? activeMap.get(acc.id) : 1,
        acc.balance?.total?.amount ?? null,
        customNameMap.get(acc.id) ?? null
      );
    }
  })(accounts);
}

export function clearAccountCache() {
  stmtClearAccounts.run();
  stmtClearPositions.run();
}

export function clearAccountsForPortfolio(portfolioId: number | string) {
  db.transaction(() => {
    stmtDeletePositionsForAccountsOfPortfolio.run(String(portfolioId));
    stmtDeleteAccounts.run(String(portfolioId));
  })();
}

export function clearPositionsForAccount(accountId: string) {
  stmtClearPositionsForAccount.run(accountId);
}

// ── Positions ─────────────────────────────────────────────────────────────────

export function getCachedPositions(accountId: string): any[] {
  const rows = stmtGetPositions.all(accountId);
  logger.debug('DB', `getCachedPositions(account=${accountId}) → ${rows.length} position(s)`);
  return rows;
}

export function saveCachedPositions(accountId: string, positions: any[]) {
  logger.info('DB', `saveCachedPositions(account=${accountId}) — saving ${positions.length} position(s)`);

  db.transaction((data: any[]) => {
    stmtDeletePositions.run(accountId);
    if (data.length > 0) {
      logger.debug('DB', `saveCachedPositions — first pos keys: ${Object.keys(data[0]).join(', ')}`);
      logger.debug('DB', `saveCachedPositions — first pos raw: ${JSON.stringify(data[0]).slice(0, 400)}`);
    }
    for (const pos of data) {
      const symbol = pos.instrument?.symbol || pos.instrument?.raw_symbol
        || (pos.symbol as any)?.symbol?.symbol || pos.symbol?.symbol || pos.symbol;
      const symbolId = pos.instrument?.id || (pos.symbol as any)?.symbol?.id || null;
      const description = pos.instrument?.description
        || (pos.symbol as any)?.description || pos.description || symbol || 'Unknown Asset';
      logger.debug('DB', `  pos: symbol=${symbol} symbolId=${symbolId}`);

      stmtInsertPosition.run(
        accountId,
        symbol || null,
        symbolId || null,
        description || null,
        pos.units || 0,
        pos.price || 0,
        pos.marketValue || 0
      );
    }
  })(positions);
}
