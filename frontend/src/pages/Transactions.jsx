import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { formatCurrency } from '../utils/format';
import { toast } from 'sonner';
import { Play, Loader2, Activity } from 'lucide-react';

const CATEGORIES = [
  'BUY', 'SELL', 'DIVIDEND', 'CONTRIBUTION', 'WITHDRAWAL', 
  'INTEREST', 'FEE', 'TRANSFER', 'OTHER'
];

const Transactions = () => {
  const queryClient = useQueryClient();
  const [filterCategory, setFilterCategory] = useState('');
  const [filterAccount, setFilterAccount] = useState('');
  const [syncing, setSyncing] = useState(false);
  const [triggeringId, setTriggeringId] = useState(null);
  const [hoveredRow, setHoveredRow] = useState(null);

  const { data: transactions = [], isLoading } = useQuery({
    queryKey: ['transactions', filterCategory, filterAccount],
    queryFn: () => {
      const params = new URLSearchParams();
      if (filterCategory) params.append('category', filterCategory);
      if (filterAccount) params.append('account_id', filterAccount);
      const url = `/api/transactions?${params.toString()}`;
      return fetch(url).then(res => res.json());
    }
  });

  const { data: automations = [] } = useQuery({
    queryKey: ['automations'],
    queryFn: () => fetch('/api/automations').then(res => res.json())
  });

  const { data: accounts = [] } = useQuery({
    queryKey: ['accounts'],
    queryFn: () => fetch('/api/accounts').then(res => res.json())
  });

  const getAccountName = (id) => {
    const acc = accounts.find(a => a.id === id);
    return acc ? `${acc.person} - ${acc.accountName}` : 'Unknown Account';
  };

  const updateCategoryMutation = useMutation({
    mutationFn: ({ id, category }) => fetch(`/api/transactions/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ category })
    }).then(res => {
      if (!res.ok) throw new Error('Failed to update category');
      return res.json();
    }),
    onSuccess: () => {
      toast.success('Category updated');
      queryClient.invalidateQueries({ queryKey: ['transactions'] });
    },
    onError: () => {
      toast.error('Failed to update category');
    }
  });

  const handleSync = async () => {
    setSyncing(true);
    try {
      const res = await fetch('/api/transactions/sync', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to sync');
      toast.success(`Synced ${data.count} transactions from SnapTrade`);
      queryClient.invalidateQueries({ queryKey: ['transactions'] });
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSyncing(false);
    }
  };

  const handleTriggerAutomation = async (txId) => {
    setTriggeringId(txId);
    try {
      const res = await fetch('/api/automations/trigger', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transaction_id: txId })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to trigger automation');
      toast.success('Automation triggered successfully! Order ID: ' + data.orderId);
      queryClient.invalidateQueries({ queryKey: ['automationLogs'] });
    } catch (err) {
      toast.error(err.message);
    } finally {
      setTriggeringId(null);
    }
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '2rem' }}>
        <div>
          <h1 style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>Transactions</h1>
          <p style={{ color: 'var(--text-secondary)' }}>Review and categorize historical transactions</p>
        </div>
        <button 
          onClick={handleSync}
          disabled={syncing}
          className="btn-sync"
          style={{ 
            padding: '0.75rem 1.5rem', 
            borderRadius: '8px', 
            background: 'var(--accent)', 
            color: 'white', 
            border: 'none', 
            fontWeight: 600, 
            cursor: syncing ? 'not-allowed' : 'pointer',
            opacity: syncing ? 0.7 : 1
          }}
        >
          {syncing ? 'Syncing...' : 'Sync Transactions'}
        </button>
      </div>

      <div className="card" style={{ marginBottom: '1.5rem', display: 'flex', gap: '2rem', alignItems: 'center' }}>
        <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
          <span style={{ fontWeight: 600 }}>Category:</span>
          <select 
            value={filterCategory}
            onChange={(e) => setFilterCategory(e.target.value)}
            style={{
              padding: '0.5rem',
              borderRadius: '6px',
              background: 'var(--bg-main)',
              color: 'var(--text-primary)',
              border: '1px solid var(--border)'
            }}
          >
            <option value="">All Categories</option>
            {CATEGORIES.map(cat => (
              <option key={cat} value={cat}>{cat}</option>
            ))}
          </select>
        </div>

        <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
          <span style={{ fontWeight: 600 }}>Account:</span>
          <select 
            value={filterAccount}
            onChange={(e) => setFilterAccount(e.target.value)}
            style={{
              padding: '0.5rem',
              borderRadius: '6px',
              background: 'var(--bg-main)',
              color: 'var(--text-primary)',
              border: '1px solid var(--border)'
            }}
          >
            <option value="">All Accounts</option>
            {accounts.map(acc => (
              <option key={acc.id} value={acc.id}>
                {acc.person} - {acc.accountName}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="card" style={{ overflowX: 'auto' }}>
        {isLoading ? (
          <div style={{ padding: '2rem', textAlign: 'center' }}>Loading transactions...</div>
        ) : transactions.length === 0 ? (
          <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>
            No transactions found. Click "Sync Transactions" to pull data.
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border)', color: 'var(--text-muted)', fontSize: '0.875rem' }}>
                <th style={{ padding: '1rem' }}>Date</th>
                <th style={{ padding: '1rem' }}>Account</th>
                <th style={{ padding: '1rem' }}>Description</th>
                <th style={{ padding: '1rem' }}>Amount</th>
                <th style={{ padding: '1rem' }}>Category</th>
              </tr>
            </thead>
            <tbody>
              {transactions.map(tx => (
                <tr 
                  key={tx.id} 
                  style={{ borderBottom: '1px solid var(--border)', position: 'relative' }}
                  onMouseEnter={() => setHoveredRow(tx.id)}
                  onMouseLeave={() => setHoveredRow(null)}
                >
                  <td style={{ padding: '1rem', whiteSpace: 'nowrap' }}>
                    {new Date(tx.trade_date).toLocaleDateString()}
                  </td>
                  <td style={{ padding: '1rem' }}>
                    <div style={{ fontSize: '0.875rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      {getAccountName(tx.account_id)}
                      {automations.some(a => a.account_id === tx.account_id) && (
                        <Activity size={12} color="var(--accent)" title="Account has active automation" />
                      )}
                    </div>
                  </td>
                  <td style={{ padding: '1rem', display: 'flex', alignItems: 'center', gap: '1rem' }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 500 }}>{tx.symbol}</div>
                      <div style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>{tx.description}</div>
                    </div>
                    {tx.type === 'DIVIDEND' && hoveredRow === tx.id && (
                      <button
                        onClick={() => handleTriggerAutomation(tx.id)}
                        disabled={triggeringId === tx.id}
                        title="Trigger Reinvestment Automation"
                        style={{
                          background: 'var(--accent)',
                          color: 'white',
                          border: 'none',
                          borderRadius: '50%',
                          width: '32px',
                          height: '32px',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          cursor: 'pointer',
                          boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
                          transition: 'transform 0.2s'
                        }}
                        onMouseEnter={(e) => e.currentTarget.style.transform = 'scale(1.1)'}
                        onMouseLeave={(e) => e.currentTarget.style.transform = 'scale(1)'}
                      >
                        {triggeringId === tx.id ? <Loader2 size={16} className="animate-spin" /> : <Play size={16} fill="white" />}
                      </button>
                    )}
                  </td>
                  <td style={{ padding: '1rem', color: tx.amount < 0 ? 'var(--down)' : 'var(--up)', fontWeight: 600 }}>
                    {tx.amount > 0 ? '+' : ''}{formatCurrency(tx.amount)} {tx.currency}
                  </td>
                  <td style={{ padding: '1rem' }}>
                    <select
                      value={CATEGORIES.includes(tx.category?.toUpperCase()) ? tx.category.toUpperCase() : 'OTHER'}
                      onChange={(e) => updateCategoryMutation.mutate({ id: tx.id, category: e.target.value })}
                      style={{
                        padding: '0.25rem 0.5rem',
                        borderRadius: '4px',
                        background: 'rgba(255,255,255,0.05)',
                        border: '1px solid var(--border)',
                        color: 'var(--text-primary)',
                        fontSize: '0.875rem'
                      }}
                    >
                      <option value="OTHER">OTHER</option>
                      {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
};

export default Transactions;
