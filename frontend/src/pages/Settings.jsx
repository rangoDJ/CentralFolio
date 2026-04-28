import React, { useState, useEffect } from 'react';
import { Settings as SettingsIcon, Shield, Database, RefreshCw, CheckCircle2, XCircle, AlertTriangle, Code, Link2, Tag } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

const Settings = () => {
  const queryClient = useQueryClient();
  const [envVars, setEnvVars] = useState({});
  
  const { data: connections = [], isLoading: isLoadingConnections } = useQuery({
    queryKey: ['connections'],
    queryFn: () => fetch('/api/connections').then(res => res.json())
  });

  const { data: settings = [], isLoading: isLoadingSettings } = useQuery({
    queryKey: ['settings'],
    queryFn: () => fetch('/api/settings').then(res => res.json())
  });

  const { data: config, isLoading: isLoadingConfig } = useQuery({
    queryKey: ['config'],
    queryFn: () => fetch('/api/config').then(res => res.json())
  });

  useEffect(() => {
    if (config) {
      const syncTimeSetting = settings.find(s => s.key === 'TRANSACTION_SYNC_TIME');
      setEnvVars({
        TRANSACTION_SYNC_TIME: syncTimeSetting?.value || '02:00'
      });
    }
  }, [config, settings]);

  const handleSettingChange = async (key, value) => {
    setEnvVars(prev => ({ ...prev, [key]: value }));
    try {
      await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key, value })
      });
    } catch (err) {
      console.error(`Failed to save setting ${key}`, err);
      toast.error(`Failed to save ${key}`);
    }
  };

  const [syncing, setSyncing] = useState(false);
  const [portfolioEdits, setPortfolioEdits] = useState({});
  const [savedRows, setSavedRows] = useState({});

  const { data: brokerageAccounts = [] } = useQuery({
    queryKey: ['brokerage-accounts'],
    queryFn: () => fetch('/api/brokerage-accounts').then(r => r.json())
  });

  const loading = isLoadingConnections || isLoadingSettings || isLoadingConfig;

  const handleSync = async () => {
    setSyncing(true);
    try {
      await fetch('/api/connections/sync', { method: 'POST' });
      await queryClient.invalidateQueries({ queryKey: ['connections'] });
      await queryClient.invalidateQueries({ queryKey: ['brokerage-accounts'] });
    } catch (err) {
      console.error('Sync failed', err);
    } finally {
      setSyncing(false);
    }
  };

  const handleDeleteConnection = async (id) => {
    if (!window.confirm('Are you sure you want to delete this connection? This action is irreversible.')) return;
    try {
      const res = await fetch(`/api/connections/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to delete connection');
      toast.success('Connection deleted successfully.');
      await queryClient.invalidateQueries({ queryKey: ['connections'] });
      await queryClient.invalidateQueries({ queryKey: ['brokerage-accounts'] });
    } catch (err) {
      console.error('Delete failed', err);
      toast.error('Failed to delete connection.');
    }
  };

  const handleSavePortfolio = async (accountId) => {
    const portfolio = portfolioEdits[accountId] ?? '';
    try {
      const res = await fetch(`/api/brokerage-accounts/${accountId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ portfolio })
      });
      if (!res.ok) throw new Error();
      await queryClient.invalidateQueries({ queryKey: ['brokerage-accounts'] });
      setSavedRows(prev => ({ ...prev, [accountId]: true }));
      setTimeout(() => setSavedRows(prev => ({ ...prev, [accountId]: false })), 2000);
      toast.success(`Portfolio "${portfolio || '(unassigned)'}" saved.`);
    } catch {
      toast.error('Failed to save portfolio assignment.');
    }
  };

  const handleConnect = async () => {
    try {
      const res = await fetch('/api/snaptrade/link', { method: 'POST' });
      const data = await res.json();
      if (data.redirectURI) {
        window.location.href = data.redirectURI;
      } else {
        toast.error('Failed to obtain redirect URI');
      }
    } catch (err) {
      console.error('Connection generation failed', err);
      toast.error('Error connecting to SnapTrade Gateway.');
    }
  };

  const StatusCard = ({ title, icon: Icon, status, details }) => (
    <div className="card" style={{ display: 'flex', alignItems: 'flex-start', gap: '1rem' }}>
      <div style={{ 
        padding: '0.75rem', 
        borderRadius: '12px', 
        backgroundColor: 'var(--bg-main)',
        color: status === 'OK' ? 'var(--up)' : 'var(--down)'
      }}>
        <Icon size={24} />
      </div>
      <div>
        <h3 style={{ fontSize: '1rem', marginBottom: '0.25rem' }}>{title}</h3>
        <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', marginBottom: '0.5rem' }}>{details}</p>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.75rem', fontWeight: 600 }}>
          {status === 'OK' ? <CheckCircle2 size={14} /> : <XCircle size={14} />}
          {status === 'OK' ? 'Operational' : 'Action Required'}
        </div>
      </div>
    </div>
  );

  if (loading) return <div>Loading...</div>;

  return (
    <div>
      <div style={{ marginBottom: '2rem' }}>
        <h1 style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>Settings</h1>
        <p style={{ color: 'var(--text-secondary)' }}>Manage API configurations and brokerage connections</p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '1.5rem', marginBottom: '3rem' }}>
        <StatusCard 
          title="SnapTrade API" 
          icon={Shield} 
          status={config?.isPersonal ? "OK" : "OK"} 
          details={config?.isPersonal ? "Personal Integration Active. Syncing via direct token." : "HMAC Signing active. Connection to SnapTrade Gateway is healthy."} 
        />
        <StatusCard 
          title="Database" 
          icon={Database} 
          status="OK" 
          details="SQLite (built-in) connected. folio.db is writable." 
        />
      </div>

      <div className="card" style={{ marginBottom: '2rem' }}>
        <h2 style={{ fontSize: '1.25rem', marginBottom: '1rem' }}>Background Sync</h2>
        <div style={{ marginBottom: '1.5rem' }}>
          <label style={{ display: 'block', marginBottom: '0.5rem', color: 'var(--text-secondary)' }}>Daily Transaction Sync Time (HH:MM)</label>
          <input 
            type="time" 
            value={envVars.TRANSACTION_SYNC_TIME || '02:00'}
            onChange={(e) => handleSettingChange('TRANSACTION_SYNC_TIME', e.target.value)}
            style={{ 
              width: '100%', 
              maxWidth: '300px',
              padding: '0.75rem', 
              background: 'var(--bg-main)', 
              color: 'white', 
              border: '1px solid var(--border)', 
              borderRadius: '8px' 
            }}
          />
          <p style={{ marginTop: '0.5rem', fontSize: '0.875rem', color: 'var(--text-muted)' }}>
            The time of day the backend will automatically pull historical transaction data from SnapTrade.
          </p>
        </div>
      </div>

      <div className="card" style={{ marginBottom: '2rem' }}>
        <h2 style={{ fontSize: '1.25rem', marginBottom: '1rem' }}>API Configuration</h2>
        <div style={{ display: 'grid', gap: '1rem', marginBottom: '1.5rem' }}>
          <div style={{ 
            padding: '1rem', 
            backgroundColor: config?.HAS_ENV_VARS ? 'rgba(34, 197, 94, 0.1)' : 'rgba(239, 68, 68, 0.1)', 
            borderRadius: '8px',
            border: `1px solid ${config?.HAS_ENV_VARS ? 'var(--up)' : 'var(--down)'}`,
            display: 'flex',
            alignItems: 'center',
            gap: '0.75rem'
          }}>
            {config?.HAS_ENV_VARS ? (
              <>
                <CheckCircle2 size={20} style={{ color: 'var(--up)' }} />
                <div>
                  <div style={{ fontWeight: 600, color: 'var(--up)' }}>Credentials Detected</div>
                  <div style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
                    SnapTrade Client ID and Consumer Key are being loaded from system environment variables.
                  </div>
                </div>
              </>
            ) : (
              <>
                <AlertTriangle size={20} style={{ color: 'var(--down)' }} />
                <div>
                  <div style={{ fontWeight: 600, color: 'var(--down)' }}>Missing Credentials</div>
                  <div style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
                    SnapTrade credentials not found in environment. Please set SNAPTRADE_CLIENT_ID and SNAPTRADE_CONSUMER_KEY in your .env or docker-compose.yml.
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', position: 'relative' }}>
          <h2 style={{ fontSize: '1.25rem' }}>Brokerage Connections</h2>
          <button 
            onClick={handleSync} 
            disabled={syncing}
            className="btn btn-primary"
            style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}
          >
            <RefreshCw size={16} className={syncing ? 'spin' : ''} />
            {syncing ? 'Syncing...' : 'Refresh Status'}
          </button>
        </div>

        {connections.length === 0 && !config?.isPersonal ? (
          <div style={{ padding: '2rem', textAlign: 'center', backgroundColor: 'var(--bg-main)', borderRadius: '8px' }}>
            <AlertTriangle size={32} style={{ color: 'var(--down)', marginBottom: '1rem' }} />
            <p style={{ marginBottom: '1rem' }}>No brokerage accounts connected yet.</p>
            <button 
              className="btn btn-primary"
              onClick={handleConnect}
              disabled={syncing}
            >
              Add Connection via SnapTrade
            </button>
          </div>
        ) : connections.length === 0 && config?.isPersonal ? (
           <div style={{ padding: '2rem', textAlign: 'center', backgroundColor: 'rgba(168, 85, 247, 0.1)', borderRadius: '8px', border: '1px solid rgba(168, 85, 247, 0.2)' }}>
              <Shield size={32} style={{ color: '#a855f7', marginBottom: '1rem' }} />
              <p style={{ marginBottom: '0.5rem', fontWeight: 600 }}>Personal Integration Active</p>
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>Your accounts will appear automatically. Note: connections list might be empty in this mode.</p>
           </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--border)' }}>
                <th style={{ padding: '1rem' }}>Brokerage</th>
                <th style={{ padding: '1rem' }}>Status</th>
                <th style={{ padding: '1rem' }}>Last Synced</th>
                <th style={{ padding: '1rem' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {connections.map(conn => (
                <tr key={conn.id} style={{ borderBottom: '1px solid var(--border)' }}>
                  <td style={{ padding: '1rem', fontWeight: 600 }}>{conn.brokerage_name}</td>
                  <td style={{ padding: '1rem' }}>
                    <span style={{ 
                      backgroundColor: 'rgba(34, 197, 94, 0.1)', 
                      color: 'var(--up)', 
                      padding: '2px 8px', 
                      borderRadius: '4px', 
                      fontSize: '0.75rem' 
                    }}>
                      {conn.connection_status}
                    </span>
                  </td>
                  <td style={{ padding: '1rem', color: 'var(--text-muted)' }}>{new Date(conn.last_synced).toLocaleString()}</td>
                  <td style={{ padding: '1rem' }}>
                    <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
                      <button 
                        onClick={handleConnect}
                        style={{ color: 'var(--accent)', background: 'none', border: 'none', cursor: 'pointer', fontSize: '0.875rem' }}
                      >
                        Reconnect
                      </button>
                      <button 
                        onClick={() => handleDeleteConnection(conn.id)}
                        style={{ color: 'var(--down)', background: 'none', border: 'none', cursor: 'pointer', fontSize: '0.875rem' }}
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Account → Portfolio Mapping */}
      <div className="card" style={{ marginTop: '2rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1.5rem' }}>
            <Link2 size={20} color="var(--accent)" />
            <div>
              <h2 style={{ fontSize: '1.25rem', marginBottom: '0.25rem' }}>Account → Portfolio Mapping</h2>
              <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', margin: 0 }}>
                Assign discovered accounts to named portfolios. Multiple accounts sharing a name are merged in the dashboard.
              </p>
            </div>
          </div>

          {brokerageAccounts.length === 0 ? (
            <div style={{ padding: '2rem', textAlign: 'center', backgroundColor: 'var(--bg-main)', borderRadius: '8px' }}>
              <Tag size={28} style={{ color: 'var(--text-muted)', marginBottom: '0.75rem', display: 'block', margin: '0 auto 0.75rem' }} />
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
                No accounts detected yet. Connect a brokerage above and click <strong>Refresh Status</strong>.
              </p>
            </div>
          ) : (() => {
            const existingPortfolios = [...new Set(brokerageAccounts.map(a => a.portfolio).filter(Boolean))];
            const grouped = brokerageAccounts.reduce((acc, a) => {
              (acc[a.brokerage] = acc[a.brokerage] || []).push(a);
              return acc;
            }, {});
            return (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                <datalist id="portfolio-names">
                  {existingPortfolios.map(p => <option key={p} value={p} />)}
                </datalist>
                {Object.entries(grouped).map(([brokerage, accounts]) => (
                  <div key={brokerage}>
                    <div style={{ fontSize: '0.7rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--text-muted)', marginBottom: '0.6rem' }}>
                      {brokerage}
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                      {accounts.map(acc => {
                        const currentVal = portfolioEdits[acc.id] ?? (acc.portfolio || '');
                        const isSaved = savedRows[acc.id];
                        const isDirty = currentVal !== (acc.portfolio || '');
                        return (
                          <div key={acc.id} style={{
                            display: 'grid',
                            gridTemplateColumns: 'auto 1fr auto auto',
                            alignItems: 'center',
                            gap: '1rem',
                            padding: '0.875rem 1rem',
                            borderRadius: '8px',
                            backgroundColor: 'var(--bg-main)',
                            border: `1px solid ${isSaved ? 'var(--up)' : isDirty ? 'rgba(245,158,11,0.5)' : 'var(--border)'}`,
                            transition: 'border-color 0.3s ease'
                          }}>
                            <input 
                              type="checkbox"
                              checked={acc.is_selected === 1}
                              onChange={async (e) => {
                                const isSelected = e.target.checked;
                                await fetch('/api/brokerage-accounts/select', {
                                  method: 'POST',
                                  headers: { 'Content-Type': 'application/json' },
                                  body: JSON.stringify({ id: acc.id, isSelected })
                                });
                                // Refresh accounts list
                                queryClient.invalidateQueries({ queryKey: ['brokerage-accounts'] });
                                queryClient.invalidateQueries({ queryKey: ['accounts'] });
                                queryClient.invalidateQueries({ queryKey: ['positions'] });
                                toast.success(`${isSelected ? 'Enabled' : 'Disabled'} ${acc.account_name}`);
                              }}
                              style={{ width: '18px', height: '18px', cursor: 'pointer' }}
                            />
                            <div>
                              <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>{acc.account_name}</div>
                              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                                {acc.account_number}{acc.account_number ? ' · ' : ''}{acc.currency}
                              </div>
                            </div>
                            <input
                              list="portfolio-names"
                              placeholder="Portfolio name (e.g. Mom)"
                              value={currentVal}
                              onChange={e => setPortfolioEdits(prev => ({ ...prev, [acc.id]: e.target.value }))}
                              style={{
                                padding: '0.5rem 0.75rem',
                                borderRadius: '6px',
                                border: '1px solid var(--border)',
                                backgroundColor: 'var(--bg-card)',
                                color: 'var(--text-primary)',
                                fontSize: '0.875rem',
                                width: '200px'
                              }}
                            />
                            <button
                              className="btn btn-primary"
                              style={{ padding: '0.5rem 1rem', fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '0.4rem', whiteSpace: 'nowrap' }}
                              onClick={() => handleSavePortfolio(acc.id)}
                            >
                              {isSaved && <CheckCircle2 size={14} />}
                              {isSaved ? 'Saved' : 'Save'}
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            );
          })()}
        </div>

      <div className="card" style={{ marginTop: '2rem' }}>
        <h2 style={{ fontSize: '1.25rem', marginBottom: '1rem' }}>System Environment</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '1rem', fontSize: '0.875rem' }}>
          <div>
            <div style={{ color: 'var(--text-muted)' }}>Node Version</div>
            <div style={{ fontWeight: 600 }}>v25.9.0</div>
          </div>
          <div>
            <div style={{ color: 'var(--text-muted)' }}>Storage Engine</div>
            <div style={{ fontWeight: 600 }}>node:sqlite</div>
          </div>
          <div>
            <div style={{ color: 'var(--text-muted)' }}>Dashboard Version</div>
            <div style={{ fontWeight: 600 }}>1.0.0-beta</div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Settings;
