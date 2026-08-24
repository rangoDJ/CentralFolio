/**
 * UI rendering for CentralFolio — Wealthsimple-style theme
 *
 * `sanitize()` now lives in format.js (loaded first) as a shared global.
 */

function findAccountInGroups(groups, aid) {
    for (const g of groups) {
        for (const a of (g.accounts || [])) {
            if (a.id === aid) return a;
        }
    }
    return null;
}

const UI = {
    portfolioList:    document.getElementById('portfolioList'),
    accountContainer: document.getElementById('accountContainer'),
    portfolioModal:   document.getElementById('portfolioModal'),
    portfolioForm:    document.getElementById('portfolioForm'),
    modalTitle:       document.getElementById('modalTitle'),
    totalBalanceEl:   document.getElementById('totalBalance'),
    portfolioCountEl: document.getElementById('portfolioCount'),
    toast:            document.getElementById('toast'),
    adminUserList:    document.getElementById('adminUserList'),

    accountsChartInstance: null,
    dividendChartInstance: null,
    dashDividendChartInstance: null,

    getChartTheme() {
        if (typeof document === 'undefined') return { textColor: '#7c8496', gridColor: 'rgba(255,255,255,0.06)', tooltipBg: '#1e2640', tooltipBorder: 'rgba(255,255,255,0.08)' };
        const style = getComputedStyle(document.documentElement);
        const textMuted = style.getPropertyValue('--text-muted').trim() || '#7c8496';
        const border = style.getPropertyValue('--border').trim() || 'rgba(255,255,255,0.06)';
        const surface2 = style.getPropertyValue('--surface-2').trim() || '#1e2640';
        return {
            textColor: textMuted,
            gridColor: border,
            tooltipBg: surface2,
            tooltipBorder: border
        };
    },

    showToast(msg, type = 'success') {
        this.toast.textContent = msg;
        this.toast.className = `toast visible ${type}`;
        clearTimeout(this._toastTimer);
        this._toastTimer = setTimeout(() => this.toast.classList.remove('visible'), 4000);
    },

    // ── Watchlist / dividend screener ──────────────────────────────────────────
    _wlRows: [],
    _wlSort: { key: 'symbol', dir: 1 },

    sortWatchlist(key) {
        if (this._wlSort.key === key) this._wlSort.dir *= -1;
        else this._wlSort = { key, dir: 1 };
        this.renderWatchlist(this._wlRows);
    },

    renderWatchlist(rows) {
        this._wlRows = rows || [];
        const container = document.getElementById('watchlist-content');
        if (!container) return;
        if (this._wlRows.length === 0) {
            container.innerHTML = '<div class="empty-state">No symbols match. Add a ticker above to start your watchlist.</div>';
            return;
        }

        const { key, dir } = this._wlSort;
        const sorted = [...this._wlRows].sort((a, b) => {
            const av = a[key], bv = b[key];
            if (av == null && bv == null) return 0;
            if (av == null) return 1;            // nulls always sort last
            if (bv == null) return -1;
            if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * dir;
            return String(av).localeCompare(String(bv)) * dir;
        });

        const num = (v, dp = 2) => (v == null || isNaN(v)) ? '—' : Number(v).toLocaleString(undefined, { minimumFractionDigits: dp, maximumFractionDigits: dp });
        const pct = (v, dp = 1) => (v == null || isNaN(v)) ? '—' : `${Number(v).toFixed(dp)}%`;
        const ratingColors = { 1: '#16c784', 2: '#2dce89', 3: '#f5a623', 4: '#f76b1c', 5: '#ea3943' };
        const dgrCell = (v) => {
            if (v == null || isNaN(v)) return '<span class="text-muted">—</span>';
            const color = v >= 0 ? 'var(--primary)' : 'var(--danger)';
            return `<span style="color:${color};font-weight:600;">${v >= 0 ? '+' : ''}${Number(v).toFixed(1)}%</span>`;
        };
        const streakCell = (n) => n > 0
            ? `<span title="${n} consecutive year(s) of non-decreasing dividends">🔥 ${n}y</span>`
            : '<span class="text-muted">—</span>';
        const ratingCell = (r) => r.ratingLabel
            ? `<span style="font-size:0.72rem;font-weight:600;padding:0.1rem 0.45rem;border-radius:999px;background:${ratingColors[r.ratingScore] || 'var(--surface-2)'}22;color:${ratingColors[r.ratingScore] || 'var(--text-muted)'};">${sanitize(r.ratingLabel)}</span>`
            : '<span class="text-muted text-sm">—</span>';

        const arrow = (k) => key === k ? (dir === 1 ? ' ▲' : ' ▼') : '';
        const th = (k, label, align = 'left') =>
            `<th style="text-align:${align};cursor:pointer;user-select:none;white-space:nowrap;" onclick="UI.sortWatchlist('${k}')">${label}${arrow(k)}</th>`;

        const body = sorted.map(r => `
            <tr>
                <td><span class="stock-link" data-stock="${sanitize(r.symbol)}" style="font-weight:600;cursor:pointer;">${sanitize(r.symbol)}</span></td>
                <td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${sanitize(r.name || '')}">${sanitize(r.name || '—')}</td>
                <td class="text-muted">${sanitize(r.sector || '—')}</td>
                <td style="text-align:right;">${num(r.price)}</td>
                <td style="text-align:right;font-weight:600;">${pct(r.yieldPct)}</td>
                <td style="text-align:right;">${dgrCell(r.dgr5yPct)}</td>
                <td style="text-align:center;">${streakCell(r.growthStreakYears)}</td>
                <td style="text-align:center;">${ratingCell(r)}</td>
                <td style="text-align:right;">
                    <button class="btn btn-outline btn-sm" title="Remove from watchlist"
                        onclick="App.removeWatchlistSymbol('${sanitize(r.symbol)}')"
                        style="padding:0.15rem 0.5rem;line-height:1;">&times;</button>
                </td>
            </tr>`).join('');

        container.innerHTML = `
            <div class="card" style="overflow-x:auto;">
                <table class="data-table watchlist-table" style="width:100%;">
                    <thead><tr>
                        ${th('symbol', 'Symbol')}
                        ${th('name', 'Name')}
                        ${th('sector', 'Sector')}
                        ${th('price', 'Price', 'right')}
                        ${th('yieldPct', 'Yield', 'right')}
                        ${th('dgr5yPct', 'DGR', 'right')}
                        ${th('growthStreakYears', 'Streak', 'center')}
                        ${th('ratingScore', 'Rating', 'center')}
                        <th></th>
                    </tr></thead>
                    <tbody>${body}</tbody>
                </table>
                <p class="text-muted" style="font-size:0.72rem;margin-top:0.75rem;">Yield = trailing-12-month dividends ÷ latest close. DGR = compound annual growth of yearly dividends (best of 5y/3y/1y). Data from Yahoo; may lag or be missing for some listings.</p>
            </div>`;
    },

    openModal(portfolio = null) {
        if (portfolio) {
            this.modalTitle.textContent = 'Edit Portfolio';
            document.getElementById('portId').value       = portfolio.id;
            document.getElementById('portName').value     = portfolio.name;
            document.getElementById('clientId').value     = portfolio.clientId;
            document.getElementById('consumerKey').value  = portfolio.consumerKey;
            document.getElementById('userId').value       = portfolio.userId;
            document.getElementById('userSecret').value   = portfolio.userSecret || '';
        } else {
            this.modalTitle.textContent = 'Add Portfolio';
            this.portfolioForm.reset();
            document.getElementById('portId').value = '';
        }
        this.portfolioModal.classList.add('open');
    },

    closeModal() {
        this.portfolioModal.classList.remove('open');
    },

    renderPortfolios(portfolios) {
        const list = document.getElementById('portfolioList');
        if (!list) return;

        if (portfolios.length === 0) {
            list.innerHTML = '<div class="empty-state" style="padding:1rem;"><p>No portfolios added yet.</p></div>';
            return;
        }

        list.innerHTML = portfolios.map(p => `
            <div class="portfolio-item">
                <div class="portfolio-item-top">
                    <div>
                        <div class="portfolio-item-name">
                            ${sanitize(p.name)}
                            ${p.registered
                                ? '<span class="status-badge status-active" style="font-size:0.65rem;padding:0.15rem 0.55rem;">Registered</span>'
                                : '<span class="status-badge status-inactive" style="font-size:0.65rem;padding:0.15rem 0.55rem;">Not registered</span>'}
                            <span id="conn-badge-${p.id}" style="font-size:0.65rem;padding:0.15rem 0.55rem;margin-left:0.25rem;"></span>
                        </div>
                        <div class="portfolio-item-meta">userId: ${sanitize(p.userId)}</div>
                    </div>
                    <div class="portfolio-item-actions">
                        <button class="btn btn-outline btn-sm" onclick="App.editPortfolio(${p.id})">Edit</button>
                        <button class="btn btn-danger btn-sm" title="Delete" onclick="App.deletePortfolio(${p.id})">&times;</button>
                    </div>
                </div>
                <div class="settings-row" style="padding:0.6rem 0;border-top:1px solid var(--border);margin-top:0.5rem;">
                    <div class="settings-row-info">
                        <div class="settings-row-label" style="font-size:0.85rem;">Enable Trading</div>
                        <div class="settings-row-desc" style="font-size:0.75rem;">Allow buy/sell orders through this portfolio</div>
                    </div>
                    <label class="switch">
                        <input type="checkbox" ${p.tradingEnabled ? 'checked' : ''}
                               onchange="App.togglePortfolioTrading(${p.id}, this.checked)">
                        <span class="slider"></span>
                    </label>
                </div>
                ${p.tradingEnabled && p.registered
                    ? `<button class="btn btn-outline btn-sm w-full" style="margin-bottom:0.4rem;" onclick="App.reconnectForTrading(${p.id}, this)">
                           <span class="loader"></span><span class="btn-text">Reconnect with Trade Permissions</span>
                       </button>`
                    : ''}
                ${!p.registered
                    ? `<button class="btn btn-primary btn-sm w-full" onclick="App.registerPortfolio(${p.id}, this)">
                           <span class="loader"></span><span class="btn-text">Register with SnapTrade</span>
                       </button>`
                    : `<button class="btn btn-outline btn-sm w-full" onclick="App.connectBrokerage(${p.id}, this)">
                           <span class="loader"></span><span class="btn-text">Connect Brokerage</span>
                       </button>`}
            </div>
        `).join('');

        // Load connection type badge for each registered portfolio
        portfolios.filter(p => p.registered).forEach(p => App.loadConnectionBadge(p.id, !!p.tradingEnabled));
    },

    /** Format a SQLite UTC timestamp ("YYYY-MM-DD HH:MM:SS") as a local "YYYY-MM-DD HH:MM" string. */
    formatLastSync(ts) {
        if (!ts) return 'Never synced';
        const d = new Date(String(ts).replace(' ', 'T') + (String(ts).includes('Z') ? '' : 'Z'));
        if (isNaN(d.getTime())) return 'Never synced';
        const pad = n => String(n).padStart(2, '0');
        return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
    },

    renderAccountSection(currentGroups, activePortfolioId, inactiveAccountIds) {
        // Keep the dashboard widgets fed regardless of how the connections list renders.
        let grandTotal = 0;
        currentGroups.forEach(g => (g.accounts || []).forEach(acc => {
            if (!inactiveAccountIds.has(acc.id)) grandTotal += (acc.balance?.total?.amount || 0);
        }));
        if (this.totalBalanceEl) {
            this.totalBalanceEl.textContent = `$${grandTotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
        }
        this.renderDashboardChart(currentGroups, inactiveAccountIds);
        this.renderDashboardHoldingsTable(currentGroups, inactiveAccountIds);

        // Populate the "Add new account" menu with registered connections.
        this.renderAddAccountMenu(App.activePortfolios || []);

        const container = this.accountContainer;
        if (!container) return;

        const userPortfolios = (typeof App !== 'undefined' && App.userPortfolios) ? App.userPortfolios : [];

        // Flatten every brokerage account across all connections into Snowball-style link cards.
        const cards = [];
        currentGroups.forEach(g => {
            if (g.error) {
                cards.push(`<div class="conn-card conn-card-error">
                    <div class="conn-error-text">⚠ ${sanitize(g.portfolioName)}: ${sanitize(g.error)}</div>
                </div>`);
                return;
            }
            (g.accounts || []).forEach(acc => {
                cards.push(this.renderConnectionCard(g, acc, inactiveAccountIds.has(acc.id), userPortfolios));
            });
        });

        if (cards.length === 0) {
            container.innerHTML = `<div class="empty-state">
                <div class="empty-icon">🔌</div>
                <p><strong>No brokerage accounts connected.</strong></p>
                <p style="margin-top:0.5rem;color:var(--text-secondary);">Use <strong>Add new account</strong> above to link a brokerage, or add a connection under
                    <a href="#" onclick="App.switchSettingsTab('keys');return false;" style="color:var(--primary);text-decoration:underline;">Keys &amp; Providers</a>.</p>
            </div>`;
            return;
        }

        container.innerHTML = `<div class="conn-list">${cards.join('')}</div>`;
    },

    renderConnectionCard(group, acc, inactive, userPortfolios) {
        const displayName = acc.customName || acc.name || 'Unnamed Account';
        const brokerage   = acc.brokerage?.name || acc.institution_name || 'Wealthsimple Trade';
        const balance     = acc.balance?.total?.amount;
        const lastSync     = this.formatLastSync(acc.lastPositionsFetch || acc.cachedAt);

        // Which custom portfolio(s) this account is grouped into.
        const assigned = userPortfolios.filter(up => (up.accountIds || []).includes(acc.id));
        let portfolioTitle, portfolioSub, dotColor;
        if (assigned.length > 0) {
            dotColor       = assigned[0].color || 'var(--primary)';
            portfolioTitle = assigned.map(p => sanitize(p.name)).join(', ');
            portfolioSub   = sanitize(group.portfolioName);
        } else {
            dotColor       = 'var(--text-muted)';
            portfolioTitle = '<span style="color:var(--text-muted);font-style:italic;">Unassigned</span>';
            portfolioSub   = sanitize(group.portfolioName);
        }

        return `
        <div class="conn-card${inactive ? ' conn-card-inactive' : ''}" data-account="${acc.id}">
            <div class="conn-grid">
                <!-- Account side -->
                <div class="conn-box">
                    <div class="conn-box-label">Account:</div>
                    <div class="conn-box-body">
                        <div class="conn-icon">
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/></svg>
                        </div>
                        <div class="conn-box-text" id="acc-name-${acc.id}">
                            <div class="conn-box-title">${sanitize(displayName)}</div>
                            <div class="conn-box-sub">${sanitize(brokerage)} (Sync via SnapTrade)</div>
                        </div>
                    </div>
                </div>

                <!-- Link / disconnect -->
                <div class="conn-link">
                    <div class="conn-link-icon" title="Linked">
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
                    </div>
                    <button class="conn-disconnect" onclick="App.disconnectAccount('${acc.id}')">${inactive ? 'Reconnect' : 'Disconnect'}</button>
                </div>

                <!-- Portfolio side -->
                <div class="conn-box">
                    <div class="conn-box-label">Portfolio:</div>
                    <div class="conn-box-body">
                        <div class="conn-icon"><span class="conn-dot" style="background:${dotColor};"></span>
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 7h-3V5a2 2 0 0 0-2-2H9a2 2 0 0 0-2 2v2H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2z"/><path d="M9 7V5h6v2"/></svg>
                        </div>
                        <div class="conn-box-text">
                            <div class="conn-box-title">${portfolioTitle}</div>
                            <div class="conn-box-sub">${portfolioSub}</div>
                        </div>
                    </div>
                </div>
            </div>

            <!-- Footer -->
            <div class="conn-footer">
                <div class="conn-sync-meta">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="7" r="4"/><path d="M3 21v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2"/></svg>
                    <span>Last sync: ${lastSync}</span>
                    ${balance !== undefined ? `<span class="conn-balance">· $${(balance || 0).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}</span>` : ''}
                </div>
                <div class="conn-actions">
                    <button class="btn btn-outline btn-sm conn-sync-btn" onclick="App.syncAccountNow(${group.portfolioId}, '${acc.id}', this)">
                        <span class="loader"></span>
                        <span class="btn-text">
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;margin-right:3px;"><path d="M23 4v6h-6"/><path d="M1 20v-6h6"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
                            Sync now
                        </span>
                    </button>
                    <details class="conn-menu">
                        <summary class="conn-menu-btn" title="More actions">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/></svg>
                        </summary>
                        <div class="conn-menu-pop">
                            <button onclick="this.closest('details').open=false;App.startRenameAccount('${acc.id}')">Rename account</button>
                            <button onclick="this.closest('details').open=false;App.toggleAccount('${acc.id}')">${inactive ? 'Activate' : 'Deactivate'}</button>
                            <button onclick="this.closest('details').open=false;App.switchMainTab('holdings')">View holdings</button>
                        </div>
                    </details>
                </div>
            </div>
        </div>`;
    },

    renderAddAccountMenu(portfolios) {
        const pop = document.getElementById('addAccountPop');
        if (!pop) return;
        const registered = (portfolios || []).filter(p => p.registered);
        let html = '';
        if (registered.length === 0) {
            html = `<div class="add-account-empty">No registered connections.<br>
                <a href="#" onclick="document.getElementById('addAccountMenu').open=false;App.switchSettingsTab('keys');return false;">Add a connection →</a></div>`;
        } else {
            html = registered.map(p => `
                <button onclick="document.getElementById('addAccountMenu').open=false;App.connectBrokerageById(${p.id})">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/></svg>
                    <span>Connect <strong>${sanitize(p.name)}</strong></span>
                </button>`).join('');
            html += `<div class="add-account-divider"></div>
                <a class="add-account-link" href="#" onclick="document.getElementById('addAccountMenu').open=false;App.switchSettingsTab('keys');return false;">Manage credentials →</a>`;
        }
        pop.innerHTML = html;
    },

    // ── Dashboard widgets ────────────────────────────────────────────────

    setDashboardDividendLoading(loading) {
        const el = document.getElementById('dashEventsLoading');
        if (el) el.style.display = loading ? 'inline' : 'none';
        if (loading) {
            const strip = document.getElementById('dashEventsStrip');
            if (strip) strip.innerHTML = '<div class="empty-state" style="padding:0.75rem 0;">Loading dividend data…</div>';
        }
    },

    renderDashboardHoldingsTable(currentGroups, inactiveAccountIds, holdingsData = null) {
        const container = document.getElementById('dashHoldingsTable');
        if (!container) return;

        if (!holdingsData && typeof App !== 'undefined') {
            holdingsData = App.getFilteredHoldingsData();
        }

        if (!holdingsData || holdingsData.length === 0) {
            container.innerHTML = '<div class="empty-state" style="padding:1.5rem 0;"><p>No holdings loaded. Click Refresh to load position data.</p></div>';
            return;
        }

        const symbolMap = new Map();
        let grandTotal = 0;
        let totalCost = 0;

        holdingsData.forEach(acct => {
            if (inactiveAccountIds && inactiveAccountIds.has(acct.accountId)) {
                return;
            }
            if (acct.error) return;

            (acct.holdings || []).forEach(pos => {
                const sym = pos.symbol?.symbol?.symbol || pos.symbol?.symbol || pos.symbol || 'Unknown';
                const desc = pos.symbol?.symbol?.description || pos.description || sym;
                const units = pos.units || 0;
                const price = pos.price || 0;
                const val = pos.marketValue || (units * price) || 0;
                const avgBuy = pos.average_purchase_price || 0;
                const cost = avgBuy > 0 ? (units * avgBuy) : val;

                if (!symbolMap.has(sym)) {
                    symbolMap.set(sym, {
                        symbol: sym,
                        description: desc,
                        value: 0,
                        cost: 0,
                        units: 0
                    });
                }
                const entry = symbolMap.get(sym);
                entry.value += val;
                entry.cost += cost;
                entry.units += units;
            });
        });

        if (currentGroups) {
            currentGroups.forEach(g => {
                g.accounts.forEach(acc => {
                    if (inactiveAccountIds && inactiveAccountIds.has(acc.id)) return;

                    let isAccountInSelectedPortfolio = true;
                    if (typeof App !== 'undefined' && App.selectedUserPortfolioId !== 'all') {
                        const activePort = App.getSelectedUserPortfolio();
                        const activePortAccountIds = new Set(activePort ? (activePort.accountIds || []) : []);
                        isAccountInSelectedPortfolio = activePortAccountIds.has(acc.id);
                    }

                    if (isAccountInSelectedPortfolio) {
                        const cashVal = acc.balance?.cash?.amount || 0;
                        if (cashVal > 0) {
                            const sym = 'CASH';
                            if (!symbolMap.has(sym)) {
                                symbolMap.set(sym, {
                                    symbol: sym,
                                    description: 'Cash Balance',
                                    value: 0,
                                    cost: 0,
                                    units: 0
                                });
                            }
                            const entry = symbolMap.get(sym);
                            entry.value += cashVal;
                            entry.cost += cashVal;
                            entry.units += cashVal;
                        }
                    }
                });
            });
        }

        const rows = Array.from(symbolMap.values());
        rows.sort((a, b) => b.value - a.value);

        rows.forEach(r => {
            grandTotal += r.value;
            totalCost += r.cost;
        });

        if (rows.length === 0) {
            container.innerHTML = '<div class="empty-state" style="padding:1.5rem 0;"><p>No active positions or cash.</p></div>';
            return;
        }

        const palette = [
            '#00d09c','#4f8ef7','#f7c948','#f76f8e','#a78bfa',
            '#38bdf8','#fb923c','#34d399','#e879f9','#facc15',
            '#60a5fa','#f87171','#2dd4bf','#c084fc','#fbbf24'
        ];

        let tableHtml = `
        <table class="data-table">
          <thead>
            <tr>
              <th>Asset</th>
              <th class="right">Value / Invested</th>
              <th class="right">Profit / Return</th>
              <th class="right">Allocation</th>
            </tr>
          </thead>
          <tbody>
        `;

        rows.forEach((r, idx) => {
            const color = palette[idx % palette.length];
            const alloc = grandTotal > 0 ? (r.value / grandTotal * 100) : 0;
            const profit = r.value - r.cost;
            const returnPct = r.cost > 0 ? (profit / r.cost * 100) : 0;

            const profitSign = profit >= 0 ? '+' : '';
            const profitColor = profit >= 0 ? 'var(--success)' : 'var(--danger)';

            tableHtml += `
            <tr id="breakdown-row-${idx}" style="cursor: pointer; transition: opacity 0.15s;" onclick="UI.toggleChartSlice(${idx})">
              <td class="breakdown-asset-cell">
                <span class="breakdown-asset-indicator" style="background-color: ${color};"></span>
                <div style="font-size: 0.85rem; font-weight: 600;">${sanitize(r.symbol)}</div>
                <div class="ticker-desc" style="font-size: 0.75rem; color: var(--text-muted); max-width: 180px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${sanitize(r.description)}">${sanitize(r.description)}</div>
              </td>
              <td class="right">
                <div class="masked-val" style="font-size: 0.85rem; font-weight: 600;">$${r.value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                <div class="masked-val" style="font-size: 0.72rem; color: var(--text-muted);">$${r.cost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
              </td>
              <td class="right">
                <div class="masked-val" style="font-size: 0.85rem; font-weight: 600; color: ${profitColor};">${profitSign}$${profit.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                <div style="font-size: 0.72rem; color: ${profitColor};">${profitSign}${returnPct.toFixed(2)}%</div>
              </td>
              <td class="right" style="vertical-align: middle;">
                <div style="font-size: 0.85rem; font-weight: 500;">${alloc.toFixed(1)}%</div>
                <div style="margin-top: 3px; height: 3px; background: var(--border); border-radius: 2px; width: 60px; margin-left: auto;">
                  <div style="height: 100%; background: ${color}; border-radius: 2px; width: ${Math.min(alloc, 100).toFixed(1)}%;"></div>
                </div>
              </td>
            </tr>
            `;
        });

        tableHtml += `
          </tbody>
        </table>
        `;

        container.innerHTML = tableHtml;

        if (localStorage.getItem('cf_mask_values') === 'true') {
            container.querySelectorAll('.masked-val').forEach(el => el.classList.add('hidden-mode'));
        }
    },

    renderDashboardDividendWidgets(dividendsData, portfolioValue) {
        if (!dividendsData) return;
        let allEvents = [];
        dividendsData.forEach(acct => {
            if (acct.error) return;
            (acct.dividends || []).forEach(e => allEvents.push({ ...e, portfolioName: acct.portfolioName, accountName: acct.accountName }));
        });
        allEvents.sort((a, b) => new Date(a.date) - new Date(b.date));

        const annualTotal  = allEvents.reduce((s, e) => s + (e.amountCAD ?? e.amount ?? 0), 0);
        const monthlyAvg   = annualTotal / 12;
        const yieldPct     = portfolioValue > 0 ? (annualTotal / portfolioValue * 100) : 0;
        const fmt          = v => `$${v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
        const el           = id => document.getElementById(id);

        if (el('dashAnnualIncome'))  el('dashAnnualIncome').textContent  = fmt(annualTotal);
        if (el('dashMonthlyIncome')) el('dashMonthlyIncome').textContent = `${fmt(monthlyAvg)} / month`;
        if (el('dashYield'))         el('dashYield').textContent         = yieldPct > 0 ? `${yieldPct.toFixed(2)}%` : '—';
        if (el('passiveYield'))      el('passiveYield').textContent      = yieldPct > 0 ? `${yieldPct.toFixed(2)}%` : '0.00%';
        if (el('passiveAnnually'))   el('passiveAnnually').textContent   = `${fmt(annualTotal)} annually`;

        this.renderDashboardEventsStrip(allEvents);
        const transactionsData = (typeof App !== 'undefined') ? App.getFilteredTransactionsData() : null;
        this.renderDashboardDividendChart(allEvents, transactionsData);
    },

    renderDashboardEventsStrip(allEvents) {
        const container = document.getElementById('dashEventsStrip');
        if (!container) return;

        const todayStr = new Date().toLocaleDateString('en-CA');
        const upcoming = allEvents.filter(e => e.date.substring(0, 10) >= todayStr).slice(0, 7);

        if (upcoming.length === 0) {
            container.innerHTML = '<div class="empty-state" style="padding:0.75rem 0;"><p>No upcoming dividend events in the forecast.</p></div>';
            return;
        }

        const freqLabel = f => ({ 1: 'annual', 2: 'semi-annual', 4: 'quarterly', 12: 'monthly', 52: 'weekly' }[f] || 'periodic');

        container.innerHTML = '<div class="dash-events-strip">' +
            upcoming.map(e => {
                const d        = new Date(e.date);
                const day      = d.getUTCDate();
                const month    = d.toLocaleString('default', { month: 'short', timeZone: 'UTC' });
                const weekday  = d.toLocaleString('default', { weekday: 'short', timeZone: 'UTC' });
                const freq     = freqLabel(e.frequency || 4);
                const amt      = (e.amount || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
                const perShare = (e.amountPerShare || 0).toFixed(4);
                return `<div class="dash-event-card">
                    <div class="dash-event-type">Ex-dividend</div>
                    <div class="dash-event-date-box">
                        <span class="dash-event-day">${day}</span>
                        <span class="dash-event-weekday">${sanitize(weekday)} ${sanitize(month)}</span>
                    </div>
                    <div class="dash-event-ticker">${sanitize(e.symbol)}</div>
                    <div class="dash-event-name">${sanitize(e.name || e.symbol)}</div>
                    <div class="dash-event-meta">$${sanitize(perShare)}/share · ${freq}</div>
                    <div class="dash-event-earn">+$${sanitize(amt)}</div>
                </div>`;
            }).join('') +
        '</div>';
    },

    renderDashboardDividendChart(allEvents, transactionsData) {
        const canvas = document.getElementById('dashDividendChart');
        if (!canvas || typeof Chart === 'undefined') return;

        const now = new Date();
        const fmt = v => `$${v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

        // Build a 24-month timeline: past 11 months + current + next 12 months.
        // Key format: 'YYYY-MM' for bucketing; label format: 'Mon YY' for display.
        const months = [];
        for (let i = -11; i <= 12; i++) {
            const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
            const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
            const label = d.toLocaleString('default', { month: 'short', year: '2-digit' });
            months.push({ key, label, received: 0, projected: 0 });
        }
        const byKey = new Map(months.map(m => [m.key, m]));

        // Fill received from transaction history.
        let totalReceived = 0;
        if (transactionsData) {
            transactionsData.forEach(acct => {
                (acct.transactions || []).forEach(txn => {
                    if (!['DIVIDEND', 'DIV'].includes((txn.type || '').toUpperCase())) return;
                    const d = new Date(txn.date);
                    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
                    const bucket = byKey.get(key);
                    if (bucket) { bucket.received += Math.abs(txn.amount || 0); totalReceived += Math.abs(txn.amount || 0); }
                });
            });
        }

        // Fill projected from dividend events (current month onwards).
        let totalProjected = 0;
        const todayKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
        allEvents.forEach(e => {
            const d = new Date(e.date);
            const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
            if (key < todayKey) return;
            const bucket = byKey.get(key);
            if (bucket) { const v = e.amountCAD ?? e.amount ?? 0; bucket.projected += v; totalProjected += v; }
        });

        const labels       = months.map(m => m.label);
        const receivedData = months.map(m => m.received);
        const projectedData = months.map(m => m.projected);
        const maxVal = Math.max(...months.map(m => m.received + m.projected), 1);

        const ftEl = document.getElementById('dashFutureTotal');
        const rtEl = document.getElementById('dashReceivedTotal');
        if (ftEl) ftEl.textContent = totalProjected > 0 ? `${fmt(totalProjected)} projected next 12m` : '';
        if (rtEl) rtEl.textContent = totalReceived > 0 ? `${fmt(totalReceived)} received` : '';

        const theme = this.getChartTheme();
        const tooltipCb = (c) => {
            const ds = c.chart.data.datasets[c.datasetIndex];
            return c.parsed.y > 0 ? ` ${ds.label}: ${fmt(c.parsed.y)}` : null;
        };

        if (this.dashDividendChartInstance) {
            this.dashDividendChartInstance.data.labels = labels;
            this.dashDividendChartInstance.data.datasets[0].data = receivedData;
            this.dashDividendChartInstance.data.datasets[1].data = projectedData;
            this.dashDividendChartInstance.options.scales.y.max = maxVal * 1.25;
            this.dashDividendChartInstance.options.scales.y.grid.color = theme.gridColor;
            this.dashDividendChartInstance.options.scales.y.ticks.color = theme.textColor;
            this.dashDividendChartInstance.options.scales.x.ticks.color = theme.textColor;
            this.dashDividendChartInstance.options.plugins.tooltip.backgroundColor = theme.tooltipBg;
            this.dashDividendChartInstance.options.plugins.tooltip.borderColor = theme.tooltipBorder;
            this.dashDividendChartInstance.update('none');
        } else {
            this.dashDividendChartInstance = new Chart(canvas.getContext('2d'), {
                type: 'bar',
                data: {
                    labels,
                    datasets: [
                        { label: 'Received', data: receivedData, backgroundColor: 'rgba(79,142,247,0.5)', borderColor: '#4f8ef7', borderWidth: 0, borderRadius: 3, hoverBackgroundColor: 'rgba(79,142,247,0.75)' },
                        { label: 'Projected', data: projectedData, backgroundColor: 'rgba(0,208,156,0.35)', borderColor: '#00d09c', borderWidth: 0, borderRadius: 3, hoverBackgroundColor: 'rgba(0,208,156,0.6)' },
                    ]
                },
                options: {
                    responsive: true, maintainAspectRatio: false,
                    interaction: { mode: 'index', intersect: false },
                    plugins: {
                        legend: { display: true, labels: { color: theme.textColor, boxWidth: 12, font: { size: 11 }, filter: i => i.text !== 'Received' || receivedData.some(v => v > 0) } },
                        tooltip: { callbacks: { label: tooltipCb }, backgroundColor: theme.tooltipBg, padding: 8, cornerRadius: 6, titleFont: { size: 11 }, bodyFont: { size: 12, weight: '600' }, borderColor: theme.tooltipBorder, borderWidth: 1 }
                    },
                    scales: {
                        y: { beginAtZero: true, max: maxVal * 1.25, stacked: false, grid: { color: theme.gridColor }, ticks: { color: theme.textColor, font: { size: 10 }, callback: v => v >= 1000 ? `$${(v/1000).toFixed(1)}K` : `$${v}` } },
                        x: { grid: { display: false }, ticks: { color: theme.textColor, font: { size: 10 }, maxRotation: 45 } }
                    }
                }
            });
        }
    },

    // Render the income projection chart (annual income vs target) + summary.
    renderIncomeProjection(result, opts) {
        const canvas = document.getElementById('fireChart');
        const empty = document.getElementById('fireEmpty');
        const summaryEl = document.getElementById('fireSummary');
        const basisEl = document.getElementById('fireBasis');
        if (!canvas || typeof Chart === 'undefined') return;

        const cur = (opts && opts.currency) || 'USD';
        const target = (opts && opts.target) || 0;
        const points = (result && result.points) || [];

        if (!points.length || (opts && opts.noBasis)) {
            if (empty) { empty.style.display = 'flex'; empty.querySelector('p').textContent = opts && opts.noBasis ? 'No holdings/income yet to project from.' : 'No projection.'; }
            if (this.fireChartInstance) { this.fireChartInstance.destroy(); this.fireChartInstance = null; }
            if (summaryEl) summaryEl.textContent = '—';
            return;
        }
        if (empty) empty.style.display = 'none';

        const s = result.summary || {};
        if (summaryEl) {
            summaryEl.textContent = s.yearsToTarget != null
                ? `${this.moneyC(target, cur)}/yr reached in ${s.yearsToTarget} year${s.yearsToTarget === 1 ? '' : 's'}`
                : `${this.moneyC(s.finalIncome, cur)}/yr after ${points.length - 1} years`;
        }
        if (basisEl) {
            basisEl.innerHTML = `Starting from <strong>${this.moneyC(opts.currentValue, cur)}</strong> generating <strong>${this.moneyC(opts.currentIncome, cur)}/yr</strong> (yield ${this.pct((s.baseYield || 0) * 100)}). Contributed over period: ${this.moneyC(s.totalContributed, cur)}. <em>Projections are estimates, not guarantees.</em>`;
        }

        const labels = points.map(p => p.year);
        const incomeData = points.map(p => p.income);
        const theme = this.getChartTheme();
        const primary = getComputedStyle(document.documentElement).getPropertyValue('--primary').trim() || '#00d09c';
        const fmt = v => this.moneyC(v, cur);

        const datasets = [{
            label: 'Annual income', data: incomeData, borderColor: primary, backgroundColor: 'rgba(0,208,156,0.12)',
            borderWidth: 2, fill: true, tension: 0.2, pointRadius: 0, pointHoverRadius: 4,
        }];
        if (target > 0) {
            datasets.push({
                label: 'Target', data: points.map(() => target), borderColor: '#f5a623',
                borderWidth: 1.5, borderDash: [6, 4], fill: false, pointRadius: 0,
            });
        }

        if (this.fireChartInstance) this.fireChartInstance.destroy();
        this.fireChartInstance = new Chart(canvas.getContext('2d'), {
            type: 'line',
            data: { labels, datasets },
            options: {
                responsive: true, maintainAspectRatio: false,
                interaction: { mode: 'index', intersect: false },
                plugins: {
                    legend: { display: true, labels: { color: theme.textColor, boxWidth: 12, font: { size: 11 } } },
                    tooltip: {
                        backgroundColor: theme.tooltipBg, borderColor: theme.tooltipBorder, borderWidth: 1, padding: 8, cornerRadius: 6,
                        callbacks: { title: items => `Year ${items[0].label}`, label: c => ` ${c.dataset.label}: ${fmt(c.parsed.y)}` },
                    },
                },
                scales: {
                    y: { beginAtZero: true, grid: { color: theme.gridColor }, ticks: { color: theme.textColor, font: { size: 10 }, callback: v => this._compactNum(v) } },
                    x: { grid: { display: false }, ticks: { color: theme.textColor, font: { size: 10 } }, title: { display: true, text: 'Years from now', color: theme.textColor, font: { size: 10 } } },
                },
            },
        });
    },

    // Palette for diversification slices (cycled).
    _DIV_PALETTE: ['#00d09c', '#4f8ef7', '#f5a623', '#9c27b0', '#ff7043', '#26a69a', '#ec407a', '#ab47bc', '#66bb6a', '#42a5f5', '#ffa726', '#8d6e63', '#789262', '#5c6bc0'],
    _DIV_DIMS: [['bySector', 'Sector'], ['byCountry', 'Geography'], ['byAssetType', 'Asset type'], ['byCurrency', 'Currency']],

    renderDiversification(result, dim, cur) {
        const canvas = document.getElementById('divChart');
        const legendEl = document.getElementById('divLegend');
        const pillsEl = document.getElementById('divDimPills');
        const empty = document.getElementById('divEmpty');
        if (!canvas || typeof Chart === 'undefined') return;

        const slices = (result && result[dim]) || [];
        if (!slices.length) {
            if (empty) { empty.style.display = 'block'; empty.querySelector('p').textContent = 'No holdings to analyze yet.'; }
            if (this.divChartInstance) { this.divChartInstance.destroy(); this.divChartInstance = null; }
            if (legendEl) legendEl.innerHTML = '';
            if (pillsEl) pillsEl.innerHTML = '';
            return;
        }
        if (empty) empty.style.display = 'none';

        if (pillsEl) {
            pillsEl.innerHTML = this._DIV_DIMS.map(([k, label]) =>
                `<button class="sd-range-pill${k === dim ? ' active' : ''}" onclick="App.setDiversificationDim('${k}')">${label}</button>`
            ).join('');
        }

        // Collapse a long tail into "Other" so the chart stays readable.
        const MAX = 9;
        let view = slices;
        if (slices.length > MAX) {
            const head = slices.slice(0, MAX - 1);
            const tail = slices.slice(MAX - 1);
            const otherVal = tail.reduce((s, x) => s + x.value, 0);
            const otherPct = tail.reduce((s, x) => s + x.pct, 0);
            view = [...head, { key: 'Other', value: otherVal, pct: Math.round(otherPct * 100) / 100 }];
        }

        const labels = view.map(s => s.key);
        const data = view.map(s => s.value);
        const colors = view.map((_, i) => this._DIV_PALETTE[i % this._DIV_PALETTE.length]);
        const theme = this.getChartTheme();
        const fmt = v => this.moneyC(v, cur);

        if (this.divChartInstance &&
            JSON.stringify(this.divChartInstance.data.labels) === JSON.stringify(labels)) {
            this.divChartInstance.data.datasets[0].data = data;
            this.divChartInstance.data.datasets[0].backgroundColor = colors;
            this.divChartInstance.update('none');
        } else {
            if (this.divChartInstance) this.divChartInstance.destroy();
            this.divChartInstance = new Chart(canvas.getContext('2d'), {
                type: 'doughnut',
                data: { labels, datasets: [{ data, backgroundColor: colors, borderColor: 'transparent', borderWidth: 0, hoverOffset: 6 }] },
                options: {
                    responsive: true, maintainAspectRatio: false, cutout: '62%',
                    plugins: {
                        legend: { display: false },
                        tooltip: {
                            backgroundColor: theme.tooltipBg, borderColor: theme.tooltipBorder, borderWidth: 1, padding: 8, cornerRadius: 6,
                            callbacks: { label: c => ` ${c.label}: ${fmt(c.parsed)} (${(c.parsed / (result.totalValue || 1) * 100).toFixed(1)}%)` },
                        },
                    },
                },
            });
        }

        if (legendEl) {
            // For the currency view each slice is in its own currency, so label
            // amounts with that currency; otherwise use the portfolio currency.
            const isCurrency = dim === 'byCurrency';
            const rowsHtml = view.map((s, i) =>
                `<div class="div-legend-row">
                    <span class="div-legend-dot" style="background:${this._DIV_PALETTE[i % this._DIV_PALETTE.length]}"></span>
                    <span class="div-legend-name">${sanitize(s.key)}</span>
                    <span class="div-legend-pct">${this.pct(s.pct)}</span>
                    <span class="div-legend-val text-muted">${this.moneyC(s.value, isCurrency ? (s.key || cur) : cur)}</span>
                </div>`
            ).join('');
            const fxNote = (isCurrency && result.totalValueBase)
                ? `<div class="div-legend-fx text-muted">≈ ${this.moneyC(result.totalValueBase, result.baseCurrency)} total (FX-adjusted to ${sanitize(result.baseCurrency)})</div>`
                : '';
            legendEl.innerHTML = rowsHtml + fxNote;
        }
    },

    // Ranges for the portfolio performance chart.
    _PERF_RANGES: [
        { key: '1m', label: '1m', days: 31 },
        { key: '3m', label: '3m', days: 92 },
        { key: '6m', label: '6m', days: 183 },
        { key: 'ytd', label: 'YTD' },
        { key: '1y', label: '1y', days: 366 },
        { key: '5y', label: '5y', days: 1827 },
        { key: 'all', label: 'all' },
    ],

    _filterPerfPoints(points, rangeKey) {
        if (!points || !points.length || rangeKey === 'all') return points || [];
        let cutoff;
        if (rangeKey === 'ytd') {
            cutoff = `${new Date().getFullYear()}-01-01`;
        } else {
            const def = this._PERF_RANGES.find(r => r.key === rangeKey);
            const d = new Date(); d.setDate(d.getDate() - (def?.days ?? 1827));
            cutoff = d.toISOString().slice(0, 10);
        }
        const out = points.filter(p => p.date >= cutoff);
        return out.length >= 2 ? out : points.slice(-2);
    },

    // Render the portfolio performance (value / invested / benchmark) line chart.
    // Render the realized capital-gains card.
    renderRealizedGains(r) {
        const body = document.getElementById('realizedBody');
        const totalEl = document.getElementById('realizedTotal');
        if (!body) return;
        const cur = (r && r.currency) || 'CAD';

        if (!r || !r.byYear || r.byYear.length === 0) {
            if (totalEl) totalEl.textContent = '';
            body.innerHTML = '<div class="empty-state" style="padding:1rem 0;"><p class="text-muted text-sm">No realized gains yet — sell transactions will appear here.</p></div>';
            return;
        }

        if (totalEl) {
            const g = r.totalGain;
            totalEl.innerHTML = `<span class="${g >= 0 ? 'pos' : 'neg'}">${g >= 0 ? '+' : '-'}${this.moneyC(Math.abs(g), cur)} lifetime</span>`;
        }

        const summary = `<div class="tax-summary">
            <div class="tax-stat"><span class="tax-stat-val ${r.taxableAccountGain >= 0 ? 'pos' : 'neg'}">${r.taxableAccountGain >= 0 ? '+' : '-'}${this.moneyC(Math.abs(r.taxableAccountGain), cur)}</span><span class="tax-stat-lbl">Taxable-account gains</span></div>
            <div class="tax-stat"><span class="tax-stat-val">${this.pct(r.inclusionRate * 100)}</span><span class="tax-stat-lbl">Inclusion rate</span></div>
            <div class="tax-stat"><span class="tax-stat-val">${this.moneyC(r.estimatedTaxableIncome, cur)}</span><span class="tax-stat-lbl">Est. taxable income</span></div>
        </div>`;

        const g = v => `<span class="${v >= 0 ? 'pos' : 'neg'}">${v >= 0 ? '+' : '-'}${this.moneyC(Math.abs(v), cur)}</span>`;
        const yearRows = `<table class="tax-table">
            <thead><tr><th>Year</th><th>Realized gain</th><th>Taxable portion</th></tr></thead>
            <tbody>${r.byYear.map(y => `<tr>
                <td>${y.year}</td>
                <td>${g(y.gain)}</td>
                <td>${g(y.taxableGain)}</td>
            </tr>`).join('')}</tbody>
        </table>`;
        const acctRows = `<table class="tax-table">
            <thead><tr><th>By account</th><th>Realized gain</th><th>Tax status</th></tr></thead>
            <tbody>${r.byAccount.map(a => `<tr>
                <td>${sanitize(a.account)}</td>
                <td>${g(a.gain)}</td>
                <td class="text-muted">${a.registered ? 'Tax-free' : 'Taxable'}</td>
            </tr>`).join('')}</tbody>
        </table>`;

        body.innerHTML = summary + `<div class="tax-tables">${yearRows}${acctRows}</div>`;
    },

    // Render the manual (off-brokerage) assets card: real estate, GICs, crypto, etc.
    renderManualAssets(assets, summary) {
        const body = document.getElementById('manualAssetsBody');
        const totalEl = document.getElementById('manualAssetsTotal');
        if (!body) return;

        if (totalEl) {
            totalEl.textContent = summary && summary.count > 0
                ? this.moneyC(summary.totalValueBase, summary.baseCurrency)
                : '';
        }

        if (!assets || assets.length === 0) {
            body.innerHTML = '<div class="empty-state" style="padding:1rem 0;"><p class="text-muted text-sm">No manual assets yet — add real estate, GICs, or anything else outside your connected brokerages.</p></div>';
            return;
        }

        const rows = assets.map(a => `<tr>
            <td>${sanitize(a.name)}</td>
            <td class="text-muted">${sanitize(a.category)}</td>
            <td class="right">${this.moneyC(a.value, a.currency)}</td>
            <td class="right" style="white-space:nowrap;">
                <button class="btn btn-outline btn-sm" onclick="App.openManualAssetModal(${a.id})">Edit</button>
                <button class="btn btn-outline btn-sm" onclick="App.deleteManualAsset(${a.id})">Delete</button>
            </td>
        </tr>`).join('');

        body.innerHTML = `<table class="tax-table">
            <thead><tr><th>Name</th><th>Category</th><th>Value</th><th></th></tr></thead>
            <tbody>${rows}</tbody>
        </table>`;
    },

    openManualAssetModal(asset) {
        const errEl = document.getElementById('maErrorMsg');
        if (errEl) errEl.style.display = 'none';
        const modal = document.getElementById('manualAssetModal');
        const title = document.getElementById('manualAssetModalTitle');
        const form  = document.getElementById('manualAssetForm');

        form.reset();
        document.getElementById('maId').value = asset ? asset.id : '';
        document.getElementById('maName').value = asset ? asset.name : '';
        document.getElementById('maCategory').value = asset ? asset.category : '';
        document.getElementById('maValue').value = asset ? asset.value : '';
        document.getElementById('maCurrency').value = asset ? asset.currency : 'CAD';
        document.getElementById('maNotes').value = asset ? (asset.notes || '') : '';
        title.textContent = asset ? 'Edit Asset' : 'Add Asset';

        modal.classList.add('open');
    },

    closeManualAssetModal() {
        const modal = document.getElementById('manualAssetModal');
        if (modal) modal.classList.remove('open');
    },

    // Render the top-movers / contribution-attribution card.
    renderAttribution(result) {
        const body = document.getElementById('moversBody');
        const totalEl = document.getElementById('moversTotal');
        if (!body) return;
        const rows = (result && result.rows) || [];
        if (!rows.length) {
            if (totalEl) totalEl.textContent = '';
            body.innerHTML = '<div class="empty-state" style="padding:1rem 0;"><p class="text-muted text-sm">No holdings to attribute yet.</p></div>';
            return;
        }
        const cur = rows[0].currency || 'USD';
        if (totalEl) {
            const tr = result.totalReturn;
            totalEl.innerHTML = `<span class="${tr >= 0 ? 'pos' : 'neg'}">${tr >= 0 ? '+' : '-'}${this.moneyC(Math.abs(tr), cur)} total</span>`;
        }

        // Largest absolute contribution drives the bar scale.
        const maxAbs = Math.max(...rows.map(r => Math.abs(r.contributionPct)), 1);
        const row = r => {
            const pos = r.totalReturn >= 0;
            const w = (Math.abs(r.contributionPct) / maxAbs) * 100;
            const retPct = r.totalReturnPct != null ? ` (${this.arrow(r.totalReturn)} ${this.pct(Math.abs(r.totalReturnPct))})` : '';
            return `<div class="mover-row stock-link" data-stock="${sanitize(r.symbol)}">
                <div class="mover-head">
                    <span class="mover-sym"><strong>${sanitize(r.symbol)}</strong> <span class="text-muted">${sanitize((r.name || '').slice(0, 22))}</span></span>
                    <span class="mover-ret ${pos ? 'pos' : 'neg'}">${pos ? '+' : '-'}${this.moneyC(Math.abs(r.totalReturn), cur)}${retPct}</span>
                </div>
                <div class="mover-bar-track"><div class="mover-bar ${pos ? 'pos' : 'neg'}" style="width:${w.toFixed(1)}%;"></div></div>
            </div>`;
        };

        // Top 5 gainers and bottom 5 detractors.
        const gainers = rows.filter(r => r.totalReturn > 0).slice(0, 5);
        const losers = rows.filter(r => r.totalReturn < 0).slice(-5).reverse();
        const section = (title, list) => !list.length ? '' :
            `<div class="mover-col"><div class="mover-col-title">${title}</div>${list.map(row).join('')}</div>`;
        body.innerHTML = `<div class="mover-grid">${section('Top contributors', gainers)}${section('Top detractors', losers)}</div>`;
    },

    // Render the dividend withholding-tax breakdown card.
    /**
     * T5008 dispositions + Schedule 3 roll-up.
     *
     * Everything shown is in CAD converted at each trade's own date. Native
     * proceeds/cost are kept in a secondary line so the figures can be checked
     * against the slip the broker actually issues.
     */
    /**
     * Shown when the selected portfolio contains no accounts. Deliberately not
     * a silent blank: the user needs to know the report is empty because of the
     * filter, not because they had no dispositions.
     */
    renderT5008Empty(scopeLabel) {
        this._setT5008Scope(scopeLabel);
        const msg = `<div class="empty-state" style="padding:1rem 0;"><p class="text-muted text-sm">` +
            `“${sanitize(scopeLabel || 'This portfolio')}” has no accounts assigned, so there is nothing to report. ` +
            `Assign accounts to it in Settings → Portfolios.</p></div>`;
        for (const id of ['t5008SummaryBody', 't5008Body', 'ccBody']) {
            const el = document.getElementById(id);
            if (el) el.innerHTML = msg;
        }
        for (const id of ['t5008Count', 't5008SummaryNote', 'ccTotal']) {
            const el = document.getElementById(id);
            if (el) el.textContent = '';
        }
        const warn = document.getElementById('t5008Warnings');
        if (warn) warn.innerHTML = '';
    },

    /** Name the account scope every figure on the page is derived from. */
    _setT5008Scope(scopeLabel) {
        const el = document.getElementById('t5008Scope');
        if (el) el.textContent = scopeLabel ? `Scope: ${scopeLabel}` : '';
    },

    renderT5008(r, scopeLabel) {
        this._setT5008Scope(scopeLabel);
        const summaryBody = document.getElementById('t5008SummaryBody');
        const body = document.getElementById('t5008Body');
        const countEl = document.getElementById('t5008Count');
        const noteEl = document.getElementById('t5008SummaryNote');
        const warnEl = document.getElementById('t5008Warnings');
        if (!body || !summaryBody) return;

        const cur = (r && r.baseCurrency) || 'CAD';
        const money = v => this.moneyC(v, cur);
        const signed = v => `<span class="${v >= 0 ? 'pos' : 'neg'}">${v >= 0 ? '+' : '-'}${money(Math.abs(v))}</span>`;

        // ── Warnings (missing FX, cross-account ACB pooling) ──────────────────
        if (warnEl) {
            const items = (r && r.warnings) || [];
            warnEl.innerHTML = items.length === 0 ? '' : `<div class="t5008-warnings">
                ${items.map(w => `<div class="t5008-warning">⚠ ${sanitize(w)}</div>`).join('')}
            </div>`;
        }

        // ── Schedule 3 summary ────────────────────────────────────────────────
        const years = (r && r.summaryByYear) || [];
        if (noteEl) {
            const excluded = (r && r.excludedRegisteredAccounts) || [];
            noteEl.textContent = excluded.length > 0
                ? `${excluded.length} registered account(s) excluded — not reportable`
                : '';
        }

        if (years.length === 0) {
            summaryBody.innerHTML = '<div class="empty-state" style="padding:1rem 0;"><p class="text-muted text-sm">No dispositions in the selected period.</p></div>';
        } else {
            const total = years.reduce((a, y) => ({
                proceeds: a.proceeds + y.proceeds,
                costBasis: a.costBasis + y.costBasis,
                outlays: a.outlays + y.outlays,
                netGain: a.netGain + y.netGain,
                deniedLosses: a.deniedLosses + y.deniedLosses,
                taxableCapitalGain: a.taxableCapitalGain + y.taxableCapitalGain,
            }), { proceeds: 0, costBasis: 0, outlays: 0, netGain: 0, deniedLosses: 0, taxableCapitalGain: 0 });

            const stats = `<div class="tax-summary">
                <div class="tax-stat"><span class="tax-stat-val">${money(total.proceeds)}</span><span class="tax-stat-lbl">Proceeds of disposition</span></div>
                <div class="tax-stat"><span class="tax-stat-val">${money(total.costBasis)}</span><span class="tax-stat-lbl">Adjusted cost base</span></div>
                <div class="tax-stat"><span class="tax-stat-val">${money(total.outlays)}</span><span class="tax-stat-lbl">Outlays &amp; expenses</span></div>
                <div class="tax-stat"><span class="tax-stat-val ${total.netGain >= 0 ? 'pos' : 'neg'}">${total.netGain >= 0 ? '+' : '-'}${money(Math.abs(total.netGain))}</span><span class="tax-stat-lbl">Net capital gain</span></div>
                <div class="tax-stat"><span class="tax-stat-val">${money(total.taxableCapitalGain)}</span><span class="tax-stat-lbl">Taxable capital gain (50%)</span></div>
            </div>`;

            const rows = years.map(y => `<tr>
                <td>${y.year}</td>
                <td>${money(y.proceeds)}</td>
                <td>${money(y.costBasis)}</td>
                <td>${money(y.outlays)}</td>
                <td>${signed(y.netGain)}</td>
                <td>${y.deniedLosses > 0 ? money(y.deniedLosses) : '—'}</td>
                <td>${money(y.taxableCapitalGain)}</td>
            </tr>`).join('');

            summaryBody.innerHTML = stats + `<table class="tax-table">
                <thead><tr>
                    <th>Year</th><th>Proceeds</th><th>ACB</th><th>Outlays</th>
                    <th>Net gain</th><th>Denied (superficial)</th><th>Taxable gain</th>
                </tr></thead>
                <tbody>${rows}</tbody>
            </table>`;
        }

        // Rendered before the early return below so charges still show on a
        // year where nothing was sold but interest was still charged.
        this.renderCarryingCharges((r && r.carryingCharges) || null, cur);

        // ── Per-disposition table ─────────────────────────────────────────────
        const ds = (r && r.dispositions) || [];
        if (countEl) countEl.textContent = ds.length > 0 ? `${ds.length} disposition${ds.length === 1 ? '' : 's'}` : '';

        if (ds.length === 0) {
            body.innerHTML = '<div class="empty-state" style="padding:1rem 0;"><p class="text-muted text-sm">No dispositions found. Sell transactions in non-registered accounts appear here.</p></div>';
            return;
        }

        const rows = ds.map(d => {
            const flags = [];
            if (d.superficialLoss > 0) flags.push(`<span class="t5008-flag t5008-flag-warn" title="${sanitize(d.superficialNote || '')}">superficial loss</span>`);
            if (d.missingCostBasis) {
                const title = d.missingCostBasisNote ||
                    "No purchase was found for these units, so the cost base is 0 and the full proceeds are counted as gain. Enter the real ACB from your broker before filing.";
                flags.push(`<span class="t5008-flag t5008-flag-danger" title="${sanitize(title)}">no cost base</span>`);
            }
            if (d.isCrypto) flags.push('<span class="t5008-flag t5008-flag-info" title="Crypto is a taxable capital disposition and belongs on Schedule 3, but no T5008 slip is issued for it">crypto — no slip</span>');
            if (d.fxRateMissing) flags.push('<span class="t5008-flag t5008-flag-warn" title="No exchange rate found for this date — 1.0 was assumed">FX missing</span>');

            const nativeLine = d.currency !== cur
                ? `<div class="t5008-native">${sanitize(d.currency)} ${d.proceedsNative.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} @ ${d.fxRate ? d.fxRate.toFixed(4) : '—'}</div>`
                : '';

            return `<tr>
                <td>${sanitize(d.date)}</td>
                <td>
                    <div class="t5008-sym">${sanitize(d.symbol)}</div>
                    <div class="t5008-desc">${sanitize(d.description)}</div>
                    ${flags.join(' ')}
                </td>
                <td>${sanitize(d.account)}</td>
                <td>${d.securityType}</td>
                <td>${d.quantity.toLocaleString()}</td>
                <td>${money(d.proceeds)}${nativeLine}</td>
                <td>${money(d.costBasis)}</td>
                <td>${d.outlays > 0 ? money(d.outlays) : '—'}</td>
                <td>${signed(d.allowableGain)}</td>
            </tr>`;
        }).join('');

        body.innerHTML = `<div class="t5008-scroll"><table class="tax-table t5008-table">
            <thead><tr>
                <th title="Box 14">Date</th>
                <th title="Box 17">Security</th>
                <th>Account</th>
                <th title="Box 15">Type</th>
                <th title="Box 16">Qty</th>
                <th title="Box 21">Proceeds</th>
                <th title="Box 20">Cost / book value</th>
                <th>Outlays</th>
                <th>Reportable gain</th>
            </tr></thead>
            <tbody>${rows}</tbody>
        </table></div>`;
    },

    /**
     * Carrying charges and interest expense (Schedule 4, line 22100).
     *
     * Deliberately kept separate from the disposition table: these are a
     * different line on the return, and margin interest is only deductible
     * where the borrowing earns investment income — a test this data cannot
     * make, so the figure is presented as a candidate total.
     */
    renderCarryingCharges(cc, cur) {
        const body = document.getElementById('ccBody');
        const totalEl = document.getElementById('ccTotal');
        if (!body) return;

        const money = v => this.moneyC(v, cur || 'CAD');
        const charges = (cc && cc.charges) || [];

        if (totalEl) totalEl.textContent = cc && cc.total > 0 ? `${money(cc.total)} total` : '';

        if (charges.length === 0) {
            // Distinguish "none exist" from "some existed but none deductible".
            const excluded = (cc && cc.excludedRegistered) || 0;
            const why = excluded > 0
                ? `${excluded} interest/fee entr${excluded === 1 ? 'y was' : 'ies were'} found, but all sit in registered accounts where they are not deductible.`
                : 'No interest or fees were charged in your non-registered accounts for this period. Margin interest appears here once your broker reports it.';
            body.innerHTML = `<div class="empty-state" style="padding:1rem 0;"><p class="text-muted text-sm">${sanitize(why)}</p></div>`;
            return;
        }

        const stats = `<div class="tax-summary">
            <div class="tax-stat"><span class="tax-stat-val neg">${money(cc.totalInterest)}</span><span class="tax-stat-lbl">Interest expense</span></div>
            <div class="tax-stat"><span class="tax-stat-val neg">${money(cc.totalFees)}</span><span class="tax-stat-lbl">Investment fees</span></div>
            <div class="tax-stat"><span class="tax-stat-val">${money(cc.total)}</span><span class="tax-stat-lbl">Total (line 22100)</span></div>
        </div>`;

        const yearRows = (cc.byYear || []).length <= 1 ? '' : `<table class="tax-table mb-3">
            <thead><tr><th>Year</th><th>Interest</th><th>Fees</th><th>Total</th></tr></thead>
            <tbody>${cc.byYear.map(y => `<tr>
                <td>${y.year}</td><td>${money(y.interest)}</td><td>${money(y.fees)}</td><td>${money(y.total)}</td>
            </tr>`).join('')}</tbody>
        </table>`;

        const rows = charges.map(c => {
            const native = c.currency !== (cur || 'CAD')
                ? `<div class="t5008-native">${sanitize(c.currency)} ${c.amountNative.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} @ ${c.fxRate ? c.fxRate.toFixed(4) : '—'}</div>`
                : '';
            const flag = c.fxRateMissing
                ? ' <span class="t5008-flag t5008-flag-warn" title="No exchange rate found for this date — 1.0 was assumed">FX missing</span>'
                : '';
            return `<tr>
                <td>${sanitize(c.date)}</td>
                <td>${sanitize(c.label)}${flag}<div class="t5008-desc">${sanitize(c.description)}</div></td>
                <td>${sanitize(c.account)}</td>
                <td>${money(c.amount)}${native}</td>
            </tr>`;
        }).join('');

        body.innerHTML = stats + yearRows + `<div class="t5008-scroll"><table class="tax-table">
            <thead><tr><th>Date</th><th>Charge</th><th>Account</th><th>Amount</th></tr></thead>
            <tbody>${rows}</tbody>
        </table></div>`;
    },

    renderTax(t) {
        const body = document.getElementById('taxBody');
        const eff = document.getElementById('taxEffective');
        if (!body) return;
        const cur = (t && t.currency) || 'CAD';

        if (!t || t.totalIncome <= 0) {
            if (eff) eff.textContent = '';
            body.innerHTML = '<div class="empty-state" style="padding:1rem 0;"><p class="text-muted text-sm">No projected dividend income to estimate tax on. Run a dividend fetch first.</p></div>';
            return;
        }

        if (eff) eff.textContent = `${this.pct(t.effectiveRate * 100)} effective`;

        const summary = `<div class="tax-summary">
            <div class="tax-stat"><span class="tax-stat-val">${this.moneyC(t.totalIncome, cur)}</span><span class="tax-stat-lbl">Gross annual income</span></div>
            <div class="tax-stat"><span class="tax-stat-val neg">-${this.moneyC(t.totalWithheld, cur)}</span><span class="tax-stat-lbl">Est. withholding tax</span></div>
            <div class="tax-stat"><span class="tax-stat-val pos">${this.moneyC(t.afterTaxIncome, cur)}</span><span class="tax-stat-lbl">After-tax income</span></div>
        </div>`;

        const rows = (slices, head) => !slices.length ? '' : `<table class="tax-table">
            <thead><tr><th>${head}</th><th>Income</th><th>Withheld</th><th>Rate</th></tr></thead>
            <tbody>${slices.map(s => `<tr>
                <td>${sanitize(s.key)}</td>
                <td>${this.moneyC(s.income, cur)}</td>
                <td class="${s.withheld > 0 ? 'neg' : ''}">${s.withheld > 0 ? '-' + this.moneyC(s.withheld, cur) : '—'}</td>
                <td>${this.pct(s.rate * 100)}</td>
            </tr>`).join('')}</tbody>
        </table>`;

        body.innerHTML = summary +
            `<div class="tax-tables">${rows(t.byAccount, 'By account')}${rows(t.byCountry, 'By source')}</div>`;
    },

    // Render the portfolio risk-metric chips below the performance chart.
    renderRiskStats(risk) {
        const el = document.getElementById('perfRisk');
        if (!el) return;
        if (!risk || (risk.volatility == null && risk.maxDrawdown == null && risk.sharpe == null && risk.beta == null)) {
            el.innerHTML = '';
            return;
        }
        const pct = v => v == null ? '—' : `${(v * 100).toFixed(1)}%`;
        const num = v => v == null ? '—' : v.toFixed(2);
        const chip = (label, val, hint) => `<div class="risk-chip" title="${sanitize(hint)}">
            <span class="risk-chip-val">${val}</span><span class="risk-chip-lbl">${label}</span></div>`;
        el.innerHTML =
            chip('Volatility', pct(risk.volatility), 'Annualized standard deviation of daily returns') +
            chip('Max drawdown', pct(risk.maxDrawdown), 'Largest peak-to-trough decline') +
            chip('Sharpe', num(risk.sharpe), 'Annualized return per unit of risk (risk-free rate assumed 0)') +
            chip(`Beta vs ${sanitize(risk.benchmark || 'SPY')}`, num(risk.beta), 'Sensitivity to benchmark moves (1 = moves with the market)');
    },

    renderPortfolioPerformance(result, rangeKey, benchOn, cur) {
        const canvas = document.getElementById('perfChart');
        const empty = document.getElementById('perfEmpty');
        const pillsEl = document.getElementById('perfRangePills');
        const summaryEl = document.getElementById('perfSummary');
        if (!canvas || typeof Chart === 'undefined') return;

        const allPoints = (result && result.points) || [];
        if (allPoints.length < 2) {
            if (empty) { empty.style.display = 'flex'; empty.querySelector('p').textContent = 'Not enough transaction history to chart performance.'; }
            if (this.perfChartInstance) { this.perfChartInstance.destroy(); this.perfChartInstance = null; }
            return;
        }
        if (empty) empty.style.display = 'none';

        if (pillsEl) {
            pillsEl.innerHTML = this._PERF_RANGES.map(r =>
                `<button class="sd-range-pill${r.key === rangeKey ? ' active' : ''}" onclick="App.setPerfRange('${r.key}')">${r.label}</button>`
            ).join('');
        }

        const pts = this._filterPerfPoints(allPoints, rangeKey);
        const labels = pts.map(p => p.date);
        const valueData = pts.map(p => p.value);
        const investedData = pts.map(p => p.invested);
        const benchData = pts.map(p => p.benchmark);

        // Summary reflects the visible window.
        const first = pts[0], last = pts[pts.length - 1];
        const gain = last.value - first.value;
        const gainCls = gain >= 0 ? 'pos' : 'neg';
        if (summaryEl) {
            const invested = last.invested;
            const ret = last.value - invested;
            const retPct = invested > 0 ? (ret / invested) * 100 : 0;
            const rc = ret >= 0 ? 'pos' : 'neg';
            summaryEl.innerHTML = `<span class="perf-val">${this.moneyC(last.value, cur)}</span>
                <span class="${rc}">${ret >= 0 ? '+' : '-'}${this.moneyC(Math.abs(ret), cur)} (${this.arrow(ret)} ${this.pct(Math.abs(retPct))})</span>
                <span class="text-muted">vs ${this.moneyC(invested, cur)} invested</span>`;
        }

        const theme = this.getChartTheme();
        const primary = getComputedStyle(document.documentElement).getPropertyValue('--primary').trim() || '#00d09c';
        const fmt = v => this.moneyC(v, cur);

        const datasets = [
            {
                label: 'Value', data: valueData, borderColor: primary, backgroundColor: 'rgba(0,208,156,0.12)',
                borderWidth: 2, fill: true, tension: 0.15, pointRadius: 0, pointHoverRadius: 4, order: 1,
            },
            {
                label: 'Invested', data: investedData, borderColor: theme.textColor, borderWidth: 1.5,
                borderDash: [5, 4], fill: false, tension: 0, pointRadius: 0, pointHoverRadius: 3, order: 2,
            },
        ];
        if (benchOn) {
            datasets.push({
                label: (result.summary && 'Benchmark') || 'Benchmark', data: benchData, borderColor: '#f5a623',
                borderWidth: 1.5, fill: false, tension: 0.15, pointRadius: 0, pointHoverRadius: 3, order: 3,
            });
        }

        // Fewer x-ticks on long ranges.
        const tickLimit = 7;

        if (this.perfChartInstance) this.perfChartInstance.destroy();
        this.perfChartInstance = new Chart(canvas.getContext('2d'), {
            type: 'line',
            data: { labels, datasets },
            options: {
                responsive: true, maintainAspectRatio: false,
                interaction: { mode: 'index', intersect: false },
                plugins: {
                    legend: { display: true, labels: { color: theme.textColor, boxWidth: 12, font: { size: 11 } } },
                    tooltip: {
                        backgroundColor: theme.tooltipBg, borderColor: theme.tooltipBorder, borderWidth: 1,
                        padding: 8, cornerRadius: 6,
                        callbacks: {
                            title: items => items.length ? new Date(items[0].label + 'T00:00:00Z').toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) : '',
                            label: c => ` ${c.dataset.label}: ${fmt(c.parsed.y)}`,
                        },
                    },
                },
                scales: {
                    y: { grid: { color: theme.gridColor }, ticks: { color: theme.textColor, font: { size: 10 }, callback: v => v >= 1000 ? `${this._compactNum(v)}` : `${Math.round(v)}` } },
                    x: { grid: { display: false }, ticks: { color: theme.textColor, font: { size: 10 }, maxRotation: 0, autoSkip: true, maxTicksLimit: tickLimit,
                        callback(val) { const d = this.getLabelForValue(val); return new Date(d + 'T00:00:00Z').toLocaleDateString(undefined, { month: 'short', year: '2-digit', timeZone: 'UTC' }); } } },
                },
            },
        });
    },

    // ────────────────────────────────────────────────────────────────────

    // ── Holdings board (Snowball-style aggregated table) ─────────────────────

    money(n) {
        return '$' + (Math.abs(Number(n) || 0)).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    },
    // Currency-aware money: prefixes CA$/$/<code> based on the holding's currency.
    moneyC(n, code) {
        return this.curSym(code) + (Math.abs(Number(n) || 0)).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    },
    pct(n) { return (Number(n) || 0).toFixed(2) + '%'; },
    arrow(n) { return (Number(n) || 0) >= 0 ? '▲' : '▼'; },

    // Map accountId → currency from the cached account groups.
    accountCurrencyMap() {
        const m = new Map();
        const groups = (typeof App !== 'undefined' && App.currentGroups) ? App.currentGroups : [];
        groups.forEach(g => (g.accounts || []).forEach(a => m.set(a.id, a.currency || 'USD')));
        return m;
    },

    renderAllHoldings(data) {
        const tabsContainer   = document.getElementById('holdings-tabs');
        const tablesContainer = document.getElementById('holdings-tables');
        if (tabsContainer) { tabsContainer.innerHTML = ''; tabsContainer.style.display = 'none'; }
        if (!tablesContainer) return;

        if (!data || data.length === 0) {
            tablesContainer.innerHTML = '<div class="empty-state"><p>No active accounts found to load holdings.</p></div>';
            return;
        }

        // Aggregate every position by symbol across all visible accounts.
        const curByAcct = this.accountCurrencyMap();
        const bySymbol = new Map();
        let hadError = false;
        data.forEach(acct => {
            if (acct.error) { hadError = true; return; }
            const accCur = curByAcct.get(acct.accountId) || 'USD';
            (acct.holdings || []).forEach(h => {
                const symbol      = h.symbol?.symbol?.symbol || h.symbol?.symbol || h.symbol || '—';
                const description = h.symbol?.symbol?.description || h.description || symbol;
                const symbolId    = h.symbolId || h.instrument?.id || h.symbol?.id || '';
                const units = h.units || 0;
                const price = h.price || 0;
                if (units === 0 && price === 0) return;
                const value = h.marketValue || (units * price) || 0;
                const avg   = h.average_purchase_price || 0;
                const cost  = avg > 0 ? units * avg : value;

                if (!bySymbol.has(symbol)) {
                    bySymbol.set(symbol, { symbol, description, symbolId, shares: 0, cost: 0, value: 0, price, currency: accCur, currencyMixed: false, lots: [] });
                }
                const row = bySymbol.get(symbol);
                if (row.currency !== accCur) row.currencyMixed = true;
                row.shares += units;
                row.cost   += cost;
                row.value  += value;
                if (price) row.price = price;
                row.lots.push({
                    accountId: acct.accountId, accountName: acct.accountName,
                    portfolioId: acct.portfolioId, tradingEnabled: acct.tradingEnabled,
                    units, price, symbolId, description
                });
            });
        });

        // Forward annual dividend per share from forecast metadata (when dividends are loaded).
        const divPerShare = new Map();
        const divData = (typeof App !== 'undefined' && App.getFilteredDividendsData) ? App.getFilteredDividendsData() : null;
        (divData || []).forEach(acct => (acct.dividends || []).forEach(ev => {
            if (ev.symbol && !divPerShare.has(ev.symbol) && ev.amountPerShare && ev.frequency) {
                divPerShare.set(ev.symbol, ev.amountPerShare * ev.frequency);
            }
        }));

        const rows = Array.from(bySymbol.values()).map(r => {
            const profit    = r.value - r.cost;
            const profitPct = r.cost > 0 ? (profit / r.cost) * 100 : 0;
            const avgCost   = r.shares > 0 ? r.cost / r.shares : 0;
            const annualPerShare = divPerShare.get(r.symbol) || 0;
            const annualDiv = annualPerShare * r.shares;
            const yieldCur  = r.price > 0   ? (annualPerShare / r.price) * 100   : 0;
            const yieldCost = avgCost > 0   ? (annualPerShare / avgCost) * 100   : 0;
            return { ...r, profit, profitPct, avgCost, annualPerShare, annualDiv, yieldCur, yieldCost };
        });

        this.holdingsRows = rows;
        if (!this.holdingsView) this.holdingsView = 'holdings';
        if (!this.holdingsSort) this.holdingsSort = { key: 'value', dir: 'desc' };

        // Totals grouped by currency — summing across currencies without FX would be wrong.
        const totByCur = {};
        rows.forEach(r => {
            const c = r.currencyMixed ? 'USD' : (r.currency || 'USD');
            const t = totByCur[c] = totByCur[c] || { value: 0, cost: 0, div: 0 };
            t.value += r.value; t.cost += r.cost; t.div += r.annualDiv;
        });
        Object.values(totByCur).forEach(t => { t.profit = t.value - t.cost; t.profitPct = t.cost > 0 ? (t.profit / t.cost) * 100 : 0; });
        this.holdingsTotalsByCur = totByCur;

        const errNote = hadError
            ? `<div style="font-size:0.78rem;color:var(--warning);padding:0 0 0.75rem;">⚠ Some accounts could not be loaded and are excluded.</div>`
            : '';

        tablesContainer.innerHTML = `
            <div class="holdings-board card">
                ${errNote}
                <div class="hb-toolbar">
                    <div class="hb-views">
                        ${[['holdings','My holdings'],['dividends','Dividends'],['returns','Returns']].map(([k,label]) =>
                            `<button class="hb-view ${this.holdingsView===k?'active':''}" onclick="UI.setHoldingsView('${k}')">${label}</button>`).join('')}
                    </div>
                    <div class="hb-search">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
                        <input type="text" id="hbSearch" placeholder="Search holdings…" oninput="UI.hbSearchInput()">
                    </div>
                </div>
                <div class="hb-scroll">
                    <table class="hb-table">
                        <thead><tr id="hbHead"></tr></thead>
                        <tbody id="hbBody"></tbody>
                    </table>
                </div>
                <div class="hb-summary" id="hbSummary"></div>
            </div>`;

        this.renderHoldingsRows();
    },

    hbSearchInput() {
        clearTimeout(this._hbSearchTimer);
        this._hbSearchTimer = setTimeout(() => this.renderHoldingsRows(), 180);
    },

    setHoldingsView(view) {
        this.holdingsView = view;
        document.querySelectorAll('.hb-view').forEach(b => b.classList.toggle('active', b.getAttribute('onclick').includes(`'${view}'`)));
        if (view === 'dividends')    this.holdingsSort = { key: 'yieldCur',  dir: 'desc' };
        else if (view === 'returns') this.holdingsSort = { key: 'profitPct', dir: 'desc' };
        else                         this.holdingsSort = { key: 'value',     dir: 'desc' };
        this.renderHoldingsRows();
    },

    sortHoldings(key) {
        const s = this.holdingsSort || { key: 'value', dir: 'desc' };
        if (s.key === key) s.dir = s.dir === 'desc' ? 'asc' : 'desc';
        else { s.key = key; s.dir = (key === 'symbol') ? 'asc' : 'desc'; }
        this.holdingsSort = s;
        this.renderHoldingsRows();
    },

    holdingsColumns(view) {
        const cols = [{ key: 'symbol', label: 'Holding', cls: 'left' }, { key: 'shares', label: 'Shares', cls: 'right' }];
        if (view === 'dividends') {
            cols.push({ key: 'annualDiv', label: 'Annual income', cls: 'right' },
                      { key: 'yieldCur',  label: 'Yield',         cls: 'right' },
                      { key: 'yieldCost', label: 'Yield on cost', cls: 'right' },
                      { key: 'value',     label: 'Current value', cls: 'right' },
                      { key: 'aiRating',  label: 'AI rating',     cls: 'right' });
        } else if (view === 'returns') {
            cols.push({ key: 'cost',      label: 'Cost basis',    cls: 'right' },
                      { key: 'value',     label: 'Current value', cls: 'right' },
                      { key: 'profit',    label: 'Total profit',  cls: 'right' },
                      { key: 'profitPct', label: 'Return %',      cls: 'right' },
                      { key: 'aiRating',  label: 'AI rating',     cls: 'right' });
        } else {
            cols.push({ key: 'cost',      label: 'Cost basis',    cls: 'right' },
                      { key: 'value',     label: 'Current value', cls: 'right' },
                      { key: 'annualDiv', label: 'Dividends',     cls: 'right' },
                      { key: 'yieldCur',  label: 'Div yield',     cls: 'right' },
                      { key: 'profit',    label: 'Total profit',  cls: 'right' },
                      { key: 'aiRating',  label: 'AI rating',     cls: 'right' });
        }
        return cols;
    },

    _ratingColors: {
        1: { bg: '#1a7a4a', text: '#6effa8', label: 'Strong Buy' },
        2: { bg: '#1a5c7a', text: '#6ecfff', label: 'Buy'        },
        3: { bg: '#4a4a1a', text: '#ffe86e', label: 'Hold'       },
        4: { bg: '#6b3a1a', text: '#ffb36e', label: 'Caution'    },
        5: { bg: '#6b1a1a', text: '#ff8080', label: 'Risky'      },
    },

    renderRatingBadge(symbol) {
        const ratings = this.stockRatings;
        if (!ratings || !ratings.size) return `<td class="right"><span class="ai-rating-na">—</span></td>`;
        const r = ratings.get(symbol);
        if (!r) return `<td class="right"><span class="ai-rating-na" title="Not yet analysed">—</span></td>`;
        const c = this._ratingColors[r.score] || this._ratingColors[5];
        const risks = (r.keyRisks || []).join(' · ');
        const tooltip = `${r.summary}${risks ? '\n\nRisks: ' + risks : ''}\n\nConfidence: ${r.confidence}`;
        return `<td class="right">
            <span class="ai-rating-badge" style="background:${c.bg};color:${c.text};" title="${sanitize(tooltip)}">
                <span class="ai-rating-score">${r.score}</span>
                <span class="ai-rating-label">${sanitize(r.label)}</span>
            </span>
        </td>`;
    },

    renderHoldingsRows() {
        const head = document.getElementById('hbHead');
        const body = document.getElementById('hbBody');
        if (!head || !body) return;

        const rows = this.holdingsRows || [];
        const view = this.holdingsView || 'holdings';
        const sort = this.holdingsSort || { key: 'value', dir: 'desc' };
        const q    = (document.getElementById('hbSearch')?.value || '').toLowerCase();
        const cols = this.holdingsColumns(view);

        head.innerHTML = cols.map(c => {
            const active = sort.key === c.key;
            const arrow  = active ? (sort.dir === 'desc' ? ' ↓' : ' ↑') : '';
            return `<th class="${c.cls}" onclick="UI.sortHoldings('${c.key}')" style="cursor:pointer;${active ? 'color:var(--primary);' : ''}">${c.label}${arrow}</th>`;
        }).join('') + '<th class="right" style="width:44px;"></th>';

        let list = rows.filter(r => !q || r.symbol.toLowerCase().includes(q) || (r.description || '').toLowerCase().includes(q));
        const dir = sort.dir === 'desc' ? -1 : 1;
        list.sort((a, b) => sort.key === 'symbol'
            ? dir * a.symbol.localeCompare(b.symbol)
            : dir * ((a[sort.key] || 0) - (b[sort.key] || 0)));

        body.innerHTML = list.length === 0
            ? `<tr><td colspan="${cols.length + 1}" style="text-align:center;color:var(--text-muted);padding:2rem;">No holdings match your search.</td></tr>`
            : list.map(r => this.renderHoldingRow(r, cols)).join('');

        const totByCur = this.holdingsTotalsByCur || {};
        const sumEl = document.getElementById('hbSummary');
        if (sumEl) {
            const curs = Object.keys(totByCur);
            const perCur = curs.map(c => {
                const t = totByCur[c];
                return `<span>Value <strong>${this.moneyC(t.value, c)}</strong></span>
                    <span>Cost <strong>${this.moneyC(t.cost, c)}</strong></span>
                    <span>Profit <strong class="${t.profit >= 0 ? 'pos' : 'neg'}">${t.profit < 0 ? '-' : '+'}${this.moneyC(t.profit, c)} (${this.pct(t.profitPct)})</strong></span>
                    <span>Income <strong style="color:var(--primary);">${this.moneyC(t.div, c)}</strong></span>`;
            }).join('<span class="hb-sum-sep"></span>');
            sumEl.innerHTML = `<span>${list.length} holding${list.length === 1 ? '' : 's'}</span>${perCur}`;
        }
    },

    renderHoldingRow(r, cols) {
        const initials = (r.symbol || '?').replace(/[^A-Za-z0-9]/g, '').slice(0, 4) || '?';
        const m = n => this.moneyC(n, r.currency);
        const cell = {
            shares:    `<td class="right">${r.shares.toLocaleString(undefined, { maximumFractionDigits: 4 })}</td>`,
            cost:      `<td class="right">${m(r.cost)}<div class="hb-sub">${m(r.avgCost)}</div></td>`,
            value:     `<td class="right">${m(r.value)}<div class="hb-sub">${m(r.price)}</div></td>`,
            annualDiv: `<td class="right">${r.annualDiv > 0 ? m(r.annualDiv) : '—'}<div class="hb-sub">${r.annualPerShare > 0 ? m(r.annualPerShare) : ''}</div></td>`,
            yieldCur:  `<td class="right">${r.yieldCur  > 0 ? this.pct(r.yieldCur)  : '—'}</td>`,
            yieldCost: `<td class="right">${r.yieldCost > 0 ? this.pct(r.yieldCost) : '—'}</td>`,
            profit:    `<td class="right ${r.profit >= 0 ? 'pos' : 'neg'}">${r.profit < 0 ? '-' : '+'}${m(r.profit)}<div class="hb-sub ${r.profit >= 0 ? 'pos' : 'neg'}">${this.arrow(r.profit)} ${this.pct(Math.abs(r.profitPct))}</div></td>`,
            profitPct: `<td class="right ${r.profitPct >= 0 ? 'pos' : 'neg'}">${this.arrow(r.profitPct)} ${this.pct(Math.abs(r.profitPct))}</td>`,
        };
        const cells = cols.slice(1).map(c => c.key === 'aiRating' ? this.renderRatingBadge(r.symbol) : (cell[c.key] || '<td class="right">—</td>')).join('');
        return `<tr>
            <td>
                <div class="hb-holding stock-link" data-stock="${sanitize(r.symbol)}" title="View ${sanitize(r.symbol)} detail">
                    <div class="hb-avatar">${sanitize(initials)}</div>
                    <div class="hb-names">
                        <div class="hb-name">${sanitize(r.description)}</div>
                        <div class="hb-ticker">${sanitize(r.symbol)}</div>
                    </div>
                </div>
            </td>
            ${cells}
            <td class="right">${this.renderHoldingMenu(r)}</td>
        </tr>`;
    },

    renderHoldingMenu(r) {
        const tradable = (r.lots || []).filter(l => l.tradingEnabled);
        const items = tradable.map(l => {
            const d = `data-account-id="${sanitize(l.accountId)}" data-portfolio-id="${sanitize(l.portfolioId)}" data-symbol="${sanitize(r.symbol)}" data-symbol-id="${sanitize(l.symbolId || r.symbolId)}" data-description="${sanitize(r.description)}" data-price="${l.price || r.price}"`;
            const label = tradable.length > 1 ? ` · ${sanitize(l.accountName || 'Account')}` : '';
            return `<button class="trade-btn-buy" ${d} data-action="BUY">Buy${label}</button>
                    <button class="trade-btn-sell" ${d} data-action="SELL">Sell${label}</button>`;
        }).join('');
        return `<details class="conn-menu hb-menu">
            <summary class="conn-menu-btn" title="Actions"><svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/></svg></summary>
            <div class="conn-menu-pop">
                ${items || '<div class="hb-menu-empty">Enable trading on the connection to buy or sell.</div>'}
            </div>
        </details>`;
    },

    // ── Transactions board (Snowball-style ledger) ───────────────────────────

    renderAllTransactions(data) {
        const tabsContainer   = document.getElementById('transactions-tabs');
        const tablesContainer = document.getElementById('transactions-tables');
        if (tabsContainer) { tabsContainer.innerHTML = ''; tabsContainer.style.display = 'none'; }
        if (!tablesContainer) return;

        if (!data || data.length === 0) {
            tablesContainer.innerHTML = '<div class="empty-state"><p>No active accounts found to load transactions.</p></div>';
            return;
        }

        // Flatten every transaction across the visible accounts.
        const all = [];
        data.forEach(acct => (acct.transactions || []).forEach(t => all.push({ ...t, accountName: t.accountName || acct.accountName })));
        all.sort((a, b) => new Date(b.date) - new Date(a.date));
        this.txAll = all;
        if (!this.txTab) this.txTab = 'trades';

        // Current price per symbol from holdings → lets us show unrealised profit per trade.
        this.txPriceMap = new Map();
        const hd = (typeof App !== 'undefined' && App.cachedHoldingsData) ? App.cachedHoldingsData : [];
        hd.forEach(acct => (acct.holdings || []).forEach(h => {
            const sym = h.symbol?.symbol?.symbol || h.symbol?.symbol || h.symbol;
            if (sym && h.price) this.txPriceMap.set(sym, h.price);
        }));

        tablesContainer.innerHTML = `
            <div class="tx-board card">
                <div class="tx-toolbar">
                    <div class="tx-tabs">
                        ${[['trades','Trades'],['incomes','Incomes'],['cash','Cash'],['all','All']].map(([k,l]) =>
                            `<button class="tx-tab ${this.txTab===k?'active':''}" onclick="UI.setTxTab('${k}')">${l}</button>`).join('')}
                    </div>
                    <div style="display:flex;align-items:center;gap:0.5rem;">
                        <div class="hb-search" style="min-width:170px;">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
                            <input type="text" id="txSearch" placeholder="Search…" oninput="UI.txSearchInput()">
                        </div>
                        <button class="btn btn-outline btn-sm" onclick="UI.exportTransactions()">
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;margin-right:3px;"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                            Export
                        </button>
                    </div>
                </div>
                <div id="txSummary" class="tx-summary"></div>
                <div class="hb-scroll">
                    <table class="hb-table tx-table">
                        <thead><tr>
                            <th>Operation</th><th>Holding</th><th>Date</th>
                            <th class="right">Shares</th><th class="right">Price</th>
                            <th class="right">Fee / Tax</th><th class="right">Summ</th>
                            <th class="right">Total profit</th><th>Note</th>
                        </tr></thead>
                        <tbody id="txBody"></tbody>
                    </table>
                </div>
                <div id="txPager" class="tx-pager"></div>
            </div>`;
        this.txPage = 0;
        this.renderTxRows();
    },

    TX_PAGE: 100,

    txSearchInput() {
        clearTimeout(this._txSearchTimer);
        this._txSearchTimer = setTimeout(() => { this.txPage = 0; this.renderTxRows(); }, 180);
    },

    txGoPage(delta) {
        this.txPage = Math.max(0, (this.txPage || 0) + delta);
        this.renderTxRows();
    },

    txCategory(t) {
        const op = (t.type || t.action || '').toUpperCase();
        if (op === 'BUY' || op === 'SELL') return 'trades';
        if (['DIVIDEND', 'INTEREST', 'DISTRIBUTION', 'INCOME'].includes(op)) return 'incomes';
        if (['DEPOSIT', 'WITHDRAWAL', 'TRANSFER_IN', 'TRANSFER_OUT', 'CONTRIBUTION', 'CASH'].includes(op)) return 'cash';
        return 'other';
    },

    setTxTab(tab) {
        this.txTab = tab;
        this.txPage = 0;
        document.querySelectorAll('.tx-tab').forEach(b => b.classList.toggle('active', b.getAttribute('onclick').includes(`'${tab}'`)));
        this.renderTxRows();
    },

    curSym(code) {
        const c = (code || '').toUpperCase();
        if (c === 'CAD') return 'CA$';
        if (c === 'USD' || c === '') return '$';
        return c + ' ';
    },

    renderTxRows() {
        const body = document.getElementById('txBody');
        if (!body) return;
        const tab = this.txTab || 'trades';
        const q = (document.getElementById('txSearch')?.value || '').toLowerCase();

        let list = (this.txAll || []).filter(t => tab === 'all' || this.txCategory(t) === tab);
        if (q) list = list.filter(t => (t.symbol || '').toLowerCase().includes(q)
            || (t.description || '').toLowerCase().includes(q) || (t.accountName || '').toLowerCase().includes(q));

        // Buy/Sell totals (grouped by currency) for the summary box.
        const sums = {};
        (this.txAll || []).forEach(t => {
            const op = (t.type || t.action || '').toUpperCase();
            if (op !== 'BUY' && op !== 'SELL') return;
            const cur = (t.currencyCode || 'USD').toUpperCase();
            sums[cur] = sums[cur] || { buy: 0, sell: 0 };
            sums[cur][op === 'BUY' ? 'buy' : 'sell'] += Math.abs(t.amount || 0);
        });
        const sumEl = document.getElementById('txSummary');
        if (sumEl) {
            const curs = Object.keys(sums);
            const money = n => n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
            sumEl.innerHTML = curs.length === 0 ? '' : `
                <div class="tx-sum-col"><div class="tx-sum-label"><span class="tx-dot pos"></span> Buy</div>
                    ${curs.map(c => `<div class="tx-sum-val">${this.curSym(c)}${money(sums[c].buy)}</div>`).join('')}</div>
                <div class="tx-sum-col"><div class="tx-sum-label"><span class="tx-dot neg"></span> Sell</div>
                    ${curs.map(c => `<div class="tx-sum-val">${this.curSym(c)}${money(sums[c].sell)}</div>`).join('')}</div>`;
        }

        // Paginate to keep the DOM small on large histories.
        const pageSize = this.TX_PAGE;
        const total = list.length;
        const maxPage = Math.max(0, Math.ceil(total / pageSize) - 1);
        if ((this.txPage || 0) > maxPage) this.txPage = maxPage;
        const page = this.txPage || 0;
        const start = page * pageSize;
        const slice = list.slice(start, start + pageSize);

        body.innerHTML = slice.length === 0
            ? `<tr><td colspan="9" style="text-align:center;color:var(--text-muted);padding:2rem;">No transactions in this view.</td></tr>`
            : slice.map(t => this.renderTxRow(t)).join('');

        const pager = document.getElementById('txPager');
        if (pager) {
            pager.innerHTML = total <= pageSize ? '' : `
                <span>${start + 1}–${Math.min(start + pageSize, total)} of ${total}</span>
                <div style="display:flex;gap:0.4rem;">
                    <button class="btn btn-outline btn-sm" ${page === 0 ? 'disabled' : ''} onclick="UI.txGoPage(-1)">← Prev</button>
                    <button class="btn btn-outline btn-sm" ${page >= maxPage ? 'disabled' : ''} onclick="UI.txGoPage(1)">Next →</button>
                </div>`;
        }
    },

    renderTxRow(t) {
        const op  = (t.type || t.action || '').toUpperCase();
        const cur = this.curSym(t.currencyCode);
        const symbol = t.symbol || '';
        const name   = t.description || symbol || (op ? op[0] + op.slice(1).toLowerCase() : '—');
        const date   = t.date ? new Date(t.date).toLocaleDateString('en-CA') : '—';
        const units  = t.units;
        const price  = t.price;
        const amount = t.amount || 0;
        const cat    = this.txCategory(t);
        const pretty = s => s ? s[0] + s.slice(1).toLowerCase().replace(/_/g, ' ') : '—';

        let badge;
        if (op === 'BUY')       badge = `<span class="op-badge op-buy">Buy</span>`;
        else if (op === 'SELL') badge = `<span class="op-badge op-sell">Sell</span>`;
        else if (cat === 'incomes') badge = `<span class="op-badge op-income">${sanitize(pretty(op))}</span>`;
        else                    badge = `<span class="op-badge op-cash">${sanitize(pretty(op))}</span>`;

        const summNeg = op === 'BUY' || op === 'WITHDRAWAL' || op === 'TRANSFER_OUT' || amount < 0;
        const summ = `<span class="${summNeg ? 'neg' : 'pos'}">${summNeg ? '-' : '+'}${cur}${Math.abs(amount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>`;

        // Unrealised gain since purchase — only meaningful for BUY lots still held.
        let profitCell = '<td class="right">—</td>';
        if (op === 'BUY' && symbol && units) {
            const curPrice = this.txPriceMap.get(symbol);
            if (curPrice && price) {
                const profit = (curPrice - price) * Math.abs(units);
                const pctv   = price > 0 ? ((curPrice - price) / price) * 100 : 0;
                const cls    = profit >= 0 ? 'pos' : 'neg';
                profitCell = `<td class="right"><div class="${cls}">${this.arrow(pctv)} ${this.pct(Math.abs(pctv))}</div><div class="hb-sub ${cls}">${profit < 0 ? '-' : '+'}${cur}${Math.abs(profit).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div></td>`;
            }
        }

        let note = t.note || '';
        if (!note) {
            if (op === 'BUY' || op === 'SELL') {
                note = `${op === 'BUY' ? 'Bought' : 'Sold'} ${units != null ? Number(units).toLocaleString(undefined, { maximumFractionDigits: 6 }) : ''} of ${symbol || '—'}${price != null ? ` at ${cur}${Number(price).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 })}` : ''}`;
            } else if (cat === 'incomes') {
                note = `${name}${symbol ? ` (${symbol})` : ''}`;
            }
        }

        return `<tr>
            <td>${badge}</td>
            <td>
                <div class="hb-names">
                    <div class="hb-name" title="${sanitize(name)}">${sanitize(name)}</div>
                    ${symbol ? `<div class="hb-ticker">${sanitize(symbol)}</div>` : ''}
                </div>
            </td>
            <td style="white-space:nowrap;color:var(--text-muted);">${sanitize(date)}</td>
            <td class="right">${units != null ? Number(units).toLocaleString(undefined, { maximumFractionDigits: 6 }) : '—'}</td>
            <td class="right">${price != null ? cur + Number(price).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—'}</td>
            <td class="right" style="color:var(--text-muted);">${cur}0.00</td>
            <td class="right" style="font-weight:600;">${summ}</td>
            ${profitCell}
            <td style="color:var(--text-muted);font-size:0.8rem;max-width:240px;white-space:normal;line-height:1.35;">${sanitize(note)} <span style="opacity:0.6;">${sanitize(t.accountName || '')}</span></td>
        </tr>`;
    },

    exportTransactions() {
        const rows = this.txAll || [];
        if (rows.length === 0) { this.showToast('No transactions to export', 'error'); return; }
        const header = ['Operation', 'Symbol', 'Holding', 'Date', 'Shares', 'Price', 'Amount', 'Currency', 'Account'];
        const esc = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
        const lines = [header.join(',')];
        rows.forEach(t => lines.push([
            (t.type || t.action || ''), t.symbol || '', t.description || '',
            t.date ? new Date(t.date).toISOString().slice(0, 10) : '',
            t.units ?? '', t.price ?? '', t.amount ?? '', t.currencyCode || '', t.accountName || ''
        ].map(esc).join(',')));
        const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `centralfolio-transactions-${new Date().toISOString().slice(0, 10)}.csv`;
        document.body.appendChild(a); a.click(); a.remove();
        URL.revokeObjectURL(url);
        this.showToast('Transactions exported');
    },

    _downloadCsv(filename, header, rows) {
        const esc = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
        const lines = [header.join(','), ...rows.map(r => r.map(esc).join(','))];
        const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a); a.click(); a.remove();
        URL.revokeObjectURL(url);
    },

    exportTax() {
        const t = App.taxData;
        if (!t || !t.byAccount || t.byAccount.length === 0) { this.showToast('No tax data to export', 'error'); return; }
        const rows = [
            ...t.byAccount.map(a => ['By account', a.key, a.income, a.withheld, a.rate]),
            ...t.byCountry.map(c => ['By country', c.key, c.income, c.withheld, c.rate]),
            ['Total', '', t.totalIncome, t.totalWithheld, t.effectiveRate],
        ];
        this._downloadCsv(
            `centralfolio-dividend-tax-${new Date().toISOString().slice(0, 10)}.csv`,
            ['Breakdown', 'Key', 'Income', 'Withheld', 'Rate'],
            rows
        );
        this.showToast('Tax estimate exported');
    },

    exportRealizedGains() {
        const r = App.realizedGainsData;
        if (!r || !r.byYear || r.byYear.length === 0) { this.showToast('No realized gains to export', 'error'); return; }
        const rows = [
            ...r.byYear.map(y => ['By year', y.year, y.gain, y.taxableGain]),
            ...r.byAccount.map(a => ['By account', a.account, a.gain, a.registered ? 'Tax-free' : 'Taxable']),
            ['Total', '', r.totalGain, r.taxableAccountGain],
        ];
        this._downloadCsv(
            `centralfolio-realized-gains-${new Date().toISOString().slice(0, 10)}.csv`,
            ['Breakdown', 'Key', 'Gain', 'Taxable/Status'],
            rows
        );
        this.showToast('Realized gains exported');
    },

    renderJobsPanel(jobs) {
        const el = document.getElementById('jobsPanel');
        if (!el) return;
        if (!jobs || jobs.length === 0) {
            el.innerHTML = '<div class="empty-state" style="padding:1rem;"><p>No jobs registered.</p></div>';
            return;
        }

        const fmtInterval = ms => {
            if (!ms) return 'Manual only';
            const h = ms / 3_600_000;
            if (h < 1)  return `Every ${Math.round(h * 60)}m`;
            if (h < 24) return `Every ${h % 1 === 0 ? h : h.toFixed(1)}h`;
            const d = h / 24;
            return `Every ${d % 1 === 0 ? d : d.toFixed(1)}d`;
        };

        el.innerHTML = jobs.map(job => {
            const isRunning   = job.status === 'running';
            const isFailed    = job.status === 'failed';
            const statusColor = isRunning ? 'var(--primary)' : isFailed ? 'var(--danger)' : job.lastRunAt ? 'var(--success)' : 'var(--text-secondary)';
            const statusLabel = isRunning ? 'Running…' : isFailed ? 'Failed' : job.lastRunAt ? 'Completed' : 'Never run';
            const lastRun  = job.lastRunAt   ? new Date(job.lastRunAt).toLocaleString()  : '—';
            const nextRun  = job.nextRunAt   ? new Date(job.nextRunAt).toLocaleString()  : '—';
            const duration = job.lastDurationMs != null
                ? job.lastDurationMs < 1000 ? `${job.lastDurationMs}ms` : `${(job.lastDurationMs / 1000).toFixed(1)}s`
                : '';
            const currentHours = job.intervalMs ? job.intervalMs / 3_600_000 : 0;

            return `
            <div style="padding:0.9rem 0;border-bottom:1px solid var(--border);">
              <div style="display:flex;align-items:flex-start;gap:1rem;">
                <div style="flex:1;min-width:0;">
                  <div style="font-weight:600;font-size:0.9rem;">${sanitize(job.label)}</div>
                  <div class="text-muted text-sm" style="margin-top:0.15rem;">
                    Last run: ${sanitize(lastRun)}${duration ? ` · ${sanitize(duration)}` : ''}
                    ${job.lastError ? `<br><span style="color:var(--danger);">${sanitize(job.lastError)}</span>` : ''}
                  </div>
                  <div class="text-muted text-sm">Next: ${sanitize(nextRun)} &middot; ${sanitize(fmtInterval(job.intervalMs))}</div>
                </div>
                <div style="display:flex;flex-direction:column;align-items:flex-end;gap:0.4rem;flex-shrink:0;">
                  <span style="font-size:0.75rem;font-weight:600;color:${statusColor};">
                    ${isRunning ? '<span class="loader" style="display:inline-block;width:10px;height:10px;border-width:2px;vertical-align:middle;margin-right:4px;"></span>' : ''}
                    ${sanitize(statusLabel)}
                  </span>
                  <button class="btn btn-outline" style="padding:0.25rem 0.75rem;font-size:0.8rem;"
                      onclick="App.handleTriggerJob('${sanitize(job.name)}')"
                      ${isRunning ? 'disabled' : ''}>
                    ${isRunning ? 'Running…' : 'Run now'}
                  </button>
                </div>
              </div>
              <div style="display:flex;align-items:center;gap:0.5rem;margin-top:0.65rem;flex-wrap:nowrap;">
                <span style="font-size:0.8rem;color:var(--text-secondary);white-space:nowrap;">Run every</span>
                <input id="job-interval-${sanitize(job.name)}"
                  type="number" min="0" step="0.5"
                  value="${currentHours}"
                  style="width:72px;padding:0.25rem 0.4rem;font-size:0.85rem;border:1px solid var(--border);border-radius:6px;background:var(--surface-2);color:var(--text-primary);">
                <span style="font-size:0.8rem;color:var(--text-secondary);white-space:nowrap;">hrs</span>
                <button class="btn btn-outline" style="padding:0.25rem 0.65rem;font-size:0.8rem;white-space:nowrap;"
                    onclick="App.handleUpdateJobSchedule('${sanitize(job.name)}')">
                  Save
                </button>
                <span style="font-size:0.75rem;color:var(--text-muted);white-space:nowrap;">0 = manual only</span>
              </div>
            </div>`;
        }).join('');
    },

    renderApiTokens(tokens) {
        const el = document.getElementById('apiTokenList');
        if (!el) return;

        if (!tokens || tokens.length === 0) {
            el.innerHTML = '<div class="empty-state" style="padding:1rem;">No API tokens yet.</div>';
            return;
        }

        el.innerHTML = tokens.map(t => {
            const created  = t.createdAt  ? new Date(t.createdAt).toLocaleString()  : '—';
            const lastUsed = t.lastUsedAt ? new Date(t.lastUsedAt).toLocaleString() : 'Never used';
            return `
            <div style="display:flex;align-items:center;justify-content:space-between;padding:0.7rem 0;border-bottom:1px solid var(--border);">
              <div style="min-width:0;">
                <div style="font-weight:600;font-size:0.9rem;">${sanitize(t.name)}</div>
                <div class="text-muted text-sm" style="margin-top:0.15rem;">Created ${sanitize(created)} · ${sanitize(lastUsed)}</div>
              </div>
              <button class="btn btn-danger btn-sm" title="Revoke" onclick="App.handleRevokeApiToken('${sanitize(t.id)}', '${sanitize(t.name).replace(/'/g, "\\'")}')">Revoke</button>
            </div>`;
        }).join('');
    },

    _logLevelColor(level) {
        return { debug: 'var(--text-secondary)', info: 'var(--text)', warn: 'var(--warning)', error: 'var(--danger)' }[level] || 'var(--text)';
    },

    _logLineHtml(e) {
        const time  = new Date(e.ts).toLocaleTimeString(undefined, { hour12: false }) + '.' + String(new Date(e.ts).getMilliseconds()).padStart(3, '0');
        const color = this._logLevelColor(e.level);
        const lvl   = e.level === 'info' ? '' : `<span style="color:${color};font-weight:700;">${e.level.toUpperCase()}</span> `;
        return `<div class="logs-line" data-level="${sanitize(e.level)}" data-tag="${sanitize(e.tag.toLowerCase())}" style="white-space:pre-wrap;word-break:break-word;padding:1px 0;color:${color};opacity:${e.level === 'debug' ? '0.7' : '1'};">` +
            `<span style="color:var(--text-muted);">${time}</span> ${lvl}<span style="color:var(--primary);font-weight:600;">[${sanitize(e.tag)}]</span> ${sanitize(e.msg)}` +
            `</div>`;
    },

    /** Full replace — used for the initial snapshot and whenever the level filter changes. */
    renderLogs(entries) {
        const el = document.getElementById('logsConsole');
        if (!el) return;
        el.innerHTML = (entries || []).map(e => this._logLineHtml(e)).join('');
        el.scrollTop = el.scrollHeight;
    },

    /** Live single-line append, capped so the DOM can't grow without bound. */
    appendLogLine(entry, autoscroll = true, maxLines = 1000) {
        const el = document.getElementById('logsConsole');
        if (!el) return;
        el.insertAdjacentHTML('beforeend', this._logLineHtml(entry));
        while (el.children.length > maxLines) el.removeChild(el.firstChild);
        if (autoscroll) el.scrollTop = el.scrollHeight;
    },

    renderJobHistoryPanel(history) {
        const el = document.getElementById('jobHistoryPanel');
        if (!el) return;
        if (!history || history.length === 0) {
            el.innerHTML = '<div class="empty-state" style="padding:1rem;"><p>No execution history available.</p></div>';
            return;
        }

        const jobLabels = {
            'dividend-fetch': 'Dividend Fetch',
            'holdings-refresh': 'Holdings Refresh',
            'transactions-refresh': 'Transactions Refresh'
        };

        const renderInfoOrError = (h) => {
            if (h.status === 'failed' && h.error) {
                return `<span style="color:var(--danger);">${sanitize(h.error)}</span>`;
            }
            if (h.info) {
                return `<span style="color:var(--text);">${sanitize(h.info)}</span>`;
            }
            return '<span class="text-muted">—</span>';
        };

        const durationStr = (ms) => {
            if (ms == null) return '—';
            if (ms < 1000) return `${ms}ms`;
            return `${(ms / 1000).toFixed(1)}s`;
        };

        const dateStr = (ts) => {
            if (!ts) return '—';
            return new Date(ts).toLocaleTimeString() + ' ' + new Date(ts).toLocaleDateString();
        };

        const getStatusBadge = (status) => {
            const colors = {
                'completed': 'var(--success)',
                'failed': 'var(--danger)',
                'running': 'var(--primary)'
            };
            const label = status.charAt(0).toUpperCase() + status.slice(1);
            return `<span style="font-weight:600;color:${colors[status] || 'var(--text-secondary)'};">${sanitize(label)}</span>`;
        };

        const getTriggerBadge = (trigger) => {
            const bgColors = {
                'scheduled': 'var(--surface-2)',
                'manual': 'rgba(0,208,156,0.08)',
                'startup': 'rgba(245,166,35,0.08)'
            };
            const fontColors = {
                'scheduled': 'var(--text-muted)',
                'manual': 'var(--primary)',
                'startup': 'var(--warning)'
            };
            const label = trigger.charAt(0).toUpperCase() + trigger.slice(1);
            return `<span style="padding:0.25rem 0.55rem;background:${bgColors[trigger] || 'var(--surface-2)'};color:${fontColors[trigger] || 'var(--text)'};font-size:0.72rem;font-weight:600;border-radius:4px;display:inline-block;text-align:center;min-width:75px;">${sanitize(label)}</span>`;
        };

        el.innerHTML = `
            <div class="hb-scroll" style="max-height:360px;overflow-y:auto;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--surface);">
                <table class="hb-table" style="width:100%;font-size:0.82rem;">
                    <thead>
                        <tr>
                            <th style="text-align:left;padding:0.6rem 0.8rem;">Job</th>
                            <th style="text-align:left;padding:0.6rem 0.8rem;">Trigger</th>
                            <th style="text-align:left;padding:0.6rem 0.8rem;">Status</th>
                            <th style="text-align:left;padding:0.6rem 0.8rem;">Time</th>
                            <th style="text-align:right;padding:0.6rem 0.8rem;">Duration</th>
                            <th style="text-align:left;padding:0.6rem 0.8rem;width:40%;">Details</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${history.map(h => `
                            <tr>
                                <td style="padding:0.6rem 0.8rem;font-weight:600;white-space:nowrap;">${sanitize(jobLabels[h.jobName] || h.jobName)}</td>
                                <td style="padding:0.6rem 0.8rem;white-space:nowrap;">${getTriggerBadge(h.triggerType)}</td>
                                <td style="padding:0.6rem 0.8rem;white-space:nowrap;">${getStatusBadge(h.status)}</td>
                                <td style="padding:0.6rem 0.8rem;white-space:nowrap;color:var(--text-muted);">${sanitize(dateStr(h.startedAt))}</td>
                                <td style="padding:0.6rem 0.8rem;text-align:right;white-space:nowrap;font-feature-settings:'tnum';">${sanitize(durationStr(h.durationMs))}</td>
                                <td style="padding:0.6rem 0.8rem;font-size:0.78rem;line-height:1.35;word-break:break-word;">${renderInfoOrError(h)}</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
        `;
    },

    renderAdminUsers(users) {
        if (!users || users.length === 0) {
            this.adminUserList.innerHTML = '<div class="empty-state" style="padding:1rem;"><p>No users found.</p></div>';
            return;
        }
        this.adminUserList.innerHTML = users.map(u => `
            <div class="admin-user-row">
                <span class="admin-user-id">${sanitize(u)}</span>
                <button class="btn btn-danger btn-sm" onclick="App.deleteAdminUser('${sanitize(u)}')">Delete</button>
            </div>
        `).join('');
    },

    renderDashboardChart(currentGroups, inactiveAccountIds, holdingsData = null) {
        const area = document.getElementById('dashboardChartArea');
        if (!area) return;

        const theme = this.getChartTheme();
        if (!holdingsData && typeof App !== 'undefined') {
            holdingsData = App.getFilteredHoldingsData();
        }

        if (!holdingsData || holdingsData.length === 0) {
            if (this.accountsChartInstance) {
                this.accountsChartInstance.destroy();
                this.accountsChartInstance = null;
            }
            area.innerHTML = '<div class="empty-state"><div class="empty-icon">📈</div><p>No position data available. Click Refresh to load position data.</p></div>';
            return;
        }

        // Build a map of portfolio name → total market value.
        // When user portfolios are defined, each slice = one user portfolio.
        // Fallback: each slice = one brokerage connection.
        const portfolioMap = new Map();
        const userPortfolios = (typeof App !== 'undefined' && App.userPortfolios && App.userPortfolios.length > 0)
            ? App.userPortfolios : null;

        if (userPortfolios) {
            for (const up of userPortfolios) {
                const accountIdSet = new Set(up.accountIds || []);
                let val = 0;

                holdingsData.forEach(acct => {
                    if (!accountIdSet.has(acct.accountId)) return;
                    if (inactiveAccountIds && inactiveAccountIds.has(acct.accountId)) return;
                    if (acct.error) return;
                    (acct.holdings || []).forEach(pos => {
                        const units = pos.units || 0;
                        const price = pos.price || 0;
                        val += pos.marketValue || (units * price) || 0;
                    });
                });

                if (currentGroups) {
                    currentGroups.forEach(g => {
                        (g.accounts || []).forEach(acc => {
                            if (!accountIdSet.has(acc.id)) return;
                            if (inactiveAccountIds && inactiveAccountIds.has(acc.id)) return;
                            val += acc.balance?.cash?.amount || 0;
                        });
                    });
                }

                if (val > 0) portfolioMap.set(up.name, (portfolioMap.get(up.name) || 0) + val);
            }
        } else if (currentGroups) {
            // Fallback: one slice per brokerage connection.
            currentGroups.forEach(g => {
                const name = g.name || g.portfolioName || 'Unknown';
                let val = 0;

                holdingsData.forEach(acct => {
                    const belongs = (g.accounts || []).some(a => a.id === acct.accountId);
                    if (!belongs) return;
                    if (inactiveAccountIds && inactiveAccountIds.has(acct.accountId)) return;
                    if (acct.error) return;
                    (acct.holdings || []).forEach(pos => {
                        const units = pos.units || 0;
                        const price = pos.price || 0;
                        val += pos.marketValue || (units * price) || 0;
                    });
                });

                (g.accounts || []).forEach(acc => {
                    if (inactiveAccountIds && inactiveAccountIds.has(acc.id)) return;
                    val += acc.balance?.cash?.amount || 0;
                });

                if (val > 0) portfolioMap.set(name, (portfolioMap.get(name) || 0) + val);
            });
        }

        const activeSlices = Array.from(portfolioMap.entries())
            .map(([label, value]) => ({ label, value }))
            .filter(slice => slice.value > 0);

        activeSlices.sort((a, b) => b.value - a.value);

        if (activeSlices.length === 0) {
            if (this.accountsChartInstance) {
                this.accountsChartInstance.destroy();
                this.accountsChartInstance = null;
            }
            area.innerHTML = '<div class="empty-state"><div class="empty-icon">📈</div><p>No position data available.</p></div>';
            return;
        }

        if (!document.getElementById('accountsChart')) {
            area.innerHTML = '<canvas id="accountsChart" style="max-height:320px;"></canvas>';
        }

        const ctx    = document.getElementById('accountsChart').getContext('2d');
        const labels = activeSlices.map(a => a.label);
        const data   = activeSlices.map(a => a.value);

        const palette = [
            '#00d09c','#4f8ef7','#f7c948','#f76f8e','#a78bfa',
            '#38bdf8','#fb923c','#34d399','#e879f9','#facc15',
            '#60a5fa','#f87171','#2dd4bf','#c084fc','#fbbf24'
        ];
        const bgColors = activeSlices.map((_, i) => palette[i % palette.length] + 'cc');

        if (this.accountsChartInstance) {
            this.accountsChartInstance.data.labels                         = labels;
            this.accountsChartInstance.data.datasets[0].data               = data;
            this.accountsChartInstance.data.datasets[0].backgroundColor    = bgColors;
            this.accountsChartInstance.options.plugins.tooltip.backgroundColor = theme.tooltipBg;
            this.accountsChartInstance.options.plugins.tooltip.borderColor = theme.tooltipBorder;
            this.accountsChartInstance.update('none');
            return;
        }

        if (typeof Chart === 'undefined') return;

        Chart.defaults.color       = theme.textColor;
        Chart.defaults.font.family = "'Inter', system-ui, sans-serif";

        this.accountsChartInstance = new Chart(ctx, {
            type: 'doughnut',
            data: {
                labels,
                datasets: [{
                    label: 'Net Value',
                    data,
                    backgroundColor: bgColors,
                    borderColor: 'transparent',
                    borderWidth: 0,
                    hoverOffset: 8
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        display: false
                    },
                    tooltip: {
                        callbacks: {
                            label(ctx) {
                                if (localStorage.getItem('cf_mask_values') === 'true') {
                                    return ` ${ctx.label}: $•••••`;
                                }
                                return ` ${ctx.label}: ${new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(ctx.parsed)}`;
                            }
                        },
                        backgroundColor: theme.tooltipBg,
                        titleFont: { size: 13 },
                        bodyFont:  { size: 13 },
                        padding: 12,
                        cornerRadius: 8,
                        borderColor: theme.tooltipBorder,
                        borderWidth: 1
                    }
                },
                cutout: '70%',
                animation: { animateScale: true, animateRotate: true }
            }
        });
    },

    toggleChartSlice(index) {
        if (this.accountsChartInstance) {
            const isVisible = this.accountsChartInstance.getDataVisibility(index);
            if (isVisible) {
                this.accountsChartInstance.hide(0, index);
            } else {
                this.accountsChartInstance.show(0, index);
            }
            const row = document.getElementById(`breakdown-row-${index}`);
            if (row) {
                row.style.opacity = isVisible ? '0.35' : '1';
            }
        }
    },

    renderDividendAccountTabs(cachedDividendsData, selectedAccountId) {
        const tabsContainer = document.getElementById('dividend-account-tabs');
        if (!tabsContainer) return;

        const activeSubTab = document.querySelector('#dividend-sub-tabs .pill-tab.active')?.getAttribute('data-subtab');
        if (activeSubTab === 'database') {
            tabsContainer.style.display = 'none';
            return;
        }

        let activeAccounts = cachedDividendsData.filter(acct => !acct.error);
        if (activeAccounts.length === 0) {
            tabsContainer.style.display = 'none';
            tabsContainer.innerHTML = '';
            return;
        }

        let tabsHtml = '';
        if (App.selectedUserPortfolioId === 'all') {
            // Global selection is All Portfolios
            const portfolios = App.userPortfolios || [];
            
            if (portfolios.length === 0) {
                tabsContainer.style.display = 'none';
                tabsContainer.innerHTML = '';
                return;
            }

            portfolios.forEach(p => {
                const isSelected = selectedAccountId === `portfolio-${p.id}`;
                tabsHtml += `<button class="pill-tab ${isSelected ? 'active' : ''}" onclick="App.switchDividendAccountTab('portfolio-${p.id}')">${sanitize(p.name)}</button>`;
            });
        } else {
            // Global selection is a specific user portfolio
            tabsHtml += `<button class="pill-tab ${selectedAccountId === 'all' ? 'active' : ''}" onclick="App.switchDividendAccountTab('all')">All Accounts</button>`;
            activeAccounts.forEach(acct => {
                const isSelected = selectedAccountId === acct.accountId;
                tabsHtml += `<button class="pill-tab ${isSelected ? 'active' : ''}" onclick="App.switchDividendAccountTab('${acct.accountId}')">${sanitize(acct.accountName || 'Unnamed')}</button>`;
            });
        }

        tabsContainer.innerHTML = tabsHtml;
        tabsContainer.style.display = 'flex';
    },

    // Transaction activity types that represent a dividend/distribution landing
    // in the account (uppercased for comparison).
    _DIV_TYPES: ['DIVIDEND', 'DIV', 'DISTRIBUTION'],

    // Annotate each forecast event with a `_status`:
    //   'received' — a matching dividend transaction was found in the account
    //   'expected' — projected, date still in the future (or today)
    //   'overdue'  — projected date has passed with no matching transaction
    // Matching is per account + symbol, claiming the nearest unused dividend
    // transaction within a frequency-aware date tolerance so monthly payers do
    // not match an adjacent month. `events` are tagged in place and returned.
    tagDividendStatus(events, txData) {
        // Delegates to the pure, unit-tested implementation in divmath.js.
        return DivMath.tagDividendStatus(events, txData, this._DIV_TYPES);
    },

    // Small 3-state legend shown above the forecast list and the calendar.
    dividendLegendHtml() {
        return `<div class="divlegend">
            <span class="divlegend-item"><span class="divlegend-dot div-expected"></span>Expected</span>
            <span class="divlegend-item"><span class="divlegend-dot div-received"></span>Received</span>
            <span class="divlegend-item"><span class="divlegend-dot div-overdue"></span>Overdue</span>
        </div>`;
    },

    _freqName(f) {
        return ({ 1: 'Annual', 2: 'Semi-annual', 4: 'Quarterly', 6: 'Bi-monthly', 12: 'Monthly', 24: 'Semi-monthly', 26: 'Bi-weekly', 52: 'Weekly' })[f] || '—';
    },

    _fmtDate(s) {
        if (!s) return '—';
        const d = new Date(s);
        return isNaN(d) ? sanitize(s) : d.toLocaleDateString('default', { day: 'numeric', month: 'short', year: 'numeric' });
    },

    // Snowball-style stock detail page: header, dividends panel, my positions.
    // `state`: 'loading' | 'ready' | 'error' — controls the Snowball-derived panel.
    renderStockDetail(symbol, asset, positions, state = 'ready') {
        const host = document.getElementById('stock-detail-content');
        if (!host) return;
        const cur = (asset && asset.currency) || (positions?.total?.currency) || 'CAD';
        const initials = (symbol || '?').replace(/[^A-Za-z0-9]/g, '').slice(0, 4).toUpperCase();

        // ── Header ──
        const logo = asset && asset.logoURL
            ? `<img src="${sanitize(asset.logoURL)}" alt="" class="sd-logo" onerror="this.style.display='none';this.nextElementSibling.style.display='flex';">
               <div class="sd-logo-fallback" style="display:none;">${sanitize(initials)}</div>`
            : `<div class="sd-logo-fallback">${sanitize(initials)}</div>`;
        const name = (asset && asset.name) || symbol;
        const sub = asset && (asset.ticker || asset.exchange)
            ? `${sanitize(asset.ticker || symbol)}${asset.exchange ? ' · ' + sanitize(asset.exchange) : ''}${asset.sector && asset.sector !== 'Other' ? ' · ' + sanitize(asset.sector) : ''}`
            : sanitize(symbol);

        let priceBlock = '';
        if (asset && asset.price != null) {
            const dc = asset.dayChange || 0, dcp = asset.dayChangePct || 0;
            const cls = dc >= 0 ? 'pos' : 'neg';
            priceBlock = `<div class="sd-price">${this.moneyC(asset.price, cur)}
                <span class="sd-daychange ${cls}">${dc >= 0 ? '+' : '-'}${this.moneyC(dc, cur)} (${this.arrow(dc)} ${this.pct(Math.abs(dcp))})</span>
            </div>`;
        } else if (state === 'loading') {
            priceBlock = `<div class="sd-price text-muted">Loading…</div>`;
        }
        const yieldBlock = asset && asset.dividendYield != null
            ? `<div class="sd-yield"><div class="sd-yield-label">Dividend yield</div><div class="sd-yield-val">${this.pct(asset.dividendYield)}</div></div>`
            : '';

        const header = `<div class="sd-header">
            <div class="sd-id">${logo}<div class="sd-id-text"><div class="sd-name">${sanitize(name)}</div><div class="sd-sub">${sub}</div></div></div>
            <div class="sd-head-right">${priceBlock}${yieldBlock}</div>
        </div>`;

        // ── Dividends panel ──
        let divPanel;
        if (state === 'error' || (state === 'ready' && !asset)) {
            divPanel = `<div class="card sd-card"><div class="card-title mb-2">Dividends</div><p class="text-muted text-sm">Details unavailable from Snowball Analytics for this symbol.</p></div>`;
        } else if (asset) {
            const row = (label, val) => `<div class="sd-divrow"><span>${label}</span><strong>${val}</strong></div>`;
            // Yield on cost = annual dividend per share ÷ your average cost per share.
            // Highlights how the income on your original investment has grown.
            const totAvgCost = positions?.total?.avgCost || positions?.rows?.[0]?.avgCost || 0;
            const yoc = (asset.annualPayout != null && totAvgCost > 0) ? (asset.annualPayout / totAvgCost) * 100 : null;
            const yocRow = yoc != null
                ? row('Yield on cost', `<span class="pos">${this.pct(yoc)}</span>`)
                : '';
            // Heuristic dividend-safety grade (A–F) from streak / growth / yield.
            const safety = DivMath.dividendSafety(asset);
            const safetyRow = safety
                ? row('Dividend safety', `<span class="div-grade div-grade-${safety.grade}" title="${sanitize(safety.factors.join(' · '))}">${safety.grade}</span> <span class="text-muted text-sm">(${safety.score}/100)</span>`)
                : '';
            divPanel = `<div class="card sd-card">
                <div class="card-title mb-2">Dividends</div>
                ${safetyRow}
                ${row('Dividend yield', asset.dividendYield != null ? this.pct(asset.dividendYield) : '—')}
                ${yocRow}
                ${row('Annual payout', asset.annualPayout != null ? this.moneyC(asset.annualPayout, cur) : '—')}
                ${row('Frequency', this._freqName(asset.frequency))}
                ${row('Next ex-div date', this._fmtDate(asset.exDividendDate))}
                ${row('Next pay date', this._fmtDate(asset.nextDividendDate))}
                ${row('Dividend growth streak', asset.growthStreak != null ? `${asset.growthStreak} y` : '—')}
                ${row('5Y dividend growth', asset.growth5Y != null ? this.pct(asset.growth5Y) : '—')}
            </div>`;
        } else {
            divPanel = `<div class="card sd-card"><div class="card-title mb-2">Dividends</div><p class="text-muted text-sm"><span class="loader" style="display:inline-block;width:14px;height:14px;border-top-color:var(--primary);"></span> Loading…</p></div>`;
        }

        // ── My positions ──
        // Per-share annual dividend (from Snowball asset detail) drives the
        // per-position Yield-on-Cost and projected annual income lines.
        const annualPerShare = asset && asset.annualPayout != null ? asset.annualPayout : null;
        const posCard = (r, isTotal) => {
            const m = n => this.moneyC(n, r.currency || cur);
            const signed = (n, p) => `<span class="${n >= 0 ? 'pos' : 'neg'}">${n < 0 ? '-' : '+'}${m(n)}${p != null ? ` (${this.arrow(n)} ${this.pct(Math.abs(p))})` : ''}</span>`;
            const line = (label, val) => `<div class="sd-posrow"><span>${label}</span><span class="sd-posval">${val}</span></div>`;
            const yoc = (annualPerShare != null && r.avgCost > 0) ? (annualPerShare / r.avgCost) * 100 : null;
            const annualIncome = (annualPerShare != null && r.units) ? annualPerShare * r.units : null;
            return `<div class="card sd-poscard${isTotal ? ' sd-poscard-total' : ''}">
                <div class="sd-poshead">
                    <span class="sd-posacct">${sanitize(r.accountName || 'Account')}</span>
                    <span class="sd-posshares">${(r.units || 0).toLocaleString(undefined, { maximumFractionDigits: 4 })} shares</span>
                </div>
                <div class="sd-posvalue">${m(r.value)}</div>
                ${line('Cost per share', m(r.avgCost))}
                ${line('Profit', signed(r.profit, r.profitPct))}
                ${line('Capital gain', signed(r.capitalGain, r.capitalGainPct))}
                ${line('Dividends received', `<span style="color:var(--primary);">+${m(r.dividends)}</span>`)}
                ${annualIncome != null ? line('Annual income', `<span style="color:var(--primary);">${m(annualIncome)}</span>`) : ''}
                ${yoc != null ? line('Yield on cost', `<span class="pos">${this.pct(yoc)}</span>`) : ''}
                ${r.pctInPortfolio != null ? line('% in portfolio', this.pct(r.pctInPortfolio)) : ''}
            </div>`;
        };

        let posSection;
        if (positions && positions.rows && positions.rows.length) {
            const cards = [];
            if (positions.total && positions.rows.length > 1) cards.push(posCard({ ...positions.total, accountName: 'All positions' }, true));
            positions.rows.forEach(r => cards.push(posCard(r, false)));
            posSection = `<div class="sd-pos-title">My positions</div><div class="sd-pos-grid">${cards.join('')}</div>`;
        } else {
            posSection = `<div class="sd-pos-title">My positions</div><div class="empty-state" style="padding:1.5rem;"><p>You don't hold ${sanitize(symbol)} in any active account.</p></div>`;
        }

        // Price history chart — filled in asynchronously by App.loadPriceHistory().
        const chartCard = `<div class="card sd-chart-card" id="sd-pricehistory">
            <div class="sd-chart-head"><div class="card-title">Price history</div></div>
            <div class="sd-chart-body"><p class="text-muted text-sm" style="padding:1rem 0;">
                <span class="loader" style="display:inline-block;width:14px;height:14px;border-top-color:var(--primary);vertical-align:-2px;"></span> Loading price history…
            </p></div>
        </div>`;

        host.innerHTML = `${header}${chartCard}<div class="sd-body">${divPanel}</div>${posSection}`;
    },

    // Ranges offered by the chart's pill selector. 'all' uses every stored candle.
    _PRICE_RANGES: [
        { key: '7d',  label: '7d',  days: 7 },
        { key: '1m',  label: '1m',  days: 31 },
        { key: '3m',  label: '3m',  days: 92 },
        { key: '6m',  label: '6m',  days: 183 },
        { key: 'ytd', label: 'YTD' },
        { key: '1y',  label: '1y',  days: 366 },
        { key: '5y',  label: '5y',  days: 1827 },
        { key: 'all', label: 'all' },
    ],

    // Filter the full candle set down to the selected range (client-side, so
    // switching ranges is instant after the initial fetch).
    _filterCandlesByRange(candles, rangeKey) {
        if (!candles || !candles.length) return [];
        if (rangeKey === 'all') return candles;
        let cutoff;
        if (rangeKey === 'ytd') {
            cutoff = `${new Date().getFullYear()}-01-01`;
        } else {
            const def = this._PRICE_RANGES.find(r => r.key === rangeKey);
            const days = def?.days ?? 1827;
            const d = new Date();
            d.setDate(d.getDate() - days);
            cutoff = d.toISOString().slice(0, 10);
        }
        const out = candles.filter(c => c.date >= cutoff);
        // Guarantee at least two points so the chart can draw a line.
        return out.length >= 2 ? out : candles.slice(-2);
    },

    // Render the price-history card for the given symbol. `candles` is the full
    // stored series; `rangeKey` selects the visible window.
    renderPriceHistory(symbol, candles, rangeKey, cur, state = 'ready', extras = {}) {
        const card = document.getElementById('sd-pricehistory');
        if (!card) return;

        if (state === 'error' || !candles || candles.length < 2) {
            card.innerHTML = `<div class="sd-chart-head"><div class="card-title">Price history</div></div>
                <div class="sd-chart-body"><p class="text-muted text-sm" style="padding:1rem 0;">No price history available for ${sanitize(symbol)}.</p></div>`;
            return;
        }

        const pills = this._PRICE_RANGES.map(r =>
            `<button class="sd-range-pill${r.key === rangeKey ? ' active' : ''}" onclick="App.setPriceHistoryRange('${r.key}')">${r.label}</button>`
        ).join('');

        const view = this._filterCandlesByRange(candles, rangeKey);
        const first = view[0], last = view[view.length - 1];
        const change = (last.close ?? 0) - (first.close ?? 0);
        const changePct = first.close ? (change / first.close) * 100 : 0;
        const cls = change >= 0 ? 'pos' : 'neg';
        const fmtD = s => new Date(s + 'T00:00:00Z').toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: '2-digit', timeZone: 'UTC' });

        const summary = `<div class="sd-chart-summary">
            <span class="sd-chart-range-lbl">${fmtD(first.date)} – ${fmtD(last.date)}</span>
            <span class="sd-chart-change ${cls}">${change >= 0 ? '+' : '-'}${this.moneyC(Math.abs(change), cur)}
                <span class="sd-chart-chgpct">(${this.arrow(change)} ${this.pct(Math.abs(changePct))})</span>
            </span>
        </div>`;

        card.innerHTML = `<div class="sd-chart-head">
                <div class="card-title">Price history</div>
                ${summary}
            </div>
            <div class="sd-chart-pills">${pills}</div>
            <div class="sd-chart-body">${this._buildPriceChartSVG(view, cur, extras)}</div>`;
    },

    // Build the SVG area/line chart (line + gradient fill, Y gridlines, X labels,
    // min/max annotations, and a hover crosshair driven by inline JS).
    _buildPriceChartSVG(candles, cur, extras = {}) {
        const W = 1000, H = 380;
        const padL = 8, padR = 70, padT = 28, padB = 30;
        const plotW = W - padL - padR, plotH = H - padT - padB;
        const trades = Array.isArray(extras.trades) ? extras.trades : [];
        // Cost-per-share lines: prefer the per-account breakdown, else a single
        // aggregate line (avgCost), else none.
        const costLines = (Array.isArray(extras.costLines) && extras.costLines.length)
            ? extras.costLines.filter(c => c.value > 0)
            : (extras.avgCost > 0 ? [{ label: 'My cost', value: extras.avgCost }] : []);

        const xs = candles.map(c => Date.parse(c.date + 'T00:00:00Z'));
        const ys = candles.map(c => c.close ?? 0);
        const xMin = xs[0], xMax = xs[xs.length - 1] || xs[0] + 1;
        let yMin = Math.min(...ys), yMax = Math.max(...ys);
        // Include the cost lines in the visible range so they never clip off.
        costLines.forEach(c => { yMin = Math.min(yMin, c.value); yMax = Math.max(yMax, c.value); });
        if (yMin === yMax) { yMin -= 1; yMax += 1; }
        const yPad = (yMax - yMin) * 0.08;
        yMin -= yPad; yMax += yPad;

        const sx = t => padL + ((t - xMin) / (xMax - xMin || 1)) * plotW;
        const sy = v => padT + (1 - (v - yMin) / (yMax - yMin || 1)) * plotH;

        const pts = candles.map((c, i) => [sx(xs[i]), sy(ys[i])]);
        const linePath = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' ');
        const areaPath = `${linePath} L${pts[pts.length - 1][0].toFixed(1)} ${(padT + plotH).toFixed(1)} L${pts[0][0].toFixed(1)} ${(padT + plotH).toFixed(1)} Z`;

        // Y gridlines at ~4 "nice" steps.
        const yGrid = this._niceTicks(yMin, yMax, 4);
        const gridLines = yGrid.map(v => {
            const y = sy(v).toFixed(1);
            return `<line x1="${padL}" y1="${y}" x2="${padL + plotW}" y2="${y}" class="sd-chart-grid"/>
                    <text x="${(padL + plotW + 8).toFixed(1)}" y="${y}" class="sd-chart-axis" dominant-baseline="middle">${this._compactNum(v)}</text>`;
        }).join('');

        // X labels — pick ~6 evenly spaced candles; format by span.
        const spanDays = (xMax - xMin) / 86400000;
        const xFmt = spanDays > 400
            ? d => new Date(d).toLocaleDateString(undefined, { year: 'numeric', timeZone: 'UTC' })
            : spanDays > 60
                ? d => new Date(d).toLocaleDateString(undefined, { month: 'short', year: '2-digit', timeZone: 'UTC' })
                : d => new Date(d).toLocaleDateString(undefined, { day: 'numeric', month: 'short', timeZone: 'UTC' });
        const nLab = Math.min(6, candles.length);
        const xLabels = Array.from({ length: nLab }, (_, i) => {
            const idx = Math.round((i / (nLab - 1 || 1)) * (candles.length - 1));
            const x = sx(xs[idx]);
            const anchor = i === 0 ? 'start' : i === nLab - 1 ? 'end' : 'middle';
            return `<text x="${x.toFixed(1)}" y="${H - 8}" class="sd-chart-axis" text-anchor="${anchor}">${xFmt(xs[idx])}</text>`;
        }).join('');

        // Min / max annotations.
        const maxI = ys.indexOf(Math.max(...ys)), minI = ys.indexOf(Math.min(...ys));
        const annot = (i, label, above) => {
            const x = sx(xs[i]), y = sy(ys[i]);
            const tx = Math.max(padL, Math.min(x, padL + plotW - 60));
            return `<line x1="${padL}" y1="${y.toFixed(1)}" x2="${(padL + plotW).toFixed(1)}" y2="${y.toFixed(1)}" class="sd-chart-minmax"/>
                    <text x="${(tx).toFixed(1)}" y="${(y + (above ? -6 : 14)).toFixed(1)}" class="sd-chart-minmax-lbl">${label}: ${this.moneyC(ys[i], cur)}</text>`;
        };

        // Average cost-per-share lines, broken down by account (active scope).
        // Each account gets its own colored dashed line + label; labels are
        // staggered vertically so close cost bases don't overprint each other.
        let costLine = '';
        if (costLines.length) {
            const items = costLines
                .map((c, i) => ({ label: c.label, value: c.value, color: this._DIV_PALETTE[i % this._DIV_PALETTE.length], y: sy(c.value) }))
                .sort((a, b) => a.y - b.y);
            const lines = items.map(it =>
                `<line x1="${padL}" y1="${it.y.toFixed(1)}" x2="${(padL + plotW).toFixed(1)}" y2="${it.y.toFixed(1)}" class="sd-chart-costline" style="stroke:${it.color};"/>`
            ).join('');
            let lastLabelY = -Infinity;
            const single = items.length === 1;
            const labels = items.map(it => {
                let ly = it.y - 5;
                if (ly < lastLabelY + 14) ly = lastLabelY + 14;
                lastLabelY = ly;
                const name = single ? 'My cost per share' : ((it.label || '').length > 18 ? it.label.slice(0, 17) + '…' : it.label);
                return `<text x="${(padL + 6).toFixed(1)}" y="${ly.toFixed(1)}" class="sd-chart-cost-lbl" style="fill:${it.color};">${sanitize(name)}: ${this.moneyC(it.value, cur)}</text>`;
            }).join('');
            costLine = lines + labels;
        }

        const cid = 'c' + Math.random().toString(36).slice(2, 8);

        // Buy/sell markers placed on the line at each trade's date, each with a
        // styled hover tooltip describing the action, share count, price and date.
        const priceAt = t => {
            let best = 0, bd = Infinity;
            for (let i = 0; i < xs.length; i++) { const d = Math.abs(xs[i] - t); if (d < bd) { bd = d; best = i; } }
            return ys[best];
        };
        const tradeDots = trades.map(tr => {
            const t = Date.parse(tr.date + 'T00:00:00Z');
            if (isNaN(t) || t < xMin || t > xMax) return '';
            const x = sx(t), y = sy(priceAt(t));
            const isBuy = tr.action === 'BUY';
            const color = isBuy ? '#4f8ef7' : 'var(--danger)';
            const units = (tr.units || 0).toLocaleString(undefined, { maximumFractionDigits: 4 });
            const l1 = `${isBuy ? 'Bought' : 'Sold'} ${units} share${tr.units === 1 ? '' : 's'}`;
            const l2 = `@ ${this.moneyC(tr.price || 0, cur)} · ${tr.date}`;
            return `<circle class="sd-chart-trade" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="4.5" fill="${color}"
                data-l1="${sanitize(l1)}" data-l2="${sanitize(l2)}"
                onmouseenter="UI._tradeTipShow(event,'${cid}')" onmouseleave="UI._tradeTipHide('${cid}')"><title>${sanitize(l1 + ' ' + l2)}</title></circle>`;
        }).join('');

        const gradId = 'sdGrad';
        // Serialize point data for the hover handler.
        const dataAttr = candles.map((c, i) => `${xs[i]}:${ys[i]}`).join(',');

        return `<svg class="sd-chart-svg" id="${cid}" viewBox="0 0 ${W} ${H}"
                    data-pts="${dataAttr}" data-cur="${sanitize(cur)}"
                    data-geo="${padL},${padT},${plotW},${plotH},${xMin},${xMax},${yMin},${yMax}"
                    onmousemove="UI._priceHover(event,'${cid}')" onmouseleave="UI._priceHoverOut('${cid}')">
            <defs>
                <linearGradient id="${gradId}" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stop-color="var(--primary)" stop-opacity="0.28"/>
                    <stop offset="100%" stop-color="var(--primary)" stop-opacity="0"/>
                </linearGradient>
            </defs>
            ${gridLines}
            ${annot(maxI, 'max', true)}
            ${annot(minI, 'min', false)}
            <path d="${areaPath}" fill="url(#${gradId})" stroke="none"/>
            <path d="${linePath}" fill="none" stroke="var(--primary)" stroke-width="2" vector-effect="non-scaling-stroke"/>
            ${costLine}
            ${tradeDots}
            ${xLabels}
            <g class="sd-chart-cross" style="display:none;">
                <line class="sd-chart-crossline" y1="${padT}" y2="${padT + plotH}"/>
                <circle class="sd-chart-crossdot" r="4"/>
            </g>
            <g class="sd-chart-tip" style="display:none;">
                <rect rx="4" width="150" height="40"/>
                <text class="sd-chart-tip-d" x="8" y="16"></text>
                <text class="sd-chart-tip-p" x="8" y="32"></text>
            </g>
            <g class="sd-chart-tradetip" style="display:none;">
                <rect rx="4" width="200" height="40"/>
                <text class="sd-chart-tradetip-1" x="9" y="17"></text>
                <text class="sd-chart-tradetip-2" x="9" y="32"></text>
            </g>
        </svg>`;
    },

    // Styled tooltip for a buy/sell marker on the price chart.
    _tradeTipShow(evt, id) {
        const svg = document.getElementById(id);
        if (!svg) return;
        const c = evt.target;
        const tip = svg.querySelector('.sd-chart-tradetip');
        if (!tip) return;
        tip.querySelector('.sd-chart-tradetip-1').textContent = c.dataset.l1 || '';
        tip.querySelector('.sd-chart-tradetip-2').textContent = c.dataset.l2 || '';
        tip.style.display = '';
        const [padL, , plotW] = svg.dataset.geo.split(',').map(Number);
        const cx = +c.getAttribute('cx'), cy = +c.getAttribute('cy');
        const tipW = 200;
        const tx = Math.max(padL, Math.min(cx - tipW / 2, padL + plotW - tipW));
        const ty = Math.max(2, cy - 48);
        tip.setAttribute('transform', `translate(${tx.toFixed(1)},${ty.toFixed(1)})`);
    },

    _tradeTipHide(id) {
        const svg = document.getElementById(id);
        const tip = svg?.querySelector('.sd-chart-tradetip');
        if (tip) tip.style.display = 'none';
    },

    // Crosshair + tooltip handler (shared by all price charts via element id).
    _priceHover(evt, id) {
        const svg = document.getElementById(id);
        if (!svg) return;
        const pts = (svg.dataset.pts || '').split(',').map(s => { const [t, v] = s.split(':'); return [+t, +v]; });
        if (!pts.length) return;
        const [padL, padT, plotW, plotH, xMin, xMax, yMin, yMax] = svg.dataset.geo.split(',').map(Number);
        const cur = svg.dataset.cur || 'USD';

        // Map mouse → SVG user units (viewBox is 1000×380).
        const rect = svg.getBoundingClientRect();
        const vbW = 1000, vbH = 380;
        const ux = ((evt.clientX - rect.left) / rect.width) * vbW;

        const t = xMin + ((ux - padL) / (plotW || 1)) * (xMax - xMin);
        // Nearest candle by time.
        let best = 0, bestd = Infinity;
        for (let i = 0; i < pts.length; i++) { const d = Math.abs(pts[i][0] - t); if (d < bestd) { bestd = d; best = i; } }
        const [pt, pv] = pts[best];
        const cx = padL + ((pt - xMin) / (xMax - xMin || 1)) * plotW;
        const cy = padT + (1 - (pv - yMin) / (yMax - yMin || 1)) * plotH;

        const cross = svg.querySelector('.sd-chart-cross');
        const tip = svg.querySelector('.sd-chart-tip');
        cross.style.display = '';
        cross.querySelector('.sd-chart-crossline').setAttribute('x1', cx);
        cross.querySelector('.sd-chart-crossline').setAttribute('x2', cx);
        cross.querySelector('.sd-chart-crossdot').setAttribute('cx', cx);
        cross.querySelector('.sd-chart-crossdot').setAttribute('cy', cy);

        const dateStr = new Date(pt).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
        tip.style.display = '';
        tip.querySelector('.sd-chart-tip-d').textContent = dateStr;
        tip.querySelector('.sd-chart-tip-p').textContent = this.moneyC(pv, cur);
        const tipW = 150;
        const tx = Math.max(padL, Math.min(cx + 10, padL + plotW - tipW));
        tip.setAttribute('transform', `translate(${tx},${Math.max(padT, cy - 48)})`);
    },

    _priceHoverOut(id) {
        const svg = document.getElementById(id);
        if (!svg) return;
        const c = svg.querySelector('.sd-chart-cross'); if (c) c.style.display = 'none';
        const t = svg.querySelector('.sd-chart-tip'); if (t) t.style.display = 'none';
    },

    // "Nice" round tick values between lo and hi (~count steps).
    _niceTicks(lo, hi, count) {
        const span = hi - lo;
        if (span <= 0) return [lo];
        const raw = span / count;
        const mag = Math.pow(10, Math.floor(Math.log10(raw)));
        const norm = raw / mag;
        const step = (norm >= 5 ? 5 : norm >= 2 ? 2 : 1) * mag;
        const start = Math.ceil(lo / step) * step;
        const out = [];
        for (let v = start; v <= hi; v += step) out.push(Math.round(v * 1e6) / 1e6);
        return out;
    },

    _compactNum(v) {
        const a = Math.abs(v);
        if (a >= 1000) return (v / 1000).toFixed(a >= 10000 ? 0 : 1) + 'k';
        return a >= 100 ? v.toFixed(0) : v.toFixed(a >= 1 ? 1 : 2);
    },

    renderDividends(cachedDividendsData, selectedAccountId = 'all') {
        const container  = document.getElementById('dividends-page-content');
        const summaryRow = document.getElementById('dividendSummaryRow');
        if (!container) return;

        this.renderDividendAccountTabs(cachedDividendsData, selectedAccountId);

        let allEvents = [];
        let totalPortfolioValue = 0;

        cachedDividendsData.forEach(acct => {
            if (acct.error) return;

            let include = false;
            if (selectedAccountId === 'all') {
                include = true;
            } else if (selectedAccountId === 'unassigned') {
                const isAssigned = (App.userPortfolios || []).some(p => (p.accountIds || []).includes(acct.accountId));
                include = !isAssigned;
            } else if (String(selectedAccountId).startsWith('portfolio-')) {
                const pid = parseInt(selectedAccountId.split('-')[1], 10);
                const port = (App.userPortfolios || []).find(p => p.id === pid);
                include = port && (port.accountIds || []).includes(acct.accountId);
            } else {
                include = acct.accountId === selectedAccountId;
            }

            if (include) {
                if (App.currentGroups) {
                    App.currentGroups.forEach(g => {
                        (g.accounts || []).forEach(acc => {
                            if (acc.id === acct.accountId && !App.inactiveAccountIds?.has(acc.id)) {
                                totalPortfolioValue += acc.balance?.total?.amount || 0;
                            }
                        });
                    });
                }

                (acct.dividends || []).forEach(e => {
                    allEvents.push({ ...e, accountId: acct.accountId, portfolioName: acct.portfolioName, accountName: acct.accountName });
                });
            }
        });

        if (allEvents.length === 0) {
            container.innerHTML = '<div class="empty-state"><p>No dividend forecast events found. Ensure you have holdings with dividend history.</p></div>';
            if (summaryRow) summaryRow.style.display = 'none';
            return;
        }

        if (summaryRow) summaryRow.style.display = 'flex';

        allEvents.sort((a, b) => new Date(a.date) - new Date(b.date));
        this.tagDividendStatus(allEvents, (typeof App !== 'undefined' && App.getFilteredTransactionsData) ? App.getFilteredTransactionsData() : null);

        const annualTotal = allEvents.reduce((s, e) => s + (e.amountCAD ?? e.amount ?? 0), 0);
        const fmt = v => `$${v.toLocaleString(undefined, {minimumFractionDigits:2, maximumFractionDigits:2})}`;

        document.getElementById('unified-annual-income').textContent   = fmt(annualTotal);
        document.getElementById('unified-monthly-average').textContent = fmt(annualTotal / 12);
        document.getElementById('unified-daily-income').textContent    = fmt(annualTotal / 365);

        // Yield: annual income / total active portfolio value (filtered by selected account)
        try {
            const yieldEl = document.getElementById('unified-yield');
            if (totalPortfolioValue > 0) {
                yieldEl.textContent = `${((annualTotal / totalPortfolioValue) * 100).toFixed(2)}%`;
            } else {
                yieldEl.textContent = '—';
            }
        } catch (_) { document.getElementById('unified-yield').textContent = '—'; }

        // Yet to receive: events from today onwards within the 12-month window
        const todayStr = new Date().toLocaleDateString('en-CA');
        const yetToReceive = allEvents
            .filter(e => e.date.substring(0, 10) >= todayStr)
            .reduce((s, e) => s + (e.amountCAD ?? e.amount ?? 0), 0);
        document.getElementById('unified-yet-to-receive').textContent = fmt(yetToReceive);

        // Build 12-month buckets from today
        const now = new Date();
        const monthlyData = {};
        for (let i = 0; i < 12; i++) {
            const d   = new Date(now.getFullYear(), now.getMonth() + i, 1);
            const key = d.toLocaleString('default', { month: 'short', year: 'numeric' });
            monthlyData[key] = { total: 0, events: [] };
        }

        allEvents.forEach(e => {
            const key = new Date(e.date).toLocaleString('default', { month: 'short', year: 'numeric', timeZone: 'UTC' });
            if (monthlyData[key]) {
                monthlyData[key].total += e.amountCAD ?? e.amount ?? 0;
                monthlyData[key].events.push(e);
            }
        });

        this.renderDividendChart(monthlyData);

        let html = this.dividendLegendHtml();
        for (const [monthYear, mData] of Object.entries(monthlyData)) {
            if (mData.events.length === 0) continue;

            html += `<div class="dividend-month-card">
                <div class="dividend-month-header">
                    <span class="dividend-month-name">${monthYear}</span>
                    <span class="dividend-month-total">+$${mData.total.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}</span>
                </div>`;

            mData.events.forEach(e => {
                const d = new Date(e.date);
                const status = e._status || 'expected';
                const tip = status === 'received'
                    ? `Received${e._recvDate ? ' ' + e._recvDate : ''}${e._recvAmount ? ' · $' + e._recvAmount.toFixed(2) : ''}`
                    : status === 'overdue' ? 'Projected — no matching transaction yet' : 'Expected';
                html += `
                    <div class="dividend-event-row div-${status}" title="${sanitize(tip)}">
                        <div class="dividend-event-date">
                            <div class="dividend-event-date-month">${sanitize(d.toLocaleString('default',{month:'short', timeZone: 'UTC'}))}</div>
                            <div class="dividend-event-date-day">${d.getUTCDate()}</div>
                        </div>
                        <div class="dividend-event-info">
                            <div>
                                <span class="dividend-event-symbol stock-link" data-stock="${sanitize(e.symbol)}">${sanitize(e.symbol)}</span>
                                <span class="dividend-event-name">${sanitize(e.name)}</span>
                            </div>
                            <div class="dividend-event-meta">${(e.units || 0).toLocaleString()} shares &middot; $${(e.amountPerShare || 0).toFixed(4)}/share</div>
                        </div>
                        <div class="dividend-event-right">
                            <div class="dividend-event-amount">${status === 'received' ? '✓ ' : ''}+$${(e.amount || 0).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}</div>
                            <div class="dividend-event-portfolio">${sanitize(e.portfolioName)}</div>
                        </div>
                    </div>`;
            });

            html += '</div>';
        }

        container.innerHTML = html;
    },

    renderDividendChart(monthlyData) {
        const canvas = document.getElementById('dividendChart');
        if (!canvas || typeof Chart === 'undefined') return;
        const ctx    = canvas.getContext('2d');
        const labels = Object.keys(monthlyData);
        const data   = Object.values(monthlyData).map(d => d.total);
        const maxVal = Math.max(...data, 1);

        const theme = this.getChartTheme();

        if (this.dividendChartInstance) {
            this.dividendChartInstance.data.labels            = labels;
            this.dividendChartInstance.data.datasets[0].data  = data;
            this.dividendChartInstance.options.scales.y.max   = maxVal * 1.2;
            this.dividendChartInstance.options.scales.y.grid.color = theme.gridColor;
            this.dividendChartInstance.options.scales.y.ticks.color = theme.textColor;
            this.dividendChartInstance.options.scales.x.ticks.color = theme.textColor;
            this.dividendChartInstance.options.plugins.tooltip.backgroundColor = theme.tooltipBg;
            this.dividendChartInstance.options.plugins.tooltip.borderColor = theme.tooltipBorder;
            this.dividendChartInstance.update('none');
            return;
        }

        this.dividendChartInstance = new Chart(ctx, {
            type: 'bar',
            data: {
                labels,
                datasets: [{
                    label: 'Projected Monthly Income',
                    data,
                    backgroundColor: 'rgba(29,161,242,0.35)',
                    borderColor:     '#1da1f2',
                    borderWidth:     0,
                    borderRadius:    4,
                    hoverBackgroundColor: 'rgba(29,161,242,0.6)'
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        callbacks: {
                            label: c => ` $${c.parsed.y.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}`
                        },
                        backgroundColor: theme.tooltipBg,
                        titleFont: { size: 12 },
                        bodyFont:  { size: 13, weight: '600' },
                        padding: 10,
                        cornerRadius: 8,
                        borderColor: theme.tooltipBorder,
                        borderWidth: 1
                    }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        max: maxVal * 1.2,
                        grid:  { color: theme.gridColor },
                        ticks: {
                            color: theme.textColor,
                            callback: v => v >= 1000 ? `$${(v/1000).toFixed(0)}K` : `$${v}`
                        }
                    },
                    x: {
                        grid:  { display: false },
                        ticks: { color: theme.textColor, font: { size: 11 } }
                    }
                }
            }
        });
    },

    // Calendar placement date for an event: a dividend that was actually
    // received is shown on the date it was received (like Snowball), even if it
    // matched a forecast event whose projected date differs. Forecast/expected
    // events use their projected date.
    _divDisplayDate(e) {
        return (e._status === 'received' && e._recvDate) ? e._recvDate : e.date;
    },

    /**
     * The currency a dividend is actually paid in, taken from the security's
     * listing rather than the account holding it.
     *
     * The account is the wrong source on two counts: a CAD account routinely
     * holds US-listed ETFs that distribute in USD, and the broker often reports
     * no account currency at all — in which case everything silently defaults
     * to USD and CAD distributions get shown with a "$" sign. The per-share
     * amounts come from the security's own listing, so the exchange suffix is
     * what determines the unit. Mirrors assetCurrency() in src/services/fxService.ts.
     */
    _assetCurrency(symbol, fallback) {
        const m = String(symbol || '').toUpperCase().match(/\.([A-Z]{1,3})$/);
        const bySuffix = {
            TO: 'CAD', V: 'CAD', VN: 'CAD', CN: 'CAD', NE: 'CAD',
            L: 'GBP', DE: 'EUR', PA: 'EUR', AS: 'EUR', MI: 'EUR', MC: 'EUR',
            AX: 'AUD', HK: 'HKD', T: 'JPY', SW: 'CHF', ST: 'SEK',
        };
        if (m && bySuffix[m[1]]) return bySuffix[m[1]];
        // No recognised suffix: a bare ticker is US-listed. Fall back to the
        // account currency only when we have one, otherwise USD.
        return m ? (fallback || 'USD') : 'USD';
    },

    /**
     * Total dividend events, grouped by the currency each one pays in.
     *
     * Amounts in different currencies are never added together. There is no
     * exchange rate available on the client, and adding CAD into USD yields a
     * number that is not valid in either currency — it looks like a bigger
     * payday than it is. A portfolio holding both CAD- and USD-listed payers
     * hits this on any date where the two overlap.
     */
    _totalsByCurrency(events) {
        const totals = {};
        (events || []).forEach(e => {
            const c = e._cur || 'USD';
            totals[c] = (totals[c] || 0) + (e.amount || 0);
        });
        return totals;
    },

    /** {USD:110.01, CAD:46.01} → ["+$110.01", "+CA$46.01"], largest first. */
    _totalParts(totals, sign = '') {
        return Object.entries(totals || {})
            .filter(([, v]) => Math.abs(v) >= 0.005)
            .sort((a, b) => b[1] - a[1])
            .map(([cur, v]) => `${sign}${this.moneyC(v, cur)}`);
    },

    /** Plain-text form, for textContent targets. */
    _formatTotals(totals, sign = '') {
        return this._totalParts(totals, sign).join('  ');
    },

    /**
     * Markup form, for innerHTML targets. Each currency is its own element so a
     * narrow day cell can wrap them onto separate lines instead of overflowing.
     * moneyC emits only a currency symbol and digits, so this needs no escaping.
     */
    _formatTotalsHtml(totals, sign = '') {
        return this._totalParts(totals, sign).map(p => `<span>${p}</span>`).join('');
    },

    /** Add one currency-keyed total map into another, in place. */
    _addTotals(into, from) {
        Object.entries(from || {}).forEach(([cur, v]) => { into[cur] = (into[cur] || 0) + v; });
        return into;
    },

    renderDividendCalendar(cachedDividendsData, targetDate, selectedAccountId = 'all') {
        const gridEl  = document.getElementById('dividend-calendar-grid');
        const monthEl = document.getElementById('currentCalendarMonth');
        if (!gridEl || !monthEl) return;

        monthEl.textContent = targetDate.toLocaleString('default', { month: 'long', year: 'numeric' });
        this.renderDividendAccountTabs(cachedDividendsData, selectedAccountId);

        // Gather events for the selected account scope (tagging each with its account currency).
        const curByAcct = this.accountCurrencyMap();
        let allEvents = [];
        let annualTotalCAD = 0;
        const includedAccountIds = new Set();
        (cachedDividendsData || []).forEach(acct => {
            if (acct.error) return;
            let include;
            if (selectedAccountId === 'all') include = true;
            else if (selectedAccountId === 'unassigned') include = !(App.userPortfolios || []).some(p => (p.accountIds || []).includes(acct.accountId));
            else if (String(selectedAccountId).startsWith('portfolio-')) {
                const pid = parseInt(selectedAccountId.split('-')[1], 10);
                const port = (App.userPortfolios || []).find(p => p.id === pid);
                include = port && (port.accountIds || []).includes(acct.accountId);
            } else include = acct.accountId === selectedAccountId;
            if (include) {
                includedAccountIds.add(acct.accountId);
                (acct.dividends || []).forEach(e => {
                    allEvents.push({ ...e, accountId: acct.accountId, portfolioName: acct.portfolioName, accountName: acct.accountName, _cur: this._assetCurrency(e.symbol, curByAcct.get(acct.accountId)) });
                    // amountCAD is the backend's FX-converted figure — summing native
                    // `amount` here mixed currencies (a USD dividend added straight
                    // into a CAD total) and understated/inflated the headline number.
                    annualTotalCAD += (e.amountCAD ?? e.amount ?? 0);
                });
            }
        });

        // Tag forecast events, and backfill the last 6 months of dividends that
        // were actually received (computed from transactions) so past months in
        // the calendar aren't empty. These don't affect the forward-looking
        // income summary/chart — only the day grid below.
        const allTx = (typeof App !== 'undefined' && App.getFilteredTransactionsData) ? (App.getFilteredTransactionsData() || []) : [];
        const scopedTx = allTx.filter(a => includedAccountIds.has(a.accountId));
        const received = DivMath.collectReceivedDividends(allEvents, scopedTx, { divTypes: this._DIV_TYPES, monthsBack: 6 });
        received.forEach(e => { e._cur = this._assetCurrency(e.symbol, curByAcct.get(e.accountId)); });
        const displayEvents = allEvents.concat(received);
        this.divCalEvents = displayEvents;

        // Per-holding current price for the yield figure on each event card.
        const priceMap = new Map();
        const hd = (typeof App !== 'undefined' && App.cachedHoldingsData) ? App.cachedHoldingsData : [];
        hd.forEach(a => (a.holdings || []).forEach(h => {
            const s = h.symbol?.symbol?.symbol || h.symbol?.symbol || h.symbol;
            if (s && h.price) priceMap.set(s, h.price);
        }));
        const curOf = e => e._cur || 'USD';
        const yieldFor = e => {
            const p = priceMap.get(e.symbol);
            if (!p || !e.amountPerShare || !e.frequency) return null;
            return (e.amountPerShare * e.frequency / p) * 100;
        };

        // Kept only as a cosmetic fallback (an empty-month currency label below) —
        // no longer used for any dollar total, which is always the blended CAD figure now.
        const annualByCurNative = {};
        allEvents.forEach(e => { const c = curOf(e); annualByCurNative[c] = (annualByCurNative[c] || 0) + (e.amount || 0); });
        const primaryCur = Object.keys(annualByCurNative).sort((a, b) => annualByCurNative[b] - annualByCurNative[a])[0] || 'USD';

        // Summary card — one blended CAD total, not the previous "biggest native
        // currency only" figure, which silently dropped every other currency's
        // dividends from the headline entirely.
        const portVal = (typeof App !== 'undefined' && App.totalPortfolioValue) ? App.totalPortfolioValue() : 0;
        const setTxt = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
        setTxt('divcalAnnual',  this.moneyC(annualTotalCAD, 'CAD'));
        setTxt('divcalMonthly', this.moneyC(annualTotalCAD / 12, 'CAD'));
        setTxt('divcalDaily',   this.moneyC(annualTotalCAD / 365, 'CAD'));
        setTxt('divcalYield',   portVal > 0 ? this.pct((annualTotalCAD / portVal) * 100) : '—');
        setTxt('unified-annual-income', this.moneyC(annualTotalCAD, 'CAD'));

        this.renderDivCalChart(allEvents);

        // Calendar grid for the viewed month.
        const year = targetDate.getFullYear(), month = targetDate.getMonth();
        const firstDow = new Date(Date.UTC(year, month, 1)).getUTCDay();
        const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
        const today = new Date();

        let html = this.dividendLegendHtml() + '<div class="divcal-weekrow">' + ['SUN','MON','TUE','WED','THU','FRI','SAT'].map(d => `<div class="divcal-weekday">${d}</div>`).join('') + '</div><div class="divcal-grid">';
        for (let i = 0; i < firstDow; i++) html += '<div class="divcal-cell empty"></div>';

        const monthTotals = {};
        for (let day = 1; day <= daysInMonth; day++) {
            const dayEvents = displayEvents.filter(e => {
                const d = new Date(this._divDisplayDate(e));
                return d.getUTCFullYear() === year && d.getUTCMonth() === month && d.getUTCDate() === day;
            });
            // Grouped by currency — a day mixing CAD and USD payers must not be
            // collapsed into one number stamped with whichever came first.
            const dayTotals = this._totalsByCurrency(dayEvents);
            this._addTotals(monthTotals, dayTotals);
            const dayTotalLabel = this._formatTotalsHtml(dayTotals, "+");
            const isToday = today.getFullYear() === year && today.getMonth() === month && today.getDate() === day;
            const cards = dayEvents.map(e => {
                const y = yieldFor(e);
                const badge = (e.symbol || '?').replace(/[^A-Za-z0-9]/g, '').slice(0, 4);
                const status = e._status || 'expected';
                const tip = status === 'received'
                    ? `Received${e._recvDate ? ' ' + e._recvDate : ''}${e._recvAmount ? ' · $' + e._recvAmount.toFixed(2) : ''}`
                    : status === 'overdue' ? 'Projected — no matching transaction yet' : (e.name || e.symbol);
                return `<div class="divcal-event div-${status} stock-link" data-stock="${sanitize(e.symbol)}" title="${sanitize(tip)}">
                    <div class="divcal-event-top"><span class="divcal-event-badge">${sanitize(badge)}</span><span class="divcal-event-name"><strong>${sanitize(e.symbol)}</strong> ${sanitize((e.name || '').slice(0, 20))}</span></div>
                    <div class="divcal-event-bot"><span class="divcal-event-amt">${status === 'received' ? '✓ ' : ''}${this.moneyC(e.amount, curOf(e))}</span>${y != null ? `<span class="divcal-event-yield">${y.toFixed(2)}%</span>` : ''}</div>
                </div>`;
            }).join('');

            html += `<div class="divcal-cell${isToday ? ' today' : ''}">
                <div class="divcal-cell-head"><span class="divcal-daynum${isToday ? ' today' : ''}">${day}</span>${dayTotalLabel ? `<span class="divcal-daytotal">${dayTotalLabel}</span>` : ''}</div>
                <div class="divcal-cell-events">${cards}</div>
            </div>`;
        }
        html += '</div>';
        gridEl.innerHTML = html;

        const mt = document.getElementById('divcalMonthTotal');
        if (mt) mt.textContent = this._formatTotals(monthTotals, '+');
        setTxt('unified-month-total', this._formatTotals(monthTotals) || this.moneyC(0, primaryCur));

        this.renderDivCalList(displayEvents);
        this.setDivCalView(this.divCalView || 'calendar');
    },

    renderDivCalChart(events) {
        const canvas = document.getElementById('divcalChart');
        if (!canvas || typeof Chart === 'undefined') return;
        const theme = this.getChartTheme();
        const now = new Date();
        const labels = [], totals = [], keys = [];
        for (let i = 0; i < 12; i++) {
            const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
            labels.push(d.toLocaleString('default', { month: 'short' }));
            keys.push(`${d.getFullYear()}-${d.getMonth()}`);
            totals.push(0);
        }
        const idx = new Map(keys.map((k, i) => [k, i]));
        (events || []).forEach(e => {
            const d = new Date(e.date);
            const k = `${d.getUTCFullYear()}-${d.getUTCMonth()}`;
            if (idx.has(k)) totals[idx.get(k)] += (e.amountCAD ?? e.amount ?? 0);
        });
        const max = Math.max(1, ...totals);
        if (this.divcalChartInst) this.divcalChartInst.destroy();
        this.divcalChartInst = new Chart(canvas, {
            type: 'bar',
            data: { labels, datasets: [{ data: totals, backgroundColor: '#3a7bd5', borderRadius: 4, maxBarThickness: 26 }] },
            options: {
                responsive: true, maintainAspectRatio: false,
                plugins: {
                    legend: { display: false },
                    tooltip: { 
                        callbacks: { label: c => '$' + c.parsed.y.toLocaleString(undefined, { maximumFractionDigits: 0 }) },
                        backgroundColor: theme.tooltipBg,
                        borderColor: theme.tooltipBorder,
                        borderWidth: 1
                    }
                },
                scales: {
                    x: { grid: { display: false }, ticks: { color: theme.textColor, font: { size: 11 } } },
                    y: { grid: { color: theme.gridColor }, ticks: { color: theme.textColor, maxTicksLimit: 4, callback: v => max >= 1000 ? '$' + (v / 1000).toFixed(0) + 'K' : '$' + v.toFixed(0) } }
                }
            }
        });
    },

    renderDivCalList(events) {
        const el = document.getElementById('dividend-calendar-list');
        if (!el) return;
        // Timeline: the last 6 months of received dividends through upcoming ones.
        const floor = new Date(); floor.setMonth(floor.getMonth() - 6); floor.setHours(0, 0, 0, 0);
        const rows = (events || []).filter(e => new Date(this._divDisplayDate(e)) >= floor)
            .sort((a, b) => new Date(this._divDisplayDate(a)) - new Date(this._divDisplayDate(b))).slice(0, 400);
        if (rows.length === 0) { el.innerHTML = '<div class="empty-state" style="padding:1.5rem;">No dividends in the last 6 months or upcoming.</div>'; return; }
        const byDate = {};
        rows.forEach(e => {
            const k = this._divDisplayDate(e).substring(0, 10);
            (byDate[k] = byDate[k] || []).push(e);
        });
        const curOf = e => e._cur || 'USD';

        el.innerHTML = '<div class="card" style="padding:0;overflow:hidden;">' + Object.keys(byDate).map(k => {
            const evs = byDate[k];
            // Same rule as the grid: never add across currencies.
            const totLabel = this._formatTotals(this._totalsByCurrency(evs), '+');
            return `<div class="divcal-listday">
                <div class="divcal-listday-head"><span>${sanitize(k)}</span><span class="pos">${totLabel}</span></div>
                ${evs.map(e => { const status = e._status || 'expected'; return `<div class="divcal-listrow div-${status}"><span class="divcal-event-badge">${sanitize((e.symbol || '?').slice(0, 4))}</span><span class="divcal-listrow-name"><strong>${sanitize(e.symbol)}</strong> · ${sanitize(e.name || '')}</span><span class="divcal-listrow-amt">${status === 'received' ? '✓ ' : ''}${this.moneyC(e.amount, curOf(e))}</span></div>`; }).join('')}
            </div>`;
        }).join('') + '</div>';
    },

    setDivCalView(view) {
        this.divCalView = view;
        const grid = document.getElementById('dividend-calendar-grid');
        const list = document.getElementById('dividend-calendar-list');
        const cb = document.getElementById('divcalViewCalendar');
        const lb = document.getElementById('divcalViewList');
        if (grid) grid.style.display = view === 'calendar' ? 'block' : 'none';
        if (list) list.style.display = view === 'list' ? 'block' : 'none';
        if (cb) cb.classList.toggle('active', view === 'calendar');
        if (lb) lb.classList.toggle('active', view === 'list');
    },

    // ── User Portfolio UI ──────────────────────────────────────────────────────

    _UP_COLORS: [
        '#7c3aed', '#2563eb', '#0891b2', '#059669', '#d97706',
        '#dc2626', '#db2777', '#7c3aed', '#4f46e5', '#0284c7'
    ],

    renderUserPortfolios(portfolios, accountMap = {}) {
        const list = document.getElementById('userPortfolioList');
        if (!list) return;

        if (!portfolios || portfolios.length === 0) {
            list.innerHTML = '<div class="empty-state" style="padding:1rem;"><p>No portfolios yet. Click <strong>+ New Portfolio</strong> to create one.</p></div>';
            return;
        }

        list.innerHTML = portfolios.map(p => {
            const acctCount = (p.accountIds || []).length;
            return `
            <div class="portfolio-item" style="border-left:3px solid ${sanitize(p.color)};padding-left:0.85rem;">
              <div class="portfolio-item-top">
                <div style="display:flex;align-items:center;gap:0.65rem;min-width:0;">
                  <div style="width:12px;height:12px;border-radius:50%;background:${sanitize(p.color)};flex-shrink:0;"></div>
                  <div style="min-width:0;">
                    <div class="portfolio-item-name" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${sanitize(p.name)}</div>
                    ${p.description ? `<div style="font-size:0.78rem;color:var(--text-secondary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${sanitize(p.description)}</div>` : ''}
                  </div>
                </div>
                <div style="display:flex;align-items:center;gap:0.5rem;flex-shrink:0;">
                  <span class="text-muted" style="font-size:0.78rem;white-space:nowrap;">${acctCount} account${acctCount !== 1 ? 's' : ''}</span>
                  <button class="btn btn-outline btn-sm" onclick="App.openUserPortfolioModal(${p.id})">Edit</button>
                  <button class="btn btn-danger btn-sm" onclick="App.deleteUserPortfolio(${p.id})">Delete</button>
                </div>
              </div>
              ${acctCount > 0 ? `
              <div style="margin-top:0.5rem;display:flex;flex-wrap:wrap;gap:0.35rem;">
                ${(p.accountIds || []).map(aid => {
                    const name = accountMap[aid] || aid;
                    return `<span style="font-size:0.73rem;padding:0.15rem 0.55rem;border-radius:4px;background:var(--surface-2);color:var(--text-secondary);border:1px solid var(--border);">${sanitize(name)}</span>`;
                }).join('')}
              </div>` : `<div style="margin-top:0.4rem;font-size:0.78rem;color:var(--text-secondary);font-style:italic;">No accounts assigned</div>`}
            </div>`;
        }).join('');
    },

    openUserPortfolioModal(portfolio, allAccounts) {
        const errEl = document.getElementById('upErrorMsg');
        if (errEl) errEl.style.display = 'none';
        const modal = document.getElementById('userPortfolioModal');
        const title = document.getElementById('userPortfolioModalTitle');
        const form  = document.getElementById('userPortfolioForm');

        form.reset();
        document.getElementById('upId').value = portfolio ? portfolio.id : '';
        document.getElementById('upName').value = portfolio ? portfolio.name : '';
        document.getElementById('upDescription').value = portfolio ? (portfolio.description || '') : '';

        const currentColor = (portfolio && portfolio.color) ? portfolio.color : '#7c3aed';
        document.getElementById('upColor').value = currentColor;
        title.textContent = portfolio ? 'Edit Portfolio' : 'New Portfolio';

        // Render color swatches
        const swatchContainer = document.getElementById('upColorSwatches');
        const colors = this._UP_COLORS;
        swatchContainer.innerHTML = colors.map(c => `
          <div class="color-swatch${c === currentColor ? ' selected' : ''}"
               style="width:24px;height:24px;border-radius:50%;background:${c};cursor:pointer;border:2px solid ${c === currentColor ? '#fff' : 'transparent'};box-shadow:${c === currentColor ? '0 0 0 2px ' + c : 'none'};"
               onclick="UI._selectColor('${c}', this)">
          </div>`).join('') + `<input type="color" id="upColorPicker" value="${currentColor}"
            style="width:26px;height:26px;border:none;background:none;cursor:pointer;padding:0;"
            oninput="UI._selectColor(this.value, null)" title="Custom color">`;

        // Render account checkboxes grouped by brokerage connection
        const checkboxContainer = document.getElementById('upAccountCheckboxes');
        const selectedIds = new Set(portfolio ? (portfolio.accountIds || []) : []);

        // allAccounts is an array of { portfolioId, portfolioName, accounts: [...] }
        const hasAny = Array.isArray(allAccounts) && allAccounts.some(g => g.accounts && g.accounts.length > 0);
        if (!hasAny) {
            checkboxContainer.innerHTML = '<span class="text-muted text-sm">No accounts found. Add a brokerage connection first.</span>';
        } else {
            checkboxContainer.innerHTML = allAccounts
                .filter(g => g.accounts && g.accounts.length > 0)
                .map(g => {
                    const activeAccounts = g.accounts.filter(a => a.isActive !== 0 && a.isActive !== false);
                    if (activeAccounts.length === 0) return '';
                    return `
                  <div style="margin-bottom:0.6rem;">
                    <div style="font-size:0.73rem;font-weight:600;color:var(--text-secondary);text-transform:uppercase;letter-spacing:0.04em;margin-bottom:0.3rem;">${sanitize(g.portfolioName || 'Unknown Connection')}</div>
                    ${activeAccounts.map(a => `
                      <label style="display:flex;align-items:center;gap:0.65rem;cursor:pointer;padding:0.3rem 0.25rem;border-radius:5px;transition:background 0.1s;" onmouseover="this.style.background='var(--surface-2)'" onmouseout="this.style.background='transparent'">
                        <input type="checkbox" value="${sanitize(a.id)}" ${selectedIds.has(a.id) ? 'checked' : ''} style="width:15px;height:15px;flex-shrink:0;margin-top:1px;">
                        <div style="min-width:0;">
                          <div style="font-size:0.875rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${sanitize(a.customName || a.name || a.id)}</div>
                          ${a.type ? `<div style="font-size:0.73rem;color:var(--text-secondary);">${sanitize(a.type)}</div>` : ''}
                        </div>
                      </label>`).join('')}
                  </div>`;
                }).join('');
        }

        modal.classList.add('open');
    },

    _selectColor(color, swatchEl) {
        document.getElementById('upColor').value = color;
        document.querySelectorAll('#upColorSwatches .color-swatch').forEach(s => {
            s.style.border = '2px solid transparent';
            s.style.boxShadow = 'none';
        });
        if (swatchEl && swatchEl.classList) {
            swatchEl.style.border = '2px solid #fff';
            swatchEl.style.boxShadow = `0 0 0 2px ${color}`;
        }
        const picker = document.getElementById('upColorPicker');
        if (picker) picker.value = color;
    },

    closeUserPortfolioModal() {
        const modal = document.getElementById('userPortfolioModal');
        if (modal) modal.classList.remove('open');
    },

    renderRebalanceTargets(targets) {
        const container = document.getElementById('targetsListContainer');
        if (!container) return;
        container.innerHTML = '';

        if (!targets || targets.length === 0) {
            this.addTargetRow();
        } else {
            targets.forEach(t => {
                this.addTargetRow(t.symbol, t.targetPct * 100);
            });
        }
        this.updateRebalanceTargetsTotal();
    },

    addTargetRow(symbol = '', pctVal = 0) {
        const container = document.getElementById('targetsListContainer');
        if (!container) return;

        const row = document.createElement('div');
        row.className = 'target-allocation-row';
        row.innerHTML = `
            <input type="text" class="target-symbol-input" placeholder="AAPL" value="${sanitize(symbol)}" required
                   style="width: 100px; background: var(--surface-2); border: 1px solid var(--border); color: var(--text); border-radius: var(--radius-sm); padding: 0.35rem 0.5rem; font-size: 0.85rem;">
            <div class="target-pct-input-wrapper">
                <input type="number" class="target-pct-input" placeholder="10" min="0.1" max="100" step="0.1" value="${pctVal || ''}" required
                       style="background: var(--surface-2); border: 1px solid var(--border); color: var(--text); border-radius: var(--radius-sm); padding: 0.35rem 0.5rem; font-size: 0.85rem; width: 100%;">
            </div>
            <button type="button" class="remove-target-btn" title="Remove ticker">&times;</button>
        `;

        // Wire up events
        const symInput = row.querySelector('.target-symbol-input');
        const pctInput = row.querySelector('.target-pct-input');
        const removeBtn = row.querySelector('.remove-target-btn');

        symInput.addEventListener('input', () => {
            symInput.value = symInput.value.toUpperCase().replace(/[^A-Z0-9.:\-]/g, '');
        });
        pctInput.addEventListener('input', () => this.updateRebalanceTargetsTotal());
        removeBtn.addEventListener('click', () => {
            row.remove();
            this.updateRebalanceTargetsTotal();
            if (container.children.length === 0) {
                this.addTargetRow();
            }
        });

        container.appendChild(row);
    },

    updateRebalanceTargetsTotal() {
        const inputs = document.querySelectorAll('.target-pct-input');
        let total = 0;
        inputs.forEach(input => {
            const val = parseFloat(input.value);
            if (!isNaN(val)) total += val;
        });

        const totalEl = document.getElementById('targetsTotalPct');
        if (totalEl) {
            totalEl.textContent = `Total: ${total.toFixed(1)}%`;
            if (Math.abs(total - 100.0) < 0.0001) {
                totalEl.style.color = 'var(--success)';
            } else {
                totalEl.style.color = 'var(--danger)';
            }
        }
    },

    renderRebalanceSuggestions(suggestions) {
        const container = document.getElementById('rebalanceSuggestionsContainer');
        if (!container) return;

        if (!suggestions || !suggestions.targetsConfigured) {
            container.innerHTML = `
                <div class="empty-state card">
                    <div class="empty-icon">🎯</div>
                    <p><strong>No target allocations configured.</strong></p>
                    <p style="margin-top:0.5rem;color:var(--text-secondary);">Set your target portfolio allocations on the left to generate rebalancing suggestions.</p>
                </div>
            `;
            return;
        }

        if (!suggestions.accounts || suggestions.accounts.length === 0) {
            container.innerHTML = `
                <div class="empty-state card">
                    <div class="empty-icon">⚠</div>
                    <p><strong>No accounts assigned to this portfolio.</strong></p>
                    <p style="margin-top:0.5rem;color:var(--text-secondary);">Add accounts to this portfolio under settings (Settings → Portfolios) to view rebalancing recommendations.</p>
                </div>
            `;
            return;
        }

        let html = `
            <svg width="0" height="0" style="position:absolute;">
              <defs>
                <linearGradient id="actualGrad" x1="0%" y1="0%" x2="100%" y2="0%">
                  <stop offset="0%" stop-color="var(--primary)" />
                  <stop offset="100%" stop-color="#4f8ef7" />
                </linearGradient>
              </defs>
            </svg>
        `;

        suggestions.accounts.forEach(acc => {
            const formatVal = v => `$${Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
            const formatPct = p => `${(p * 100).toFixed(1)}%`;

            html += `
                <div class="card account-suggestion-card" style="padding: 1.25rem; margin-bottom: 1.25rem;">
                    <div class="account-suggestion-header">
                        <div>
                            <div class="account-suggestion-title">${sanitize(acc.accountName)}</div>
                            <div style="font-size:0.75rem; color:var(--text-muted); margin-top:2px;">Account ID: ${sanitize(acc.accountId)}</div>
                        </div>
                        <div style="text-align:right;">
                            <div class="account-suggestion-title" style="font-feature-settings:'tnum'">${formatVal(acc.totalValue)}</div>
                            <div class="account-suggestion-meta">Cash Balance: <span style="font-weight:600; color:var(--text);">${formatVal(acc.cash)}</span></div>
                        </div>
                    </div>

                    <!-- Deviations Comparison Section -->
                    <div style="margin-bottom: 1.5rem; background: var(--surface-2); border-radius: var(--radius-sm); padding: 1rem; border: 1px solid var(--border);">
                        <div style="font-size:0.75rem; font-weight:700; text-transform:uppercase; letter-spacing:0.06em; color:var(--text-muted); margin-bottom:0.75rem;">Deviation Map</div>
                        
                        ${acc.assets.map(a => {
                            const devVal = a.deviation * 100;
                            const devSign = devVal >= 0 ? '+' : '';
                            const devClass = Math.abs(devVal) < 2 ? 'val-pos' : (devVal < -2 ? 'val-neg' : 'text-warning');
                            
                            return `
                                <div class="deviation-bar-wrapper">
                                    <div style="display:flex; justify-content:space-between; align-items:center; font-size:0.8rem; margin-bottom:0.3rem;">
                                        <span style="font-weight:600; font-family:monospace;">${sanitize(a.symbol)}</span>
                                        <span class="text-muted" style="font-size:0.75rem;">
                                            Actual: ${formatPct(a.currentPct)} | Target: ${formatPct(a.targetPct)} 
                                            (<span class="${devClass}" style="font-weight:600;">${devSign}${devVal.toFixed(1)}%</span>)
                                        </span>
                                    </div>
                                    <div style="position:relative; height:6px; background:var(--surface); border-radius:3px; overflow:visible; border: 1px solid var(--border);">
                                        <div style="position:absolute; left:0; top:0; height:100%; width:${Math.min(a.currentPct * 100, 100).toFixed(1)}%; background:url(#actualGrad); border-radius:3px;"></div>
                                        <div style="position:absolute; left:${(a.targetPct * 100).toFixed(1)}%; top:-4px; height:12px; width:2px; background:#fff; box-shadow: 0 0 2px rgba(0,0,0,0.8);" title="Target: ${formatPct(a.targetPct)}"></div>
                                    </div>
                                </div>
                            `;
                        }).join('')}
                    </div>

                    <!-- Suggested Trades Section -->
                    <div>
                        <div style="font-size:0.75rem; font-weight:700; text-transform:uppercase; letter-spacing:0.06em; color:var(--text-muted); margin-bottom:0.5rem;">Suggested Rebalancing Trades</div>
            `;

            if (!acc.trades || acc.trades.length === 0) {
                html += `
                        <div class="empty-state" style="padding: 1.5rem 0; border: 1px dashed var(--border); border-radius: var(--radius-sm);">
                            <div style="font-size: 1.2rem; margin-bottom: 0.25rem;">✨</div>
                            <p class="text-sm">Account is balanced within +/- $5 of targets. No trades needed!</p>
                        </div>
                    </div>
                </div>`;
                return;
            }

            html += `
                        <div style="overflow-x:auto;">
                            <table class="data-table" style="width:100%; font-size:0.85rem;">
                                <thead>
                                    <tr>
                                        <th style="width: 40px; padding:0.5rem 0.75rem;">
                                            <input type="checkbox" id="trade-select-all-${sanitize(acc.accountId)}" class="trade-checkbox-custom" checked
                                                   onclick="UI.toggleSelectAllRebalanceTrades('${sanitize(acc.accountId)}', this.checked)">
                                        </th>
                                        <th style="padding:0.5rem 0.75rem;">Ticker</th>
                                        <th style="padding:0.5rem 0.75rem;">Action</th>
                                        <th class="right" style="padding:0.5rem 0.75rem;">Amount</th>
                                    </tr>
                                </thead>
                                <tbody id="suggestions-trades-${sanitize(acc.accountId)}">
                                    ${acc.trades.map((t, idx) => {
                                        const aid = sanitize(acc.accountId);
                                        const sym = sanitize(t.symbol);
                                        const act = sanitize(t.action);
                                        const amt = Number(t.amount);
                                        const badgeClass = act === 'BUY' ? 'badge-buy' : 'badge-with';
                                        
                                        return `
                                            <tr>
                                                <td style="padding:0.5rem 0.75rem;">
                                                    <input type="checkbox" class="trade-select-cb trade-checkbox-custom" checked
                                                           data-symbol="${sym}" data-action="${act}" data-amount="${amt}"
                                                           onclick="UI.updateRebalanceExecutionBtnState('${aid}')">
                                                </td>
                                                <td style="font-weight:600; font-family:monospace; padding:0.5rem 0.75rem;">${sym}</td>
                                                <td style="padding:0.5rem 0.75rem;"><span class="type-badge ${badgeClass}">${act}</span></td>
                                                <td class="right" style="font-weight:600; font-variant-numeric:tabular-nums; padding:0.5rem 0.75rem;">${formatVal(amt)}</td>
                                            </tr>
                                        `;
                                    }).join('')}
                                </tbody>
                            </table>
                        </div>

                        <!-- Execution Box -->
                        <div class="trades-bulk-action">
                            <span id="trades-count-summary-${sanitize(acc.accountId)}" style="font-size:0.8rem; color:var(--text-secondary); font-weight:500;">
                                ${acc.trades.length} trade(s) selected
                            </span>
                            <button id="btn-execute-${sanitize(acc.accountId)}" class="btn btn-primary btn-sm"
                                    onclick="App.executeBulkRebalance('${sanitize(acc.accountId)}')">
                                <span class="loader"></span><span class="btn-text">Execute Orders</span>
                            </button>
                        </div>
                    </div>
                </div>
            `;
        });

        container.innerHTML = html;
    },

    toggleSelectAllRebalanceTrades(accountId, checked) {
        const container = document.getElementById(`suggestions-trades-${accountId}`);
        if (!container) return;
        const cbs = container.querySelectorAll('.trade-select-cb');
        cbs.forEach(cb => cb.checked = checked);
        this.updateRebalanceExecutionBtnState(accountId);
    },

    updateRebalanceExecutionBtnState(accountId) {
        const container = document.getElementById(`suggestions-trades-${accountId}`);
        if (!container) return;
        const cbs = container.querySelectorAll('.trade-select-cb');
        const checkedCount = container.querySelectorAll('.trade-select-cb:checked').length;
        
        const btn = document.getElementById(`btn-execute-${accountId}`);
        if (btn) btn.disabled = (checkedCount === 0);

        const summaryEl = document.getElementById(`trades-count-summary-${accountId}`);
        if (summaryEl) {
            summaryEl.textContent = `${checkedCount} of ${cbs.length} trade(s) selected`;
        }

        const allCb = document.getElementById(`trade-select-all-${accountId}`);
        if (allCb) {
            allCb.checked = (checkedCount === cbs.length);
            allCb.indeterminate = (checkedCount > 0 && checkedCount < cbs.length);
        }
    },
};
