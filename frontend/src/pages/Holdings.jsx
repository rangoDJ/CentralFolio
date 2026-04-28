import React from 'react';
import { useQuery } from '@tanstack/react-query';
import HoldingsTable from '../components/HoldingsTable';
import ErrorBoundary from '../components/ErrorBoundary';
import { formatCurrency } from '../utils/format';

const Holdings = () => {
  const { data: positions = [], isLoading: pLoading } = useQuery({
    queryKey: ['positions'],
    queryFn: () => fetch('/api/positions').then(res => { if (!res.ok) throw new Error(`positions ${res.status}`); return res.json(); }),
    refetchInterval: 15000,
    refetchIntervalInBackground: false
  });

  const { data: fxData, isLoading: fxLoading, isError: fxError } = useQuery({
    queryKey: ['fxRate'],
    queryFn: () => fetch('/api/fx-rate').then(res => res.json())
  });

  const [activeTab, setActiveTab] = React.useState(0);
  const loading = pLoading || fxLoading;
  const fxRate = fxData?.rate || null;

  if (loading) {
    return (
      <div>
        <div style={{ marginBottom: '2rem' }}>
          <h1 style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>Portfolio Holdings</h1>
          <p style={{ color: 'var(--text-secondary)' }}>Detailed view of all positions across all family accounts</p>
        </div>
        <div className="skeleton" style={{ height: '350px', width: '100%', borderRadius: '12px', marginBottom: '2rem' }}></div>
      </div>
    );
  }

  if (!positions || positions.length === 0) {
    return (
      <div style={{ textAlign: 'center', padding: '4rem 2rem' }}>
        <h2 style={{ color: 'var(--text-secondary)' }}>No active accounts selected</h2>
        <p>Go to Settings to enable sync for your brokerage accounts.</p>
      </div>
    );
  }

  const currentAccount = positions[activeTab] || positions[0];

  return (
    <div>
      <div style={{ marginBottom: '2rem' }}>
        <h1 style={{ fontSize: '2rem', fontWeight: 700, marginBottom: '0.25rem' }}>Holdings</h1>
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>All positions across your accounts</p>
      </div>

      {/* Account Tabs */}
      <div style={{
        display: 'flex',
        gap: '0.25rem',
        marginBottom: '1rem',
        overflowX: 'auto',
        paddingBottom: '0.5rem',
        borderBottom: '1px solid var(--border)'
      }}>
        {positions.map((acc, idx) => (
          <button
            key={acc.accountId}
            onClick={() => setActiveTab(idx)}
            style={{
              padding: '0.625rem 1.25rem',
              borderRadius: '8px',
              border: 'none',
              backgroundColor: activeTab === idx ? 'rgba(0,200,150,0.12)' : 'transparent',
              color: activeTab === idx ? 'var(--accent)' : 'var(--text-muted)',
              cursor: 'pointer',
              fontWeight: activeTab === idx ? 600 : 400,
              fontSize: '0.875rem',
              whiteSpace: 'nowrap',
              transition: 'all 0.15s ease'
            }}
          >
            {acc.accountName}
          </button>
        ))}
      </div>

      {currentAccount.balances && currentAccount.balances.length > 0 && (
        <div style={{ display: 'flex', gap: '1rem', marginBottom: '2rem', flexWrap: 'wrap' }}>
          {currentAccount.balances.map(b => {
            const isMargin = typeof b.buying_power === 'number' && b.buying_power > b.cash;
            return (
              <div key={b.currency?.code || 'CAD'} className="card" style={{ padding: '1rem 1.5rem', flex: '0 1 auto', display: 'flex', flexDirection: 'column', gap: '0.25rem', borderLeft: isMargin ? '4px solid var(--accent)' : '4px solid transparent' }}>
                <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  Available Cash ({b.currency?.code || 'CAD'})
                </span>
                <span style={{ fontSize: '1.5rem', fontWeight: 700, margin: '0.25rem 0' }}>
                  {formatCurrency(b.cash)}
                </span>
                {isMargin && (
                   <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '0.5rem', paddingTop: '0.5rem', borderTop: '1px solid var(--border)' }}>
                     <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                       Margin Buying Power:
                     </span>
                     <span style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--accent)' }}>
                       {formatCurrency(b.buying_power)}
                     </span>
                   </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {(fxError || !fxRate) && (
        <div style={{ marginBottom: '1rem', padding: '0.75rem 1rem', backgroundColor: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.3)', borderRadius: '8px', fontSize: '0.875rem', color: '#f59e0b' }}>
          FX rate unavailable — USD values cannot be converted to CAD. Showing native currency amounts.
        </div>
      )}
      <ErrorBoundary>
        <HoldingsTable positions={currentAccount.holdings} fxRate={fxRate ?? 1} />
      </ErrorBoundary>
    </div>
  );
};

export default Holdings;
