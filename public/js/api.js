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

    async getAccounts() {
        const res = await fetch('/api/accounts');
        if (!res.ok) throw new Error('Failed to load accounts');
        return await res.json();
    },

    async getHoldings(portfolioId, accountId) {
        const res = await fetch(`/api/holdings/${portfolioId}/${accountId}`);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to fetch holdings');
        return data;
    },

    async getDividendForecast(portfolioId, accountId) {
        const res = await fetch(`/api/dividends/forecast/${portfolioId}/${accountId}`);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to fetch dividend forecast');
        return data;
    },
    
    async getAllDividends() {
        const res = await fetch('/api/portfolios/all-dividends');
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
    }
};
