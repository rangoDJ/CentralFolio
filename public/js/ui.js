/**
 * UI and Rendering logic for CentralFolio
 */
const UI = {
    // Elements
    portfolioList: document.getElementById('portfolioList'),
    accountContainer: document.getElementById('accountContainer'),
    portfolioModal: document.getElementById('portfolioModal'),
    portfolioForm: document.getElementById('portfolioForm'),
    modalTitle: document.getElementById('modalTitle'),
    totalBalanceEl: document.getElementById('totalBalance'),
    portfolioCountEl: document.getElementById('portfolioCount'),
    toast: document.getElementById('toast'),
    adminUserList: document.getElementById('adminUserList'),

    showToast(msg, type = 'success') {
        this.toast.textContent = msg;
        this.toast.className = `toast show ${type}`;
        setTimeout(() => this.toast.classList.remove('show'), 4000);
    },

    openModal(portfolio = null) {
        if (portfolio) {
            this.modalTitle.textContent = 'Edit Portfolio';
            document.getElementById('portId').value = portfolio.id;
            document.getElementById('portName').value = portfolio.name;
            document.getElementById('clientId').value = portfolio.clientId;
            document.getElementById('consumerKey').value = portfolio.consumerKey;
            document.getElementById('userId').value = portfolio.userId;
            document.getElementById('userSecret').value = portfolio.userSecret || '';
        } else {
            this.modalTitle.textContent = 'Add Portfolio';
            this.portfolioForm.reset();
            document.getElementById('portId').value = '';
        }
        this.portfolioModal.classList.add('show');
    },

    closeModal() {
        this.portfolioModal.classList.remove('show');
    },

    renderPortfolios(portfolios) {
        this.portfolioCountEl.textContent = portfolios.length;
        if (portfolios.length === 0) {
            this.portfolioList.innerHTML = '<div class="empty-state" style="padding: 1rem;">No portfolios added.</div>';
            return;
        }

        this.portfolioList.innerHTML = portfolios.map(p => `
            <div class="portfolio-item" style="display: flex; flex-direction: column; gap: 1rem;">
                <div style="display: flex; justify-content: space-between; align-items: flex-start;">
                    <div>
                        <div style="display: flex; align-items: center; gap: 0.75rem; margin-bottom: 0.25rem;">
                            <span class="portfolio-name" style="font-size: 1.1rem;">${p.name}</span>
                            ${p.userSecret ? '<span class="status-badge status-active" style="padding: 0.2rem 0.5rem; font-size: 0.65rem;">Registered</span>' : ''}
                        </div>
                        <div class="portfolio-meta" style="margin: 0;">User: <span style="font-family: monospace; color: var(--text); opacity: 0.8;">${p.userId}</span></div>
                    </div>
                    <div style="display: flex; gap: 0.5rem;">
                        <button class="btn btn-outline btn-sm" style="padding: 0.35rem 0.75rem; font-size: 0.75rem;" onclick="App.editPortfolio(${p.id})">Edit</button>
                        <button class="btn btn-danger btn-sm" style="padding: 0.35rem 0.6rem; font-size: 0.85rem; line-height: 1;" title="Delete Portfolio" onclick="App.deletePortfolio(${p.id})">&times;</button>
                    </div>
                </div>
                
                <div class="portfolio-actions" style="margin-top: 0.25rem;">
                    ${!p.userSecret ? 
                        `<button class="btn btn-success btn-sm" style="width: 100%; justify-content: center;" onclick="App.registerPortfolio(${p.id}, this)">
                            <span class="loader"></span><span class="btn-text">Register with SnapTrade</span>
                         </button>` : 
                        `<button class="btn btn-outline btn-sm" style="width: 100%; justify-content: center; background: rgba(255,255,255,0.03);" onclick="App.connectBrokerage(${p.id}, this)">
                            <span class="loader"></span><span class="btn-text">Connect Brokerage</span>
                         </button>`
                    }
                </div>
            </div>
        `).join('');
    },

    renderAccountSection(currentGroups, activePortfolioId, inactiveAccountIds) {
        if (!currentGroups.length) return;

        // Calculate Grand Total (Excluding Inactive)
        let grandTotal = 0;
        currentGroups.forEach(group => {
            group.accounts.forEach(acc => {
                if (!inactiveAccountIds.has(acc.id)) {
                    grandTotal += (acc.balance?.total?.amount || 0);
                }
            });
        });
        this.totalBalanceEl.textContent = `$${grandTotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

        // Render Tabs
        let html = `<div class="portfolio-tabs">`;
        currentGroups.forEach(group => {
            html += `
                <div class="portfolio-tab ${group.portfolioId === activePortfolioId ? 'active' : ''}" 
                     onclick="App.switchPortfolioTab(${group.portfolioId})">
                    ${group.portfolioName}
                </div>
            `;
        });
        html += `</div>`;

        // Render Active Portfolio Accounts
        const activeGroup = currentGroups.find(g => g.portfolioId === activePortfolioId) || currentGroups[0];
        if (activeGroup) {
            const portfolioTotal = activeGroup.accounts.reduce((sum, acc) => sum + (acc.balance?.total?.amount || 0), 0);
            const activeTotal = activeGroup.accounts.reduce((sum, acc) => sum + (inactiveAccountIds.has(acc.id) ? 0 : (acc.balance?.total?.amount || 0)), 0);

            html += `
                <div class="account-group">
                    <div class="account-list">
                        ${activeGroup.error ? `<div class="account-item" style="color: var(--error)">Error: ${activeGroup.error}</div>` : ''}
                        ${activeGroup.accounts.length === 0 && !activeGroup.error ? `<div class="empty-state" style="padding: 1rem;">No accounts found.</div>` : ''}
                        ${activeGroup.accounts.map(acc => {
                            const isInactive = inactiveAccountIds.has(acc.id);
                            return `
                                <div class="account-item ${isInactive ? 'inactive' : ''}">
                                    <div class="account-info">
                                        <div class="account-item-header">
                                            <h4>${acc.name || 'Unnamed Account'}</h4>
                                            <label class="switch" title="${isInactive ? 'Activate' : 'Deactivate'} Account">
                                                <input type="checkbox" ${!isInactive ? 'checked' : ''} onchange="App.toggleAccount('${acc.id}')">
                                                <span class="slider"></span>
                                            </label>
                                        </div>
                                        <p>${acc.brokerage?.name || 'Unknown'} • ${acc.number || 'No Number'}</p>
                                    </div>
                                    <div class="account-balance">
                                        <div class="balance-label">Net Value</div>
                                        <div class="balance-amount">$${acc.balance?.total?.amount?.toLocaleString() || '0.00'}</div>
                                    </div>
                                </div>
                            `;
                        }).join('')}
                        ${activeGroup.accounts.length > 0 ? `
                            <div style="text-align: right; padding: 0.5rem 1.25rem; font-size: 0.8125rem; color: var(--text-muted);">
                                Active Total: $${activeTotal.toLocaleString()} / Portfolio Total: $${portfolioTotal.toLocaleString()}
                            </div>` : ''
                        }
                    </div>
                </div>
            `;
        }

        this.accountContainer.innerHTML = html;
        this.renderDashboardChart(currentGroups, inactiveAccountIds);
    },

    renderAllHoldings(data) {
        const tabsContainer = document.getElementById('holdings-tabs');
        const tablesContainer = document.getElementById('holdings-tables');
        
        if (!data || data.length === 0) {
            if(tabsContainer) tabsContainer.innerHTML = '';
            tablesContainer.innerHTML = '<div class="empty-state">No active accounts found to load holdings.</div>';
            return;
        }

        let tabsHtml = '';
        let tablesHtml = '';
        
        data.forEach((account, index) => {
            const isActive = index === 0;
            const tabId = `holdings-pane-${account.accountId}`;
            
            tabsHtml += `
                <div class="tab ${isActive ? 'active' : ''}" 
                     onclick="App.switchHoldingsPageTab('${account.accountId}')"
                     id="holdings-tabbtn-${account.accountId}">
                    ${account.portfolioName} - ${account.accountName || 'Unnamed'}
                </div>
            `;
            
            tablesHtml += `<div class="holdings-pane card ${isActive ? 'active' : ''}" id="${tabId}" style="display: ${isActive ? 'block' : 'none'};">`;
            
            if (account.error) {
                tablesHtml += `
                    <div class="empty-state" style="padding: 2rem;">
                        <div class="empty-icon" style="color: var(--error);">⚠️</div>
                        <p style="margin-bottom: 1rem; color: var(--error); font-weight: 600;">Connection Error</p>
                        <p style="font-size: 0.875rem; color: var(--text-muted); margin-bottom: 1.5rem;">Failed to load holdings for this account. The brokerage connection might be stale or expired.</p>
                        <p style="font-size: 0.875rem; background: rgba(239, 68, 68, 0.1); color: var(--error); padding: 0.75rem; border-radius: 6px; display: inline-block; word-break: break-all; max-width: 100%;">${account.error}</p>
                        <div style="margin-top: 2rem;">
                            <button class="btn btn-outline" onclick="App.switchMainTab('settings'); App.switchSettingsTab('portfolios')">Go to Settings to Reconnect</button>
                        </div>
                    </div></div>`;
                return;
            }

            if (!account.holdings || account.holdings.length === 0) {
                tablesHtml += '<div class="empty-state" style="padding: 1rem;">No holdings found in this account.</div></div>';
                return;
            }

            tablesHtml += `
                <table class="holdings-table">
                    <thead>
                        <tr>
                            <th>Asset</th>
                            <th>Symbol</th>
                            <th>Quantity</th>
                            <th>Price</th>
                            <th>Total Value</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${account.holdings.map((h, i) => `
                            <tr key="${h.symbol?.symbol?.id || i}">
                                <td>
                                    <div style="font-weight: 600;">${h.symbol?.symbol?.description || 'Unknown Asset'}</div>
                                    <div class="asset-class">${h.symbol?.symbol?.type?.name || 'Asset'}</div>
                                </td>
                                <td><span class="symbol-badge">${h.symbol?.symbol?.symbol || 'N/A'}</span></td>
                                <td>${(h.units || 0).toLocaleString(undefined, { maximumFractionDigits: 4 })}</td>
                                <td>$${(h.price || 0).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</td>
                                <td style="font-weight: 700;">$${((h.units || 0) * (h.price || 0)).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>`;
        });

        if(tabsContainer) tabsContainer.innerHTML = tabsHtml;
        tablesContainer.innerHTML = tablesHtml;
    },

    renderAdminUsers(users) {
        if (users.length === 0) {
            this.adminUserList.innerHTML = '<div style="font-size: 0.75rem; padding: 0.5rem;">No users found.</div>';
            return;
        }
        this.adminUserList.innerHTML = users.map(u => `
            <div style="display: flex; justify-content: space-between; align-items: center; padding: 0.75rem; border-bottom: 1px solid rgba(255,255,255,0.05); transition: background-color 0.2s ease; border-radius: 6px;" onmouseover="this.style.backgroundColor='rgba(255,255,255,0.05)'" onmouseout="this.style.backgroundColor='transparent'">
                <div style="display: flex; align-items: center; gap: 0.5rem;">
                    <span style="font-size: 1.1rem; opacity: 0.7;">👤</span>
                    <span style="font-size: 0.85rem; font-family: monospace; font-weight: 500; color: var(--text);">${u}</span>
                </div>
                <button class="btn btn-danger btn-sm" style="padding: 0.25rem 0.75rem; font-size: 0.75rem;" onclick="App.deleteAdminUser('${u}')">Delete</button>
            </div>
        `).join('');
    },

    renderDashboardChart(currentGroups, inactiveAccountIds) {
        const container = document.getElementById('dashboardChartContainer');
        if (!container) return;

        let activeAccounts = [];
        currentGroups.forEach(group => {
            group.accounts.forEach(acc => {
                const amount = acc.balance?.total?.amount || 0;
                if (!inactiveAccountIds.has(acc.id) && amount > 0) {
                    activeAccounts.push({
                        label: `${group.portfolioName} - ${acc.name || 'Unnamed'}`,
                        value: amount
                    });
                }
            });
        });

        if (activeAccounts.length === 0) {
            container.style.display = 'flex';
            container.style.alignItems = 'center';
            container.style.justifyContent = 'center';
            container.innerHTML = `
                <div class="empty-state">
                    <div class="empty-icon">📈</div>
                    <p>No account data available.</p>
                    <p style="font-size: 0.875rem; margin-top: 0.5rem;">Please connect an account with a positive balance.</p>
                </div>
            `;
            if (this.accountsChartInstance) {
                this.accountsChartInstance.destroy();
                this.accountsChartInstance = null;
            }
            return;
        }

        container.style.display = 'block';
        if (!document.getElementById('accountsChart')) {
            container.innerHTML = '<canvas id="accountsChart"></canvas>';
        }

        const ctx = document.getElementById('accountsChart').getContext('2d');
        const labels = activeAccounts.map(a => a.label);
        const data = activeAccounts.map(a => a.value);

        // Generate nice HSL colors
        const backgroundColors = activeAccounts.map((_, i) => `hsl(${i * (360 / activeAccounts.length)}, 70%, 60%)`);
        const borderColors = activeAccounts.map((_, i) => `hsl(${i * (360 / activeAccounts.length)}, 70%, 50%)`);

        if (this.accountsChartInstance) {
            this.accountsChartInstance.data.labels = labels;
            this.accountsChartInstance.data.datasets[0].data = data;
            this.accountsChartInstance.data.datasets[0].backgroundColor = backgroundColors;
            this.accountsChartInstance.data.datasets[0].borderColor = borderColors;
            this.accountsChartInstance.update();
        } else {
            if (typeof Chart === 'undefined') return;
            
            Chart.defaults.color = '#94a3b8';
            Chart.defaults.font.family = "'Outfit', sans-serif";

            this.accountsChartInstance = new Chart(ctx, {
                type: 'doughnut',
                data: {
                    labels: labels,
                    datasets: [{
                        label: 'Net Value',
                        data: data,
                        backgroundColor: backgroundColors,
                        borderColor: 'transparent',
                        borderWidth: 2,
                        hoverOffset: 10
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: {
                            position: 'right',
                            labels: {
                                padding: 20,
                                font: {
                                    size: 13
                                },
                                color: '#f8fafc'
                            }
                        },
                        tooltip: {
                            callbacks: {
                                label: function(context) {
                                    let label = context.label || '';
                                    if (label) {
                                        label += ': ';
                                    }
                                    if (context.parsed !== null) {
                                        label += new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(context.parsed);
                                    }
                                    return label;
                                }
                            },
                            backgroundColor: 'rgba(15, 23, 42, 0.9)',
                            titleFont: { size: 14, family: "'Outfit', sans-serif" },
                            bodyFont: { size: 14, family: "'Outfit', sans-serif" },
                            padding: 12,
                            cornerRadius: 8,
                            borderColor: 'rgba(255,255,255,0.1)',
                            borderWidth: 1
                        }
                    },
                    cutout: '65%',
                    animation: {
                        animateScale: true,
                        animateRotate: true
                    }
                }
            });
        }
    },

    renderDividends(cachedDividendsData) {
        const container = document.getElementById('dividends-page-content');
        const summaryContainer = document.getElementById('dividend-tracker-summary');
        const chartContainer = document.getElementById('dividendChartContainer');
        if (!container) return;

        let allForecastEvents = [];

        cachedDividendsData.forEach(accountData => {
            if (accountData.error) return;
            if (Array.isArray(accountData.dividends)) {
                accountData.dividends.forEach(event => {
                    allForecastEvents.push({
                        ...event,
                        portfolioName: accountData.portfolioName,
                        accountName: accountData.accountName
                    });
                });
            }
        });

        if (allForecastEvents.length === 0) {
            container.innerHTML = '<div class="empty-state">No dividend forecast events found. Ensure you have holdings with dividend history.</div>';
            if (summaryContainer) summaryContainer.style.display = 'none';
            if (chartContainer) chartContainer.style.display = 'none';
            return;
        }

        // Show summaries
        if (summaryContainer) summaryContainer.style.display = 'grid';
        if (chartContainer) chartContainer.style.display = 'block';

        // Sort by date ascending
        allForecastEvents.sort((a, b) => new Date(a.date) - new Date(b.date));

        // Calculate Totals
        const annualTotal = allForecastEvents.reduce((sum, e) => sum + (e.amount || 0), 0);
        document.getElementById('unified-annual-income').textContent = `$${annualTotal.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;
        document.getElementById('unified-monthly-average').textContent = `$${(annualTotal / 12).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;

        // Group by Month for Chart and List
        const monthlyData = {};
        const now = new Date();
        for (let i = 0; i < 12; i++) {
            const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
            const key = d.toLocaleString('default', { month: 'short', year: 'numeric' });
            monthlyData[key] = {
                total: 0,
                events: []
            };
        }

        allForecastEvents.forEach(e => {
            const date = new Date(e.date);
            const key = date.toLocaleString('default', { month: 'short', year: 'numeric' });
            if (monthlyData[key]) {
                monthlyData[key].total += e.amount;
                monthlyData[key].events.push(e);
            }
        });

        // Render Chart
        this.renderDividendChart(monthlyData);

        // Render List
        let html = '';
        for (const [monthYear, data] of Object.entries(monthlyData)) {
            if (data.events.length === 0) continue;

            html += `
                <div class="card" style="margin-bottom: 2rem;">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem; border-bottom: 1px solid var(--border); padding-bottom: 1rem;">
                        <h3 style="font-size: 1.25rem; font-weight: 600;">${monthYear}</h3>
                        <div style="font-weight: 700; color: var(--success); font-size: 1.25rem;">+$${data.total.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</div>
                    </div>
                    
                    <div style="display: flex; flex-direction: column; gap: 1rem;">
                        ${data.events.map(e => {
                            const date = new Date(e.date);
                            const day = date.getDate();
                            
                            return `
                                <div style="display: flex; justify-content: space-between; align-items: center; padding: 1rem; background: rgba(255, 255, 255, 0.02); border: 1px solid var(--border); border-radius: 12px; transition: all 0.2s;">
                                    <div style="display: flex; align-items: center; gap: 1rem;">
                                        <div style="background: rgba(99, 102, 241, 0.1); width: 48px; height: 48px; border-radius: 12px; display: flex; flex-direction: column; align-items: center; justify-content: center;">
                                            <span style="font-size: 0.75rem; color: var(--primary-light); text-transform: uppercase;">${date.toLocaleString('default', { month: 'short' })}</span>
                                            <span style="font-weight: 700; font-size: 1.1rem; color: var(--text);">${day}</span>
                                        </div>
                                        <div>
                                            <div style="display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.25rem;">
                                                <span class="symbol-badge">${e.symbol}</span>
                                                <span style="font-size: 0.9rem; font-weight: 600;">${e.name}</span>
                                            </div>
                                            <div style="font-size: 0.75rem; color: var(--text-muted);">
                                                ${e.units.toLocaleString()} shares • $${e.amountPerShare.toFixed(4)} / share
                                            </div>
                                        </div>
                                    </div>
                                    <div style="text-align: right;">
                                        <div style="font-weight: 700; color: var(--success); font-size: 1.1rem;">+$${e.amount.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</div>
                                        <div style="font-size: 0.75rem; color: var(--text-muted);">${e.portfolioName}</div>
                                    </div>
                                </div>
                            `;
                        }).join('')}
                    </div>
                </div>
            `;
        }

        container.innerHTML = html;
    },

    renderDividendChart(monthlyData) {
        const ctx = document.getElementById('dividendChart').getContext('2d');
        const labels = Object.keys(monthlyData);
        const data = Object.values(monthlyData).map(d => d.total);

        if (this.dividendChartInstance) {
            this.dividendChartInstance.data.labels = labels;
            this.dividendChartInstance.data.datasets[0].data = data;
            this.dividendChartInstance.update();
        } else {
            if (typeof Chart === 'undefined') return;

            this.dividendChartInstance = new Chart(ctx, {
                type: 'bar',
                data: {
                    labels: labels,
                    datasets: [{
                        label: 'Projected Monthly Income',
                        data: data,
                        backgroundColor: 'rgba(99, 102, 241, 0.5)',
                        borderColor: 'rgb(99, 102, 241)',
                        borderWidth: 2,
                        borderRadius: 6,
                        hoverBackgroundColor: 'rgba(99, 102, 241, 0.8)'
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
                                label: function(context) {
                                    return ' ' + new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(context.parsed.y);
                                }
                            },
                            backgroundColor: 'rgba(15, 23, 42, 0.9)',
                            titleFont: { size: 14, family: "'Outfit', sans-serif" },
                            bodyFont: { size: 14, family: "'Outfit', sans-serif" },
                            padding: 12,
                            cornerRadius: 8
                        }
                    },
                    scales: {
                        y: {
                            beginAtZero: true,
                            grid: {
                                color: 'rgba(255, 255, 255, 0.05)'
                            },
                            ticks: {
                                callback: function(value) {
                                    return '$' + value;
                                }
                            }
                        },
                        x: {
                            grid: {
                                display: false
                            }
                        }
                    }
                }
            });
        }
    },

    renderDividendCalendar(cachedDividendsData, targetDate) {
        const gridContainer = document.getElementById('dividend-calendar-grid');
        const monthLabel = document.getElementById('currentCalendarMonth');
        if (!gridContainer || !monthLabel) return;

        // Set Month Label
        monthLabel.textContent = targetDate.toLocaleString('default', { month: 'long', year: 'numeric' });

        // Gather all events
        let allForecastEvents = [];
        let annualTotal = 0;
        if (cachedDividendsData) {
            cachedDividendsData.forEach(accountData => {
                if (accountData.error) return;
                if (Array.isArray(accountData.dividends)) {
                    accountData.dividends.forEach(event => {
                        allForecastEvents.push({
                            ...event,
                            portfolioName: accountData.portfolioName,
                            accountName: accountData.accountName
                        });
                        annualTotal += (event.amount || 0);
                    });
                }
            });
        }

        // Update Summary Header
        const summaryGrid = document.getElementById('dividend-tracker-summary');
        if (summaryGrid) summaryGrid.style.display = 'grid';

        const annualTotalEl = document.getElementById('unified-annual-income');
        const monthlyAverageEl = document.getElementById('unified-monthly-average');
        const viewingMonthTotalEl = document.getElementById('unified-month-total');
        const viewingMonthLabelEl = document.getElementById('unified-month-label');

        if (annualTotalEl) annualTotalEl.textContent = `$${annualTotal.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;
        if (monthlyAverageEl) monthlyAverageEl.textContent = `$${(annualTotal / 12).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;
        
        if (viewingMonthLabelEl) {
            viewingMonthLabelEl.textContent = `${targetDate.toLocaleString('default', { month: 'short' })} Total`;
        }

        // Calendar Logic
        const year = targetDate.getFullYear();
        const month = targetDate.getMonth();
        
        const firstDayOfMonth = new Date(year, month, 1).getDay(); // 0 (Sun) to 6 (Sat)
        const daysInMonth = new Date(year, month + 1, 0).getDate();
        
        // Days from previous month to fill the first row
        const prevMonthLastDay = new Date(year, month, 0).getDate();
        const prevMonthDaysToShow = firstDayOfMonth; // If month starts on Wed (3), show 3 days (Sun, Mon, Tue)
        
        let html = '<div class="calendar-grid">';
        
        // Day Headers
        ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].forEach(day => {
            html += `<div class="calendar-day-header">${day}</div>`;
        });

        // Previous Month Days
        for (let i = prevMonthDaysToShow - 1; i >= 0; i--) {
            const day = prevMonthLastDay - i;
            html += `<div class="calendar-day prev-month">${day}</div>`;
        }

        // Current Month Days
        const today = new Date();
        let viewingMonthTotal = 0;
        for (let day = 1; day <= daysInMonth; day++) {
            const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
            const isToday = today.getFullYear() === year && today.getMonth() === month && today.getDate() === day;
            
            // Filter events for this day
            const dayEvents = allForecastEvents.filter(e => {
                const eDate = new Date(e.date);
                return eDate.getFullYear() === year && eDate.getMonth() === month && eDate.getDate() === day;
            });

            const totalAmount = dayEvents.reduce((sum, e) => sum + (e.amount || 0), 0);
            viewingMonthTotal += totalAmount;
            const hasEvents = dayEvents.length > 0;

            html += `
                <div class="calendar-day ${isToday ? 'today' : ''} ${hasEvents ? 'has-events' : ''}" 
                     onclick="UI.renderCalendarDayDetails(${JSON.stringify(dayEvents).replace(/"/g, '&quot;')}, '${dateStr}')">
                    <div class="calendar-day-num">${day}</div>
                    ${hasEvents ? `
                        <div class="calendar-event-marker">
                            <span class="dot"></span>
                            <span class="amount">+$${totalAmount.toFixed(2)}</span>
                        </div>
                    ` : ''}
                </div>
            `;
        }
        
        if (viewingMonthTotalEl) {
            viewingMonthTotalEl.textContent = `$${viewingMonthTotal.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;
        }

        // Next Month Days to fill the 6x7 grid (42 cells total)
        const totalCellsUsed = prevMonthDaysToShow + daysInMonth;
        const remainingCells = 42 - totalCellsUsed;
        for (let i = 1; i <= remainingCells; i++) {
            html += `<div class="calendar-day next-month">${i}</div>`;
        }

        html += '</div>';
        gridContainer.innerHTML = html;
        
        // If we have events for today, or if no day is selected, maybe clear details?
        // For now, let's just clear it unless a user clicks.
        // document.getElementById('calendar-day-details').innerHTML = '<div class="empty-state">Select a day to view its dividends</div>';
    },

    renderCalendarDayDetails(events, dateStr) {
        const container = document.getElementById('calendar-day-details');
        if (!container) return;

        // Mark the selected day in CSS
        document.querySelectorAll('.calendar-day').forEach(el => el.classList.remove('selected'));
        // Find the cell with the date - we might need to store it differently but for now:
        // Actually, the click handler is on the cell, so we can pass the event or just rely on the re-render not being too frequent.

        const date = new Date(dateStr + 'T12:00:00'); // Use noon to avoid TZ issues
        const formattedDate = date.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });

        if (!events || events.length === 0) {
            container.innerHTML = `
                <div style="margin-bottom: 1.5rem;">
                    <div style="font-size: 0.875rem; color: var(--text-muted);">${formattedDate}</div>
                </div>
                <div class="empty-state" style="padding: 2rem 0;">
                    <div style="font-size: 2rem; margin-bottom: 1rem; opacity: 0.5;">☕</div>
                    <p style="font-size: 0.875rem; color: var(--text-muted);">No dividends scheduled for this day.</p>
                </div>
            `;
            return;
        }

        const totalDayAmount = events.reduce((sum, e) => sum + (e.amount || 0), 0);

        let html = `
            <div style="margin-bottom: 1.5rem; padding-bottom: 1rem; border-bottom: 1px solid var(--border);">
                <div style="font-size: 0.875rem; color: var(--text-muted); margin-bottom: 0.25rem;">${formattedDate}</div>
                <div style="font-size: 1.5rem; font-weight: 700; color: var(--success);">+$${totalDayAmount.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</div>
            </div>
            <div style="display: flex; flex-direction: column; gap: 0.75rem;">
        `;

        events.forEach(e => {
            html += `
                <div class="dividend-detail-item" style="padding: 1rem; background: rgba(255,255,255,0.03); border: 1px solid var(--border); border-radius: 10px;">
                    <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 0.5rem;">
                        <span class="symbol-badge">${e.symbol}</span>
                        <span style="font-weight: 700; color: var(--success);">+$${e.amount.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</span>
                    </div>
                    <div style="font-size: 0.9rem; font-weight: 600; margin-bottom: 0.25rem;">${e.name}</div>
                    <div style="font-size: 0.75rem; color: var(--text-muted);">
                        ${e.units.toLocaleString()} shares @ $${e.amountPerShare.toFixed(4)}
                    </div>
                    <div style="font-size: 0.7rem; color: var(--text-muted); margin-top: 0.5rem; opacity: 0.7;">
                        ${e.portfolioName} • ${e.accountName}
                    </div>
                </div>
            `;
        });

        html += '</div>';
        container.innerHTML = html;
    }
};
