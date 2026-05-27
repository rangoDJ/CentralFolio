/**
 * UI rendering for CentralFolio — Wealthsimple-style theme
 */

function sanitize(str) {
    if (str == null) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
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
    dashFutureChartInstance: null,
    dashReceivedChartInstance: null,
    holdingsStore: new Map(),
    txStore: new Map(),
    TX_PAGE_SIZE: 25,

    showToast(msg, type = 'success') {
        this.toast.textContent = msg;
        this.toast.className = `toast visible ${type}`;
        clearTimeout(this._toastTimer);
        this._toastTimer = setTimeout(() => this.toast.classList.remove('visible'), 4000);
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

        this.portfolioCountEl.textContent = portfolios.length;

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
                            ${p.userSecret
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
                ${p.tradingEnabled && p.userSecret
                    ? `<button class="btn btn-outline btn-sm w-full" style="margin-bottom:0.4rem;" onclick="App.reconnectForTrading(${p.id}, this)">
                           <span class="loader"></span><span class="btn-text">Reconnect with Trade Permissions</span>
                       </button>`
                    : ''}
                ${!p.userSecret
                    ? `<button class="btn btn-primary btn-sm w-full" onclick="App.registerPortfolio(${p.id}, this)">
                           <span class="loader"></span><span class="btn-text">Register with SnapTrade</span>
                       </button>`
                    : `<button class="btn btn-outline btn-sm w-full" onclick="App.connectBrokerage(${p.id}, this)">
                           <span class="loader"></span><span class="btn-text">Connect Brokerage</span>
                       </button>`}
            </div>
        `).join('');

        // Load connection type badge for each registered portfolio
        portfolios.filter(p => p.userSecret).forEach(p => App.loadConnectionBadge(p.id, !!p.tradingEnabled));
    },

    renderAccountSection(currentGroups, activePortfolioId, inactiveAccountIds) {
        if (!currentGroups.length) return;

        let grandTotal = 0;
        currentGroups.forEach(g => g.accounts.forEach(acc => {
            if (!inactiveAccountIds.has(acc.id)) grandTotal += (acc.balance?.total?.amount || 0);
        }));
        this.totalBalanceEl.textContent = `$${grandTotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

        // Portfolio selector tabs
        let html = '<div class="portfolio-tabs">';
        currentGroups.forEach(g => {
            html += `<button class="portfolio-tab ${g.portfolioId === activePortfolioId ? 'active' : ''}"
                             onclick="App.switchPortfolioTab(${g.portfolioId})">${sanitize(g.portfolioName)}</button>`;
        });
        html += '</div>';

        // Active portfolio accounts
        const active = currentGroups.find(g => g.portfolioId === activePortfolioId) || currentGroups[0];
        if (active) {
            const activeTotal = active.accounts.reduce((s, a) => s + (inactiveAccountIds.has(a.id) ? 0 : (a.balance?.total?.amount || 0)), 0);
            const portTotal   = active.accounts.reduce((s, a) => s + (a.balance?.total?.amount || 0), 0);

            html += '<div class="account-group">';
            html += `<div class="account-group-header">
                        <span>${sanitize(active.portfolioName)}</span>
                        <span style="font-feature-settings:'tnum'">Active $${activeTotal.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})} / Total $${portTotal.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}</span>
                     </div>`;

            if (active.error) {
                html += `<div class="empty-state" style="padding:1rem;color:var(--danger);">Error: ${sanitize(active.error)}</div>`;
            } else if (active.accounts.length === 0) {
                html += '<div class="empty-state" style="padding:1rem;"><p>No accounts found.</p></div>';
            } else {
                active.accounts.forEach(acc => {
                    const inactive = inactiveAccountIds.has(acc.id);
                    const balance  = acc.balance?.total?.amount;
                    const displayName = acc.customName || acc.name || 'Unnamed Account';
                    html += `
                        <div class="account-row" style="${inactive ? 'opacity:0.5;' : ''}">
                            <div class="account-row-info">
                                <div id="acc-name-${acc.id}" style="display:flex;align-items:center;gap:0.3rem;">
                                    <span class="account-row-name">${sanitize(displayName)}</span>
                                    <button title="Rename account" onclick="App.startRenameAccount('${acc.id}')"
                                            style="background:none;border:none;cursor:pointer;color:var(--text-muted);padding:2px 3px;line-height:1;border-radius:3px;opacity:0.45;flex-shrink:0;"
                                            onmouseenter="this.style.opacity='1'" onmouseleave="this.style.opacity='0.45'">
                                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                                            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                                            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                                        </svg>
                                    </button>
                                </div>
                                <div class="account-row-meta">${sanitize(acc.brokerage?.name || 'Unknown')} &middot; ${sanitize(acc.number || 'No number')}</div>
                            </div>
                            <div class="account-row-right">
                                ${balance !== undefined ? `
                                    <div>
                                        <div class="account-balance-val">$${(balance || 0).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}</div>
                                        <div class="account-balance-label">Net Value</div>
                                    </div>` : ''}
                                <label class="switch" title="${inactive ? 'Activate' : 'Deactivate'} account">
                                    <input type="checkbox" ${!inactive ? 'checked' : ''} onchange="App.toggleAccount('${acc.id}')">
                                    <span class="slider"></span>
                                </label>
                            </div>
                        </div>`;
                });
            }
            html += '</div>';
        }

        this.accountContainer.innerHTML = html;
        this.renderDashboardChart(currentGroups, inactiveAccountIds);
        this.renderDashboardHoldingsTable(currentGroups, inactiveAccountIds);
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

    renderDashboardHoldingsTable(currentGroups, inactiveAccountIds) {
        const container = document.getElementById('dashHoldingsTable');
        if (!container) return;

        let grandTotal = 0;
        const rows = [];
        currentGroups.forEach(g => {
            g.accounts.forEach(acc => {
                if (!inactiveAccountIds.has(acc.id)) {
                    const val = acc.balance?.total?.amount || 0;
                    grandTotal += val;
                    rows.push({ name: acc.customName || acc.name || 'Unnamed', brokerage: acc.brokerage?.name || '', value: val });
                }
            });
        });

        const countEl = document.getElementById('dashAccountCount');
        if (countEl) countEl.textContent = `${rows.length} account${rows.length !== 1 ? 's' : ''} active`;

        if (rows.length === 0) {
            container.innerHTML = '<div class="empty-state" style="padding:1.5rem 0;"><p>No active accounts.</p></div>';
            return;
        }

        rows.sort((a, b) => b.value - a.value);

        container.innerHTML = '<table class="data-table"><thead><tr>' +
            '<th>Account</th><th class="right">Value</th><th class="right">Allocation</th>' +
            '</tr></thead><tbody>' +
            rows.map(r => {
                const alloc = grandTotal > 0 ? (r.value / grandTotal * 100) : 0;
                return `<tr>
                    <td>
                        <div style="font-size:0.85rem;font-weight:500;">${sanitize(r.name)}</div>
                        ${r.brokerage ? `<div class="ticker-desc">${sanitize(r.brokerage)}</div>` : ''}
                    </td>
                    <td class="right" style="font-weight:600;">$${r.value.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}</td>
                    <td class="right">
                        <div>${alloc.toFixed(1)}%</div>
                        <div style="margin-top:3px;height:3px;background:var(--border);border-radius:2px;min-width:56px;">
                            <div style="height:100%;background:var(--primary);border-radius:2px;width:${Math.min(alloc,100).toFixed(1)}%;"></div>
                        </div>
                    </td>
                </tr>`;
            }).join('') +
            '</tbody></table>';
    },

    renderDashboardDividendWidgets(dividendsData, portfolioValue) {
        if (!dividendsData) return;
        let allEvents = [];
        dividendsData.forEach(acct => {
            if (acct.error) return;
            (acct.dividends || []).forEach(e => allEvents.push({ ...e, portfolioName: acct.portfolioName, accountName: acct.accountName }));
        });
        allEvents.sort((a, b) => new Date(a.date) - new Date(b.date));

        const annualTotal  = allEvents.reduce((s, e) => s + (e.amount || 0), 0);
        const monthlyAvg   = annualTotal / 12;
        const yieldPct     = portfolioValue > 0 ? (annualTotal / portfolioValue * 100) : 0;
        const fmt          = v => `$${v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
        const el           = id => document.getElementById(id);

        if (el('dashAnnualIncome'))  el('dashAnnualIncome').textContent  = fmt(annualTotal);
        if (el('dashMonthlyIncome')) el('dashMonthlyIncome').textContent = `${fmt(monthlyAvg)} / month`;
        if (el('dashYield'))         el('dashYield').textContent         = yieldPct > 0 ? `${yieldPct.toFixed(2)}%` : '—';

        this.renderDashboardEventsStrip(allEvents);
        this.renderDashboardFutureChart(allEvents);
    },

    renderDashboardEventsStrip(allEvents) {
        const container = document.getElementById('dashEventsStrip');
        if (!container) return;

        const today = new Date(); today.setHours(0, 0, 0, 0);
        const upcoming = allEvents.filter(e => new Date(e.date) >= today).slice(0, 7);

        if (upcoming.length === 0) {
            container.innerHTML = '<div class="empty-state" style="padding:0.75rem 0;"><p>No upcoming dividend events in the forecast.</p></div>';
            return;
        }

        const freqLabel = f => ({ 1: 'annual', 2: 'semi-annual', 4: 'quarterly', 12: 'monthly', 52: 'weekly' }[f] || 'periodic');

        container.innerHTML = '<div class="dash-events-strip">' +
            upcoming.map(e => {
                const d        = new Date(e.date);
                const day      = d.getDate();
                const month    = d.toLocaleString('default', { month: 'short' });
                const weekday  = d.toLocaleString('default', { weekday: 'short' });
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

    renderDashboardFutureChart(allEvents) {
        const canvas = document.getElementById('dashFutureChart');
        if (!canvas || typeof Chart === 'undefined') return;

        const now = new Date();
        const monthlyData = {};
        for (let i = 0; i < 12; i++) {
            const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
            monthlyData[d.toLocaleString('default', { month: 'short' })] = 0;
        }

        let totalNext12 = 0;
        allEvents.forEach(e => {
            const d = new Date(e.date);
            const ahead = (d.getFullYear() - now.getFullYear()) * 12 + (d.getMonth() - now.getMonth());
            if (ahead >= 0 && ahead < 12) {
                const key = d.toLocaleString('default', { month: 'short' });
                if (monthlyData[key] !== undefined) { monthlyData[key] += (e.amount || 0); totalNext12 += (e.amount || 0); }
            }
        });

        const labels = Object.keys(monthlyData);
        const data   = Object.values(monthlyData);
        const maxVal = Math.max(...data, 1);
        const fmt    = v => `$${v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

        const ftEl = document.getElementById('dashFutureTotal');
        const fmEl = document.getElementById('dashFutureMonthly');
        if (ftEl) ftEl.textContent = `${fmt(totalNext12)} next 12m`;
        if (fmEl) fmEl.textContent = `${fmt(totalNext12 / 12)} monthly avg`;

        const chartCfg = {
            type: 'bar',
            data: { labels, datasets: [{ data, backgroundColor: 'rgba(0,208,156,0.28)', borderColor: '#00d09c', borderWidth: 0, borderRadius: 3, hoverBackgroundColor: 'rgba(0,208,156,0.55)' }] },
            options: {
                responsive: true, maintainAspectRatio: false,
                plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => ` ${fmt(c.parsed.y)}` }, backgroundColor: '#1e2640', padding: 8, cornerRadius: 6, titleFont: { size: 11 }, bodyFont: { size: 12, weight: '600' }, borderColor: 'rgba(255,255,255,0.08)', borderWidth: 1 } },
                scales: {
                    y: { beginAtZero: true, max: maxVal * 1.25, grid: { color: 'rgba(255,255,255,0.04)' }, ticks: { color: '#7c8496', font: { size: 10 }, callback: v => v >= 1000 ? `$${(v/1000).toFixed(0)}K` : `$${v}` } },
                    x: { grid: { display: false }, ticks: { color: '#7c8496', font: { size: 10 } } }
                }
            }
        };

        if (this.dashFutureChartInstance) {
            this.dashFutureChartInstance.data.labels = labels;
            this.dashFutureChartInstance.data.datasets[0].data = data;
            this.dashFutureChartInstance.options.scales.y.max = maxVal * 1.25;
            this.dashFutureChartInstance.update();
        } else {
            this.dashFutureChartInstance = new Chart(canvas.getContext('2d'), chartCfg);
        }
    },

    renderDashboardReceivedChart(transactionsData) {
        const canvas = document.getElementById('dashReceivedChart');
        if (!canvas || typeof Chart === 'undefined') return;

        const now = new Date();
        const monthlyData = {};
        for (let i = 11; i >= 0; i--) {
            const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
            monthlyData[d.toLocaleString('default', { month: 'short', year: '2-digit' })] = 0;
        }

        let total12m = 0;
        if (transactionsData) {
            transactionsData.forEach(acct => {
                (acct.transactions || []).forEach(txn => {
                    if (!['DIVIDEND', 'DIV'].includes((txn.type || '').toUpperCase())) return;
                    const d = new Date(txn.date);
                    const ago = (now.getFullYear() - d.getFullYear()) * 12 + (now.getMonth() - d.getMonth());
                    if (ago >= 0 && ago < 12) {
                        const key = d.toLocaleString('default', { month: 'short', year: '2-digit' });
                        if (monthlyData[key] !== undefined) { monthlyData[key] += Math.abs(txn.amount || 0); total12m += Math.abs(txn.amount || 0); }
                    }
                });
            });
        }

        const labels = Object.keys(monthlyData);
        const data   = Object.values(monthlyData);
        const maxVal = Math.max(...data, 1);
        const fmt    = v => `$${v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

        const totalEl = document.getElementById('dashReceivedTotal');
        if (totalEl) totalEl.textContent = total12m > 0 ? `${fmt(total12m)} received` : 'No data yet';

        const chartCfg = {
            type: 'bar',
            data: { labels, datasets: [{ data, backgroundColor: 'rgba(79,142,247,0.28)', borderColor: '#4f8ef7', borderWidth: 0, borderRadius: 3, hoverBackgroundColor: 'rgba(79,142,247,0.55)' }] },
            options: {
                responsive: true, maintainAspectRatio: false,
                plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => ` ${fmt(c.parsed.y)}` }, backgroundColor: '#1e2640', padding: 8, cornerRadius: 6, titleFont: { size: 11 }, bodyFont: { size: 12, weight: '600' }, borderColor: 'rgba(255,255,255,0.08)', borderWidth: 1 } },
                scales: {
                    y: { beginAtZero: true, max: maxVal * 1.25, grid: { color: 'rgba(255,255,255,0.04)' }, ticks: { color: '#7c8496', font: { size: 10 }, callback: v => v >= 1000 ? `$${(v/1000).toFixed(0)}K` : `$${v}` } },
                    x: { grid: { display: false }, ticks: { color: '#7c8496', font: { size: 10 } } }
                }
            }
        };

        if (this.dashReceivedChartInstance) {
            this.dashReceivedChartInstance.data.labels = labels;
            this.dashReceivedChartInstance.data.datasets[0].data = data;
            this.dashReceivedChartInstance.options.scales.y.max = maxVal * 1.25;
            this.dashReceivedChartInstance.update();
        } else {
            this.dashReceivedChartInstance = new Chart(canvas.getContext('2d'), chartCfg);
        }
    },

    // ────────────────────────────────────────────────────────────────────

    renderAllHoldings(data) {
        const tabsContainer   = document.getElementById('holdings-tabs');
        const tablesContainer = document.getElementById('holdings-tables');

        if (!data || data.length === 0) {
            if (tabsContainer) { tabsContainer.innerHTML = ''; tabsContainer.style.display = 'none'; }
            tablesContainer.innerHTML = '<div class="empty-state"><p>No active accounts found to load holdings.</p></div>';
            return;
        }

        this.holdingsStore.clear();
        let tabsHtml = '', tablesHtml = '';

        data.forEach((account, index) => {
            const isActive = index === 0;
            const tabId = `holdings-pane-${account.accountId}`;
            const aid = sanitize(account.accountId);

            tabsHtml += `<button class="pill-tab ${isActive ? 'active' : ''}"
                                 onclick="App.switchHoldingsPageTab('${aid}')"
                                 id="holdings-tabbtn-${aid}">
                             ${sanitize(account.accountName || 'Unnamed')}
                         </button>`;

            tablesHtml += `<div class="holdings-pane card ${isActive ? 'active' : ''}" id="${tabId}" style="display:${isActive ? 'block' : 'none'}; padding:0; overflow:hidden;">`;

            if (account.error) {
                tablesHtml += `
                    <div class="empty-state" style="padding:2.5rem 1.5rem;">
                        <div class="empty-icon" style="color:var(--danger);">⚠</div>
                        <p style="color:var(--danger);font-weight:600;margin-bottom:0.5rem;">Connection Error</p>
                        <p>${sanitize(account.error)}</p>
                        <button class="btn btn-outline btn-sm mt-2" onclick="App.switchMainTab('settings');App.switchSettingsTab('portfolios')">Go to Settings</button>
                    </div></div>`;
                return;
            }

            if (!account.holdings || account.holdings.length === 0) {
                tablesHtml += '<div class="empty-state" style="padding:2rem;"><p>No holdings found in this account.</p></div></div>';
                return;
            }

            this.holdingsStore.set(account.accountId, {
                holdings: account.holdings,
                tradingEnabled: account.tradingEnabled,
                portfolioId: account.portfolioId,
                accountName: account.accountName
            });

            const tradeCol = account.tradingEnabled;
            const colCount = tradeCol ? 6 : 4;

            tablesHtml += `
                <div style="padding:0.6rem 1rem;border-bottom:1px solid var(--border);display:flex;gap:0.5rem;align-items:center;flex-wrap:wrap;">
                    <input type="text" class="holdings-filter" data-account="${aid}" placeholder="Filter positions…"
                           style="flex:1;min-width:140px;max-width:220px;background:var(--surface-2);border:1px solid var(--border);color:var(--text);border-radius:var(--radius-sm);padding:0.28rem 0.6rem;font-size:0.78rem;">
                    <select class="holdings-sort" data-account="${aid}"
                            style="background:var(--surface-2);border:1px solid var(--border);color:var(--text);border-radius:var(--radius-sm);padding:0.28rem 0.6rem;font-size:0.78rem;cursor:pointer;">
                        <option value="value-desc">Value ↓</option>
                        <option value="value-asc">Value ↑</option>
                        <option value="symbol">Symbol A→Z</option>
                        <option value="symbol-desc">Symbol Z→A</option>
                        <option value="shares-desc">Shares ↓</option>
                        <option value="price-desc">Price ↓</option>
                    </select>
                </div>
                <table class="data-table"><thead><tr>
                    <th>Position</th>
                    <th class="right">Shares</th>
                    <th class="right">Price</th>
                    <th class="right">Total Value</th>
                    ${tradeCol ? '<th></th><th class="right">Quick Buy</th>' : ''}
                </tr></thead><tbody id="holdings-tbody-${aid}"></tbody></table>`;

            tablesHtml += '</div>';
        });

        if (tabsContainer) {
            tabsContainer.innerHTML = tabsHtml;
            tabsContainer.style.display = 'flex';
        }
        tablesContainer.innerHTML = tablesHtml;

        // Wire up filter/sort listeners and render each table body
        this.holdingsStore.forEach((_, accountId) => {
            this.renderHoldingsTableBody(accountId);
            const filterEl = document.querySelector(`.holdings-filter[data-account="${sanitize(accountId)}"]`);
            const sortEl   = document.querySelector(`.holdings-sort[data-account="${sanitize(accountId)}"]`);
            filterEl?.addEventListener('input',  () => this.renderHoldingsTableBody(accountId));
            sortEl?.addEventListener('change',   () => this.renderHoldingsTableBody(accountId));
        });
    },

    renderHoldingsTableBody(accountId) {
        const store = this.holdingsStore.get(accountId);
        if (!store) return;
        const tbody = document.getElementById(`holdings-tbody-${sanitize(accountId)}`);
        if (!tbody) return;

        const filterEl = document.querySelector(`.holdings-filter[data-account="${sanitize(accountId)}"]`);
        const sortEl   = document.querySelector(`.holdings-sort[data-account="${sanitize(accountId)}"]`);
        const filter   = (filterEl?.value || '').toLowerCase();
        const sort     = sortEl?.value || 'value-desc';

        let holdings = [...store.holdings];

        if (filter) {
            holdings = holdings.filter(h => {
                const sym  = (h.symbol?.symbol?.symbol || h.symbol?.symbol || h.symbol || '').toLowerCase();
                const desc = (h.symbol?.symbol?.description || h.description || '').toLowerCase();
                return sym.includes(filter) || desc.includes(filter);
            });
        }

        holdings.sort((a, b) => {
            const symA = a.symbol?.symbol?.symbol || a.symbol?.symbol || a.symbol || '';
            const symB = b.symbol?.symbol?.symbol || b.symbol?.symbol || b.symbol || '';
            const valA = (a.units || 0) * (a.price || 0);
            const valB = (b.units || 0) * (b.price || 0);
            switch (sort) {
                case 'symbol':      return symA.localeCompare(symB);
                case 'symbol-desc': return symB.localeCompare(symA);
                case 'value-desc':  return valB - valA;
                case 'value-asc':   return valA - valB;
                case 'shares-desc': return (b.units || 0) - (a.units || 0);
                case 'price-desc':  return (b.price || 0) - (a.price || 0);
                default:            return 0;
            }
        });

        const { tradingEnabled, portfolioId } = store;
        const tradeCol = tradingEnabled;
        const colCount = tradeCol ? 6 : 4;

        if (holdings.length === 0) {
            tbody.innerHTML = `<tr><td colspan="${colCount}" style="text-align:center;color:var(--text-muted);padding:1.5rem;">No positions match the filter.</td></tr>`;
            return;
        }

        tbody.innerHTML = holdings.map(h => {
            const symbol      = h.symbol?.symbol?.symbol || h.symbol?.symbol || h.symbol || '—';
            const description = h.symbol?.symbol?.description || h.description || symbol;
            const symbolId    = h.symbolId || h.instrument?.id || h.symbol?.id || '';
            const units       = h.units  || 0;
            const price       = h.price  || 0;
            const totalValue  = units * price;
            const aid         = sanitize(accountId);
            const pid         = sanitize(portfolioId);

            const tradeBtns = tradeCol ? `
                <td style="white-space:nowrap;">
                    <div style="display:flex;gap:0.3rem;justify-content:flex-end;">
                        <button class="trade-btn-buy"
                                data-account-id="${aid}" data-portfolio-id="${pid}"
                                data-symbol="${sanitize(symbol)}" data-symbol-id="${sanitize(symbolId)}"
                                data-description="${sanitize(description)}" data-price="${price}"
                                data-action="BUY">Buy</button>
                        <button class="trade-btn-sell"
                                data-account-id="${aid}" data-portfolio-id="${pid}"
                                data-symbol="${sanitize(symbol)}" data-symbol-id="${sanitize(symbolId)}"
                                data-description="${sanitize(description)}" data-price="${price}"
                                data-action="SELL">Sell</button>
                    </div>
                </td>` : '';

            const presetBtns = tradeCol ? `
                <td style="white-space:nowrap;">
                    <div style="display:flex;gap:0.25rem;justify-content:flex-end;">
                        ${[100, 250, 500].map(bucket => `
                        <button class="trade-btn-preset"
                                data-account-id="${aid}" data-portfolio-id="${pid}"
                                data-symbol="${sanitize(symbol)}" data-symbol-id="${sanitize(symbolId)}"
                                data-description="${sanitize(description)}" data-price="${price}"
                                data-bucket="${bucket}"
                                ${!price ? 'disabled' : ''}>$${bucket}</button>`).join('')}
                    </div>
                </td>` : '';

            return `<tr>
                <td>
                    <div class="ticker-cell">${sanitize(symbol)}</div>
                    <div class="ticker-desc">${sanitize(description)}</div>
                </td>
                <td class="right">${units.toLocaleString(undefined,{maximumFractionDigits:4})}</td>
                <td class="right">$${price.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}</td>
                <td class="right" style="font-weight:600;">$${totalValue.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}</td>
                ${tradeBtns}${presetBtns}
            </tr>`;
        }).join('');
    },

    renderAllTransactions(data) {
        const tabsContainer   = document.getElementById('transactions-tabs');
        const tablesContainer = document.getElementById('transactions-tables');

        if (!data || data.length === 0) {
            if (tabsContainer) { tabsContainer.innerHTML = ''; tabsContainer.style.display = 'none'; }
            tablesContainer.innerHTML = '<div class="empty-state"><p>No active accounts found to load transactions.</p></div>';
            return;
        }

        this.txStore.clear();
        let tabsHtml = '', tablesHtml = '';

        data.forEach((account, index) => {
            const isActive = index === 0;
            const tabId = `transactions-pane-${account.accountId}`;
            const aid = sanitize(account.accountId);

            tabsHtml += `<button class="pill-tab ${isActive ? 'active' : ''}"
                                 onclick="App.switchTransactionsPageTab('${aid}')"
                                 id="transactions-tabbtn-${aid}">
                             ${sanitize(account.accountName || 'Unnamed')}
                         </button>`;

            tablesHtml += `<div class="transactions-pane card ${isActive ? 'active' : ''}" id="${tabId}" style="display:${isActive ? 'block' : 'none'}; padding:0; overflow:hidden;">`;

            if (!account.transactions || account.transactions.length === 0) {
                tablesHtml += '<div class="empty-state" style="padding:2rem;"><p>No transactions found in this account.</p></div></div>';
                return;
            }

            this.txStore.set(account.accountId, { transactions: account.transactions, positionsBySymbol: account.positionsBySymbol || {}, page: 0 });

            tablesHtml += `
                <table class="data-table"><thead><tr>
                    <th>Security</th><th>Date</th><th>Type</th>
                    <th class="right">Quantity</th><th class="right">Amount</th>
                </tr></thead><tbody id="tx-tbody-${aid}"></tbody></table>
                <div class="tx-pagination" id="tx-pagination-${aid}" style="display:flex;align-items:center;justify-content:space-between;padding:0.6rem 1rem;border-top:1px solid var(--border);font-size:0.78rem;color:var(--text-muted);">
                    <span id="tx-page-info-${aid}"></span>
                    <div style="display:flex;gap:0.4rem;">
                        <button class="btn btn-outline btn-sm" id="tx-prev-${aid}" onclick="UI.txPageChange('${aid}',-1)">← Prev</button>
                        <button class="btn btn-outline btn-sm" id="tx-next-${aid}" onclick="UI.txPageChange('${aid}',1)">Next →</button>
                    </div>
                </div>`;

            tablesHtml += '</div>';
        });

        if (tabsContainer) {
            tabsContainer.innerHTML = tabsHtml;
            tabsContainer.style.display = 'flex';
        }
        tablesContainer.innerHTML = tablesHtml;

        this.txStore.forEach((_, accountId) => this.renderTransactionPage(accountId));
    },

    txPageChange(accountId, delta) {
        const entry = this.txStore.get(accountId);
        if (!entry) return;
        const total = entry.transactions.length;
        const maxPage = Math.ceil(total / this.TX_PAGE_SIZE) - 1;
        entry.page = Math.max(0, Math.min(maxPage, entry.page + delta));
        this.renderTransactionPage(accountId);
    },

    renderTransactionPage(accountId) {
        const entry = this.txStore.get(accountId);
        if (!entry) return;
        const aid = sanitize(accountId);
        const tbody = document.getElementById(`tx-tbody-${aid}`);
        const infoEl = document.getElementById(`tx-page-info-${aid}`);
        const prevBtn = document.getElementById(`tx-prev-${aid}`);
        const nextBtn = document.getElementById(`tx-next-${aid}`);
        if (!tbody) return;

        const { transactions, positionsBySymbol, page } = entry;
        const total    = transactions.length;
        const maxPage  = Math.ceil(total / this.TX_PAGE_SIZE) - 1;
        const start    = page * this.TX_PAGE_SIZE;
        const end      = Math.min(start + this.TX_PAGE_SIZE, total);
        const slice    = transactions.slice(start, end);

        const typeBadge = type => {
            const t = (type || '').toUpperCase();
            if (t === 'BUY')                               return `<span class="type-badge badge-buy">Buy</span>`;
            if (t === 'SELL')                              return `<span class="type-badge badge-sell">Sell</span>`;
            if (t === 'DIVIDEND')                          return `<span class="type-badge badge-dividend">Dividend</span>`;
            if (t === 'DEPOSIT' || t === 'TRANSFER_IN')   return `<span class="type-badge badge-dep">Deposit</span>`;
            if (t === 'WITHDRAWAL' || t === 'TRANSFER_OUT') return `<span class="type-badge badge-with">Withdrawal</span>`;
            return `<span class="type-badge badge-other">${sanitize(type) || '—'}</span>`;
        };

        tbody.innerHTML = slice.map(txn => {
            const symbol      = txn.symbol || '—';
            const description = txn.description || symbol;
            const date        = txn.date ? new Date(txn.date).toLocaleDateString(undefined, {year:'numeric',month:'short',day:'numeric'}) : '—';
            const amount      = txn.amount ?? 0;
            const amtCls      = amount >= 0 ? 'val-pos' : 'val-neg';
            const amtSign     = amount >= 0 ? '+' : '';

            const isDividend  = (txn.type || '').toUpperCase() === 'DIVIDEND';
            let unitsHtml     = '—';

            if (txn.units != null) {
                // Brokerage provided the share count directly
                const sharesStr = Number(txn.units).toLocaleString(undefined, { maximumFractionDigits: 4 });
                if (isDividend && txn.price != null) {
                    const perShare = Number(txn.price).toFixed(4);
                    unitsHtml = `${sanitize(sharesStr)}<div class="text-sm text-muted" title="Dividend per share">$${perShare}/sh</div>`;
                } else {
                    unitsHtml = sanitize(sharesStr);
                }
            } else if (isDividend && symbol !== '—' && positionsBySymbol[symbol] != null) {
                // SnapTrade didn't send units — cross-reference with current holdings
                const heldShares = positionsBySymbol[symbol];
                const sharesStr  = Number(heldShares).toLocaleString(undefined, { maximumFractionDigits: 4 });
                const perShare   = heldShares > 0 ? (amount / heldShares).toFixed(4) : null;
                unitsHtml = `<span title="Share count not provided by brokerage — inferred from current holdings">~${sanitize(sharesStr)}</span>`
                    + (perShare ? `<div class="text-sm text-muted" title="Implied dividend per share">~$${perShare}/sh</div>` : '');
            }

            return `<tr>
                <td>
                    <div class="ticker-cell">${sanitize(symbol !== '—' ? symbol : description)}</div>
                    ${symbol !== '—' && description !== symbol ? `<div class="ticker-desc">${sanitize(description)}</div>` : ''}
                </td>
                <td style="white-space:nowrap;color:var(--text-muted);font-size:0.8rem;">${sanitize(date)}</td>
                <td>${typeBadge(txn.type)}</td>
                <td class="right" style="color:var(--text-muted);">${unitsHtml}</td>
                <td class="right" style="font-weight:600;">
                    <span class="${amtCls}">${amtSign}$${Math.abs(amount).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}</span>
                    <div class="text-sm text-muted">${sanitize(txn.currencyCode || '')}</div>
                </td>
            </tr>`;
        }).join('');

        if (infoEl) infoEl.textContent = `${start + 1}–${end} of ${total}`;
        if (prevBtn) prevBtn.disabled = page === 0;
        if (nextBtn) nextBtn.disabled = page >= maxPage;

        const paginationEl = document.getElementById(`tx-pagination-${aid}`);
        if (paginationEl) paginationEl.style.display = total <= this.TX_PAGE_SIZE ? 'none' : 'flex';
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

    renderDashboardChart(currentGroups, inactiveAccountIds) {
        const area = document.getElementById('dashboardChartArea');
        if (!area) return;

        const activeAccounts = [];
        currentGroups.forEach(group => {
            group.accounts.forEach(acc => {
                const amount = acc.balance?.total?.amount || 0;
                if (!inactiveAccountIds.has(acc.id) && amount > 0) {
                    activeAccounts.push({
                        label: acc.customName || acc.name || 'Unnamed',
                        value: amount
                    });
                }
            });
        });

        if (activeAccounts.length === 0) {
            if (this.accountsChartInstance) {
                this.accountsChartInstance.destroy();
                this.accountsChartInstance = null;
            }
            area.innerHTML = '<div class="empty-state"><div class="empty-icon">📈</div><p>No account data available. Connect an account with a positive balance.</p></div>';
            return;
        }

        if (!document.getElementById('accountsChart')) {
            area.innerHTML = '<canvas id="accountsChart" style="max-height:360px;"></canvas>';
        }

        const ctx    = document.getElementById('accountsChart').getContext('2d');
        const labels = activeAccounts.map(a => a.label);
        const data   = activeAccounts.map(a => a.value);

        const palette = [
            '#00d09c','#4f8ef7','#f7c948','#f76f8e','#a78bfa',
            '#38bdf8','#fb923c','#34d399','#e879f9','#facc15',
            '#60a5fa','#f87171','#2dd4bf','#c084fc','#fbbf24'
        ];
        const bgColors = activeAccounts.map((_, i) => palette[i % palette.length] + 'cc');

        if (this.accountsChartInstance) {
            this.accountsChartInstance.data.labels                         = labels;
            this.accountsChartInstance.data.datasets[0].data               = data;
            this.accountsChartInstance.data.datasets[0].backgroundColor    = bgColors;
            this.accountsChartInstance.update();
            return;
        }

        if (typeof Chart === 'undefined') return;

        Chart.defaults.color       = '#7c8496';
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
                        position: 'right',
                        labels: { padding: 18, font: { size: 12 }, color: '#e8eaf0' }
                    },
                    tooltip: {
                        callbacks: {
                            label(ctx) {
                                return ` ${ctx.label}: ${new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(ctx.parsed)}`;
                            }
                        },
                        backgroundColor: '#1e2640',
                        titleFont: { size: 13 },
                        bodyFont:  { size: 13 },
                        padding: 12,
                        cornerRadius: 8,
                        borderColor: 'rgba(255,255,255,0.08)',
                        borderWidth: 1
                    }
                },
                cutout: '68%',
                animation: { animateScale: true, animateRotate: true }
            }
        });
    },

    renderDividends(cachedDividendsData) {
        const container  = document.getElementById('dividends-page-content');
        const summaryRow = document.getElementById('dividendSummaryRow');
        if (!container) return;

        let allEvents = [];
        cachedDividendsData.forEach(acct => {
            if (acct.error) return;
            (acct.dividends || []).forEach(e => {
                allEvents.push({ ...e, portfolioName: acct.portfolioName, accountName: acct.accountName });
            });
        });

        if (allEvents.length === 0) {
            container.innerHTML = '<div class="empty-state"><p>No dividend forecast events found. Ensure you have holdings with dividend history.</p></div>';
            if (summaryRow) summaryRow.style.display = 'none';
            return;
        }

        if (summaryRow) summaryRow.style.display = 'flex';

        allEvents.sort((a, b) => new Date(a.date) - new Date(b.date));

        const annualTotal = allEvents.reduce((s, e) => s + (e.amount || 0), 0);
        const fmt = v => `$${v.toLocaleString(undefined, {minimumFractionDigits:2, maximumFractionDigits:2})}`;

        document.getElementById('unified-annual-income').textContent   = fmt(annualTotal);
        document.getElementById('unified-monthly-average').textContent = fmt(annualTotal / 12);
        document.getElementById('unified-daily-income').textContent    = fmt(annualTotal / 365);

        // Yield: annual income / total active portfolio value
        try {
            let portfolioValue = 0;
            if (App.currentGroups) {
                App.currentGroups.forEach(g => {
                    (g.accounts || []).forEach(acc => {
                        if (!App.inactiveAccountIds?.has(acc.id)) {
                            portfolioValue += acc.balance?.total?.amount || 0;
                        }
                    });
                });
            }
            const yieldEl = document.getElementById('unified-yield');
            if (portfolioValue > 0) {
                yieldEl.textContent = `${((annualTotal / portfolioValue) * 100).toFixed(2)}%`;
            } else {
                yieldEl.textContent = '—';
            }
        } catch (_) { document.getElementById('unified-yield').textContent = '—'; }

        // Yet to receive: events from today onwards within the 12-month window
        const today = new Date(); today.setHours(0,0,0,0);
        const yetToReceive = allEvents
            .filter(e => new Date(e.date) >= today)
            .reduce((s, e) => s + (e.amount || 0), 0);
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
            const key = new Date(e.date).toLocaleString('default', { month: 'short', year: 'numeric' });
            if (monthlyData[key]) {
                monthlyData[key].total += e.amount || 0;
                monthlyData[key].events.push(e);
            }
        });

        this.renderDividendChart(monthlyData);

        let html = '';
        for (const [monthYear, mData] of Object.entries(monthlyData)) {
            if (mData.events.length === 0) continue;

            html += `<div class="dividend-month-card">
                <div class="dividend-month-header">
                    <span class="dividend-month-name">${monthYear}</span>
                    <span class="dividend-month-total">+$${mData.total.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}</span>
                </div>`;

            mData.events.forEach(e => {
                const d = new Date(e.date);
                html += `
                    <div class="dividend-event-row">
                        <div class="dividend-event-date">
                            <div class="dividend-event-date-month">${sanitize(d.toLocaleString('default',{month:'short'}))}</div>
                            <div class="dividend-event-date-day">${d.getDate()}</div>
                        </div>
                        <div class="dividend-event-info">
                            <div>
                                <span class="dividend-event-symbol">${sanitize(e.symbol)}</span>
                                <span class="dividend-event-name">${sanitize(e.name)}</span>
                            </div>
                            <div class="dividend-event-meta">${(e.units || 0).toLocaleString()} shares &middot; $${(e.amountPerShare || 0).toFixed(4)}/share</div>
                        </div>
                        <div class="dividend-event-right">
                            <div class="dividend-event-amount">+$${(e.amount || 0).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}</div>
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

        if (this.dividendChartInstance) {
            this.dividendChartInstance.data.labels            = labels;
            this.dividendChartInstance.data.datasets[0].data  = data;
            this.dividendChartInstance.options.scales.y.max   = maxVal * 1.2;
            this.dividendChartInstance.update();
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
                        backgroundColor: '#1e2640',
                        titleFont: { size: 12 },
                        bodyFont:  { size: 13, weight: '600' },
                        padding: 10,
                        cornerRadius: 8,
                        borderColor: 'rgba(255,255,255,0.08)',
                        borderWidth: 1
                    }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        max: maxVal * 1.2,
                        grid:  { color: 'rgba(255,255,255,0.04)' },
                        ticks: {
                            color: '#7c8496',
                            callback: v => v >= 1000 ? `$${(v/1000).toFixed(0)}K` : `$${v}`
                        }
                    },
                    x: {
                        grid:  { display: false },
                        ticks: { color: '#7c8496', font: { size: 11 } }
                    }
                }
            }
        });
    },

    renderDividendCalendar(cachedDividendsData, targetDate) {
        const gridEl   = document.getElementById('dividend-calendar-grid');
        const monthEl  = document.getElementById('currentCalendarMonth');
        if (!gridEl || !monthEl) return;

        monthEl.textContent = targetDate.toLocaleString('default', { month: 'long', year: 'numeric' });

        let allEvents  = [];
        let annualTotal = 0;
        if (cachedDividendsData) {
            cachedDividendsData.forEach(acct => {
                if (acct.error) return;
                (acct.dividends || []).forEach(e => {
                    allEvents.push({ ...e, portfolioName: acct.portfolioName, accountName: acct.accountName });
                    annualTotal += (e.amount || 0);
                });
            });
        }

        const summaryEl = document.getElementById('dividend-tracker-summary');
        if (summaryEl) summaryEl.style.display = 'grid';
        const annualEl  = document.getElementById('unified-annual-income');
        const monthAvgEl = document.getElementById('unified-monthly-average');
        const monthTotalEl = document.getElementById('unified-month-total');
        const monthLabelEl = document.getElementById('unified-month-label');

        if (annualEl)   annualEl.textContent   = `$${annualTotal.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}`;
        if (monthAvgEl) monthAvgEl.textContent = `$${(annualTotal / 12).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}`;
        if (monthLabelEl) monthLabelEl.textContent = `${targetDate.toLocaleString('default',{month:'short'})} Total`;

        const year  = targetDate.getFullYear();
        const month = targetDate.getMonth();
        const firstDow    = new Date(year, month, 1).getDay();
        const daysInMonth = new Date(year, month + 1, 0).getDate();
        const prevLast    = new Date(year, month, 0).getDate();
        const today       = new Date();

        let html = '<div class="calendar-header-row">';
        ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].forEach(d => {
            html += `<div class="calendar-day-name">${d}</div>`;
        });
        html += '</div><div class="calendar-grid">';

        for (let i = firstDow - 1; i >= 0; i--) {
            html += `<div class="calendar-cell other-month"><div class="calendar-date-num">${prevLast - i}</div></div>`;
        }

        let viewingMonthTotal = 0;
        for (let day = 1; day <= daysInMonth; day++) {
            const dateStr  = `${year}-${String(month+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
            const isToday  = today.getFullYear() === year && today.getMonth() === month && today.getDate() === day;
            const dayEvents = allEvents.filter(e => {
                const d = new Date(e.date);
                return d.getFullYear() === year && d.getMonth() === month && d.getDate() === day;
            });
            const dayTotal = dayEvents.reduce((s, e) => s + (e.amount || 0), 0);
            viewingMonthTotal += dayTotal;
            const hasEvents = dayEvents.length > 0;
            const eventsJson = JSON.stringify(dayEvents).replace(/"/g, '&quot;');

            html += `<div class="calendar-cell${isToday ? ' today' : ''}${hasEvents ? ' has-events' : ''}"
                         onclick="${hasEvents ? `UI.renderCalendarDayDetails(${eventsJson}, '${dateStr}')` : ''}">
                        <div class="calendar-date-num">${day}</div>
                        ${hasEvents ? `<div class="calendar-event-dot"></div>
                                       <span class="calendar-event-amount">+$${dayTotal.toFixed(2)}</span>` : ''}
                     </div>`;
        }

        if (monthTotalEl) monthTotalEl.textContent = `$${viewingMonthTotal.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}`;

        const totalCells = firstDow + daysInMonth;
        const remaining  = (Math.ceil(totalCells / 7) * 7) - totalCells;
        for (let i = 1; i <= remaining; i++) {
            html += `<div class="calendar-cell other-month"><div class="calendar-date-num">${i}</div></div>`;
        }

        html += '</div>';
        gridEl.innerHTML = html;
    },

    renderCalendarDayDetails(events, dateStr) {
        const container = document.getElementById('calendar-day-details');
        if (!container) return;

        document.querySelectorAll('.calendar-cell').forEach(el => el.classList.remove('selected'));

        const date          = new Date(dateStr + 'T12:00:00');
        const formattedDate = date.toLocaleDateString(undefined, { weekday:'long', month:'long', day:'numeric', year:'numeric' });

        if (!events || events.length === 0) {
            container.innerHTML = `
                <div class="day-detail-header">
                    <div class="day-detail-date">${formattedDate}</div>
                </div>
                <div class="empty-state" style="padding:1.5rem 0;">
                    <p>No dividends scheduled for this day.</p>
                </div>`;
            return;
        }

        const total = events.reduce((s, e) => s + (e.amount || 0), 0);

        let html = `
            <div class="day-detail-header">
                <div class="day-detail-date">${formattedDate}</div>
                <div class="day-detail-total">+$${total.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}</div>
            </div>`;

        events.forEach(e => {
            html += `
                <div class="day-detail-item">
                    <div class="day-detail-item-top">
                        <span class="dividend-event-symbol">${e.symbol}</span>
                        <span class="day-detail-item-amount">+$${(e.amount||0).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}</span>
                    </div>
                    <div class="day-detail-item-name">${e.name}</div>
                    <div class="day-detail-item-meta">${(e.units||0).toLocaleString()} shares @ $${(e.amountPerShare||0).toFixed(4)}</div>
                    <div class="day-detail-item-meta" style="margin-top:4px;opacity:0.7;">${e.portfolioName} &middot; ${e.accountName}</div>
                </div>`;
        });

        container.innerHTML = html;
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
};
