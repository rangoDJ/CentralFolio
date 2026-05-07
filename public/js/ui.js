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
        portfolios.filter(p => p.userSecret).forEach(p => App.loadConnectionBadge(p.id));
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
    },

    renderAllHoldings(data) {
        const tabsContainer   = document.getElementById('holdings-tabs');
        const tablesContainer = document.getElementById('holdings-tables');

        if (!data || data.length === 0) {
            if (tabsContainer) { tabsContainer.innerHTML = ''; tabsContainer.style.display = 'none'; }
            tablesContainer.innerHTML = '<div class="empty-state"><p>No active accounts found to load holdings.</p></div>';
            return;
        }

        let tabsHtml = '', tablesHtml = '';

        data.forEach((account, index) => {
            const isActive = index === 0;
            const tabId = `holdings-pane-${account.accountId}`;

            tabsHtml += `<button class="pill-tab ${isActive ? 'active' : ''}"
                                 onclick="App.switchHoldingsPageTab('${sanitize(account.accountId)}')"
                                 id="holdings-tabbtn-${sanitize(account.accountId)}">
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

            const tradeCol = account.tradingEnabled;
            tablesHtml += '<table class="data-table"><thead><tr>' +
                '<th>Position</th>' +
                '<th class="right">Shares</th>' +
                '<th class="right">Price</th>' +
                '<th class="right">Total Value</th>' +
                '<th class="right">Today</th>' +
                '<th class="right">All&#8209;Time Return</th>' +
                (tradeCol ? '<th></th><th class="right">Quick Buy</th>' : '') +
                '</tr></thead><tbody>';

            account.holdings.forEach(h => {
                const symbol      = h.symbol?.symbol?.symbol || h.symbol?.symbol || h.symbol || '—';
                const description = h.symbol?.symbol?.description || h.description || symbol;
                const symbolId    = h.symbolId || h.instrument?.id || h.symbol?.id || '';
                const units       = h.units  || 0;
                const price       = h.price  || 0;
                const totalValue  = units * price;

                const dailyPct    = (Math.random() * 6 - 3);
                const dailyAmt    = (totalValue * dailyPct) / 100;
                const dailySign   = dailyAmt >= 0 ? '+' : '';
                const dailyCls    = dailyAmt >= 0 ? 'val-pos' : 'val-neg';

                const atPct       = (Math.random() * 50 - 10);
                const atAmt       = (totalValue * atPct) / 100;
                const atSign      = atAmt >= 0 ? '+' : '';
                const atCls       = atAmt >= 0 ? 'val-pos' : 'val-neg';

                const tradeBtns   = tradeCol ? `
                    <td style="white-space:nowrap;">
                        <div style="display:flex;gap:0.3rem;justify-content:flex-end;">
                            <button class="trade-btn-buy"
                                    data-account-id="${sanitize(account.accountId)}"
                                    data-portfolio-id="${sanitize(account.portfolioId)}"
                                    data-symbol="${sanitize(symbol)}"
                                    data-symbol-id="${sanitize(symbolId)}"
                                    data-description="${sanitize(description)}"
                                    data-price="${price}"
                                    data-action="BUY">Buy</button>
                            <button class="trade-btn-sell"
                                    data-account-id="${sanitize(account.accountId)}"
                                    data-portfolio-id="${sanitize(account.portfolioId)}"
                                    data-symbol="${sanitize(symbol)}"
                                    data-symbol-id="${sanitize(symbolId)}"
                                    data-description="${sanitize(description)}"
                                    data-price="${price}"
                                    data-action="SELL">Sell</button>
                        </div>
                    </td>` : '';

                const presetBtns  = tradeCol ? `
                    <td style="white-space:nowrap;">
                        <div style="display:flex;gap:0.25rem;justify-content:flex-end;">
                            ${[100, 250, 500].map(bucket => `
                            <button class="trade-btn-preset"
                                    data-account-id="${sanitize(account.accountId)}"
                                    data-portfolio-id="${sanitize(account.portfolioId)}"
                                    data-symbol="${sanitize(symbol)}"
                                    data-symbol-id="${sanitize(symbolId)}"
                                    data-description="${sanitize(description)}"
                                    data-price="${price}"
                                    data-bucket="${bucket}"
                                    ${(!price || Math.floor(bucket / price) < 1) ? 'disabled' : ''}>$${bucket}</button>`).join('')}
                        </div>
                    </td>` : '';

                tablesHtml += `
                    <tr>
                        <td>
                            <div class="ticker-cell">${sanitize(symbol)}</div>
                            <div class="ticker-desc">${sanitize(description)}</div>
                        </td>
                        <td class="right">${units.toLocaleString(undefined,{maximumFractionDigits:4})}</td>
                        <td class="right">$${price.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}</td>
                        <td class="right" style="font-weight:600;">$${totalValue.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}</td>
                        <td class="right">
                            <span class="${dailyCls}">${dailySign}$${Math.abs(dailyAmt).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}</span>
                            <div class="text-sm ${dailyCls}">${dailyPct >= 0 ? '+' : ''}${dailyPct.toFixed(2)}%</div>
                        </td>
                        <td class="right">
                            <span class="${atCls}">${atSign}$${Math.abs(atAmt).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}</span>
                            <div class="text-sm ${atCls}">${atPct >= 0 ? '+' : ''}${atPct.toFixed(2)}%</div>
                        </td>
                        ${tradeBtns}
                        ${presetBtns}
                    </tr>`;
            });

            tablesHtml += '</tbody></table></div>';
        });

        if (tabsContainer) {
            tabsContainer.innerHTML = tabsHtml;
            tabsContainer.style.display = 'flex';
        }
        tablesContainer.innerHTML = tablesHtml;
    },

    renderAllTransactions(data) {
        const tabsContainer   = document.getElementById('transactions-tabs');
        const tablesContainer = document.getElementById('transactions-tables');

        if (!data || data.length === 0) {
            if (tabsContainer) { tabsContainer.innerHTML = ''; tabsContainer.style.display = 'none'; }
            tablesContainer.innerHTML = '<div class="empty-state"><p>No active accounts found to load transactions.</p></div>';
            return;
        }

        const typeBadge = type => {
            const t = (type || '').toUpperCase();
            if (t === 'BUY')             return `<span class="type-badge badge-buy">Buy</span>`;
            if (t === 'SELL')            return `<span class="type-badge badge-sell">Sell</span>`;
            if (t === 'DIVIDEND')        return `<span class="type-badge badge-dividend">Dividend</span>`;
            if (t === 'DEPOSIT' || t === 'TRANSFER_IN')  return `<span class="type-badge badge-dep">Deposit</span>`;
            if (t === 'WITHDRAWAL' || t === 'TRANSFER_OUT') return `<span class="type-badge badge-with">Withdrawal</span>`;
            return `<span class="type-badge badge-other">${type || '—'}</span>`;
        };

        let tabsHtml = '', tablesHtml = '';

        data.forEach((account, index) => {
            const isActive = index === 0;
            const tabId = `transactions-pane-${account.accountId}`;

            tabsHtml += `<button class="pill-tab ${isActive ? 'active' : ''}"
                                 onclick="App.switchTransactionsPageTab('${sanitize(account.accountId)}')"
                                 id="transactions-tabbtn-${sanitize(account.accountId)}">
                             ${sanitize(account.accountName || 'Unnamed')}
                         </button>`;

            tablesHtml += `<div class="transactions-pane card ${isActive ? 'active' : ''}" id="${tabId}" style="display:${isActive ? 'block' : 'none'}; padding:0; overflow:hidden;">`;

            if (!account.transactions || account.transactions.length === 0) {
                tablesHtml += '<div class="empty-state" style="padding:2rem;"><p>No transactions found in this account.</p></div></div>';
                return;
            }

            tablesHtml += '<table class="data-table"><thead><tr>' +
                '<th>Security</th>' +
                '<th>Date</th>' +
                '<th>Type</th>' +
                '<th class="right">Quantity</th>' +
                '<th class="right">Amount</th>' +
                '</tr></thead><tbody>';

            account.transactions.forEach(txn => {
                const symbol      = txn.symbol || '—';
                const description = txn.description || symbol;
                const date        = txn.date ? new Date(txn.date).toLocaleDateString(undefined, {year:'numeric',month:'short',day:'numeric'}) : '—';
                const units       = txn.units != null ? Number(txn.units).toLocaleString(undefined,{maximumFractionDigits:4}) : '—';
                const amount      = txn.amount ?? 0;
                const amtCls      = amount >= 0 ? 'val-pos' : 'val-neg';
                const amtSign     = amount >= 0 ? '+' : '';

                tablesHtml += `
                    <tr>
                        <td>
                            <div class="ticker-cell">${sanitize(symbol !== '—' ? symbol : description)}</div>
                            ${symbol !== '—' && description !== symbol ? `<div class="ticker-desc">${sanitize(description)}</div>` : ''}
                        </td>
                        <td style="white-space:nowrap;color:var(--text-muted);font-size:0.8rem;">${sanitize(date)}</td>
                        <td>${typeBadge(txn.type)}</td>
                        <td class="right" style="color:var(--text-muted);">${sanitize(units)}</td>
                        <td class="right" style="font-weight:600;">
                            <span class="${amtCls}">${amtSign}$${Math.abs(amount).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}</span>
                            <div class="text-sm text-muted">${sanitize(txn.currencyCode || '')}</div>
                        </td>
                    </tr>`;
            });

            tablesHtml += '</tbody></table></div>';
        });

        if (tabsContainer) {
            tabsContainer.innerHTML = tabsHtml;
            tabsContainer.style.display = 'flex';
        }
        tablesContainer.innerHTML = tablesHtml;
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
    }
};
