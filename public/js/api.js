const API = {
    // Auth now rides on the httpOnly, same-site session cookie (set at login).
    // Nothing is stored in localStorage, so a successful XSS can't exfiltrate a
    // reusable token. Non-browser clients (Android) keep using Bearer tokens.
    _headers(extra = {}) {
        return { 'Content-Type': 'application/json', ...extra };
    },

    async _fetch(url, options = {}) {
        const res = await fetch(url, {
            ...options,
            headers: { ...this._headers(), ...(options.headers || {}) }
        });
        if (res.status === 401) {
            window.location.href = '/login.html';
            throw new Error('Session expired. Redirecting to login.');
        }
        return res;
    },

    async _json(res) {
        const contentType = res.headers.get('content-type');
        if (contentType && contentType.includes('application/json')) {
            try {
                return await res.json();
            } catch (err) {
                // fall through
            }
        }
        const text = await res.text();
        return { error: text || res.statusText || `Request failed with status ${res.status}` };
    },

    async getPortfolios() {
        const res = await this._fetch('/api/portfolios');
        const data = await this._json(res);
        if (!res.ok) throw new Error(data.error || 'Failed to load portfolios');
        return data;
    },

    async savePortfolio(data) {
        const res = await this._fetch('/api/portfolios', {
            method: 'POST',
            body: JSON.stringify(data)
        });
        const json = await this._json(res);
        if (!res.ok) throw new Error(json.error || 'Save failed');
        return json;
    },

    async setPortfolioTrading(id, tradingEnabled) {
        const res = await this._fetch(`/api/portfolios/${id}/trading`, {
            method: 'PATCH',
            body: JSON.stringify({ tradingEnabled })
        });
        const data = await this._json(res);
        if (!res.ok) throw new Error(data.error || 'Failed to update trading setting');
        return data;
    },

    async deletePortfolio(id) {
        const res = await this._fetch(`/api/portfolios/${id}`, { method: 'DELETE' });
        const data = await this._json(res);
        if (!res.ok) throw new Error(data.error || 'Delete failed');
        return true;
    },

    async registerPortfolio(id) {
        const res = await this._fetch('/api/register', {
            method: 'POST',
            body: JSON.stringify({ portfolioId: id })
        });
        const data = await this._json(res);
        if (!res.ok) throw new Error(data.error || 'Registration failed');
        return data;
    },

    async getLoginUrl(id) {
        const res = await this._fetch('/api/login', {
            method: 'POST',
            body: JSON.stringify({ portfolioId: id })
        });
        const data = await this._json(res);
        if (!res.ok) throw new Error(data.error || 'Failed to get link');
        return data.loginUrl;
    },

    async getTradeLoginUrl(id) {
        const redirectUrl = window.location.origin + window.location.pathname + '#settings';
        const res = await this._fetch('/api/login/trade', {
            method: 'POST',
            body: JSON.stringify({ portfolioId: id, redirectUrl })
        });
        const data = await this._json(res);
        if (!res.ok) throw new Error(data.error || 'Failed to get trade link');
        return data.loginUrl;
    },

    async getConnectionStatus(portfolioId) {
        const res = await this._fetch(`/api/connection-status/${portfolioId}`);
        const data = await this._json(res);
        if (!res.ok) throw new Error(data.error || 'Failed to get connection status');
        return data;
    },

    async getAccounts(forceRefresh = false) {
        const url = `/api/accounts${forceRefresh ? '?forceRefresh=true' : ''}`;
        const res = await this._fetch(url);
        const data = await this._json(res);
        if (!res.ok) throw new Error(data.error || 'Failed to load accounts');
        return data;
    },

    async getHoldings(portfolioId, accountId, forceRefresh = false) {
        const url = `/api/holdings/${portfolioId}/${accountId}${forceRefresh ? '?forceRefresh=true' : ''}`;
        const res = await this._fetch(url);
        const data = await this._json(res);
        if (!res.ok) throw new Error(data.error || 'Failed to fetch holdings');
        return data;
    },

    async getDividendForecast(portfolioId, accountId, forceRefresh = false) {
        const url = `/api/dividends/forecast/${portfolioId}/${accountId}${forceRefresh ? '?forceRefresh=true' : ''}`;
        const res = await this._fetch(url);
        const data = await this._json(res);
        if (!res.ok) throw new Error(data.error || 'Failed to fetch dividend forecast');
        return data;
    },

    async getAllDividends(forceRefresh = false) {
        const url = `/api/portfolios/all-dividends${forceRefresh ? '?forceRefresh=true' : ''}`;
        const res = await this._fetch(url);
        const data = await this._json(res);
        if (!res.ok) throw new Error(data.error || 'Failed to fetch all dividends');
        // Returns { fetching: bool, data: [] }
        return data;
    },

    async getDividendMetadata() {
        const res = await this._fetch('/api/portfolios/dividend-metadata');
        const data = await this._json(res);
        if (!res.ok) throw new Error(data.error || 'Failed to fetch dividend metadata');
        return data;
    },

    async clearDividendCache() {
        const res = await this._fetch('/api/portfolios/clear-dividend-cache', { method: 'POST' });
        const data = await this._json(res);
        if (!res.ok) throw new Error(data.error || 'Failed to clear dividend cache');
        return data;
    },

    async snowballFetchDividendMetadata(symbol) {
        const res = await this._fetch(`/api/portfolios/dividend-metadata/${encodeURIComponent(symbol)}/snowball-fetch`, { method: 'POST' });
        const data = await this._json(res);
        if (!res.ok) throw new Error(data.error || `Snowball lookup failed for ${symbol}`);
        return data;
    },

    async saveDividendMetadata(symbol, payload) {
        const res = await this._fetch(`/api/portfolios/dividend-metadata/${encodeURIComponent(symbol)}`, {
            method: 'PUT',
            body: JSON.stringify(payload),
        });
        const data = await this._json(res);
        if (!res.ok) throw new Error(data.error || 'Failed to save dividend metadata');
        return data;
    },

    async deleteDividendMetadata(symbol) {
        const res = await this._fetch(`/api/portfolios/dividend-metadata/${encodeURIComponent(symbol)}`, { method: 'DELETE' });
        const data = await this._json(res);
        if (!res.ok) throw new Error(data.error || `Failed to delete ${symbol}`);
        return data;
    },

    async getStockDetail(symbol) {
        const res = await this._fetch(`/api/stock/${encodeURIComponent(symbol)}`);
        const data = await this._json(res);
        if (!res.ok) throw new Error(data.error || `Failed to load detail for ${symbol}`);
        return data;
    },

    async getStockPriceHistory(symbol, range = 'max') {
        const res = await this._fetch(`/api/stock/${encodeURIComponent(symbol)}/history?range=${encodeURIComponent(range)}`);
        const data = await this._json(res);
        if (!res.ok) throw new Error(data.error || `Failed to load price history for ${symbol}`);
        return data;
    },

    async getPortfolioHistory(benchmark = 'SPY', accountIds = null) {
        let url = `/api/analytics/portfolio-history?benchmark=${encodeURIComponent(benchmark)}`;
        if (accountIds && accountIds.length > 0) url += `&accountIds=${encodeURIComponent(accountIds.join(','))}`;
        const res = await this._fetch(url);
        const data = await this._json(res);
        if (!res.ok) throw new Error(data.error || 'Failed to load portfolio history');
        return data;
    },

    async getRisk(benchmark = 'SPY', accountIds = null) {
        let url = `/api/analytics/risk?benchmark=${encodeURIComponent(benchmark)}`;
        if (accountIds && accountIds.length > 0) url += `&accountIds=${encodeURIComponent(accountIds.join(','))}`;
        const res = await this._fetch(url);
        const data = await this._json(res);
        if (!res.ok) throw new Error(data.error || 'Failed to load risk metrics');
        return data;
    },

    async getAttribution(accountIds = null) {
        let url = '/api/analytics/attribution';
        if (accountIds && accountIds.length > 0) url += `?accountIds=${encodeURIComponent(accountIds.join(','))}`;
        const res = await this._fetch(url);
        const data = await this._json(res);
        if (!res.ok) throw new Error(data.error || 'Failed to load attribution');
        return data;
    },

    async getRealizedGains(accountIds = null) {
        let url = '/api/analytics/realized-gains';
        if (accountIds && accountIds.length > 0) url += `?accountIds=${encodeURIComponent(accountIds.join(','))}`;
        const res = await this._fetch(url);
        const data = await this._json(res);
        if (!res.ok) throw new Error(data.error || 'Failed to load realized gains');
        return data;
    },

    async getT5008(year = null, accountIds = null) {
        const params = new URLSearchParams();
        if (year) params.set('year', year);
        if (accountIds && accountIds.length > 0) params.set('accountIds', accountIds.join(','));
        const qs = params.toString();
        const res = await this._fetch('/api/analytics/t5008' + (qs ? `?${qs}` : ''));
        const data = await this._json(res);
        if (!res.ok) throw new Error(data.error || 'Failed to load T5008 report');
        return data;
    },

    /**
     * Download the T5008 CSV. Auth rides on the httpOnly cookie, so a plain
     * <a href> would work, but we fetch it as a blob to control the filename.
     */
    async downloadT5008Csv(year = null, accountIds = null) {
        const params = new URLSearchParams();
        if (year) params.set('year', year);
        if (accountIds && accountIds.length > 0) params.set('accountIds', accountIds.join(','));
        const qs = params.toString();
        const res = await this._fetch('/api/analytics/t5008.csv' + (qs ? `?${qs}` : ''));
        if (!res.ok) throw new Error((await this._json(res)).error || 'Failed to export CSV');

        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `t5008-${year || 'all-years'}.csv`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
    },

    async getTax(accountIds = null) {
        let url = '/api/analytics/tax';
        if (accountIds && accountIds.length > 0) url += `?accountIds=${encodeURIComponent(accountIds.join(','))}`;
        const res = await this._fetch(url);
        const data = await this._json(res);
        if (!res.ok) throw new Error(data.error || 'Failed to load tax estimate');
        return data;
    },

    async getDiversification(accountIds = null) {
        let url = '/api/analytics/diversification';
        if (accountIds && accountIds.length > 0) url += `?accountIds=${encodeURIComponent(accountIds.join(','))}`;
        const res = await this._fetch(url);
        const data = await this._json(res);
        if (!res.ok) throw new Error(data.error || 'Failed to load diversification');
        return data;
    },

    async getStockRatings() {
        const res = await this._fetch('/api/analytics/stock-ratings');
        if (!res.ok) return [];
        return await this._json(res);
    },

    async getJobs() {
        const res = await this._fetch('/api/jobs');
        const data = await this._json(res);
        if (!res.ok) throw new Error(data.error || 'Failed to fetch jobs');
        return data;
    },

    async getJobHistory() {
        const res = await this._fetch('/api/jobs/history');
        const data = await this._json(res);
        if (!res.ok) throw new Error(data.error || 'Failed to fetch job history');
        return data;
    },

    async triggerJob(name) {
        const res = await this._fetch(`/api/jobs/${encodeURIComponent(name)}/trigger`, { method: 'POST' });
        const data = await this._json(res);
        if (!res.ok) throw new Error(data.error || `Failed to trigger job ${name}`);
        return data;
    },

    async updateJobSchedule(name, intervalHours) {
        const res = await this._fetch(`/api/jobs/${encodeURIComponent(name)}/schedule`, {
            method: 'PATCH',
            body: JSON.stringify({ intervalHours })
        });
        const data = await this._json(res);
        if (!res.ok) throw new Error(data.error || `Failed to update schedule for ${name}`);
        return data;
    },

    async getAdminUsers() {
        const res = await this._fetch('/api/admin/users');
        const data = await this._json(res);
        if (!res.ok) throw new Error(data.error || 'Failed to list users');
        return data;
    },

    async deleteAdminUser(uid) {
        const res = await this._fetch(`/api/admin/users/${uid}`, { method: 'DELETE' });
        const data = await this._json(res);
        if (!res.ok) throw new Error(data.error || 'Delete failed');
        return true;
    },

    async wipeAdminUsers(confirm) {
        const res = await this._fetch('/api/admin/wipe', {
            method: 'POST',
            body: JSON.stringify({ confirm })
        });
        const data = await this._json(res);
        if (!res.ok) throw new Error(data.error || 'Wipe failed');
        return data;
    },

    async purgeAdminData(confirm) {
        const res = await this._fetch('/api/admin/purge-data', {
            method: 'POST',
            body: JSON.stringify({ confirm })
        });
        const data = await this._json(res);
        if (!res.ok) throw new Error(data.error || 'Purge failed');
        return data;
    },

    async getSettings() {
        const res = await this._fetch('/api/admin/settings');
        const data = await this._json(res);
        if (!res.ok) throw new Error(data.error || 'Failed to fetch settings');
        return data;
    },

    async updateSettings(settings) {
        const res = await this._fetch('/api/admin/settings', {
            method: 'POST',
            body: JSON.stringify(settings)
        });
        const data = await this._json(res);
        if (!res.ok) throw new Error(data.error || 'Failed to update settings');
        return data;
    },

    async placeTrade({ portfolioId, accountId, ticker, action, orderType, units, notional_value, price, timeInForce }) {
        const res = await this._fetch('/api/trade', {
            method: 'POST',
            body: JSON.stringify({ portfolioId, accountId, ticker, action, orderType, units, notional_value, price, timeInForce })
        });
        const data = await this._json(res);
        if (!res.ok) throw new Error(data.error || 'Order staging failed');
        return data;
    },

    async confirmTrade(confirmationToken) {
        const res = await this._fetch('/api/trade/confirm', {
            method: 'POST',
            body: JSON.stringify({ confirmationToken })
        });
        const data = await this._json(res);
        if (!res.ok) throw new Error(data.error || 'Order placement failed');
        return data;
    },

    async renameAccount(accountId, name) {
        const res = await this._fetch(`/api/accounts/${encodeURIComponent(accountId)}/name`, {
            method: 'PATCH',
            body: JSON.stringify({ name })
        });
        const data = await this._json(res);
        if (!res.ok) throw new Error(data.error || 'Failed to rename account');
        return data;
    },

    async setAccountActive(accountId, isActive) {
        const res = await this._fetch(`/api/accounts/${encodeURIComponent(accountId)}/active`, {
            method: 'PATCH',
            body: JSON.stringify({ isActive })
        });
        const data = await this._json(res);
        if (!res.ok) throw new Error(data.error || 'Failed to update account status');
        return data;
    },

    async getTransactions(forceRefresh = false) {
        const url = `/api/transactions${forceRefresh ? '?forceRefresh=true' : ''}`;
        const res = await this._fetch(url);
        const data = await this._json(res);
        if (!res.ok) throw new Error(data.error || 'Failed to fetch transactions');
        return data;
    },

    async changePassword(currentPassword, newPassword) {
        const res = await this._fetch('/auth/change-password', {
            method: 'POST',
            body: JSON.stringify({ currentPassword, newPassword })
        });
        const data = await this._json(res);
        if (!res.ok) throw new Error(data.error || 'Failed to change password');
        return data;
    },

    async invalidatePortfolioCache(portfolioId) {
        const res = await this._fetch(`/api/invalidate-cache/${encodeURIComponent(portfolioId)}`, { method: 'POST' });
        const data = await this._json(res);
        if (!res.ok) throw new Error(data.error || 'Cache invalidation failed');
        return data;
    },

    async getUserPortfolios() {
        const res = await this._fetch('/api/user-portfolios');
        const data = await this._json(res);
        if (!res.ok) throw new Error(data.error || 'Failed to load portfolios');
        return data;
    },

    async createUserPortfolio(data) {
        const res = await this._fetch('/api/user-portfolios', {
            method: 'POST',
            body: JSON.stringify(data)
        });
        const dataJson = await this._json(res);
        if (!res.ok) throw new Error(dataJson.error || 'Failed to create portfolio');
        return dataJson;
    },

    async updateUserPortfolio(id, data) {
        const res = await this._fetch(`/api/user-portfolios/${id}`, {
            method: 'PATCH',
            body: JSON.stringify(data)
        });
        const dataJson = await this._json(res);
        if (!res.ok) throw new Error(dataJson.error || 'Failed to update portfolio');
        return dataJson;
    },

    async deleteUserPortfolio(id) {
        const res = await this._fetch(`/api/user-portfolios/${id}`, { method: 'DELETE' });
        const data = await this._json(res);
        if (!res.ok) throw new Error(data.error || 'Failed to delete portfolio');
        return true;
    },

    async setUserPortfolioAccounts(id, accountIds) {
        const res = await this._fetch(`/api/user-portfolios/${id}/accounts`, {
            method: 'PUT',
            body: JSON.stringify({ accountIds })
        });
        const dataJson = await this._json(res);
        if (!res.ok) throw new Error(dataJson.error || 'Failed to update accounts');
        return dataJson;
    },

    async getPortfolioTargets(id) {
        const res = await this._fetch(`/api/user-portfolios/${id}/targets`);
        const data = await this._json(res);
        if (!res.ok) throw new Error(data.error || 'Failed to load targets');
        return data;
    },

    async setPortfolioTargets(id, targets) {
        const res = await this._fetch(`/api/user-portfolios/${id}/targets`, {
            method: 'PUT',
            body: JSON.stringify(targets)
        });
        const data = await this._json(res);
        if (!res.ok) throw new Error(data.error || 'Failed to save targets');
        return data;
    },

    async getRebalanceSuggestions(id, mode = 'buy_only') {
        const res = await this._fetch(`/api/user-portfolios/${id}/rebalance?mode=${mode}`);
        const data = await this._json(res);
        if (!res.ok) throw new Error(data.error || 'Failed to load rebalancing suggestions');
        return data;
    },

    async executeRebalance(id, trades) {
        const res = await this._fetch(`/api/user-portfolios/${id}/rebalance/execute`, {
            method: 'POST',
            body: JSON.stringify({ trades })
        });
        const data = await this._json(res);
        if (!res.ok) throw new Error(data.error || 'Failed to stage rebalance trades');
        return data;
    },

    async confirmRebalance(id, confirmationToken) {
        const res = await this._fetch(`/api/user-portfolios/${id}/rebalance/confirm`, {
            method: 'POST',
            body: JSON.stringify({ confirmationToken })
        });
        const data = await this._json(res);
        if (!res.ok) throw new Error(data.error || 'Failed to execute rebalance trades');
        return data;
    },

    // ── Watchlist / dividend screener ──────────────────────────────────────────
    async getWatchlist() {
        const res = await this._fetch('/api/watchlist');
        const data = await this._json(res);
        if (!res.ok) throw new Error(data.error || 'Failed to load watchlist');
        return data;
    },

    async addWatchlist(symbol, notes) {
        const res = await this._fetch('/api/watchlist', {
            method: 'POST',
            body: JSON.stringify({ symbol, notes })
        });
        const data = await this._json(res);
        if (!res.ok) throw new Error(data.error || 'Failed to add to watchlist');
        return data;
    },

    async removeWatchlist(symbol) {
        const res = await this._fetch(`/api/watchlist/${encodeURIComponent(symbol)}`, { method: 'DELETE' });
        const data = await this._json(res);
        if (!res.ok) throw new Error(data.error || 'Failed to remove from watchlist');
        return true;
    },

    // ── Dividend growth ────────────────────────────────────────────────────────
    async getHeldDividendGrowth() {
        const res = await this._fetch('/api/dividend-growth');
        const data = await this._json(res);
        if (!res.ok) throw new Error(data.error || 'Failed to load dividend growth');
        return data;
    },

    // ── Manual (off-brokerage) assets ──────────────────────────────────────────
    async getManualAssets() {
        const res = await this._fetch('/api/manual-assets');
        const data = await this._json(res);
        if (!res.ok) throw new Error(data.error || 'Failed to load manual assets');
        return data;
    },

    async getManualAssetsSummary() {
        const res = await this._fetch('/api/manual-assets/summary');
        const data = await this._json(res);
        if (!res.ok) throw new Error(data.error || 'Failed to load manual assets summary');
        return data;
    },

    async addManualAsset(asset) {
        const res = await this._fetch('/api/manual-assets', {
            method: 'POST',
            body: JSON.stringify(asset)
        });
        const data = await this._json(res);
        if (!res.ok) throw new Error(data.error || 'Failed to add manual asset');
        return data;
    },

    async updateManualAsset(id, asset) {
        const res = await this._fetch(`/api/manual-assets/${encodeURIComponent(id)}`, {
            method: 'PATCH',
            body: JSON.stringify(asset)
        });
        const data = await this._json(res);
        if (!res.ok) throw new Error(data.error || 'Failed to update manual asset');
        return data;
    },

    async deleteManualAsset(id) {
        const res = await this._fetch(`/api/manual-assets/${encodeURIComponent(id)}`, { method: 'DELETE' });
        const data = await this._json(res);
        if (!res.ok) throw new Error(data.error || 'Failed to delete manual asset');
        return true;
    },

    // ── Notifications ───────────────────────────────────────────────────────────
    async testNotification() {
        const res = await this._fetch('/api/admin/test-notification', { method: 'POST' });
        const data = await this._json(res);
        if (!res.ok) throw new Error(data.error || 'Failed to send test notification');
        return data;
    },

};
