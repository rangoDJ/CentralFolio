import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { formatCurrency, formatDate } from '../utils/format';
import { RefreshCw, Plus, Trash2, Activity, ShieldAlert, Edit2, XCircle } from 'lucide-react';
import { toast } from 'sonner';

const Automations = () => {
  const queryClient = useQueryClient();
  const [isEditing, setIsEditing] = useState(false);
  const [newRule, setNewRule] = useState({ account_id: '', percentage: 100, excluded_symbols: '' });

  const { data: accounts = [] } = useQuery({
    queryKey: ['accounts'],
    queryFn: () => fetch('/api/accounts').then(res => res.json())
  });

  const { data: automations = [], isLoading: rulesLoading } = useQuery({
    queryKey: ['automations'],
    queryFn: () => fetch('/api/automations').then(res => res.json())
  });

  const { data: logs = [], isLoading: logsLoading } = useQuery({
    queryKey: ['automationLogs'],
    queryFn: () => fetch('/api/automations/logs').then(res => res.json()),
    refetchInterval: 10000
  });

  const addMutation = useMutation({
    mutationFn: (rule) => fetch('/api/automations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(rule)
    }),
    onSuccess: () => {
      queryClient.invalidateQueries(['automations']);
      setNewRule({ account_id: '', percentage: 100, excluded_symbols: '' });
      setIsEditing(false);
      toast.success(isEditing ? 'Automation updated' : 'Automation created');
    }
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => fetch(`/api/automations/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries(['automations']);
      toast.success('Automation deleted');
    }
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!newRule.account_id) return;
    addMutation.mutate(newRule);
  };

  const handleEdit = (rule) => {
    setNewRule({
      account_id: rule.account_id,
      percentage: rule.percentage,
      excluded_symbols: rule.excluded_symbols || ''
    });
    setIsEditing(true);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const cancelEdit = () => {
    setNewRule({ account_id: '', percentage: 100, excluded_symbols: '' });
    setIsEditing(false);
  };

  return (
    <div style={{ maxWidth: '1200px' }}>
      <div style={{ marginBottom: '2rem' }}>
        <h1 style={{ fontSize: '2rem', fontWeight: 700, marginBottom: '0.25rem' }}>Dividend Automations</h1>
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>Set up rules to automatically reinvest dividends</p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(350px, 1fr))', gap: '2rem' }}>
        {/* Create/Edit Rule Form */}
        <div className="card" style={{ padding: '1.5rem' }}>
          <h2 style={{ fontSize: '1.25rem', marginBottom: '1.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            {isEditing ? <Edit2 size={20} color="var(--accent)" /> : <Plus size={20} color="var(--accent)" />}
            {isEditing ? 'Edit Reinvestment Rule' : 'Create Reinvestment Rule'}
          </h2>
          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <div>
              <label style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '0.5rem', textTransform: 'uppercase' }}>Account</label>
              <select 
                value={newRule.account_id}
                onChange={(e) => setNewRule({...newRule, account_id: e.target.value})}
                disabled={isEditing}
                style={{ width: '100%', padding: '0.75rem', borderRadius: '8px', border: '1px solid var(--border)', backgroundColor: 'var(--card-bg)', color: 'var(--text-primary)', opacity: isEditing ? 0.7 : 1 }}
                required
              >
                <option value="">Select an account</option>
                {accounts.map(acc => (
                  <option key={acc.id} value={acc.id}>{acc.accountName} ({acc.brokerage_name})</option>
                ))}
              </select>
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '0.5rem', textTransform: 'uppercase' }}>Reinvestment Percentage (%)</label>
              <input 
                type="number"
                min="1"
                max="100"
                value={newRule.percentage}
                onChange={(e) => setNewRule({...newRule, percentage: parseFloat(e.target.value)})}
                style={{ width: '100%', padding: '0.75rem', borderRadius: '8px', border: '1px solid var(--border)', backgroundColor: 'var(--card-bg)', color: 'var(--text-primary)' }}
                required
              />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '0.5rem', textTransform: 'uppercase' }}>Excluded Symbols (Optional)</label>
              <input 
                type="text"
                placeholder="e.g. VOO, AAPL, TSLA"
                value={newRule.excluded_symbols}
                onChange={(e) => setNewRule({...newRule, excluded_symbols: e.target.value.toUpperCase()})}
                style={{ width: '100%', padding: '0.75rem', borderRadius: '8px', border: '1px solid var(--border)', backgroundColor: 'var(--card-bg)', color: 'var(--text-primary)' }}
              />
              <p style={{ fontSize: '0.65rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>Comma-separated tickers that will NOT be reinvested.</p>
            </div>
            
            <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
              <button 
                type="submit" 
                className="btn-primary"
                disabled={addMutation.isLoading}
                style={{ flex: 1 }}
              >
                {isEditing ? 'Update Rule' : 'Add Automation Rule'}
              </button>
              {isEditing && (
                <button 
                  type="button" 
                  onClick={cancelEdit}
                  style={{ padding: '0.75rem', borderRadius: '8px', border: '1px solid var(--border)', backgroundColor: 'transparent', color: 'var(--text-primary)', cursor: 'pointer' }}
                >
                  Cancel
                </button>
              )}
            </div>
          </form>

          <div style={{ marginTop: '1.5rem', padding: '1rem', borderRadius: '8px', backgroundColor: 'rgba(255, 180, 0, 0.05)', border: '1px solid rgba(255, 180, 0, 0.2)', display: 'flex', gap: '0.75rem' }}>
            <ShieldAlert size={20} color="#ffb400" style={{ flexShrink: 0 }} />
            <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', margin: 0 }}>
              Automations use <strong>Market Orders</strong>. Fractional shares are not supported; the system will buy the maximum number of whole shares possible.
            </p>
          </div>
        </div>

        {/* Active Rules List */}
        <div className="card" style={{ padding: '1.5rem' }}>
          <h2 style={{ fontSize: '1.25rem', marginBottom: '1.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Activity size={20} color="var(--accent)" />
            Active Rules
          </h2>
          {rulesLoading ? <div className="skeleton" style={{ height: '200px' }} /> : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              {automations.length === 0 ? (
                <p style={{ color: 'var(--text-muted)', textAlign: 'center', padding: '2rem' }}>No rules configured yet.</p>
              ) : (
                automations.map(rule => (
                  <div key={rule.id} style={{ padding: '1rem', borderRadius: '8px', border: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 600 }}>{accounts.find(a => a.id === rule.account_id)?.accountName || 'Unknown Account'}</div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                        Reinvest {rule.percentage}% of dividends
                      </div>
                      {rule.excluded_symbols && (
                        <div style={{ fontSize: '0.65rem', color: 'var(--error)', marginTop: '0.25rem', display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                          <XCircle size={10} />
                          Excluding: {rule.excluded_symbols}
                        </div>
                      )}
                    </div>
                    <div style={{ display: 'flex', gap: '0.25rem' }}>
                      <button 
                        onClick={() => handleEdit(rule)}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: '0.5rem' }}
                      >
                        <Edit2 size={16} />
                      </button>
                      <button 
                        onClick={() => deleteMutation.mutate(rule.id)}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--error)', padding: '0.5rem' }}
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      </div>

      {/* Logs Table */}
      <div className="card" style={{ marginTop: '2rem', padding: '1.5rem' }}>
        <h2 style={{ fontSize: '1.25rem', marginBottom: '1.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <RefreshCw size={20} color="var(--accent)" />
          Automation Logs
        </h2>
        {logsLoading ? <div className="skeleton" style={{ height: '300px' }} /> : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border)', color: 'var(--text-secondary)', fontSize: '0.75rem', textTransform: 'uppercase' }}>
                  <th style={{ textAlign: 'left', padding: '1rem' }}>Date</th>
                  <th style={{ textAlign: 'left', padding: '1rem' }}>Account</th>
                  <th style={{ textAlign: 'left', padding: '1rem' }}>Dividend</th>
                  <th style={{ textAlign: 'left', padding: '1rem' }}>Status</th>
                  <th style={{ textAlign: 'left', padding: '1rem' }}>Order ID</th>
                </tr>
              </thead>
              <tbody>
                {logs.length === 0 ? (
                  <tr>
                    <td colSpan="5" style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>No logs found.</td>
                  </tr>
                ) : (
                  logs.map(log => {
                    const rule = automations.find(a => a.id === log.automation_id);
                    const account = accounts.find(a => a.id === rule?.account_id);
                    return (
                      <tr key={log.id} style={{ borderBottom: '1px solid var(--border)', fontSize: '0.875rem' }}>
                        <td style={{ padding: '1rem' }}>{formatDate(log.timestamp)}</td>
                        <td style={{ padding: '1rem' }}>{account?.accountName || 'Unknown'}</td>
                        <td style={{ padding: '1rem' }}>{formatCurrency(log.amount_reinvested)}</td>
                        <td style={{ padding: '1rem' }}>
                          <span style={{ 
                            padding: '0.25rem 0.5rem', 
                            borderRadius: '4px', 
                            fontSize: '0.75rem',
                            backgroundColor: log.status === 'Success' ? 'rgba(0, 200, 150, 0.1)' : 'rgba(255, 100, 100, 0.1)',
                            color: log.status === 'Success' ? 'var(--accent)' : 'var(--error)'
                          }}>
                            {log.status}
                          </span>
                        </td>
                        <td style={{ padding: '1rem', color: 'var(--text-muted)', fontSize: '0.75rem' }}>{log.order_id || 'N/A'}</td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};

export default Automations;
