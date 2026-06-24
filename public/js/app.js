/**
 * Main application logic for CentralFolio
 */
const App = {
    // State
    activePortfolios: [],
    currentGroups: [],
    activePortfolioId: null,

    // Reactive selectedUserPortfolioId — automatically keeps localStorage in sync.
    _selectedUserPortfolioId: 'all',
    get selectedUserPortfolioId() {
        return this._selectedUserPortfolioId;
    },
    set selectedUserPortfolioId(val) {
        this._selectedUserPortfolioId = val;
        localStorage.setItem('selectedUserPortfolioId', String(val));
    },

    inactiveAccountIds: new Set(), // seeded from server DB on fetchAccounts
    cachedHoldingsData: null,
    holdingsLastUpdated: null,
    cachedDividendsData: null,
    dividendsLastUpdated: null,
    currentCalendarDate: new Date(),
    currentDividendAccountId: 'all',
    currentTrade: null,
    currentTradeAction: 'BUY',
    currentTradeNotional: null,

    async init() {
        this.initTheme();

        // Guard: redirect to login if not authenticated
        if (!localStorage.getItem('cf_token')) {
            window.location.href = '/login.html';
            return;
        }

        this.setupEventListeners();

        // Open the live-update stream so pages refresh themselves when backend data changes.
        this.connectLiveSync();

        // Load all portfolios, settings, and user portfolios first to avoid race conditions
        await Promise.all([
            this.loadPortfolios(),
            this.loadSettings(),
            this.fetchUserPortfolios()
        ]);

        this.renderGlobalPortfolioSelect();

        // Restore tab state and load data after we have loaded the portfolio definitions
        const savedMainTab = localStorage.getItem('activeMainTab') || 'dashboard';
        const mainBtn = document.querySelector(`.topnav-item[data-tab="${savedMainTab}"]`);
        this.switchMainTab(savedMainTab, mainBtn);

        const savedSettingsTab = localStorage.getItem('activeSettingsTab') || 'portfolios';
        const settingsBtn = document.querySelector(`.underline-tab[data-tab="${savedSettingsTab}"]`);
        this.switchSettingsTab(savedSettingsTab, settingsBtn);

        const savedDividendSubTab = localStorage.getItem('activeDividendSubTab') || 'forecast';
        const dividendSubBtn = document.querySelector(`#dividend-sub-tabs .pill-tab[data-subtab="${savedDividendSubTab}"]`);
        this.switchDividendSubTab(savedDividendSubTab, dividendSubBtn);

        // Load data for whichever settings pane is active at startup
        const activeSettingsTab = localStorage.getItem('activeSettingsTab') || 'portfolios';
        if (activeSettingsTab === 'portfolios') {
            this.loadUserPortfolios();
        }
    },

    setupEventListeners() {
        document.getElementById('addPortfolioBtn').onclick = () => UI.openModal();
        document.querySelector('.modal-close').onclick = () => UI.closeModal();

        // User portfolio modal
        document.getElementById('userPortfolioModalClose').onclick = () => UI.closeUserPortfolioModal();
        document.getElementById('userPortfolioForm').onsubmit = (e) => this.handleUserPortfolioSubmit(e);

        // Rebalancing targets form
        document.getElementById('rebalanceTargetsForm').onsubmit = (e) => this.handleSaveTargets(e);

        document.getElementById('tradeModalClose').onclick = () => this.closeTradeModal();

        // Trade button delegation — data-* attributes prevent inline JS injection
        document.getElementById('holdings-tables').addEventListener('click', e => {
            const btn = e.target.closest('.trade-btn-buy, .trade-btn-sell');
            if (btn) {
                const d = btn.dataset;
                this.openTradeModal(d.accountId, d.portfolioId, d.symbol, d.symbolId, d.description, parseFloat(d.price), d.action);
                return;
            }
            const preset = e.target.closest('.trade-btn-preset');
            if (preset) {
                const d = preset.dataset;
                const price = parseFloat(d.price);
                const bucket = parseFloat(d.bucket);
                if (!price || price <= 0) { UI.showToast('Price unavailable for this holding', 'error'); return; }
                this.openTradeModal(d.accountId, d.portfolioId, d.symbol, d.symbolId, d.description, price, 'BUY', null, bucket);
            }
        });

        window.onclick = (e) => {
            if (e.target === UI.portfolioModal) UI.closeModal();
            if (e.target === document.getElementById('tradeModal')) this.closeTradeModal();
            if (e.target === document.getElementById('userPortfolioModal')) UI.closeUserPortfolioModal();
        };

        // Clicking any element tagged with data-stock opens the stock detail page.
        document.addEventListener('click', (e) => {
            const link = e.target.closest('[data-stock]');
            if (link) {
                e.preventDefault();
                this.openStockDetail(link.getAttribute('data-stock'));
            }
        });

        UI.portfolioForm.onsubmit = (e) => this.handlePortfolioSubmit(e);

        document.getElementById('refreshBtn').onclick = () => this.fetchAccounts(true);

        document.getElementById('listUsersBtn').onclick = () => this.handleListUsers();
        document.getElementById('wipeBtn').onclick = () => this.handleWipeUsers();
        document.getElementById('purgeDataBtn').onclick = () => this.handlePurgeData();
        document.getElementById('clearDividendCacheBtn').onclick = () => this.handleClearDividendCache();
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

    async togglePortfolioTrading(id, enabled) {
        try {
            await API.setPortfolioTrading(id, enabled);
            const p = this.activePortfolios.find(x => x.id === id);
            if (p) p.tradingEnabled = enabled ? 1 : 0;
            UI.renderPortfolios(this.activePortfolios);
            // Re-render holdings from cache so trade/preset columns update immediately
            this.cachedHoldingsData = null;
            this.loadAllHoldings();
            UI.showToast(`Trading ${enabled ? 'enabled' : 'disabled'}`);
        } catch (err) {
            UI.showToast('Failed to update trading setting: ' + err.message, 'error');
            UI.renderPortfolios(this.activePortfolios);
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

    async reconnectForTrading(id, btn) {
        btn.classList.add('loading');
        try {
            const loginUrl = await API.getTradeLoginUrl(id);
            const popup = window.open(loginUrl, '_blank');
            UI.showToast('Trade portal opened. Complete the reconnect to enable trade permissions.');
            // Poll until popup closes, then invalidate stale cache and refresh the badge
            const poll = setInterval(async () => {
                if (popup && popup.closed) {
                    clearInterval(poll);
                    try { await API.invalidatePortfolioCache(id); } catch (_) {}
                    this.loadConnectionBadge(id);
                }
            }, 1000);
        } catch (err) {
            UI.showToast(err.message, 'error');
        } finally {
            btn.classList.remove('loading');
        }
    },

    async loadConnectionBadge(portfolioId, tradingEnabled = true) {
        const badge = document.getElementById(`conn-badge-${portfolioId}`);
        if (!badge) return;
        try {
            const { connectionType } = await API.getConnectionStatus(portfolioId);
            if (connectionType === 'trade') {
                if (tradingEnabled) {
                    badge.textContent = 'Trade';
                    badge.className = 'status-badge status-active';
                    badge.style.cssText = 'font-size:0.65rem;padding:0.15rem 0.55rem;margin-left:0.25rem;';
                } else {
                    badge.textContent = 'Trade (disabled)';
                    badge.className = 'status-badge status-inactive';
                    badge.style.cssText = 'font-size:0.65rem;padding:0.15rem 0.55rem;margin-left:0.25rem;';
                }
            } else if (connectionType === 'read') {
                badge.textContent = 'Read Only';
                badge.className = 'status-badge status-inactive';
                badge.style.cssText = 'font-size:0.65rem;padding:0.15rem 0.55rem;margin-left:0.25rem;background:#7a5c00;color:#ffd;border-color:#b88a00;';
            }
        } catch (_) { /* silently skip if API fails */ }
    },

    async fetchAccounts(forceRefresh = false) {
        if (forceRefresh) {
            this.cachedHoldingsData = null;
            this.cachedDividendsData = null;
            this.cachedTransactionsData = null;
        }
        UI.accountContainer.innerHTML = '<div class="empty-state">Loading accounts for all portfolios...</div>';
        try {
            this.currentGroups = await API.getAccounts(forceRefresh);

            // Build inactiveAccountIds from the DB-backed isActive field on each account
            this.inactiveAccountIds = new Set();
            for (const group of this.currentGroups) {
                for (const acc of (group.accounts || [])) {
                    if (!acc.isActive) {
                        this.inactiveAccountIds.add(acc.id);
                    }
                }
            }

            if (this.currentGroups.length === 0) {
                UI.accountContainer.innerHTML = `<div class="empty-state">
                    <div class="empty-icon">🔑</div>
                    <p><strong>No portfolios configured.</strong></p>
                    <p style="margin-top:0.5rem;color:var(--text-secondary);">Go to <a href="#" onclick="App.switchMainTab('settings');return false;" style="color:var(--primary);text-decoration:underline;">Settings → Portfolios</a> to add your SnapTrade credentials.</p>
                </div>`;
                return;
            }

            if (!this.activePortfolioId && this.currentGroups.length > 0) {
                this.activePortfolioId = this.currentGroups[0].portfolioId;
            }

            UI.renderAccountSection(this.currentGroups, this.activePortfolioId, this.inactiveAccountIds);
        } catch (err) {
            UI.accountContainer.innerHTML = `<div class="empty-state" style="color: var(--danger)">Error: ${sanitize(err.message)}</div>`;
        }
    },

    switchPortfolioTab(id) {
        this.activePortfolioId = id;
        UI.renderAccountSection(this.currentGroups, this.activePortfolioId, this.inactiveAccountIds);
    },

    startRenameAccount(accountId) {
        let currentName = '';
        for (const group of this.currentGroups) {
            const acc = group.accounts.find(a => a.id === accountId);
            if (acc) { currentName = acc.customName || acc.name || ''; break; }
        }
        const nameEl = document.getElementById('acc-name-' + accountId);
        if (!nameEl) return;
        nameEl.innerHTML = `
            <div style="display:flex;align-items:center;gap:0.35rem;flex-wrap:wrap;">
                <input type="text" id="rename-input"
                       style="background:var(--surface-2);border:1px solid var(--primary);color:var(--text);border-radius:var(--radius-sm);padding:0.2rem 0.45rem;font-size:0.875rem;width:180px;">
                <button class="btn btn-primary btn-sm" id="rename-save-btn">Save</button>
                <button class="btn btn-outline btn-sm" id="rename-cancel-btn">Cancel</button>
            </div>`;
        const input = document.getElementById('rename-input');
        input.value = currentName;
        input.addEventListener('keydown', e => {
            if (e.key === 'Enter') this.confirmRenameAccount(accountId);
            else if (e.key === 'Escape') UI.renderAccountSection(this.currentGroups, this.activePortfolioId, this.inactiveAccountIds);
        });
        document.getElementById('rename-save-btn').addEventListener('click', () => this.confirmRenameAccount(accountId));
        document.getElementById('rename-cancel-btn').addEventListener('click', () => UI.renderAccountSection(this.currentGroups, this.activePortfolioId, this.inactiveAccountIds));
        setTimeout(() => input?.focus(), 0);
    },

    async confirmRenameAccount(accountId) {
        const input = document.getElementById('rename-input');
        if (!input) return;
        const newName = input.value.trim();
        if (!newName) { UI.showToast('Name cannot be empty', 'error'); return; }

        try {
            await API.renameAccount(accountId, newName);
            for (const group of this.currentGroups) {
                const acc = group.accounts.find(a => a.id === accountId);
                if (acc) { acc.customName = newName; break; }
            }
            this.cachedHoldingsData = null;
            this.cachedDividendsData = null;
            UI.renderAccountSection(this.currentGroups, this.activePortfolioId, this.inactiveAccountIds);
            UI.showToast('Account renamed');
        } catch (err) {
            UI.showToast('Failed to rename: ' + err.message, 'error');
            UI.renderAccountSection(this.currentGroups, this.activePortfolioId, this.inactiveAccountIds);
        }
    },

    openTradeModal(accountId, portfolioId, symbol, symbolId, description, price, action = 'BUY', prefillUnits = null, notional = null) {
        if (!symbolId) {
            UI.showToast('Click "Refresh" on this page first to sync position data before trading', 'error');
            return;
        }
        this.currentTrade = { accountId, portfolioId, symbol, symbolId };
        this.currentTradeNotional = notional;

        document.getElementById('tradeSymbolTicker').textContent = symbol;
        document.getElementById('tradeSymbolDesc').textContent = description || '';
        document.getElementById('tradeCurrentPrice').textContent = price
            ? `$${Number(price).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
            : '—';

        const isNotional = notional != null;
        document.getElementById('tradeNotionalGroup').style.display  = isNotional ? 'block' : 'none';
        document.getElementById('tradeUnitsGroup').style.display      = isNotional ? 'none'  : 'block';
        document.getElementById('tradeOrderTypeGroup').style.display  = isNotional ? 'none'  : 'block';
        document.getElementById('tradeTifGroup').style.display        = isNotional ? 'none'  : 'block';
        document.getElementById('tradeLimitPriceGroup').style.display = 'none';

        if (isNotional) {
            const estShares = price > 0
                ? (notional / price).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 })
                : '—';
            document.getElementById('tradeNotionalDisplay').innerHTML =
                `<div style="font-size:0.95rem;font-weight:600;">$${Number(notional).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>` +
                `<div style="font-size:0.75rem;color:var(--text-muted);margin-top:0.2rem;">≈ ${sanitize(estShares)} shares at market price · Day order</div>`;
        } else {
            document.getElementById('tradeUnits').value = prefillUnits !== null ? String(prefillUnits) : '';
            document.getElementById('tradeOrderType').value = 'Market';
            document.getElementById('tradeLimitPrice').value = '';
            document.getElementById('tradeTimeInForce').value = 'Day';
        }

        this.setTradeAction(action);
        document.getElementById('tradeModal').classList.add('open');
        if (!isNotional) setTimeout(() => document.getElementById('tradeUnits').focus(), 100);
    },

    closeTradeModal() {
        document.getElementById('tradeModal').classList.remove('open');
        this.currentTrade = null;
        this.currentTradeNotional = null;
    },

    setTradeAction(action) {
        this.currentTradeAction = action;
        const buyBtn  = document.getElementById('tradeBuyBtn');
        const sellBtn = document.getElementById('tradeSellBtn');
        if (action === 'BUY') {
            buyBtn.className  = 'btn btn-primary';
            sellBtn.className = 'btn btn-outline';
        } else {
            buyBtn.className  = 'btn btn-outline';
            sellBtn.className = 'btn btn-danger';
        }
    },

    updateTradeOrderType() {
        const isLimit = document.getElementById('tradeOrderType').value === 'Limit';
        const group   = document.getElementById('tradeLimitPriceGroup');
        const input   = document.getElementById('tradeLimitPrice');
        group.style.display = isLimit ? 'block' : 'none';
        input.required = isLimit;
    },

    async submitTrade() {
        if (!this.currentTrade) return;

        const isNotional = this.currentTradeNotional != null;
        const units      = isNotional ? undefined : parseFloat(document.getElementById('tradeUnits').value);
        const orderType  = isNotional ? 'Market' : document.getElementById('tradeOrderType').value;
        const limitPrice = orderType === 'Limit' ? parseFloat(document.getElementById('tradeLimitPrice').value) : undefined;
        const timeInForce = isNotional ? 'Day' : document.getElementById('tradeTimeInForce').value;

        if (!isNotional && (!units || units <= 0)) { UI.showToast('Enter a valid quantity', 'error'); return; }
        if (orderType === 'Limit' && (!limitPrice || limitPrice <= 0)) {
            UI.showToast('Enter a valid limit price', 'error'); return;
        }

        const btn = document.getElementById('submitTradeBtn');
        btn.classList.add('loading');
        btn.disabled = true;

        try {
            const { portfolioId, accountId, symbol } = this.currentTrade;
            const action = this.currentTradeAction;
            const notional_value = this.currentTradeNotional ?? undefined;
            await API.placeTrade({ portfolioId, accountId, ticker: symbol, action, orderType, units, notional_value, price: limitPrice, timeInForce });
            this.closeTradeModal();
            const desc = notional_value != null
                ? `${action} order placed — $${notional_value} of ${symbol}`
                : `${action} order placed — ${units} × ${symbol}`;
            UI.showToast(desc);
        } catch (err) {
            UI.showToast('Order failed: ' + err.message, 'error');
        } finally {
            btn.classList.remove('loading');
            btn.disabled = false;
        }
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

    // ── Brokerage connection card actions (Snowball-style) ───────────────────

    async connectBrokerageById(id) {
        try {
            const loginUrl = await API.getLoginUrl(id);
            window.open(loginUrl, '_blank');
            UI.showToast('Connection portal opened. Refresh after linking your account.');
        } catch (err) {
            UI.showToast(err.message, 'error');
        }
    },

    addNewAccount() {
        // The "+ Add new account" button is a <details> menu; this is a no-op fallback.
        const menu = document.getElementById('addAccountMenu');
        if (menu) menu.open = !menu.open;
    },

    async syncAccountNow(portfolioId, accountId, btn) {
        if (btn) btn.classList.add('loading');
        try {
            await API.getHoldings(portfolioId, accountId, true);
            // Position data changed — drop derived caches so other tabs refetch.
            this.cachedHoldingsData = null;
            this.cachedDividendsData = null;
            await this.fetchAccounts();
            UI.showToast('Account synced');
        } catch (err) {
            UI.showToast('Sync failed: ' + err.message, 'error');
        } finally {
            if (btn) btn.classList.remove('loading');
        }
    },

    async disconnectAccount(accountId) {
        const isInactive = this.inactiveAccountIds.has(accountId);
        if (!isInactive && !confirm('Disconnect this account? It will be excluded from holdings, dividends, and rebalancing until reconnected. No data is deleted.')) {
            return;
        }
        // toggleAccount flips active state, persists to the DB, and re-renders.
        await this.toggleAccount(accountId);
        UI.showToast(isInactive ? 'Account reconnected' : 'Account disconnected');
    },

    async handleListUsers() {
        UI.adminUserList.innerHTML = '<div style="font-size: 0.75rem; padding: 0.5rem;">Listing unique users...</div>';
        try {
            const users = await API.getAdminUsers();
            UI.renderAdminUsers(users);
        } catch (err) {
            UI.adminUserList.innerHTML = '<div style="color: var(--danger); font-size: 0.75rem;">Failed to list.</div>';
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
        const input = prompt('WIPE ALL USERS from ALL SnapTrade keys? This cannot be undone.\nTo confirm, type "WIPE ALL USERS" below:');
        if (input !== 'WIPE ALL USERS') {
            UI.showToast('Wipe cancelled');
            return;
        }
        const wipeBtn = document.getElementById('wipeBtn');
        wipeBtn.classList.add('loading');
        try {
            const data = await API.wipeAdminUsers('WIPE_ALL');
            UI.showToast(`Wiped ${data.wipedCount} users. ${data.failedCount} failed.`);
            await this.handleListUsers();
        } catch (err) {
            UI.showToast('Wipe failed', 'error');
        } finally {
            wipeBtn.classList.remove('loading');
        }
    },

    async handlePurgeData() {
        const input = prompt('DELETE ALL custom user portfolios, targets, cash balances, transaction logs, and cached dividend metadata?\nThis keeps your brokerage / SnapTrade connection keys intact.\nTo confirm, type "PURGE DATA" below:');
        if (input !== 'PURGE DATA') {
            UI.showToast('Purge cancelled');
            return;
        }
        const purgeBtn = document.getElementById('purgeDataBtn');
        purgeBtn.classList.add('loading');
        try {
            await API.purgeAdminData('PURGE_DATA');
            UI.showToast('All custom portfolios and cached data purged');
            // Reload portfolios to reflect clean state immediately
            await this.loadPortfolios();
        } catch (err) {
            UI.showToast('Purge failed: ' + err.message, 'error');
        } finally {
            purgeBtn.classList.remove('loading');
        }
    },

    async handleSaveRefreshSchedule() {
        const btn = document.getElementById('saveRefreshScheduleBtn');
        btn.classList.add('loading');
        btn.disabled = true;
        try {
            const hours = parseInt(document.getElementById('refreshIntervalHours').value, 10);
            if (!hours || hours < 1) { UI.showToast('Interval must be at least 1 hour', 'error'); return; }
            await API.updateSettings({ data_refresh_interval_hours: String(hours) });
            UI.showToast(`Refresh interval saved — data will sync every ${hours} hour${hours === 1 ? '' : 's'}`);
            this.updateRefreshHint(hours);
        } catch (err) {
            UI.showToast(err.message, 'error');
        } finally {
            btn.classList.remove('loading');
            btn.disabled = false;
        }
    },

    updateRefreshHint(hours) {
        const el = document.getElementById('nextRefreshHint');
        if (el) el.textContent = `Server syncs every ${hours} hour${hours === 1 ? '' : 's'} · Use Refresh button for immediate update`;
    },

    async loadSettings() {
        try {
            const settings = await API.getSettings();

            // Load refresh interval
            const intervalHours = parseInt(settings.data_refresh_interval_hours ?? '24', 10);
            const intervalInput = document.getElementById('refreshIntervalHours');
            if (intervalInput) intervalInput.value = intervalHours;
            this.updateRefreshHint(intervalHours);

            // Load background fetch setting
            const bgFetchEnabled = settings.dividend_background_fetch_enabled !== 'false';
            const bgFetchToggle = document.getElementById('dividendBgFetchToggle');
            if (bgFetchToggle) {
                bgFetchToggle.checked = bgFetchEnabled;
                bgFetchToggle.onchange = async () => {
                    try {
                        await API.updateSettings({
                            dividend_background_fetch_enabled: bgFetchToggle.checked ? 'true' : 'false'
                        });
                        UI.showToast('Background sync setting saved.');
                    } catch (err) {
                        UI.showToast('Failed to save background sync setting.', 'error');
                        bgFetchToggle.checked = !bgFetchToggle.checked; // revert
                    }
                };
            }
        } catch (err) {
            console.error('Failed to load settings:', err);
        }
    },

    async handleClearDividendCache() {
        const btn = document.getElementById('clearDividendCacheBtn');
        btn.classList.add('loading');
        btn.disabled = true;
        try {
            await API.clearDividendCache();
            this.cachedDividendsData = null;
            UI.showToast('Dividend cache cleared — next refresh will fetch fresh data');
        } catch (err) {
            UI.showToast(err.message, 'error');
        } finally {
            btn.classList.remove('loading');
            btn.disabled = false;
        }
    },

    async saveAnthropicKey() {
        const input = document.getElementById('anthropicKeyInput');
        const key = (input?.value || '').trim();
        if (!key) { UI.showToast('Enter an API key first', 'error'); return; }
        try {
            await API.updateSettings({ anthropic_api_key: key });
            if (input) { input.value = ''; input.placeholder = '••••••••' + key.slice(-4); }
            UI.showToast('Anthropic API key saved');
        } catch (err) {
            UI.showToast(err.message, 'error');
        }
    },

    async runStockRatingNow() {
        const statusEl = document.getElementById('stockRatingStatus');
        if (statusEl) statusEl.textContent = 'Running…';
        try {
            const result = await API.triggerJob('stock-rating');
            if (statusEl) statusEl.textContent = result?.detail || 'Job triggered — check the Jobs log for progress.';
        } catch (err) {
            if (statusEl) statusEl.textContent = err.message;
            UI.showToast(err.message, 'error');
        }
    },

    async loadAllHoldings(forceRefresh = false) {
        const container = document.getElementById('holdings-tables');
        if (!container) return;

        const refreshBtn = document.getElementById('refreshHoldingsBtn');

        if (!forceRefresh && this.cachedHoldingsData && this.holdingsLastUpdated) {
            UI.renderAllHoldings(this.getFilteredHoldingsData());
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
                const portfolio = this.activePortfolios.find(p => p.id === group.portfolioId);
                const tradingEnabled = portfolio?.tradingEnabled ? true : false;
                for (const acc of group.accounts) {
                    if (!this.inactiveAccountIds.has(acc.id)) {
                        try {
                            const data = await API.getHoldings(group.portfolioId, acc.id, forceRefresh);
                            allHoldingsData.push({
                                portfolioName: this.getUserPortfolioNamesForAccount(acc.id),
                                accountName: acc.customName || acc.name,
                                accountId: acc.id,
                                portfolioId: group.portfolioId,
                                tradingEnabled,
                                holdings: data
                            });
                        } catch (err) {
                            // Skip disabled accounts silently, only show other errors
                            if (err.message !== 'Account is disabled') {
                                allHoldingsData.push({
                                    portfolioName: this.getUserPortfolioNamesForAccount(acc.id),
                                    accountName: acc.customName || acc.name,
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

            // Load AI ratings in the background — non-blocking.
            API.getStockRatings().then(ratings => {
                this.cachedStockRatings = new Map((ratings || []).map(r => [r.symbol, r]));
                UI.stockRatings = this.cachedStockRatings;
                UI.renderHoldingsRows();
            }).catch(() => {});

            UI.stockRatings = this.cachedStockRatings || new Map();
            UI.renderAllHoldings(this.getFilteredHoldingsData());
        } catch (err) {
            container.innerHTML = `<div class="empty-state" style="color: var(--danger)">Error: ${sanitize(err.message)}</div>`;
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

        this.resolveDividendAccountId();
        if (this.currentDividendAccountId === 'none') {
            container.innerHTML = `<div class="empty-state">
                <div class="empty-icon">📂</div>
                <p><strong>No custom portfolios found.</strong></p>
                <p style="margin-top:0.5rem;color:var(--text-secondary);">Go to <a href="#" onclick="App.switchMainTab('settings');App.switchSettingsTab('portfolios');return false;" style="color:var(--primary);text-decoration:underline;">Settings → Portfolios</a> to create a custom portfolio first.</p>
            </div>`;
            const summaryRow = document.getElementById('dividendSummaryRow');
            if (summaryRow) summaryRow.style.display = 'none';
            UI.renderDividendAccountTabs([], 'none');
            return;
        }

        try {
            const response = await API.getAllDividends(forceRefresh);
            if (response.data && response.data.length > 0) {
                this.cachedDividendsData = response.data.map(d => ({
                    ...d,
                    portfolioName: this.getUserPortfolioNamesForAccount(d.accountId)
                }));
                this.dividendsLastUpdated = new Date();
                this.updateDividendsTimestamp();
                await this.ensureTransactionsLoaded();
                UI.renderDividends(this.getFilteredDividendsData(), this.currentDividendAccountId);
            } else if (!response.fetching) {
                container.innerHTML = '<div class="empty-state"><p>No dividend data available. Trigger a fetch from Settings → Background Jobs.</p></div>';
            }

            // If a background fetch is running and we have nothing cached yet, show a
            // loader. The live `dividends` event refreshes this view when data lands.
            if (response.fetching && (!response.data || response.data.length === 0)) {
                container.innerHTML = '<div class="empty-state"><span class="loader" style="display:inline-block;border-top-color:var(--primary);"></span><p style="margin-top:0.75rem;">Fetching dividend data in the background…</p><p class="text-muted text-sm">This page will update automatically when ready.</p></div>';
            }
        } catch (err) {
            container.innerHTML = `<div class="empty-state" style="color:var(--danger)">Error: ${sanitize(err.message)}</div>`;
        }
    },

    // ── Live updates via Server-Sent Events ─────────────────────────────────────
    // The backend pushes `data-changed` and `job-status` events whenever cached
    // data is written. We react by silently refreshing the affected in-memory
    // caches and re-rendering the active page (and anything derived from it).

    connectLiveSync() {
        const token = localStorage.getItem('cf_token');
        if (!token) return;
        if (this._sse) { try { this._sse.close(); } catch (_) {} this._sse = null; }

        this._livePending = this._livePending || new Set();

        const es = new EventSource(`/api/events?token=${encodeURIComponent(token)}`);
        this._sse = es;

        es.addEventListener('data-changed', (e) => {
            try {
                const { domain } = JSON.parse(e.data);
                if (domain) {
                    this._livePending.add(domain);
                    this.scheduleLiveUpdate();
                }
            } catch (err) { console.warn('liveSync: bad data-changed event', err); }
        });

        es.addEventListener('job-status', (e) => {
            try { this.onJobStatusEvent(JSON.parse(e.data).job); } catch (err) { console.warn('liveSync: bad job-status event', err); }
        });

        es.onopen = () => { this._sseErrors = 0; };
        es.onerror = () => {
            // EventSource auto-reconnects on transient failures. Guard against a
            // permanently-failing (e.g. revoked) token by giving up after a streak.
            this._sseErrors = (this._sseErrors || 0) + 1;
            if (this._sseErrors > 12) {
                try { es.close(); } catch (_) {}
                this._sse = null;
            }
        };
    },

    disconnectLiveSync() {
        if (this._sse) { try { this._sse.close(); } catch (_) {} this._sse = null; }
        clearTimeout(this._liveTimer);
    },

    // Coalesce a burst of events (e.g. a job writing many accounts) into one update.
    scheduleLiveUpdate() {
        clearTimeout(this._liveTimer);
        this._liveTimer = setTimeout(() => {
            const domains = this._livePending;
            this._livePending = new Set();
            this.applyLiveUpdate(domains).catch(() => {});
        }, 400);
    },

    async applyLiveUpdate(domains) {
        if (!domains || domains.size === 0) return;

        const holdingsChanged      = domains.has('holdings') || domains.has('accounts');
        const dividendsChanged     = domains.has('dividends');
        const transactionsChanged  = domains.has('transactions');
        const targetsChanged       = domains.has('targets');

        // 1. Refresh the in-memory caches for whatever changed (cache-only, silent).
        if (holdingsChanged) {
            try {
                this.currentGroups = await API.getAccounts();
                await this.fetchHoldingsDataSilently();
            } catch (err) { console.warn('liveUpdate: holdings refresh failed', err); }
        }
        if (dividendsChanged) {
            try {
                const response = await API.getAllDividends(false);
                if (response.data) {
                    this.cachedDividendsData = response.data.map(d => ({
                        ...d,
                        portfolioName: this.getUserPortfolioNamesForAccount(d.accountId)
                    }));
                    this.dividendsLastUpdated = new Date();
                }
            } catch (err) { console.warn('liveUpdate: dividends refresh failed', err); }
        }
        if (transactionsChanged) {
            try {
                const response = await API.getTransactions(false);
                this.cachedTransactionsData = response
                    .filter(group => group.transactions && group.transactions.length > 0)
                    .map(group => ({
                        portfolioName: this.getUserPortfolioNamesForAccount(group.accountId),
                        accountName: group.accountName,
                        accountId: group.accountId,
                        positionsBySymbol: group.positionsBySymbol || {},
                        transactions: group.transactions
                    }));
                this.transactionsLastUpdated = new Date();
                // Transactions changed — portfolio history needs a fresh fetch.
                this._perfResult = null;
            } catch (err) { console.warn('liveUpdate: transactions refresh failed', err); }
        }

        // 2. Re-render the active page; dependent figures recompute from fresh caches.
        //    Other tabs re-read these same caches when next shown via switchMainTab.
        const activeTab = localStorage.getItem('activeMainTab') || 'dashboard';
        if (activeTab === 'dashboard') {
            this.loadDashboard();
        } else if (activeTab === 'holdings' && holdingsChanged) {
            UI.renderAllHoldings(this.getFilteredHoldingsData());
        } else if (activeTab === 'transactions' && transactionsChanged) {
            UI.renderAllTransactions(this.getFilteredTransactionsData());
            this.updateTransactionsTimestamp();
        } else if (activeTab === 'rebalance' && (holdingsChanged || targetsChanged)) {
            this.loadRebalanceTab(false);
        } else if (activeTab === 'dividend-tracker' && (dividendsChanged || transactionsChanged)) {
            // transactionsChanged also re-renders so newly-logged dividends recolor
            // expected → received in the forecast/calendar without a reload.
            const subTab = localStorage.getItem('activeDividendSubTab') || 'forecast';
            const filtered = this.getFilteredDividendsData();
            
            this.resolveDividendAccountId();
            if (this.currentDividendAccountId === 'none') {
                const containerId = subTab === 'forecast' ? 'dividends-page-content' : 'dividend-calendar-grid';
                const container = document.getElementById(containerId);
                if (container) {
                    container.innerHTML = `<div class="empty-state">
                        <div class="empty-icon">📂</div>
                        <p><strong>No custom portfolios found.</strong></p>
                        <p style="margin-top:0.5rem;color:var(--text-secondary);">Go to <a href="#" onclick="App.switchMainTab('settings');App.switchSettingsTab('portfolios');return false;" style="color:var(--primary);text-decoration:underline;">Settings → Portfolios</a> to create a custom portfolio first.</p>
                    </div>`;
                }
                if (subTab === 'forecast') {
                    const summaryRow = document.getElementById('dividendSummaryRow');
                    if (summaryRow) summaryRow.style.display = 'none';
                } else {
                    const listEl = document.getElementById('dividend-calendar-list');
                    if (listEl) listEl.innerHTML = '';
                }
                UI.renderDividendAccountTabs([], 'none');
            } else {
                if (subTab === 'forecast') {
                    UI.renderDividends(filtered, this.currentDividendAccountId);
                } else {
                    UI.renderDividendCalendar(filtered, this.currentCalendarDate, this.currentDividendAccountId);
                }
            }
            this.updateDividendsTimestamp();
        }
    },

    onJobStatusEvent(job) {
        // Keep the Scheduler → Background Jobs panel live while it's on screen.
        if (localStorage.getItem('activeMainTab') === 'settings' && localStorage.getItem('activeSettingsTab') === 'scheduler') {
            API.getJobs().then(jobs => UI.renderJobsPanel(jobs)).catch(() => {});
            API.getJobHistory().then(history => UI.renderJobHistoryPanel(history)).catch(() => {});
        }
        // The dividend-fetch finishing also flips the "Fetching…" loader to real
        // data; the `dividends` data-changed event drives the actual re-render.
        if (job && job.name === 'dividend-fetch' && job.status !== 'running') {
            this._livePending = this._livePending || new Set();
            this._livePending.add('dividends');
            this.scheduleLiveUpdate();
        }
    },

    async loadJobsPanel() {
        // Initial render; subsequent updates arrive via `job-status` SSE events.
        try {
            const [jobs, history] = await Promise.all([
                API.getJobs(),
                API.getJobHistory()
            ]);
            UI.renderJobsPanel(jobs);
            UI.renderJobHistoryPanel(history);
        } catch (err) {
            const el = document.getElementById('jobsPanel');
            if (el) el.innerHTML = `<div class="empty-state" style="color:var(--danger)">Error: ${sanitize(err.message)}</div>`;
        }
    },

    async handleTriggerJob(name) {
        try {
            await API.triggerJob(name);
            UI.showToast('Job started');
            await this.loadJobsPanel();
        } catch (err) {
            UI.showToast(err.message, 'error');
        }
    },

    async handleUpdateJobSchedule(name) {
        const input = document.getElementById(`job-interval-${name}`);
        if (!input) return;
        const hours = parseFloat(input.value);
        if (isNaN(hours) || hours < 0) {
            UI.showToast('Enter a valid number of hours (0 = manual only)', 'error');
            return;
        }
        try {
            await API.updateJobSchedule(name, hours);
            UI.showToast(`Schedule saved — ${hours === 0 ? 'manual only' : 'every ' + hours + 'h'}`);
            await this.loadJobsPanel();
        } catch (err) {
            UI.showToast(err.message, 'error');
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

        this.resolveDividendAccountId();
        if (this.currentDividendAccountId === 'none') {
            container.innerHTML = `<div class="empty-state">
                <div class="empty-icon">📂</div>
                <p><strong>No custom portfolios found.</strong></p>
                <p style="margin-top:0.5rem;color:var(--text-secondary);">Go to <a href="#" onclick="App.switchMainTab('settings');App.switchSettingsTab('portfolios');return false;" style="color:var(--primary);text-decoration:underline;">Settings → Portfolios</a> to create a custom portfolio first.</p>
            </div>`;
            const listEl = document.getElementById('dividend-calendar-list');
            if (listEl) listEl.innerHTML = '';
            UI.renderDividendAccountTabs([], 'none');
            return;
        }

        if (!forceRefresh && this.cachedDividendsData && this.dividendsLastUpdated) {
            await this.ensureTransactionsLoaded();
            UI.renderDividendCalendar(this.getFilteredDividendsData(), this.currentCalendarDate, this.currentDividendAccountId);
            return;
        }

        // If no cache, we can trigger the loadAllDividends which populates the cache
        await this.loadAllDividends(forceRefresh);
        await this.ensureTransactionsLoaded();
        UI.renderDividendCalendar(this.getFilteredDividendsData(), this.currentCalendarDate, this.currentDividendAccountId);
    },

    // Ensure dividend transactions are cached so the forecast/calendar can mark
    // which projected dividends have actually been received. Cache-only + idempotent.
    async ensureTransactionsLoaded() {
        if (this.cachedTransactionsData) return true;
        try {
            const response = await API.getTransactions(false);
            this.cachedTransactionsData = response
                .filter(group => group.transactions && group.transactions.length > 0)
                .map(group => ({
                    portfolioName: this.getUserPortfolioNamesForAccount(group.accountId),
                    accountName: group.accountName,
                    accountId: group.accountId,
                    positionsBySymbol: group.positionsBySymbol || {},
                    transactions: group.transactions
                }));
            this.transactionsLastUpdated = new Date();
            return true;
        } catch (err) {
            console.warn('ensureTransactionsLoaded failed', err);
            return false;
        }
    },

    changeCalendarMonth(delta) {
        const newDate = new Date(this.currentCalendarDate);
        newDate.setMonth(newDate.getMonth() + delta);
        this.currentCalendarDate = newDate;
        UI.renderDividendCalendar(this.getFilteredDividendsData(), this.currentCalendarDate, this.currentDividendAccountId);
    },

    async loadAllTransactions(forceRefresh = false) {
        const container = document.getElementById('transactions-tables');
        if (!container) return;

        if (!forceRefresh && this.cachedTransactionsData && this.transactionsLastUpdated) {
            UI.renderAllTransactions(this.getFilteredTransactionsData());
            this.updateTransactionsTimestamp();
            return;
        }

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
                    portfolioName: this.getUserPortfolioNamesForAccount(group.accountId),
                    accountName: group.accountName,
                    accountId: group.accountId,
                    positionsBySymbol: group.positionsBySymbol || {},
                    transactions: group.transactions
                }));

            this.cachedTransactionsData = data;
            UI.renderAllTransactions(this.getFilteredTransactionsData());

            const elapsed = Date.now() - start;
            if (elapsed > 1000) {
                UI.showToast(`Transaction data refreshed (${elapsed}ms)`);
            }
        } catch (err) {
            container.innerHTML = `<div class="empty-state" style="color: var(--danger)">Error: ${sanitize(err.message)}</div>`;
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
        document.querySelectorAll('#transactions-tabs .pill-tab').forEach(t => t.classList.remove('active'));
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
        document.querySelectorAll('#holdings-tabs .pill-tab').forEach(t => t.classList.remove('active'));
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

    switchHoldingsPortfolioTab(portfolioId) {
        this.activeHoldingsTabId = portfolioId === 'unassigned' ? 'unassigned' : parseInt(portfolioId, 10);
        UI.renderAllHoldings(this.getFilteredHoldingsData());
    },

    switchTransactionsPortfolioTab(portfolioId) {
        this.activeTransactionsTabId = portfolioId === 'unassigned' ? 'unassigned' : parseInt(portfolioId, 10);
        UI.renderAllTransactions(this.getFilteredTransactionsData());
    },

    async handleChangePassword() {
        const current  = document.getElementById('currentPassword').value;
        const newPw    = document.getElementById('newPassword').value;
        const confirm  = document.getElementById('confirmNewPassword').value;
        if (!current || !newPw || !confirm) { UI.showToast('Fill in all fields', 'error'); return; }
        if (newPw !== confirm) { UI.showToast('Passwords do not match', 'error'); return; }
        if (newPw.length < 8) { UI.showToast('New password must be at least 8 characters', 'error'); return; }
        const btn = document.getElementById('changePasswordBtn');
        btn.classList.add('loading'); btn.disabled = true;
        try {
            await API.changePassword(current, newPw);
            document.getElementById('currentPassword').value = '';
            document.getElementById('newPassword').value = '';
            document.getElementById('confirmNewPassword').value = '';
            UI.showToast('Password changed successfully');
        } catch (err) {
            UI.showToast(err.message, 'error');
        } finally {
            btn.classList.remove('loading'); btn.disabled = false;
        }
    },

    totalPortfolioValue() {
        let total = 0;
        const groups = this.getFilteredGroups();
        if (groups) {
            groups.forEach(g => {
                (g.accounts || []).forEach(acc => {
                    if (!this.inactiveAccountIds?.has(acc.id)) {
                        total += acc.balance?.total?.amount || 0;
                    }
                });
            });
        }
        return total;
    },

    async fetchHoldingsDataSilently() {
        if (!this.currentGroups || this.currentGroups.length === 0) {
            this.currentGroups = await API.getAccounts();
        }

        // Flatten active accounts into a task list.
        const tasks = [];
        for (const group of this.currentGroups) {
            const portfolio = this.activePortfolios.find(p => p.id === group.portfolioId);
            const tradingEnabled = portfolio?.tradingEnabled ? true : false;
            for (const acc of group.accounts) {
                if (!this.inactiveAccountIds.has(acc.id)) tasks.push({ group, acc, tradingEnabled });
            }
        }

        const fetchOne = async ({ group, acc, tradingEnabled }) => {
            const base = {
                portfolioName: this.getUserPortfolioNamesForAccount(acc.id),
                accountName: acc.customName || acc.name,
                accountId: acc.id,
            };
            try {
                const data = await API.getHoldings(group.portfolioId, acc.id, false);
                return { ...base, portfolioId: group.portfolioId, tradingEnabled, holdings: data };
            } catch (err) {
                if (err.message === 'Account is disabled') return null;
                return { ...base, error: err.message };
            }
        };

        // Bounded concurrency — fetch a few accounts at a time instead of one-by-one.
        const CONCURRENCY = 4;
        const allHoldingsData = [];
        for (let i = 0; i < tasks.length; i += CONCURRENCY) {
            const batch = await Promise.all(tasks.slice(i, i + CONCURRENCY).map(fetchOne));
            batch.forEach(r => { if (r) allHoldingsData.push(r); });
        }

        this.cachedHoldingsData = allHoldingsData;
        this.holdingsLastUpdated = new Date();
    },

    async loadDashboard() {
        const countEl = document.getElementById('portfolioCount');
        if (countEl) countEl.textContent = this.userPortfolios ? this.userPortfolios.length : 0;

        if (!this.currentGroups || this.currentGroups.length === 0) {
            try {
                this.currentGroups = await API.getAccounts();
            } catch (_) {}
        }

        if (!this.currentGroups || this.currentGroups.length === 0) {
            const holdingsTable = document.getElementById('dashboardChartArea');
            if (holdingsTable) holdingsTable.innerHTML = `<div class="empty-state">
                <div class="empty-icon">🔑</div>
                <p><strong>No connections configured.</strong></p>
                <p style="margin-top:0.5rem;color:var(--text-secondary);">Go to <a href="#" onclick="App.switchMainTab('settings');App.switchSettingsTab('keys');return false;" style="color:var(--primary);text-decoration:underline;">Settings → Keys & Providers</a> to connect a brokerage.</p>
            </div>`;
            return;
        }

        if (!this.cachedHoldingsData) {
            await this.fetchHoldingsDataSilently();
        }

        const filteredGroups = this.getFilteredGroups();
        const filteredHoldings = this.getFilteredHoldingsData();

        let totalBalance = 0;
        let totalInvested = 0;

        if (filteredHoldings) {
            filteredHoldings.forEach(acct => {
                if (this.inactiveAccountIds.has(acct.accountId)) return;
                if (acct.error) return;
                (acct.holdings || []).forEach(pos => {
                    const units = pos.units || 0;
                    const price = pos.price || 0;
                    const val = pos.marketValue || (units * price) || 0;
                    const avgBuy = pos.average_purchase_price || 0;
                    const cost = avgBuy > 0 ? (units * avgBuy) : val;

                    totalBalance += val;
                    totalInvested += cost;
                });
            });
        }

        if (filteredGroups) {
            filteredGroups.forEach(g => {
                (g.accounts || []).forEach(acc => {
                    if (!this.inactiveAccountIds.has(acc.id)) {
                        const cashVal = acc.balance?.cash?.amount || 0;
                        totalBalance += cashVal;
                        totalInvested += cashVal;
                    }
                });
            });
        }

        const profit = totalBalance - totalInvested;
        const profitPct = totalInvested > 0 ? (profit / totalInvested * 100) : 0;

        const totalBalanceEl = document.getElementById('totalBalance');
        if (totalBalanceEl) {
            totalBalanceEl.textContent = `$${totalBalance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
        }

        const totalInvestedEl = document.getElementById('totalInvested');
        if (totalInvestedEl) {
            totalInvestedEl.textContent = `$${totalInvested.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} invested`;
        }

        const profitEl = document.getElementById('totalProfit');
        if (profitEl) {
            profitEl.textContent = `${profit >= 0 ? '+' : '-'}$${Math.abs(profit).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
            profitEl.style.color = profit >= 0 ? 'var(--primary)' : 'var(--danger)';
        }

        const profitPctEl = document.getElementById('totalProfitPct');
        if (profitPctEl) {
            profitPctEl.textContent = `${profit >= 0 ? '+' : '-'}${Math.abs(profitPct).toFixed(2)}% total return`;
            profitPctEl.style.color = profit >= 0 ? 'var(--primary)' : 'var(--danger)';
        }

        const irrValueEl = document.getElementById('irrValue');
        if (irrValueEl) {
            irrValueEl.textContent = `${profitPct.toFixed(2)}%`;
        }

        const irrSubEl = document.getElementById('irrSub');
        if (irrSubEl) {
            irrSubEl.textContent = 'Simple return';
        }

        if (filteredGroups) {
            UI.renderDashboardChart(filteredGroups, this.inactiveAccountIds, filteredHoldings);
            UI.renderDashboardHoldingsTable(filteredGroups, this.inactiveAccountIds, filteredHoldings);
        }

        const filteredDividends = this.getFilteredDividendsData();
        if (filteredDividends) {
            UI.renderDashboardDividendWidgets(filteredDividends, totalBalance);
        } else {
            UI.setDashboardDividendLoading(true);
            try {
                const response = await API.getAllDividends(false);
                if (response.data && response.data.length > 0) {
                    this.cachedDividendsData = response.data.map(d => ({
                        ...d,
                        portfolioName: this.getUserPortfolioNamesForAccount(d.accountId)
                    }));
                    this.dividendsLastUpdated = new Date();
                    UI.renderDashboardDividendWidgets(this.getFilteredDividendsData(), totalBalance);
                }
                // If a background fetch is still running, the `dividends` SSE event
                // will refresh these widgets when the data lands.
            } catch (_) {}
            finally { UI.setDashboardDividendLoading(false); }
        }

        // Dividend chart (received + projected) is rendered inside renderDashboardDividendWidgets.

        this.applyDashboardValuesVisibility(localStorage.getItem('cf_mask_values') === 'true');

        // Portfolio performance (value over time) — loaded async, independent of
        // the synchronous dashboard widgets above.
        this.loadPortfolioPerformance();
        this.loadDiversification();
        this.updateProjection();
    },

    // Current portfolio value + annual dividend income, used as the projection
    // starting point. Income comes from the 12-month dividend forecast.
    getProjectionBasis() {
        let value = 0;
        (this.getFilteredHoldingsData() || []).forEach(acct => (acct.holdings || []).forEach(h => {
            const units = h.units || 0, price = h.price || 0;
            value += h.marketValue || (units * price) || 0;
        }));
        let income = 0;
        (this.getFilteredDividendsData() || []).forEach(acct => (acct.dividends || []).forEach(e => { income += e.amount || 0; }));
        const currency = (this.getFilteredHoldingsData()?.[0]?.holdings?.[0]?.currency) || 'USD';
        return { value, income, currency };
    },

    // Recompute and render the income projection from the current inputs +
    // portfolio basis. Cheap and pure (DivMath.projectIncome), so safe to call
    // on every keystroke.
    updateProjection() {
        const num = (id, def) => { const el = document.getElementById(id); const v = el ? parseFloat(el.value) : NaN; return isNaN(v) ? def : v; };
        const basis = this.getProjectionBasis();

        if (basis.value <= 0 && basis.income <= 0) {
            UI.renderIncomeProjection(null, { noBasis: true });
            return;
        }

        const monthly = num('fireContribution', 0);
        const target = num('fireTarget', 0);
        const drip = document.getElementById('fireDrip')?.checked !== false;

        const result = DivMath.projectIncome({
            currentValue: basis.value,
            currentIncome: basis.income,
            annualContribution: monthly * 12,
            dividendGrowthRate: num('fireDgr', 0),
            priceGrowthRate: num('firePgr', 0),
            reinvest: drip,
            years: num('fireYears', 25),
            targetAnnualIncome: target,
        });

        UI.renderIncomeProjection(result, {
            currency: basis.currency, target,
            currentValue: basis.value, currentIncome: basis.income,
        });
    },

    async loadDiversification() {
        this._divDim = this._divDim || localStorage.getItem('cf_div_dim') || 'bySector';
        try {
            const result = await API.getDiversification();
            this._divResult = result;
            this._divCurrency = (this.getFilteredHoldingsData()?.[0]?.holdings?.[0]?.currency) || 'USD';
            UI.renderDiversification(result, this._divDim, this._divCurrency);
        } catch (e) {
            const empty = document.getElementById('divEmpty');
            if (empty) { empty.style.display = 'block'; empty.querySelector('p').textContent = 'Could not load diversification data.'; }
        }
    },

    setDiversificationDim(dim) {
        this._divDim = dim;
        localStorage.setItem('cf_div_dim', dim);
        if (this._divResult) UI.renderDiversification(this._divResult, dim, this._divCurrency || 'USD');
    },

    // Fetch the reconstructed portfolio history once and render it; range and
    // benchmark toggles re-render from the cached result (benchmark change
    // refetches since it's computed server-side).
    async loadPortfolioPerformance() {
        const benchOn = localStorage.getItem('cf_perf_bench') !== 'false';
        const benchSym = localStorage.getItem('cf_perf_bench_sym') || 'SPY';
        this._perfRange = this._perfRange || localStorage.getItem('cf_perf_range') || '1y';
        const benchToggle = document.getElementById('perfBenchToggle');
        if (benchToggle) benchToggle.checked = benchOn;
        const benchLabel = document.getElementById('perfBenchLabel');
        if (benchLabel) benchLabel.textContent = benchSym;

        // Re-use cached result unless it was invalidated (e.g. by a transaction sync).
        if (this._perfResult) {
            this._perfCurrency = (this.getFilteredHoldingsData()?.[0]?.holdings?.[0]?.currency) || 'USD';
            UI.renderPortfolioPerformance(this._perfResult, this._perfRange, benchOn, this._perfCurrency);
            return;
        }

        try {
            const result = await API.getPortfolioHistory(benchSym);
            this._perfResult = result;
            this._perfCurrency = (this.getFilteredHoldingsData()?.[0]?.holdings?.[0]?.currency) || 'USD';
            UI.renderPortfolioPerformance(result, this._perfRange, benchOn, this._perfCurrency);
        } catch (e) {
            const empty = document.getElementById('perfEmpty');
            if (empty) { empty.style.display = 'flex'; empty.querySelector('p').textContent = 'Could not load performance data.'; }
        }
    },

    setPerfRange(rangeKey) {
        this._perfRange = rangeKey;
        localStorage.setItem('cf_perf_range', rangeKey);
        if (this._perfResult) {
            const benchOn = localStorage.getItem('cf_perf_bench') !== 'false';
            UI.renderPortfolioPerformance(this._perfResult, rangeKey, benchOn, this._perfCurrency || 'USD');
        }
    },

    togglePerfBenchmark(on) {
        localStorage.setItem('cf_perf_bench', String(on));
        if (this._perfResult) {
            UI.renderPortfolioPerformance(this._perfResult, this._perfRange, on, this._perfCurrency || 'USD');
        }
    },

    toggleDashboardValuesVisibility() {
        const current = localStorage.getItem('cf_mask_values') === 'true';
        const next = !current;
        localStorage.setItem('cf_mask_values', String(next));
        this.applyDashboardValuesVisibility(next);
    },

    applyDashboardValuesVisibility(masked) {
        const openIcon = document.getElementById('eyeIconOpen');
        const closedIcon = document.getElementById('eyeIconClosed');
        
        if (masked) {
            if (openIcon) openIcon.style.display = 'none';
            if (closedIcon) closedIcon.style.display = 'block';
            document.querySelectorAll('.masked-val').forEach(el => {
                el.classList.add('hidden-mode');
            });
        } else {
            if (openIcon) openIcon.style.display = 'block';
            if (closedIcon) closedIcon.style.display = 'none';
            document.querySelectorAll('.masked-val').forEach(el => {
                el.classList.remove('hidden-mode');
            });
        }
        if (UI.accountsChartInstance) {
            UI.accountsChartInstance.update();
        }
    },

    // Toggles the mobile dropdown of the top navigation menu. (Named
    // toggleSidebar for backwards-compatibility with existing onclick handlers.)
    toggleSidebar() {
        const nav = document.querySelector('.app-topnav');
        const overlay = document.getElementById('sidebarOverlay');
        const open = nav?.classList.toggle('nav-open');
        overlay?.classList.toggle('visible', open);
    },

    closeSidebarOnMobile() {
        if (window.innerWidth <= 768) {
            document.querySelector('.app-topnav')?.classList.remove('nav-open');
            document.getElementById('sidebarOverlay')?.classList.remove('visible');
        }
    },

    logout() {
        this.disconnectLiveSync();
        localStorage.removeItem('cf_token');
        window.location.href = '/login.html';
    },

    switchMainTab(tabId, btnElement) {
        this.closeSidebarOnMobile();
        localStorage.setItem('activeMainTab', tabId);
        // Update active class on nav items
        document.querySelectorAll('.topnav-item').forEach(btn => btn.classList.remove('active'));
        if (btnElement) {
            btnElement.classList.add('active');
        } else {
            const btn = document.querySelector(`.topnav-item[data-tab="${tabId}"]`);
            if (btn) btn.classList.add('active');
        }

        // Update page title
        const pageTitleEl = document.getElementById('pageTitle');
        if (pageTitleEl) {
            const titles = { dashboard: 'Dashboard', holdings: 'Holdings', 'dividend-tracker': 'Dividend Tracker', transactions: 'Transactions', rebalance: 'Rebalancing', settings: 'Settings' };
            pageTitleEl.textContent = titles[tabId] || tabId;
        }

        // Update active class on tab contents
        document.querySelectorAll('.tab-content').forEach(tab => tab.classList.remove('active'));
        const activeTab = document.getElementById(tabId + '-tab');
        if (activeTab) {
            activeTab.classList.add('active');
        }

        if (tabId === 'dashboard') {
            this.loadDashboard();
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
        } else if (tabId === 'rebalance') {
            this.loadRebalanceTab();
        }
    },

    // ── Stock detail page ────────────────────────────────────────────────────
    // Opened by clicking a symbol; a contextual full-page view (not a sidebar
    // tab) reached over the current page, with a Back button to return.
    async openStockDetail(symbol) {
        if (!symbol) return;
        symbol = String(symbol).toUpperCase().trim();
        // Remember where to return (in memory only, so a reload won't get stuck here).
        this._returnTab = localStorage.getItem('activeMainTab') || 'dashboard';

        document.querySelectorAll('.tab-content').forEach(tab => tab.classList.remove('active'));
        const view = document.getElementById('stock-detail-tab');
        if (view) view.classList.add('active');
        const pageTitleEl = document.getElementById('pageTitle');
        if (pageTitleEl) pageTitleEl.textContent = symbol;
        this.closeSidebarOnMobile();

        // Positions come from already-cached data (ensure transactions for dividends-received).
        await this.ensureTransactionsLoaded();
        const positions = this.buildStockPositions(symbol);

        // Render immediately with positions + a loading header, then fill in Snowball detail.
        UI.renderStockDetail(symbol, null, positions, 'loading');
        let detailCurrency = (positions?.total?.currency) || 'USD';
        try {
            const detail = await API.getStockDetail(symbol);
            detailCurrency = (detail && detail.currency) || detailCurrency;
            UI.renderStockDetail(symbol, detail, positions, 'ready');
        } catch (_) {
            UI.renderStockDetail(symbol, null, positions, 'error');
        }
        // Price history is independent of Snowball detail — load it after the
        // detail card is in the DOM (renderStockDetail recreates the placeholder).
        // Pass the active-portfolio cost basis + trades so the chart can draw the
        // average-cost line and buy/sell markers.
        const extras = {
            avgCost: positions?.total?.avgCost || positions?.rows?.[0]?.avgCost || 0,
            // Per-account cost-per-share lines (the breakdown shown on the cards).
            costLines: (positions?.rows || [])
                .filter(r => r.avgCost > 0)
                .map(r => ({ label: r.accountName || 'Account', value: r.avgCost })),
            trades: this.getSymbolTradesForChart(symbol),
        };
        this.loadPriceHistory(symbol, detailCurrency, extras);
    },

    // Buy/sell trades for a symbol in the currently active scope, for plotting
    // transaction markers on the price chart.
    getSymbolTradesForChart(symbol) {
        const want = String(symbol || '').toUpperCase().trim();
        const out = [];
        (this.getFilteredTransactionsData() || []).forEach(acct => {
            (acct.transactions || []).forEach(t => {
                if (String(t.symbol || '').toUpperCase().trim() !== want) return;
                const type = String(t.type || t.action || '').toUpperCase();
                const isBuy = type.includes('BUY');
                const isSell = type.includes('SELL');
                if (!isBuy && !isSell) return;
                if (!t.date) return;
                out.push({
                    date: String(t.date).slice(0, 10),
                    action: isBuy ? 'BUY' : 'SELL',
                    units: Math.abs(t.units || 0),
                    price: Math.abs(t.price || (t.units ? (t.amount || 0) / t.units : 0)),
                });
            });
        });
        return out;
    },

    // Fetch the full price-history series once, cache it, and render the chart.
    // Range buttons then filter the cached series client-side (instant switching).
    // `extras` carries the average cost line + transaction markers (active scope).
    async loadPriceHistory(symbol, currency = 'USD', extras = {}) {
        this._priceHistory = { symbol, currency, candles: null, range: this._priceHistoryRange || '5y', extras };
        try {
            const { candles } = await API.getStockPriceHistory(symbol, 'max');
            // Guard against the user navigating to another symbol mid-fetch.
            if (!this._priceHistory || this._priceHistory.symbol !== symbol) return;
            this._priceHistory.candles = candles;
            UI.renderPriceHistory(symbol, candles, this._priceHistory.range, currency, 'ready', extras);
        } catch (_) {
            if (this._priceHistory && this._priceHistory.symbol === symbol) {
                UI.renderPriceHistory(symbol, null, this._priceHistory.range, currency, 'error', extras);
            }
        }
    },

    setPriceHistoryRange(rangeKey) {
        this._priceHistoryRange = rangeKey;
        const ph = this._priceHistory;
        if (!ph || !ph.candles) return;
        ph.range = rangeKey;
        UI.renderPriceHistory(ph.symbol, ph.candles, rangeKey, ph.currency, 'ready', ph.extras || {});
    },

    closeStockDetail() {
        this.switchMainTab(this._returnTab || 'dashboard');
    },

    // Build the "My positions" breakdown for a symbol from cached holdings +
    // transactions. Returns { rows: [...per account], total: {...aggregate} }.
    buildStockPositions(symbol) {
        // Delegates to the pure, unit-tested implementation in divmath.js.
        return DivMath.buildStockPositions(symbol, {
            holdings: this.getFilteredHoldingsData(),
            txData: this.getFilteredTransactionsData(),
            groups: this.getFilteredGroups(),
            inactiveIds: this.inactiveAccountIds,
            divTypes: UI._DIV_TYPES,
        });
    },

    async switchSettingsTab(paneId, btnElement) {
        localStorage.setItem('activeSettingsTab', paneId);
        // Update active class on settings tabs
        document.querySelectorAll('.underline-tab').forEach(btn => btn.classList.remove('active'));

        if (btnElement) {
            btnElement.classList.add('active');
        } else {
            const btn = document.querySelector(`.underline-tab[data-tab="${paneId}"]`);
            if (btn) btn.classList.add('active');
        }

        // Update active class on panes — CSS handles display via .pane.active
        document.querySelectorAll('#settings-tab .pane').forEach(pane => pane.classList.remove('active'));

        const activePane = document.getElementById('settings-' + paneId + '-pane');
        if (activePane) activePane.classList.add('active');

        // Load data based on which pane was activated
        if (paneId === 'keys') {
            try {
                this.activePortfolios = await API.getPortfolios();
                UI.renderPortfolios(this.activePortfolios);
            } catch (err) {
                console.error('Failed to load portfolios:', err);
            }
            // Load existing Anthropic key hint (masked)
            try {
                const settings = await API.getSettings();
                const keyEl = document.getElementById('anthropicKeyInput');
                if (keyEl && settings.anthropic_api_key) {
                    keyEl.placeholder = '••••••••' + settings.anthropic_api_key.slice(-4);
                }
            } catch (_) {}
        } else if (paneId === 'portfolios') {
            this.loadUserPortfolios();
        } else if (paneId === 'connections') {
            this.fetchAccounts();
        } else if (paneId === 'scheduler') {
            this.loadJobsPanel();
        }
    },

    switchDividendSubTab(subTabId, btnElement) {
        localStorage.setItem('activeDividendSubTab', subTabId);

        // Update button styles
        document.querySelectorAll('#dividend-sub-tabs .pill-tab').forEach(btn => btn.classList.remove('active'));

        if (btnElement) {
            btnElement.classList.add('active');
        } else {
            const btn = document.querySelector(`#dividend-sub-tabs .pill-tab[data-subtab="${subTabId}"]`);
            if (btn) btn.classList.add('active');
        }

        // 'calendar' and 'list' are two views of the same calendar pane.
        const paneKey = (subTabId === 'list') ? 'calendar' : subTabId;

        // Update pane visibility — CSS handles display via .pane.active
        document.querySelectorAll('#dividend-tracker-tab .pane').forEach(pane => pane.classList.remove('active'));

        const activePane = document.getElementById('dividend-' + paneKey + '-pane');
        if (activePane) activePane.classList.add('active');

        // Show/hide account selector tabs container (hidden only on the Database view)
        const tabsContainer = document.getElementById('dividend-account-tabs');
        if (tabsContainer) {
            tabsContainer.style.display = (subTabId === 'database') ? 'none' : 'flex';
        }

        if (subTabId === 'forecast') {
            this.loadAllDividends();
        } else if (subTabId === 'database') {
            this.loadDividendDatabase();
        } else {
            // calendar or list — same pane, different inner view
            UI.divCalView = subTabId;
            this.loadDividendCalendar();
        }
    },

    switchDividendAccountTab(accountId) {
        this.currentDividendAccountId = accountId;

        const filteredDivs = this.getFilteredDividendsData();
        // Re-render tabs to reflect active selection
        if (filteredDivs) {
            UI.renderDividendAccountTabs(filteredDivs, this.currentDividendAccountId);
        }

        // Check which subtab is active and re-render that subtab
        const activeSubTab = document.querySelector('#dividend-sub-tabs .pill-tab.active')?.getAttribute('data-subtab');
        if (!filteredDivs) return;
        if (activeSubTab === 'forecast' || !activeSubTab) {
            UI.renderDividends(filteredDivs, this.currentDividendAccountId);
        } else if (activeSubTab === 'calendar' || activeSubTab === 'list') {
            UI.renderDividendCalendar(filteredDivs, this.currentCalendarDate, this.currentDividendAccountId);
        }
    },

    async loadDividendDatabase() {
        const container = document.getElementById('dividend-database-content');
        const countEl   = document.getElementById('divDbCount');
        const searchEl  = document.getElementById('divDbSearch');
        const badgeEl   = document.getElementById('eodhdQuotaBadge');
        if (!container) return;

        try {
            const { rows, eodhd } = await API.getDividendMetadata();

            if (countEl) countEl.textContent = `${rows.length} symbol${rows.length !== 1 ? 's' : ''}`;

            if (badgeEl) {
                badgeEl.style.display = 'none';
            }

            const freqLabel = f => ({ 1: 'Annual', 2: 'Semi-annual', 4: 'Quarterly', 6: 'Bi-monthly', 12: 'Monthly', 24: 'Semi-monthly', 26: 'Bi-weekly', 52: 'Weekly' }[f] || f || '—');
            const providerBadgeColor = p => ({ snowball: '#4caf50', yahoo: '#7e57c2', tiingo: '#42a5f5', eodhd: '#26a69a', polygon: '#ff7043', alphavantage: '#66bb6a', finnhub: '#ffa726', manual: '#555', ai: '#9c27b0' }[p] || '#888');

            const render = (filter) => {
                const filtered = filter
                    ? rows.filter(r => r.symbol.toLowerCase().includes(filter) || (r.name || '').toLowerCase().includes(filter))
                    : rows;

                if (filtered.length === 0) {
                    container.innerHTML = '<div class="empty-state"><p>No cached dividend data found. Run a dividend fetch from Background Jobs.</p></div>';
                    return;
                }

                container.innerHTML = `
                <div style="overflow-x:auto;">
                <table class="data-table" style="width:100%;font-size:0.85rem;">
                  <thead><tr>
                    <th>Symbol</th><th>Name</th><th>Provider</th>
                    <th style="text-align:right;">Amount/Share</th>
                    <th>Frequency</th><th>Last Ex-Date</th><th>Cached</th>
                    <th></th>
                  </tr></thead>
                  <tbody>
                  ${filtered.map(r => `
                    <tr data-symbol="${sanitize(r.symbol)}">
                      <td style="font-weight:600;font-family:monospace;">${sanitize(r.symbol)}</td>
                      <td style="color:var(--text-secondary);max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${sanitize(r.name || '')}">${sanitize(r.name || '—')}</td>
                      <td><span style="font-size:0.72rem;padding:0.15rem 0.5rem;border-radius:4px;background:${providerBadgeColor(r.provider)};color:#fff;font-weight:600;">${sanitize(r.provider || '?')}</span></td>
                      <td style="text-align:right;font-variant-numeric:tabular-nums;">$${r.amountPerShare != null ? Number(r.amountPerShare).toFixed(4) : '—'}</td>
                      <td>${freqLabel(r.frequency)}</td>
                      <td style="font-family:monospace;font-size:0.8rem;">${sanitize(r.lastExDate || '—')}</td>
                      <td style="color:var(--text-secondary);font-size:0.78rem;">${r.cachedAt ? new Date(r.cachedAt).toLocaleDateString() : '—'}</td>
                      <td style="white-space:nowrap;">
                        <button class="btn btn-outline btn-sm" style="font-size:0.72rem;padding:0.15rem 0.5rem;" onclick="App.divRowRefetchAI('${sanitize(r.symbol)}')" title="Re-fetch from Snowball">Fetch</button>
                        <button class="btn btn-outline btn-sm" style="font-size:0.72rem;padding:0.15rem 0.5rem;color:var(--danger);border-color:var(--danger);" onclick="App.divRowDelete('${sanitize(r.symbol)}')" title="Delete entry">✕</button>
                      </td>
                    </tr>`).join('')}
                  </tbody>
                </table></div>`;
            };

            render('');
            if (searchEl) {
                searchEl.oninput = () => render(searchEl.value.trim().toLowerCase());
            }
        } catch (err) {
            container.innerHTML = `<div class="empty-state" style="color:var(--danger)">Error: ${sanitize(err.message)}</div>`;
        }
    },

    // ── Dividend lookup panel ─────────────────────────────────────────────────

    _divLookupSymbol: null,

    divLookupSetStatus(msg, isError = false) {
        const el = document.getElementById('divLookupStatus');
        if (el) { el.textContent = msg; el.style.color = isError ? 'var(--danger)' : 'var(--text-secondary)'; }
    },

    divLookupPopulate(data) {
        const freqMap = { 52: '52', 26: '26', 24: '24', 12: '12', 6: '6', 4: '4', 2: '2', 1: '1' };
        document.getElementById('divLookupName').value = data.name || '';
        const freqSel = document.getElementById('divLookupFreq');
        if (freqSel) freqSel.value = freqMap[data.frequency] || String(data.frequency) || '4';
        document.getElementById('divLookupAmount').value = data.amountPerShare != null ? data.amountPerShare : '';
        document.getElementById('divLookupExDate').value = data.lastExDate || '';
        document.getElementById('divLookupResult').style.display = 'block';
    },

    divLookupClear() {
        this._divLookupSymbol = null;
        document.getElementById('divLookupSymbol').value = '';
        document.getElementById('divLookupResult').style.display = 'none';
        this.divLookupSetStatus('');
    },

    async divLookupFetchAI() {
        const symbolInput = document.getElementById('divLookupSymbol');
        const symbol = symbolInput?.value.trim().toUpperCase();
        if (!symbol) { this.divLookupSetStatus('Enter a ticker symbol first.', true); return; }

        const btn = document.getElementById('divLookupFetchBtn');
        if (btn) btn.disabled = true;
        this.divLookupSetStatus('Querying Snowball Analytics…');
        document.getElementById('divLookupResult').style.display = 'none';

        try {
            const data = await API.snowballFetchDividendMetadata(symbol);
            this._divLookupSymbol = symbol;
            this.divLookupPopulate(data);
            this.divLookupSetStatus(`Snowball result for ${symbol} — review and save below.`);
        } catch (err) {
            this.divLookupSetStatus(err.message, true);
        } finally {
            if (btn) btn.disabled = false;
        }
    },

    async divLookupSave() {
        const symbol = this._divLookupSymbol;
        if (!symbol) { UI.showToast('No symbol loaded — fetch first.', 'error'); return; }

        const payload = {
            frequency: parseInt(document.getElementById('divLookupFreq').value, 10),
            amountPerShare: parseFloat(document.getElementById('divLookupAmount').value) || 0,
            lastExDate: document.getElementById('divLookupExDate').value || null,
            name: document.getElementById('divLookupName').value.trim() || symbol,
        };

        try {
            await API.saveDividendMetadata(symbol, payload);
            UI.showToast(`${symbol} saved to dividend database.`);
            this.divLookupClear();
            this.loadDividendDatabase();
        } catch (err) {
            UI.showToast(err.message, 'error');
        }
    },

    async divRowRefetchAI(symbol) {
        const symbolInput = document.getElementById('divLookupSymbol');
        if (symbolInput) symbolInput.value = symbol;
        this._divLookupSymbol = symbol;
        await this.divLookupFetchAI();
        document.getElementById('divLookupPanel')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    },

    async divRowDelete(symbol) {
        if (!confirm(`Delete cached dividend data for ${symbol}?`)) return;
        try {
            await API.deleteDividendMetadata(symbol);
            UI.showToast(`${symbol} removed from dividend database.`);
            this.loadDividendDatabase();
        } catch (err) {
            UI.showToast(err.message, 'error');
        }
    },

    // ── Global User Portfolio Filter helpers ──────────────────────────────────
    async fetchUserPortfolios() {
        try {
            this.userPortfolios = await API.getUserPortfolios();
        } catch (err) {
            console.error('Failed to fetch user portfolios:', err);
        }
    },

    getUserPortfolioNamesForAccount(accountId) {
        if (!this.userPortfolios || this.userPortfolios.length === 0) return 'Unassigned';
        const matched = this.userPortfolios
            .filter(p => (p.accountIds || []).includes(accountId))
            .map(p => p.name);
        return matched.length > 0 ? matched.join(', ') : 'Unassigned';
    },

    renderGlobalPortfolioSelect() {
        const select = document.getElementById('globalPortfolioSelect');
        if (!select) return;

        // Seed from localStorage on first call — setter keeps it in sync thereafter
        const savedSelect = localStorage.getItem('selectedUserPortfolioId') || 'all';
        // Use the private backing field to avoid double-writing to localStorage during init
        this._selectedUserPortfolioId = savedSelect === 'all' ? 'all' : parseInt(savedSelect, 10);

        // Validate that the saved ID still exists; silently fall back to 'all' if not
        if (this._selectedUserPortfolioId !== 'all') {
            const exists = (this.userPortfolios || []).some(p => p.id === this._selectedUserPortfolioId);
            if (!exists) {
                this.selectedUserPortfolioId = 'all'; // setter writes to localStorage
            }
        }

        let html = '<option value="all">All Portfolios</option>';
        if (this.userPortfolios && this.userPortfolios.length > 0) {
            this.userPortfolios.forEach(p => {
                const isSelected = this.selectedUserPortfolioId === p.id;
                html += `<option value="${p.id}" ${isSelected ? 'selected' : ''}>${sanitize(p.name)}</option>`;
            });
        }
        select.innerHTML = html;
        select.value = this.selectedUserPortfolioId;

        select.onchange = (e) => {
            const val = e.target.value;
            this.selectedUserPortfolioId = val === 'all' ? 'all' : parseInt(val, 10); // setter syncs localStorage

            // Reset page-level active tabs/sub-selections when global portfolio changes
            this.currentDividendAccountId = 'all';
            this.activeHoldingsTabId = null;
            this.activeTransactionsTabId = null;

            this.refreshActiveTab();
        };
    },

    refreshActiveTab() {
        const activeTab = localStorage.getItem('activeMainTab') || 'dashboard';
        if (activeTab === 'dashboard') {
            this.loadDashboard();
        } else if (activeTab === 'holdings') {
            UI.renderAllHoldings(this.getFilteredHoldingsData());
        } else if (activeTab === 'transactions') {
            UI.renderAllTransactions(this.getFilteredTransactionsData());
        } else if (activeTab === 'rebalance') {
            this.loadRebalanceTab();
        } else if (activeTab === 'dividend-tracker') {
            const subTab = localStorage.getItem('activeDividendSubTab') || 'forecast';
            const filteredDivs = this.getFilteredDividendsData();
            
            this.resolveDividendAccountId();
            if (this.currentDividendAccountId === 'none') {
                const containerId = subTab === 'forecast' ? 'dividends-page-content' : 'dividend-calendar-grid';
                const container = document.getElementById(containerId);
                if (container) {
                    container.innerHTML = `<div class="empty-state">
                        <div class="empty-icon">📂</div>
                        <p><strong>No custom portfolios found.</strong></p>
                        <p style="margin-top:0.5rem;color:var(--text-secondary);">Go to <a href="#" onclick="App.switchMainTab('settings');App.switchSettingsTab('portfolios');return false;" style="color:var(--primary);text-decoration:underline;">Settings → Portfolios</a> to create a custom portfolio first.</p>
                    </div>`;
                }
                if (subTab === 'forecast') {
                    const summaryRow = document.getElementById('dividendSummaryRow');
                    if (summaryRow) summaryRow.style.display = 'none';
                } else {
                    const listEl = document.getElementById('dividend-calendar-list');
                    if (listEl) listEl.innerHTML = '';
                }
                UI.renderDividendAccountTabs([], 'none');
            } else {
                if (subTab === 'forecast') {
                    UI.renderDividends(filteredDivs, this.currentDividendAccountId);
                } else if (subTab === 'calendar' || subTab === 'list') {
                    UI.renderDividendCalendar(filteredDivs, this.currentCalendarDate, this.currentDividendAccountId);
                }
            }
        }
    },

    getSelectedUserPortfolio() {
        if (this.selectedUserPortfolioId === 'all') return null;
        return (this.userPortfolios || []).find(p => p.id === this.selectedUserPortfolioId) || null;
    },

    getFilterAccountIds() {
        if (this.selectedUserPortfolioId === 'all') {
            if (!this.userPortfolios || this.userPortfolios.length === 0) {
                return null;
            }
            const ids = new Set();
            this.userPortfolios.forEach(p => {
                (p.accountIds || []).forEach(id => ids.add(id));
            });
            return ids;
        } else {
            const portfolio = this.getSelectedUserPortfolio();
            if (!portfolio) return new Set();
            return new Set(portfolio.accountIds || []);
        }
    },

    getFilteredGroups() {
        if (!this.currentGroups) return [];
        const accountIds = this.getFilterAccountIds();
        if (accountIds === null) return this.currentGroups;
        
        return this.currentGroups.map(g => {
            const filteredAccounts = (g.accounts || []).filter(a => accountIds.has(a.id));
            return { ...g, accounts: filteredAccounts };
        }).filter(g => g.accounts.length > 0);
    },

    getFilteredHoldingsData() {
        if (!this.cachedHoldingsData) return null;
        const accountIds = this.getFilterAccountIds();
        if (accountIds === null) return this.cachedHoldingsData;
        
        return this.cachedHoldingsData.filter(h => accountIds.has(h.accountId));
    },

    getFilteredDividendsData() {
        if (!this.cachedDividendsData) return null;
        const accountIds = this.getFilterAccountIds();
        if (accountIds === null) return this.cachedDividendsData;
        
        return this.cachedDividendsData.filter(d => accountIds.has(d.accountId));
    },

    getFilteredTransactionsData() {
        if (!this.cachedTransactionsData) return null;
        const accountIds = this.getFilterAccountIds();
        if (accountIds === null) return this.cachedTransactionsData;
        
        return this.cachedTransactionsData.filter(t => accountIds.has(t.accountId));
    },

    resolveDividendAccountId() {
        if (this.selectedUserPortfolioId === 'all') {
            const portfolios = this.userPortfolios || [];
            if (portfolios.length > 0) {
                const isUserPort = String(this.currentDividendAccountId).startsWith('portfolio-');
                const portId = isUserPort ? parseInt(String(this.currentDividendAccountId).split('-')[1], 10) : null;
                const exists = portId !== null && portfolios.some(p => p.id === portId);
                
                if (!exists) {
                    this.currentDividendAccountId = `portfolio-${portfolios[0].id}`;
                }
            } else {
                this.currentDividendAccountId = 'none';
            }
        } else {
            const portfolio = this.getSelectedUserPortfolio();
            const accountIds = new Set(portfolio ? (portfolio.accountIds || []) : []);
            if (this.currentDividendAccountId !== 'all' && !accountIds.has(this.currentDividendAccountId)) {
                this.currentDividendAccountId = 'all';
            }
        }
        return this.currentDividendAccountId;
    },

    // ── User Portfolio Management ─────────────────────────────────────────────
    userPortfolios: [],

    async loadUserPortfolios() {
        const list = document.getElementById('userPortfolioList');
        if (!list) return;
        list.innerHTML = '<div class="empty-state"><p>Loading…</p></div>';
        try {
            const [portfolios, accountGroups] = await Promise.all([
                API.getUserPortfolios(),
                API.getAccounts().catch(() => [])
            ]);
            this.userPortfolios = portfolios;

            // Build flat account map: id → displayName
            const accountMap = {};
            (accountGroups || []).forEach(g => {
                (g.accounts || []).forEach(a => {
                    accountMap[a.id] = a.customName || a.name || a.id;
                });
            });

            UI.renderUserPortfolios(portfolios, accountMap);
        } catch (err) {
            list.innerHTML = `<div class="empty-state" style="color:var(--danger)">Error: ${sanitize(err.message)}</div>`;
        }
    },

    async openUserPortfolioModal(id = null) {
        // Prefer in-memory currentGroups (kept up-to-date after renames/toggles)
        // so custom account names are always reflected without an extra round-trip.
        let accounts = (this.currentGroups && this.currentGroups.length > 0)
            ? this.currentGroups
            : [];
        if (accounts.length === 0) {
            try { accounts = await API.getAccounts(); } catch (e) { /* ignore */ }
        }

        const portfolio = id != null ? this.userPortfolios.find(p => p.id === id) : null;
        UI.openUserPortfolioModal(portfolio, accounts);
    },

    async handleUserPortfolioSubmit(e) {
        e.preventDefault();
        const saveBtn = document.getElementById('saveUserPortBtn');
        const errEl   = document.getElementById('upErrorMsg');

        const showErr = (msg) => {
            if (errEl) { errEl.textContent = msg; errEl.style.display = 'block'; }
            console.error('[UserPortfolio] Save error:', msg);
        };

        if (errEl) errEl.style.display = 'none';
        saveBtn.classList.add('loading');
        saveBtn.disabled = true;

        const id = document.getElementById('upId').value;
        const name = document.getElementById('upName').value.trim();
        const description = document.getElementById('upDescription').value.trim() || null;
        const color = document.getElementById('upColor').value || '#7c3aed';

        // Collect selected account IDs
        const accountIds = Array.from(
            document.querySelectorAll('#upAccountCheckboxes input[type="checkbox"]:checked')
        ).map(cb => cb.value);

        try {
            let portfolio;
            if (id) {
                portfolio = await API.updateUserPortfolio(parseInt(id), { name, description, color });
            } else {
                portfolio = await API.createUserPortfolio({ name, description, color });
            }
            await API.setUserPortfolioAccounts(portfolio.id, accountIds);
            UI.closeUserPortfolioModal();
            await this.loadUserPortfolios();
            this.renderGlobalPortfolioSelect();
            UI.showToast(id ? 'Portfolio updated' : 'Portfolio created');
        } catch (err) {
            showErr(err.message || 'Something went wrong. Check browser console.');
        } finally {
            saveBtn.classList.remove('loading');
            saveBtn.disabled = false;
        }
    },

    async deleteUserPortfolio(id) {
        if (!confirm('Delete this portfolio? The brokerage accounts will not be affected.')) return;
        try {
            await API.deleteUserPortfolio(id);
            await this.loadUserPortfolios();
            this.renderGlobalPortfolioSelect();
            UI.showToast('Portfolio deleted');
        } catch (err) {
            UI.showToast('Delete failed: ' + err.message, 'error');
        }
    },

    async loadRebalanceTab(forceRefresh = false) {
        const portfolioId = this.selectedUserPortfolioId;
        const unselectedEl = document.getElementById('rebalance-unselected-state');
        const selectedEl = document.getElementById('rebalance-selected-state');
        
        if (portfolioId === 'all') {
            if (unselectedEl) unselectedEl.style.display = 'block';
            if (selectedEl) selectedEl.style.display = 'none';
            return;
        }
        
        if (unselectedEl) unselectedEl.style.display = 'none';
        if (selectedEl) selectedEl.style.display = 'block';
        
        const refreshBtn = document.getElementById('refreshRebalanceBtn');
        if (refreshBtn && forceRefresh) refreshBtn.classList.add('loading');
        
        try {
            // 1. Load targets for the current portfolio
            const targets = await API.getPortfolioTargets(portfolioId);
            UI.renderRebalanceTargets(targets);
            
            // 2. Fetch rebalancing suggestions for the selected mode
            const mode = document.getElementById('rebalanceModeSelect')?.value || 'buy_only';
            const suggestions = await API.getRebalanceSuggestions(portfolioId, mode);
            UI.renderRebalanceSuggestions(suggestions);
            
            const timestampEl = document.getElementById('rebalance-last-updated');
            if (timestampEl) {
                timestampEl.textContent = `Last updated: ${new Date().toLocaleTimeString()}`;
            }
        } catch (err) {
            UI.showToast('Failed to load rebalancing data: ' + err.message, 'error');
        } finally {
            if (refreshBtn) refreshBtn.classList.remove('loading');
        }
    },

    handleRebalanceModeChange() {
        this.loadRebalanceTab(false);
    },

    addTargetRow() {
        UI.addTargetRow();
    },

    async handleSaveTargets(e) {
        e.preventDefault();
        const portfolioId = this.selectedUserPortfolioId;
        if (portfolioId === 'all') return;
        
        const rows = document.querySelectorAll('.target-allocation-row');
        const targets = [];
        let totalPct = 0;
        
        for (const row of rows) {
            const symbolInput = row.querySelector('.target-symbol-input');
            const pctInput = row.querySelector('.target-pct-input');
            
            const symbol = symbolInput.value.trim().toUpperCase();
            const pct = parseFloat(pctInput.value) / 100;
            
            if (!symbol) continue;
            
            if (isNaN(pct) || pct < 0 || pct > 1) {
                UI.showToast(`Invalid percentage for ${symbol}`, 'error');
                return;
            }
            
            targets.push({ symbol, targetPct: pct });
            totalPct += pct;
        }
        
        // Validation: sum must be exactly 1.0 (100%)
        if (targets.length > 0 && Math.abs(totalPct - 1.0) > 0.0001) {
            UI.showToast(`Allocations must sum to exactly 100% (currently ${(totalPct * 100).toFixed(1)}%)`, 'error');
            return;
        }
        
        const btn = document.getElementById('saveTargetsBtn');
        if (btn) { btn.classList.add('loading'); btn.disabled = true; }
        
        try {
            await API.setPortfolioTargets(portfolioId, targets);
            UI.showToast('Target allocations saved successfully');
            this.loadRebalanceTab(false);
        } catch (err) {
            UI.showToast(err.message, 'error');
        } finally {
            if (btn) { btn.classList.remove('loading'); btn.disabled = false; }
        }
    },

    async executeBulkRebalance(accountId) {
        const container = document.getElementById(`suggestions-trades-${accountId}`);
        if (!container) return;
        
        const cbs = container.querySelectorAll('.trade-select-cb:checked');
        if (cbs.length === 0) {
            UI.showToast('No trades selected for execution', 'error');
            return;
        }
        
        if (!confirm(`Are you sure you want to place ${cbs.length} order(s) for this account?`)) {
            return;
        }
        
        const trades = [];
        cbs.forEach(cb => {
            const symbol = cb.dataset.symbol;
            const action = cb.dataset.action;
            const amount = parseFloat(cb.dataset.amount);
            trades.push({ accountId, symbol, action, amount });
        });
        
        const btn = document.getElementById(`btn-execute-${accountId}`);
        if (btn) { btn.classList.add('loading'); btn.disabled = true; }
        
        try {
            const portfolioId = this.selectedUserPortfolioId;
            const res = await API.executeRebalance(portfolioId, trades);
            
            let successCount = 0;
            let failureMsg = '';
            
            res.results.forEach(r => {
                if (r.success) {
                    successCount++;
                } else {
                    failureMsg += `\n- ${r.trade.symbol} (${r.trade.action}): ${r.error}`;
                }
            });
            
            if (successCount === res.results.length) {
                UI.showToast(`Successfully placed all ${successCount} order(s)!`);
            } else {
                UI.showToast(`Placed ${successCount} order(s); ${res.results.length - successCount} failed.`, 'error');
                alert(`Rebalance order execution summary:${failureMsg}`);
            }
            
            // Reload suggestions to reflect new status/positions
            this.loadRebalanceTab(false);
        } catch (err) {
            UI.showToast('Execution failed: ' + err.message, 'error');
        } finally {
            if (btn) { btn.classList.remove('loading'); btn.disabled = false; }
        }
    },

    initTheme() {
        const savedTheme = localStorage.getItem('theme') || 'dark';
        this.applyTheme(savedTheme);
    },

    applyTheme(theme) {
        const icon = document.getElementById('themeToggleIcon');
        if (theme === 'light') {
            document.documentElement.classList.add('light-theme');
            if (icon) {
                icon.innerHTML = `
                    <circle cx="12" cy="12" r="5"></circle>
                    <line x1="12" y1="1" x2="12" y2="3"></line>
                    <line x1="12" y1="21" x2="12" y2="23"></line>
                    <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line>
                    <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line>
                    <line x1="1" y1="12" x2="3" y2="12"></line>
                    <line x1="21" y1="12" x2="23" y2="12"></line>
                    <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line>
                    <line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line>
                `;
            }
        } else {
            document.documentElement.classList.remove('light-theme');
            if (icon) {
                icon.innerHTML = `<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path>`;
            }
        }
        localStorage.setItem('theme', theme);
    },

    toggleTheme() {
        const currentTheme = document.documentElement.classList.contains('light-theme') ? 'light' : 'dark';
        const newTheme = currentTheme === 'light' ? 'dark' : 'light';
        this.applyTheme(newTheme);
        this.refreshActiveTab();
    },

};

// Initialize app
document.addEventListener('DOMContentLoaded', () => App.init());
