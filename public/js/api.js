const API = {
    _token() {
        return localStorage.getItem('cf_token') || '';
    },

    _headers(extra = {}) {
        return { 'Content-Type': 'application/json', Authorization: `Bearer ${this._token()}`, ...extra };
    },

    async _fetch(url, options = {}) {
        const res = await fetch(url, {
            ...options,
            headers: { ...this._headers(), ...(options.headers || {}) }
        });
        if (res.status === 401) {
            localStorage.removeItem('cf_token');
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

    async getPortfolioHistory(benchmark = 'SPY') {
        const res = await this._fetch(`/api/analytics/portfolio-history?benchmark=${encodeURIComponent(benchmark)}`);
        const data = await this._json(res);
        if (!res.ok) throw new Error(data.error || 'Failed to load portfolio history');
        return data;
    },

    async getDiversification() {
        const res = await this._fetch('/api/analytics/diversification');
        const data = await this._json(res);
        if (!res.ok) throw new Error(data.error || 'Failed to load diversification');
        return data;
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
        if (!res.ok) throw new Error(data.error || 'Failed to execute rebalance trades');
        return data;
    },

};
