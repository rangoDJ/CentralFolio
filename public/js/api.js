/**
 * API logic for CentralFolio
 */
const API = {
    async getPortfolios() {
        const res = await fetch('/api/portfolios');
        return await res.json();
    },

    async savePortfolio(data) {
        const res = await fetch('/api/portfolios', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        if (!res.ok) {
            const error = await res.json();
            throw new Error(error.error || 'Save failed');
        }
        return await res.json();
    },

    async setPortfolioTrading(id, tradingEnabled) {
        const res = await fetch(`/api/portfolios/${id}/trading`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tradingEnabled })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to update trading setting');
        return data;
    },

    async deletePortfolio(id) {
        const res = await fetch(`/api/portfolios/${id}`, { method: 'DELETE' });
        if (!res.ok) throw new Error('Delete failed');
        return true;
    },

    async registerPortfolio(id) {
        const res = await fetch('/api/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ portfolioId: id })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Registration failed');
        return data;
    },

    async getLoginUrl(id) {
        const res = await fetch('/api/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ portfolioId: id })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to get link');
        return data.loginUrl;
    },

    async getTradeLoginUrl(id) {
        const redirectUrl = window.location.origin + window.location.pathname + '#settings';
        const res = await fetch('/api/login/trade', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ portfolioId: id, redirectUrl })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to get trade link');
        return data.loginUrl;
    },

    async getConnectionStatus(portfolioId) {
        const res = await fetch(`/api/connection-status/${portfolioId}`);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to get connection status');
        return data;
    },

    async getAccounts(forceRefresh = false) {
        const url = `/api/accounts${forceRefresh ? '?forceRefresh=true' : ''}`;
        const res = await fetch(url);
        if (!res.ok) throw new Error('Failed to load accounts');
        return await res.json();
    },

    async getHoldings(portfolioId, accountId, forceRefresh = false) {
        const url = `/api/holdings/${portfolioId}/${accountId}${forceRefresh ? '?forceRefresh=true' : ''}`;
        const res = await fetch(url);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to fetch holdings');
        return data;
    },

    async getDividendForecast(portfolioId, accountId, forceRefresh = false) {
        const url = `/api/dividends/forecast/${portfolioId}/${accountId}${forceRefresh ? '?forceRefresh=true' : ''}`;
        const res = await fetch(url);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to fetch dividend forecast');
        return data;
    },
    
    async getAllDividends(forceRefresh = false) {
        const url = `/api/portfolios/all-dividends${forceRefresh ? '?forceRefresh=true' : ''}`;
        const res = await fetch(url);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to fetch all dividends');
        return data;
    },

    async getAdminUsers() {
        const res = await fetch('/api/admin/users');
        if (!res.ok) throw new Error('Failed to list users');
        return await res.json();
    },

    async deleteAdminUser(uid) {
        const res = await fetch(`/api/admin/users/${uid}`, { method: 'DELETE' });
        if (!res.ok) throw new Error('Delete failed');
        return true;
    },

    async wipeAdminUsers() {
        const res = await fetch('/api/admin/wipe', { method: 'POST' });
        const data = await res.json();
        if (!res.ok) throw new Error('Wipe failed');
        return data;
    },

    async getSettings() {
        const res = await fetch('/api/admin/settings');
        if (!res.ok) throw new Error('Failed to fetch settings');
        return await res.json();
    },

    async updateSettings(settings) {
        const res = await fetch('/api/admin/settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(settings)
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to update settings');
        return data;
    },

    async placeTrade(data) {
        const res = await fetch('/api/trade', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || 'Order placement failed');
        return json;
    },

    async renameAccount(accountId, name) {
        const res = await fetch(`/api/accounts/${encodeURIComponent(accountId)}/name`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to rename account');
        return data;
    },

    async setAccountActive(accountId, isActive) {
        const res = await fetch(`/api/accounts/${encodeURIComponent(accountId)}/active`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ isActive })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to update account status');
        return data;
    },

    async getTransactions(forceRefresh = false) {
        const url = `/api/transactions${forceRefresh ? '?forceRefresh=true' : ''}`;
        const res = await fetch(url);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to fetch transactions');
        return data;
    }
};
