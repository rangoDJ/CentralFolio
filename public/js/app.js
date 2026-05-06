/**
 * Main application logic for CentralFolio
 */
const App = {
    // State
    activePortfolios: [],
    currentGroups: [],
    activePortfolioId: null,
    inactiveAccountIds: new Set(), // seeded from server DB on fetchAccounts
    cachedHoldingsData: null,
    holdingsLastUpdated: null,
    cachedDividendsData: null,
    dividendsLastUpdated: null,
    currentCalendarDate: new Date(),

    async init() {
        this.setupEventListeners();
        
        // Restore tab state
        const savedMainTab = localStorage.getItem('activeMainTab') || 'dashboard';
        const mainBtn = document.querySelector(`.sidebar-item[data-tab="${savedMainTab}"]`);
        this.switchMainTab(savedMainTab, mainBtn);

        const savedSettingsTab = localStorage.getItem('activeSettingsTab') || 'portfolios';
        const settingsBtn = document.querySelector(`.settings-tab-btn[data-tab="${savedSettingsTab}"]`);
        this.switchSettingsTab(savedSettingsTab, settingsBtn);

        const savedDividendSubTab = localStorage.getItem('activeDividendSubTab') || 'forecast';
        const dividendSubBtn = document.querySelector(`.sub-tab-btn[data-subtab="${savedDividendSubTab}"]`);
        this.switchDividendSubTab(savedDividendSubTab, dividendSubBtn);

        await Promise.all([
            this.loadPortfolios(),
            this.loadSettings()
        ]);
    },

    setupEventListeners() {
        document.getElementById('addPortfolioBtn').onclick = () => UI.openModal();
        document.querySelector('.modal-close').onclick = () => UI.closeModal();

        window.onclick = (e) => {
            if (e.target === UI.portfolioModal) UI.closeModal();
        };

        UI.portfolioForm.onsubmit = (e) => this.handlePortfolioSubmit(e);

        document.getElementById('refreshBtn').onclick = () => this.fetchAccounts(true);

        document.getElementById('listUsersBtn').onclick = () => this.handleListUsers();
        document.getElementById('wipeBtn').onclick = () => this.handleWipeUsers();
        document.getElementById('saveDividendProvidersBtn').onclick = () => this.handleSaveSettings();

        // Add listeners for provider toggles
        document.getElementById('provider-polygon').addEventListener('change', () => this.updateProviderKeyVisibility());
        document.getElementById('provider-alphavantage').addEventListener('change', () => this.updateProviderKeyVisibility());
        document.getElementById('provider-finnhub').addEventListener('change', () => this.updateProviderKeyVisibility());
    },

    async loadPortfolios() {
        try {
            this.activePortfolios = await API.getPortfolios();
            UI.renderPortfolios(this.activePortfolios);
            await this.fetchAccounts();
        } catch (err) {
            UI.showToast('Failed to load portfolios', 'error');
        }
    },

    async handlePortfolioSubmit(e) {
        e.preventDefault();
        const saveBtn = document.getElementById('savePortBtn');
        saveBtn.classList.add('loading');
        saveBtn.disabled = true;

        const data = {
            id: document.getElementById('portId').value,
            name: document.getElementById('portName').value,
            clientId: document.getElementById('clientId').value,
            consumerKey: document.getElementById('consumerKey').value,
            userId: document.getElementById('userId').value,
            userSecret: document.getElementById('userSecret').value
        };

        try {
            await API.savePortfolio(data);
            UI.showToast('Portfolio saved successfully');
            UI.closeModal();
            await this.loadPortfolios();
        } catch (err) {
            UI.showToast(err.message, 'error');
        } finally {
            saveBtn.classList.remove('loading');
            saveBtn.disabled = false;
        }
    },

    async deletePortfolio(id) {
        if (!confirm('Delete this portfolio and all its settings?')) return;
        try {
            await API.deletePortfolio(id);
            UI.showToast('Portfolio deleted');
            await this.loadPortfolios();
        } catch (err) {
            UI.showToast('Delete failed', 'error');
        }
    },

    editPortfolio(id) {
        const p = this.activePortfolios.find(x => x.id === id);
        if (p) UI.openModal(p);
    },

    async registerPortfolio(id, btn) {
        btn.classList.add('loading');
        try {
            await API.registerPortfolio(id);
            UI.showToast('Successfully registered with SnapTrade');
            await this.loadPortfolios();
        } catch (err) {
            UI.showToast(err.message, 'error');
        } finally {
            btn.classList.remove('loading');
        }
    },

    async connectBrokerage(id, btn) {
        btn.classList.add('loading');
        try {
            const loginUrl = await API.getLoginUrl(id);
            window.open(loginUrl, '_blank');
            UI.showToast('Portal opened. Refresh accounts after connecting.');
        } catch (err) {
            UI.showToast(err.message, 'error');
        } finally {
            btn.classList.remove('loading');
        }
    },

    async fetchAccounts(forceRefresh = false) {
        UI.accountContainer.innerHTML = '<div class="empty-state">Loading accounts for all portfolios...</div>';
        try {
            this.currentGroups = await API.getAccounts(forceRefresh);

            // Build inactiveAccountIds from the DB-backed isActive field on each account
            this.inactiveAccountIds = new Set();
            for (const group of this.currentGroups) {
                for (const acc of (group.accounts || [])) {
                    if (acc.isActive === false) {
                        this.inactiveAccountIds.add(acc.id);
                    }
                }
            }

            if (this.currentGroups.length === 0) {
                UI.accountContainer.innerHTML = '<div class="empty-state">No portfolios configured.</div>';
                return;
            }

            if (!this.activePortfolioId && this.currentGroups.length > 0) {
                this.activePortfolioId = this.currentGroups[0].portfolioId;
            }

            UI.renderAccountSection(this.currentGroups, this.activePortfolioId, this.inactiveAccountIds);
        } catch (err) {
            UI.accountContainer.innerHTML = `<div class="empty-state" style="color: var(--error)">Error: ${err.message}</div>`;
        }
    },

    switchPortfolioTab(id) {
        this.activePortfolioId = id;
        UI.renderAccountSection(this.currentGroups, this.activePortfolioId, this.inactiveAccountIds);
    },

    async toggleAccount(accountId) {
        const isCurrentlyInactive = this.inactiveAccountIds.has(accountId);
        const newIsActive = isCurrentlyInactive; // toggling: if inactive → now active, and vice versa

        // Clear holdings and dividend caches since account status changed
        this.cachedHoldingsData = null;
        this.cachedDividendsData = null;

        // Optimistic UI update immediately
        if (newIsActive) {
            this.inactiveAccountIds.delete(accountId);
        } else {
            this.inactiveAccountIds.add(accountId);
        }
        UI.renderAccountSection(this.currentGroups, this.activePortfolioId, this.inactiveAccountIds);

        // Persist to backend DB
        try {
            await API.setAccountActive(accountId, newIsActive);
        } catch (err) {
            // Rollback optimistic update on failure
            if (newIsActive) {
                this.inactiveAccountIds.add(accountId);
            } else {
                this.inactiveAccountIds.delete(accountId);
            }
            UI.renderAccountSection(this.currentGroups, this.activePortfolioId, this.inactiveAccountIds);
            UI.showToast('Failed to update account status: ' + err.message, 'error');
        }
    },

    async handleListUsers() {
        UI.adminUserList.innerHTML = '<div style="font-size: 0.75rem; padding: 0.5rem;">Listing unique users...</div>';
        try {
            const users = await API.getAdminUsers();
            UI.renderAdminUsers(users);
        } catch (err) {
            UI.adminUserList.innerHTML = '<div style="color: var(--error); font-size: 0.75rem;">Failed to list.</div>';
        }
    },

    async deleteAdminUser(uid) {
        if (!confirm(`Delete user ${uid}?`)) return;
        try {
            await API.deleteAdminUser(uid);
            UI.showToast('User deleted');
            await this.handleListUsers();
        } catch (err) {
            UI.showToast('Delete failed', 'error');
        }
    },

    async handleWipeUsers() {
        if (!confirm('WIPE ALL USERS from ALL SnapTrade keys? This cannot be undone.')) return;
        const wipeBtn = document.getElementById('wipeBtn');
        wipeBtn.classList.add('loading');
        try {
            const data = await API.wipeAdminUsers();
            UI.showToast(`Wiped ${data.wipedCount} users. ${data.failedCount} failed.`);
            await this.handleListUsers();
        } catch (err) {
            UI.showToast('Wipe failed', 'error');
        } finally {
            wipeBtn.classList.remove('loading');
        }
    },

    async loadSettings() {
        try {
            const settings = await API.getSettings();

            // Load dividend provider settings
            if (settings.dividend_providers) {
                const providers = JSON.parse(settings.dividend_providers);
                document.getElementById('provider-yahoo').checked = providers.yahoo !== false;
                document.getElementById('provider-polygon').checked = providers.polygon || false;
                document.getElementById('provider-alphavantage').checked = providers.alphavantage || false;
                document.getElementById('provider-finnhub').checked = providers.finnhub || false;
            }

            // Load API keys
            if (settings.polygon_api_key) {
                document.getElementById('polygonApiKey').value = settings.polygon_api_key;
            }
            if (settings.alphavantage_api_key) {
                document.getElementById('alphavantageApiKey').value = settings.alphavantage_api_key;
            }
            if (settings.finnhub_api_key) {
                document.getElementById('finnhubApiKey').value = settings.finnhub_api_key;
            }

            // Update visibility of API key inputs
            this.updateProviderKeyVisibility();
        } catch (err) {
            console.error('Failed to load settings:', err);
        }
    },

    updateProviderKeyVisibility() {
        document.getElementById('polygon-key-group').style.display =
            document.getElementById('provider-polygon').checked ? 'block' : 'none';
        document.getElementById('alphavantage-key-group').style.display =
            document.getElementById('provider-alphavantage').checked ? 'block' : 'none';
        document.getElementById('finnhub-key-group').style.display =
            document.getElementById('provider-finnhub').checked ? 'block' : 'none';
    },

    async handleSaveSettings() {
        const saveBtn = document.getElementById('saveDividendProvidersBtn');
        saveBtn.classList.add('loading');
        saveBtn.disabled = true;

        try {
            const providers = {
                yahoo: true, // Always enabled
                polygon: document.getElementById('provider-polygon').checked,
                alphavantage: document.getElementById('provider-alphavantage').checked,
                finnhub: document.getElementById('provider-finnhub').checked
            };

            const settings = {
                dividend_providers: JSON.stringify(providers),
                polygon_api_key: document.getElementById('polygonApiKey').value.trim() || null,
                alphavantage_api_key: document.getElementById('alphavantageApiKey').value.trim() || null,
                finnhub_api_key: document.getElementById('finnhubApiKey').value.trim() || null
            };

            await API.updateSettings(settings);
            UI.showToast('Dividend provider settings saved successfully');
        } catch (err) {
            UI.showToast(err.message, 'error');
        } finally {
            saveBtn.classList.remove('loading');
            saveBtn.disabled = false;
        }
    },

    async loadAllHoldings(forceRefresh = false) {
        const container = document.getElementById('holdings-page-content');
        if (!container) return;

        const refreshBtn = document.getElementById('refreshHoldingsBtn');

        if (!forceRefresh && this.cachedHoldingsData && this.holdingsLastUpdated) {
            UI.renderAllHoldings(this.cachedHoldingsData);
            this.updateHoldingsTimestamp();
            return;
        }

        if (refreshBtn) refreshBtn.classList.add('loading');
        
        const tabsContainer = document.getElementById('holdings-tabs');
        const tablesContainer = document.getElementById('holdings-tables');
        if (tabsContainer) tabsContainer.innerHTML = '';
        if (tablesContainer) tablesContainer.innerHTML = '<div class="empty-state"><span class="loader" style="display:inline-block; border-top-color:var(--primary);"></span><br>Loading holdings...</div>';
        
        try {
            if (!this.currentGroups || this.currentGroups.length === 0) {
                this.currentGroups = await API.getAccounts();
            }

            let allHoldingsData = [];
            for (const group of this.currentGroups) {
                for (const acc of group.accounts) {
                    if (!this.inactiveAccountIds.has(acc.id)) {
                        try {
                            const data = await API.getHoldings(group.portfolioId, acc.id, forceRefresh);
                            allHoldingsData.push({
                                portfolioName: group.portfolioName,
                                accountName: acc.name,
                                accountId: acc.id,
                                holdings: data
                            });
                        } catch (err) {
                            // Skip disabled accounts silently, only show other errors
                            if (err.message !== 'Account is disabled') {
                                allHoldingsData.push({
                                    portfolioName: group.portfolioName,
                                    accountName: acc.name,
                                    accountId: acc.id,
                                    error: err.message
                                });
                            }
                        }
                    }
                }
            }
            
            this.cachedHoldingsData = allHoldingsData;
            this.holdingsLastUpdated = new Date();
            this.updateHoldingsTimestamp();

            UI.renderAllHoldings(this.cachedHoldingsData);
        } catch (err) {
            container.innerHTML = `<div class="empty-state" style="color: var(--error)">Error: ${err.message}</div>`;
        } finally {
            if (refreshBtn) refreshBtn.classList.remove('loading');
        }
    },

    updateHoldingsTimestamp() {
        const el = document.getElementById('holdings-last-updated');
        if (el && this.holdingsLastUpdated) {
            el.textContent = `Last updated: ${this.holdingsLastUpdated.toLocaleTimeString()}`;
        }
    },

    async loadAllDividends(forceRefresh = false) {
        const container = document.getElementById('dividends-page-content');
        if (!container) return;

        const refreshBtn = document.getElementById('refreshDividendsBtn');

        if (!forceRefresh && this.cachedDividendsData && this.dividendsLastUpdated) {
            UI.renderDividends(this.cachedDividendsData);
            this.updateDividendsTimestamp();
            return;
        }

        if (refreshBtn) {
            refreshBtn.classList.add('loading');
            refreshBtn.disabled = true;
        }

        container.innerHTML = '<div class="empty-state"><span class="loader" style="display:inline-block; border-top-color:var(--primary);"></span><br>' + (forceRefresh ? 'Fetching fresh dividend data...' : 'Loading dividends...') + '</div>';

        try {
            const start = Date.now();
            this.cachedDividendsData = await API.getAllDividends(forceRefresh);
            const elapsed = Date.now() - start;
            this.dividendsLastUpdated = new Date();
            this.updateDividendsTimestamp();

            UI.renderDividends(this.cachedDividendsData);
            if (forceRefresh) {
                UI.showToast(`Dividend data refreshed (${elapsed}ms)`);
            }
        } catch (err) {
            container.innerHTML = `<div class="empty-state" style="color: var(--error)">Error: ${err.message}</div>`;
            UI.showToast(`Failed to refresh dividends: ${err.message}`, 'error');
        } finally {
            if (refreshBtn) {
                refreshBtn.classList.remove('loading');
                refreshBtn.disabled = false;
            }
        }
    },

    updateDividendsTimestamp() {
        const el = document.getElementById('dividends-last-updated');
        if (el && this.dividendsLastUpdated) {
            el.textContent = `Last updated: ${this.dividendsLastUpdated.toLocaleTimeString()}`;
        }
    },

    async loadDividendCalendar(forceRefresh = false) {
        const container = document.getElementById('dividend-calendar-grid');
        if (!container) return;

        if (!forceRefresh && this.cachedDividendsData && this.dividendsLastUpdated) {
            UI.renderDividendCalendar(this.cachedDividendsData, this.currentCalendarDate);
            return;
        }

        // If no cache, we can trigger the loadAllDividends which populates the cache
        await this.loadAllDividends(forceRefresh);
        UI.renderDividendCalendar(this.cachedDividendsData, this.currentCalendarDate);
    },

    changeCalendarMonth(delta) {
        const newDate = new Date(this.currentCalendarDate);
        newDate.setMonth(newDate.getMonth() + delta);
        this.currentCalendarDate = newDate;
        UI.renderDividendCalendar(this.cachedDividendsData, this.currentCalendarDate);
    },

    async loadAllTransactions(forceRefresh = false) {
        const container = document.getElementById('transactions-page-content');
        if (!container) return;

        const refreshBtn = document.getElementById('refreshTransactionsBtn');

        if (refreshBtn) {
            refreshBtn.classList.add('loading');
            refreshBtn.disabled = true;
        }

        try {
            const start = Date.now();
            const response = await API.getTransactions(forceRefresh);
            this.transactionsLastUpdated = new Date();
            this.updateTransactionsTimestamp();

            const data = response
                .filter(group => group.transactions && group.transactions.length > 0)
                .map(group => ({
                    portfolioName: group.portfolioName,
                    accountName: group.accountName,
                    accountId: group.accountId,
                    transactions: group.transactions
                }));

            UI.renderAllTransactions(data);
            this.cachedTransactionsData = data;

            const elapsed = Date.now() - start;
            if (elapsed > 1000) {
                UI.showToast(`Transaction data refreshed (${elapsed}ms)`);
            }
        } catch (err) {
            container.innerHTML = `<div class="empty-state" style="color: var(--error)">Error: ${err.message}</div>`;
            UI.showToast(`Failed to refresh transactions: ${err.message}`, 'error');
        } finally {
            if (refreshBtn) {
                refreshBtn.classList.remove('loading');
                refreshBtn.disabled = false;
            }
        }
    },

    updateTransactionsTimestamp() {
        const el = document.getElementById('transactions-last-updated');
        if (el && this.transactionsLastUpdated) {
            el.textContent = `Last updated: ${this.transactionsLastUpdated.toLocaleTimeString()}`;
        }
    },

    switchTransactionsPageTab(accountId) {
        document.querySelectorAll('#transactions-tabs .tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('#transactions-tables .transactions-pane').forEach(p => {
            p.classList.remove('active');
            p.style.display = 'none';
        });

        const activeTabBtn = document.getElementById(`transactions-tabbtn-${accountId}`);
        const activePane = document.getElementById(`transactions-pane-${accountId}`);

        if (activeTabBtn) activeTabBtn.classList.add('active');
        if (activePane) {
            activePane.classList.add('active');
            activePane.style.display = 'block';
        }
    },

    switchHoldingsPageTab(accountId) {
        document.querySelectorAll('#holdings-tabs .tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('#holdings-tables .holdings-pane').forEach(p => {
            p.classList.remove('active');
            p.style.display = 'none';
        });
        
        const activeTabBtn = document.getElementById(`holdings-tabbtn-${accountId}`);
        const activePane = document.getElementById(`holdings-pane-${accountId}`);
        
        if (activeTabBtn) activeTabBtn.classList.add('active');
        if (activePane) {
            activePane.classList.add('active');
            activePane.style.display = 'block';
        }
    },

    switchMainTab(tabId, btnElement) {
        localStorage.setItem('activeMainTab', tabId);
        // Update active class on sidebar items
        document.querySelectorAll('.sidebar-item').forEach(btn => btn.classList.remove('active'));
        if (btnElement) {
            btnElement.classList.add('active');
        } else {
            const btn = document.querySelector(`.sidebar-item[data-tab="${tabId}"]`);
            if (btn) btn.classList.add('active');
        }

        // Update active class on tab contents
        document.querySelectorAll('.tab-content').forEach(tab => tab.classList.remove('active'));
        const activeTab = document.getElementById(tabId + '-tab');
        if (activeTab) {
            activeTab.classList.add('active');
        }

        if (tabId === 'dashboard') {
            if (UI.accountsChartInstance) {
                UI.accountsChartInstance.resize();
            } else if (this.currentGroups && this.currentGroups.length > 0) {
                UI.renderDashboardChart(this.currentGroups, this.inactiveAccountIds);
            }
        } else if (tabId === 'holdings') {
            this.loadAllHoldings();
        } else if (tabId === 'transactions') {
            this.loadAllTransactions();
        } else if (tabId === 'dividend-tracker') {
            const subTab = localStorage.getItem('activeDividendSubTab') || 'forecast';
            if (subTab === 'forecast') {
                this.loadAllDividends();
            } else {
                this.loadDividendCalendar();
            }
        }
    },

    async switchSettingsTab(paneId, btnElement) {
        localStorage.setItem('activeSettingsTab', paneId);
        // Update active class on settings tabs
        document.querySelectorAll('.settings-tab-btn').forEach(btn => {
            btn.classList.remove('active');
            btn.style.color = 'var(--text-muted)';
        });

        if (btnElement) {
            btnElement.classList.add('active');
            btnElement.style.color = 'var(--text)';
        } else {
            const btn = document.querySelector(`.settings-tab-btn[data-tab="${paneId}"]`);
            if (btn) {
                btn.classList.add('active');
                btn.style.color = 'var(--text)';
            }
        }

        // Update active class on panes
        document.querySelectorAll('.settings-pane').forEach(pane => {
            pane.classList.remove('active');
            pane.style.display = 'none';
        });

        const activePane = document.getElementById('settings-' + paneId + '-pane');
        if (activePane) {
            activePane.classList.add('active');
            activePane.style.display = 'block';
        }

        // If switching to Keys tab, fetch and render portfolios from database
        if (paneId === 'keys') {
            try {
                this.activePortfolios = await API.getPortfolios();
                UI.renderPortfolios(this.activePortfolios);
            } catch (err) {
                console.error('Failed to load portfolios:', err);
            }
        }
    },

    switchDividendSubTab(subTabId, btnElement) {
        localStorage.setItem('activeDividendSubTab', subTabId);
        
        // Update button styles
        document.querySelectorAll('.sub-tab-btn').forEach(btn => btn.classList.remove('active'));
        
        if (btnElement) {
            btnElement.classList.add('active');
        } else {
            const btn = document.querySelector(`.sub-tab-btn[data-subtab="${subTabId}"]`);
            if (btn) btn.classList.add('active');
        }

        // Update pane visibility
        document.querySelectorAll('.dividend-pane').forEach(pane => pane.classList.remove('active'));
        
        const activePane = document.getElementById('dividend-' + subTabId + '-pane');
        if (activePane) {
            activePane.classList.add('active');
        }

        // Update unified summary month total visibility
        const monthTotalCard = document.getElementById('unified-month-total-card');
        if (monthTotalCard) {
            monthTotalCard.style.display = subTabId === 'calendar' ? 'block' : 'none';
        }

        // Update controls visibility
        const trackerControls = document.getElementById('dividend-tracker-controls');
        const calendarControls = document.getElementById('calendar-controls');
        
        if (subTabId === 'forecast') {
            if (trackerControls) trackerControls.style.display = 'flex';
            if (calendarControls) calendarControls.style.display = 'none';
            this.loadAllDividends();
        } else {
            if (trackerControls) trackerControls.style.display = 'none';
            if (calendarControls) calendarControls.style.display = 'flex';
            this.loadDividendCalendar();
        }
    }
};

// Initialize app
document.addEventListener('DOMContentLoaded', () => App.init());
