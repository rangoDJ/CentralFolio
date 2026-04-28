import React, { useState, useCallback } from 'react';
import AccountGrid from '../components/AccountGrid';
import ErrorBoundary from '../components/ErrorBoundary';
import { AssetAllocationDonut } from '../components/Charts';
import { formatCurrency, formatPercent } from '../utils/format';
import { Wallet, TrendingUp, BarChart3 } from 'lucide-react';

const Overview = () => {
  const [metrics, setMetrics] = useState({
    totalValue: 0,
    dayChange: 0,
    dayChangePercent: 0,
    buyingPower: 12500 // Mock for now
  });
  const [rawAccounts, setRawAccounts] = useState([]);

  const handleDataLoaded = useCallback((accounts) => {
    setRawAccounts(accounts);
    const total = accounts.reduce((sum, acc) => sum + acc.value, 0);
    const dayChange = accounts.reduce((sum, acc) => sum + acc.dayChange, 0);
    const dayChangePercent = (dayChange / (total - dayChange)) * 100;
    
    setMetrics(prev => ({
      ...prev,
      totalValue: total,
      dayChange: dayChange,
      dayChangePercent: dayChangePercent
    }));
  }, []);

  const isPositive = metrics.dayChange >= 0;

  return (
    <div>
      <div style={{ marginBottom: '2rem' }}>
        <h1 style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>Family Portfolio Overview</h1>
        <p style={{ color: 'var(--text-secondary)' }}>Aggregated data across all 9 accounts</p>
      </div>

      {/* Summary Metrics */}
      <div style={{ 
        display: 'grid', 
        gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', 
        gap: '1.5rem',
        marginBottom: '2.5rem'
      }}>
        <div className="card">
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1rem', color: 'var(--accent)' }}>
            <Wallet size={20} />
            <span style={{ fontSize: '0.875rem', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Total Value (CAD)</span>
          </div>
          <div style={{ fontSize: '2rem', fontWeight: 700 }}>{formatCurrency(metrics.totalValue)}</div>
        </div>

        <div className="card">
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1rem', color: isPositive ? 'var(--up)' : 'var(--down)' }}>
            <TrendingUp size={20} />
            <span style={{ fontSize: '0.875rem', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Day P&L</span>
          </div>
          <div style={{ fontSize: '2rem', fontWeight: 700, color: isPositive ? 'var(--up)' : 'var(--down)' }}>
            {formatCurrency(metrics.dayChange)}
          </div>
          <div style={{ fontSize: '0.875rem', color: isPositive ? 'var(--up)' : 'var(--down)', marginTop: '0.25rem' }}>
            {isPositive ? '+' : ''}{metrics.dayChangePercent.toFixed(2)}%
          </div>
        </div>

        <div className="card">
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1rem', color: 'var(--text-secondary)' }}>
            <BarChart3 size={20} />
            <span style={{ fontSize: '0.875rem', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Buying Power</span>
          </div>
          <div style={{ fontSize: '2rem', fontWeight: 700 }}>{formatCurrency(metrics.buyingPower)}</div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: '2.5rem', height: '350px', display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1rem', color: 'var(--accent)' }}>
          <span style={{ fontSize: '1.25rem', fontWeight: 600 }}>Total Asset Allocation</span>
        </div>
        <div style={{ flex: 1, minHeight: 0 }}>
          <ErrorBoundary>
            <AssetAllocationDonut accounts={rawAccounts} />
          </ErrorBoundary>
        </div>
      </div>

      <div style={{ marginBottom: '1.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
        <h2 style={{ fontSize: '1.25rem' }}>Accounts</h2>
      </div>
      
      <ErrorBoundary>
        <AccountGrid onDataLoaded={handleDataLoaded} />
      </ErrorBoundary>
    </div>
  );
};

export default Overview;
