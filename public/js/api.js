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

    async getPortfolios() {
        const res = await this._fetch('/api/portfolios');
        return await res.json();
    },

    async savePortfolio(data) {
        const res = await this._fetch('/api/portfolios', {
            method: 'POST',
            body: JSON.stringify(data)
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || 'Save failed');
        return json;
    },

    async setPortfolioTrading(id, tradingEnabled) {
        const res = await this._fetch(`/api/portfolios/${id}/trading`, {
            method: 'PATCH',
            body: JSON.stringify({ tradingEnabled })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to update trading setting');
        return data;
    },

    async deletePortfolio(id) {
        const res = await this._fetch(`/api/portfolios/${id}`, { method: 'DELETE' });
        if (!res.ok) throw new Error('Delete failed');
        return true;
    },

    async registerPortfolio(id) {
        const res = await this._fetch('/api/register', {
            method: 'POST',
            body: JSON.stringify({ portfolioId: id })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Registration failed');
        return data;
    },

    async getLoginUrl(id) {
        const res = await this._fetch('/api/login', {
            method: 'POST',
            body: JSON.stringify({ portfolioId: id })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to get link');
        return data.loginUrl;
    },

    async getTradeLoginUrl(id) {
        const redirectUrl = window.location.origin + window.location.pathname + '#settings';
        const res = await this._fetch('/api/login/trade', {
            method: 'POST',
            body: JSON.stringify({ portfolioId: id, redirectUrl })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to get trade link');
        return data.loginUrl;
    },

    async getConnectionStatus(portfolioId) {
        const res = await this._fetch(`/api/connection-status/${portfolioId}`);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to get connection status');
        return data;
    },

    async getAccounts(forceRefresh = false) {
        const url = `/api/accounts${forceRefresh ? '?forceRefresh=true' : ''}`;
        const res = await this._fetch(url);
        if (!res.ok) throw new Error('Failed to load accounts');
        return await res.json();
    },

    async getHoldings(portfolioId, accountId, forceRefresh = false) {
        const url = `/api/holdings/${portfolioId}/${accountId}${forceRefresh ? '?forceRefresh=true' : ''}`;
        const res = await this._fetch(url);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to fetch holdings');
        return data;
    },

    async getDividendForecast(portfolioId, accountId, forceRefresh = false) {
        const url = `/api/dividends/forecast/${portfolioId}/${accountId}${forceRefresh ? '?forceRefresh=true' : ''}`;
        const res = await this._fetch(url);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to fetch dividend forecast');
        return data;
    },

    async getAllDividends(forceRefresh = false) {
        const url = `/api/portfolios/all-dividends${forceRefresh ? '?forceRefresh=true' : ''}`;
        const res = await this._fetch(url);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to fetch all dividends');
        return data;
    },

    async getAdminUsers() {
        const res = await this._fetch('/api/admin/users');
        if (!res.ok) throw new Error('Failed to list users');
        return await res.json();
    },

    async deleteAdminUser(uid) {
        const res = await this._fetch(`/api/admin/users/${uid}`, { method: 'DELETE' });
        if (!res.ok) throw new Error('Delete failed');
        return true;
    },

    async wipeAdminUsers() {
        const res = await this._fetch('/api/admin/wipe', { method: 'POST' });
        const data = await res.json();
        if (!res.ok) throw new Error('Wipe failed');
        return data;
    },

    async getSettings() {
        const res = await this._fetch('/api/admin/settings');
        if (!res.ok) throw new Error('Failed to fetch settings');
        return await res.json();
    },

    async updateSettings(settings) {
        const res = await this._fetch('/api/admin/settings', {
            method: 'POST',
            body: JSON.stringify(settings)
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to update settings');
        return data;
    },

    async placeTrade({ portfolioId, accountId, ticker, action, orderType, units, notional_value, price, timeInForce }) {
        const res = await this._fetch('/api/trade', {
            method: 'POST',
            body: JSON.stringify({ portfolioId, accountId, ticker, action, orderType, units, notional_value, price, timeInForce })
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || 'Order placement failed');
        return json;
    },

    async renameAccount(accountId, name) {
        const res = await this._fetch(`/api/accounts/${encodeURIComponent(accountId)}/name`, {
            method: 'PATCH',
            body: JSON.stringify({ name })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to rename account');
        return data;
    },

    async setAccountActive(accountId, isActive) {
        const res = await this._fetch(`/api/accounts/${encodeURIComponent(accountId)}/active`, {
            method: 'PATCH',
            body: JSON.stringify({ isActive })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to update account status');
        return data;
    },

    async getTransactions(forceRefresh = false) {
        const url = `/api/transactions${forceRefresh ? '?forceRefresh=true' : ''}`;
        const res = await this._fetch(url);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to fetch transactions');
        return data;
    },

    async changePassword(currentPassword, newPassword) {
        const res = await this._fetch('/auth/change-password', {
            method: 'POST',
            body: JSON.stringify({ currentPassword, newPassword })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to change password');
        return data;
    },

    async invalidatePortfolioCache(portfolioId) {
        const res = await this._fetch(`/api/invalidate-cache/${encodeURIComponent(portfolioId)}`, { method: 'POST' });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Cache invalidation failed');
        return data;
    }
};
