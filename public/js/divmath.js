/**
 * Pure dividend/position math — no DOM, no globals. Single source of truth for
 * the numbers users rely on, so it can be unit-tested directly (see
 * src/divmath.test.ts). Exposed as `window.DivMath` in the browser and via
 * module.exports for tests.
 */
(function (root, factory) {
    const mod = factory();
    if (typeof module !== 'undefined' && module.exports) module.exports = mod;
    else root.DivMath = mod;
})(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    const DEFAULT_DIV_TYPES = ['DIVIDEND', 'DIV', 'DISTRIBUTION'];
    const norm = s => String(s || '').toUpperCase().trim();
    const baseSym = s => { const u = norm(s); const i = u.lastIndexOf('.'); return i > 0 ? u.slice(0, i) : u; };

    // Build accountId → symbolKey → sorted [rec] index of dividend transactions.
    // Each rec is shared across the symbol and base-symbol keys so marking it
    // `used` removes it from both.
    function buildDivIndex(txData, TYPES) {
        const index = new Map();
        (txData || []).forEach(acct => {
            (acct.transactions || []).forEach(txn => {
                if (!TYPES.includes(norm(txn.type))) return;
                if (!txn.symbol || !txn.date) return;
                const rec = {
                    t: new Date(txn.date).getTime(),
                    amount: Math.abs(txn.amount || 0),
                    used: false,
                    symbol: norm(txn.symbol),
                    accountId: acct.accountId,
                    name: txn.description || txn.symbol,
                    units: txn.units || 0,
                };
                const accMap = index.get(acct.accountId) || new Map();
                for (const key of new Set([norm(txn.symbol), baseSym(txn.symbol)])) {
                    const list = accMap.get(key) || [];
                    list.push(rec); // same rec object under both keys
                    accMap.set(key, list);
                }
                index.set(acct.accountId, accMap);
            });
        });
        index.forEach(accMap => accMap.forEach(list => list.sort((a, b) => a.t - b.t)));
        return index;
    }

    // Tag each forecast event with `_status` ('received'|'expected'|'overdue')
    // by claiming the nearest unused dividend transaction in the same
    // account+symbol within a frequency-aware tolerance. Mutates events + index.
    function tagEventsWithIndex(events, index) {
        const todayTs = (() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); })();
        const DAY = 86400000;
        const ordered = [...events].sort((a, b) => new Date(a.date) - new Date(b.date));
        ordered.forEach(e => {
            const evTs = new Date(e.date).getTime();
            const freq = e.frequency || 4;
            const tolDays = Math.min(30, (365 / freq) * 0.45);
            const accMap = index.get(e.accountId);
            const list = accMap && (accMap.get(norm(e.symbol)) || accMap.get(baseSym(e.symbol)));

            let match = null, bestDelta = Infinity;
            if (list) {
                for (const rec of list) {
                    if (rec.used) continue;
                    const delta = Math.abs(rec.t - evTs);
                    if (delta <= tolDays * DAY && delta < bestDelta) { bestDelta = delta; match = rec; }
                }
            }

            if (match) {
                match.used = true;
                e._status = 'received';
                e._recvAmount = match.amount;
                e._recvDate = new Date(match.t).toLocaleDateString('en-CA');
            } else {
                e._status = evTs >= todayTs ? 'expected' : 'overdue';
            }
        });
        return events;
    }

    function tagDividendStatus(events, txData, divTypes) {
        return tagEventsWithIndex(events, buildDivIndex(txData, divTypes || DEFAULT_DIV_TYPES));
    }

    // Tag `events` (forecast) AND return historical "received" events built from
    // the dividend transactions that did NOT match any forecast event, within the
    // last `monthsBack` months. This backfills the calendar with actual past
    // payouts without double-counting ones already shown as matched forecasts.
    function collectReceivedDividends(events, txData, opts) {
        opts = opts || {};
        const TYPES = opts.divTypes || DEFAULT_DIV_TYPES;
        const monthsBack = opts.monthsBack || 6;
        const index = buildDivIndex(txData, TYPES);
        tagEventsWithIndex(events, index); // marks matched recs used

        const cut = new Date(); cut.setMonth(cut.getMonth() - monthsBack); cut.setHours(0, 0, 0, 0);
        const cutoff = cut.getTime();
        const nowTs = Date.now();

        const seen = new Set();
        const received = [];
        index.forEach((accMap, accountId) => accMap.forEach(list => list.forEach(rec => {
            if (rec.used || seen.has(rec)) return;
            if (rec.t < cutoff || rec.t > nowTs + 86400000) return; // window: last N months .. today
            seen.add(rec);
            received.push({
                symbol: rec.symbol,
                name: rec.name,
                date: new Date(rec.t).toISOString(),
                amount: rec.amount,
                units: rec.units,
                accountId,
                _status: 'received',
                _recvAmount: rec.amount,
                _recvDate: new Date(rec.t).toLocaleDateString('en-CA'),
                _fromTxn: true,
            });
        })));
        return received;
    }

    // Build the per-account "My positions" breakdown for a symbol.
    // ctx: { holdings, txData, groups, inactiveIds (Set|Array), divTypes }
    function buildStockPositions(symbol, ctx) {
        ctx = ctx || {};
        const TYPES = ctx.divTypes || DEFAULT_DIV_TYPES;
        const want = norm(symbol);
        const inactive = ctx.inactiveIds;
        const isInactive = id => inactive
            ? (typeof inactive.has === 'function' ? inactive.has(id) : Array.isArray(inactive) && inactive.includes(id))
            : false;
        const symOf = h => norm(h.symbol?.symbol?.symbol || h.symbol?.symbol || h.symbol);

        // Dividends received per account for this symbol.
        const divByAccount = new Map();
        (ctx.txData || []).forEach(acct => {
            (acct.transactions || []).forEach(t => {
                if (!TYPES.includes(norm(t.type))) return;
                if (norm(t.symbol) !== want) return;
                divByAccount.set(acct.accountId, (divByAccount.get(acct.accountId) || 0) + Math.abs(t.amount || 0));
            });
        });

        // Per-account totals (for "% in portfolio").
        const acctTotal = new Map();
        (ctx.groups || []).forEach(g => (g.accounts || []).forEach(a => {
            if (!isInactive(a.id)) acctTotal.set(a.id, a.balance?.total?.amount || 0);
        }));

        const rows = [];
        (ctx.holdings || []).forEach(acct => {
            if (isInactive(acct.accountId)) return;
            (acct.holdings || []).forEach(h => {
                if (symOf(h) !== want) return;
                const units = h.units || 0;
                const price = h.price || 0;
                const value = h.marketValue || (units * price) || 0;
                const avgCost = h.average_purchase_price || 0;
                const cost = avgCost > 0 ? avgCost * units : value;
                const capitalGain = value - cost;
                const dividends = divByAccount.get(acct.accountId) || 0;
                const profit = capitalGain + dividends;
                const portTotal = acctTotal.get(acct.accountId) || 0;
                rows.push({
                    accountId: acct.accountId,
                    accountName: acct.accountName,
                    currency: h.currency || 'CAD',
                    units, price, value, avgCost, cost,
                    capitalGain,
                    capitalGainPct: cost > 0 ? (capitalGain / cost) * 100 : 0,
                    dividends,
                    profit,
                    profitPct: cost > 0 ? (profit / cost) * 100 : 0,
                    pctInPortfolio: portTotal > 0 ? (value / portTotal) * 100 : 0,
                });
            });
        });

        const sum = (k) => rows.reduce((s, r) => s + (r[k] || 0), 0);
        const tUnits = sum('units'), tValue = sum('value'), tCost = sum('cost');
        const tCap = tValue - tCost, tDiv = sum('dividends'), tProfit = tCap + tDiv;
        const total = rows.length ? {
            accountName: `${rows.length} ${rows.length === 1 ? 'account' : 'accounts'}`,
            currency: rows[0].currency,
            units: tUnits,
            avgCost: tUnits > 0 ? tCost / tUnits : 0,
            value: tValue, cost: tCost,
            capitalGain: tCap, capitalGainPct: tCost > 0 ? (tCap / tCost) * 100 : 0,
            dividends: tDiv,
            profit: tProfit, profitPct: tCost > 0 ? (tProfit / tCost) * 100 : 0,
        } : null;

        return { rows, total };
    }

    return { tagDividendStatus, collectReceivedDividends, buildStockPositions };
});
