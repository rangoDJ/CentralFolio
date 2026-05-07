import { db } from "../models/database.js";
import { logger } from "../utils/logger.js";

// ── Accounts ──────────────────────────────────────────────────────────────────

export function getCachedAccounts(portfolioId: number | string): any[] {
  const rows = db.prepare("SELECT * FROM accounts WHERE portfolioId = ?").all(portfolioId) as any[];
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
  const rows = db.prepare("SELECT id FROM accounts WHERE isActive = 1").all() as any[];
  const ids = new Set<string>(rows.map(r => r.id));
  logger.debug('DB', `getActiveAccountIds → ${ids.size} active account(s)`);
  return ids;
}

export function setAccountActive(accountId: string, isActive: boolean) {
  logger.info('DB', `setAccountActive(${accountId}) → ${isActive}`);
  db.prepare("UPDATE accounts SET isActive = ? WHERE id = ?").run(isActive ? 1 : 0, accountId);
}

export function getAccountActive(accountId: string): boolean | null {
  const row = db.prepare("SELECT isActive FROM accounts WHERE id = ?").get(accountId) as any;
  if (!row) {
    logger.debug('DB', `getAccountActive(${accountId}) → null (account not found)`);
    return null;
  }
  const isActive = row.isActive === 1 || row.isActive === true;
  logger.debug('DB', `getAccountActive(${accountId}) → ${isActive}`);
  return isActive;
}

export function accountBelongsToPortfolio(accountId: string, portfolioId: number | string): boolean {
  const row = db.prepare("SELECT id FROM accounts WHERE id = ? AND portfolioId = ?").get(accountId, String(portfolioId));
  return row != null;
}

export function setAccountCustomName(accountId: string, customName: string | null) {
  logger.info('DB', `setAccountCustomName(${accountId}) → "${customName}"`);
  db.prepare("UPDATE accounts SET customName = ? WHERE id = ?").run(customName || null, accountId);
}

export function saveCachedAccounts(portfolioId: number | string, accounts: any[]) {
  logger.info('DB', `saveCachedAccounts(portfolio=${portfolioId}) — saving ${accounts.length} account(s)`);

  const existing = db.prepare("SELECT id, isActive, customName FROM accounts WHERE portfolioId = ?").all(portfolioId) as any[];
  const activeMap    = new Map<string, number>(existing.map(r => [r.id, r.isActive]));
  const customNameMap = new Map<string, string | null>(existing.map(r => [r.id, r.customName]));

  const deleteStmt = db.prepare("DELETE FROM accounts WHERE portfolioId = ?");
  const insertStmt = db.prepare(`
    INSERT INTO accounts (id, portfolioId, name, number, type, currency, isActive, balanceTotal, customName, cachedAt)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
  `);

  db.transaction((data: any[]) => {
    deleteStmt.run(portfolioId);
    for (const acc of data) {
      insertStmt.run(
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
  db.prepare("DELETE FROM accounts").run();
  db.prepare("DELETE FROM positions").run();
}

export function clearAccountsForPortfolio(portfolioId: number | string) {
  db.transaction(() => {
    db.prepare("DELETE FROM positions WHERE accountId IN (SELECT id FROM accounts WHERE portfolioId = ?)").run(String(portfolioId));
    db.prepare("DELETE FROM accounts WHERE portfolioId = ?").run(String(portfolioId));
  })();
}

export function clearPositionsForAccount(accountId: string) {
  db.prepare("DELETE FROM positions WHERE accountId = ?").run(accountId);
}

// ── Positions ─────────────────────────────────────────────────────────────────

export function getCachedPositions(accountId: string): any[] {
  const rows = db.prepare("SELECT * FROM positions WHERE accountId = ?").all(accountId);
  logger.debug('DB', `getCachedPositions(account=${accountId}) → ${rows.length} position(s)`);
  return rows;
}

export function saveCachedPositions(accountId: string, positions: any[]) {
  logger.info('DB', `saveCachedPositions(account=${accountId}) — saving ${positions.length} position(s)`);

  const deleteStmt = db.prepare("DELETE FROM positions WHERE accountId = ?");
  const insertStmt = db.prepare(`
    INSERT INTO positions (accountId, symbol, symbolId, description, units, price, marketValue, cachedAt)
    VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
  `);

  db.transaction((data: any[]) => {
    deleteStmt.run(accountId);
    if (data.length > 0) {
      logger.info('DB', `saveCachedPositions — first pos keys: ${Object.keys(data[0]).join(', ')}`);
      logger.info('DB', `saveCachedPositions — first pos raw: ${JSON.stringify(data[0]).slice(0, 400)}`);
    }
    for (const pos of data) {
      const symbol = pos.instrument?.symbol || pos.instrument?.raw_symbol
        || (pos.symbol as any)?.symbol?.symbol || pos.symbol?.symbol || pos.symbol;
      const symbolId = pos.instrument?.id || (pos.symbol as any)?.symbol?.id || null;
      const description = pos.instrument?.description
        || (pos.symbol as any)?.description || pos.description;
      logger.info('DB', `  pos: symbol=${symbol} symbolId=${symbolId}`);

      insertStmt.run(
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
