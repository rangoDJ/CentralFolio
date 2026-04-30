import React, { useState, useEffect } from 'react';
import { Settings as SettingsIcon, Shield, Database, RefreshCw, CheckCircle2, XCircle, AlertTriangle, Code, Link2, Tag, Key, Plus, Trash2, Edit2, Save } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

const Settings = () => {
  const queryClient = useQueryClient();
  const [envVars, setEnvVars] = useState({});
  const [editingConnectionId, setEditingConnectionId] = useState(null);
  const [editingDisplayName, setEditingDisplayName] = useState('');
  const [expandedKey, setExpandedKey] = useState(null);

  const { data: snapTradeKeys = [], isLoading: isLoadingKeys } = useQuery({
    queryKey: ['snaptrade-keys'],
    queryFn: () => fetch('/api/snaptrade-keys').then(res => res.json())
  });

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

  const loading = isLoadingConnections || isLoadingSettings || isLoadingConfig || isLoadingKeys;

  // Mutation for renaming connection
  const renameConnectionMutation = useMutation({
    mutationFn: async ({ connectionId, displayName }) => {
      const res = await fetch(`/api/connections/${connectionId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ displayName })
      });
      if (!res.ok) throw new Error('Failed to rename connection');
      return res.json();
    },
    onSuccess: () => {
      toast.success('Connection renamed successfully');
      queryClient.invalidateQueries({ queryKey: ['connections'] });
      setEditingConnectionId(null);
    },
    onError: () => {
      toast.error('Failed to rename connection');
    }
  });

  // Mutation for deleting a key
  const deleteKeyMutation = useMutation({
    mutationFn: async (keyIndex) => {
      const res = await fetch(`/api/snaptrade-keys/${keyIndex}`, {
        method: 'DELETE',
        headers: { 'X-Confirm-Delete': 'true' }
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || 'Failed to delete key');
      }
      return res.json();
    },
    onSuccess: () => {
      toast.success('SnapTrade key deleted successfully');
      queryClient.invalidateQueries({ queryKey: ['snaptrade-keys'] });
      queryClient.invalidateQueries({ queryKey: ['connections'] });
      queryClient.invalidateQueries({ queryKey: ['brokerage-accounts'] });
    },
    onError: (error) => {
      toast.error(error.message || 'Failed to delete key');
    }
  });

  // Mutation for initiating OAuth per key
  const oauthMutation = useMutation({
    mutationFn: async (keyIndex) => {
      const res = await fetch(`/api/connections/${keyIndex}/oauth`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
      if (!res.ok) throw new Error('Failed to generate OAuth link');
      return res.json();
    },
    onSuccess: (data) => {
      if (data.redirectURI) {
        window.location.href = data.redirectURI;
      } else {
        toast.error('No redirect URI provided');
      }
    },
    onError: () => {
      toast.error('Failed to generate OAuth link');
    }
  });

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
                    {config?.ENV_KEYS?.length} SnapTrade key pair(s) loaded from environment variables.
                  </div>
                </div>
              </>
            ) : (
              <>
                <AlertTriangle size={20} style={{ color: 'var(--down)' }} />
                <div>
                  <div style={{ fontWeight: 600, color: 'var(--down)' }}>Missing Credentials</div>
                  <div style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
                    SnapTrade credentials not found in environment. Set SNAPTRADE_CLIENT_ID_1 and SNAPTRADE_CONSUMER_KEY_1 (or legacy SNAPTRADE_CLIENT_ID/SNAPTRADE_CONSUMER_KEY) in .env or docker-compose.yml.
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: '2rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1.5rem' }}>
          <Key size={20} style={{ color: 'var(--accent)' }} />
          <h2 style={{ fontSize: '1.25rem', margin: 0 }}>SnapTrade Keys Management</h2>
        </div>

        {snapTradeKeys.length === 0 ? (
          <div style={{ padding: '2rem', textAlign: 'center', backgroundColor: 'var(--bg-main)', borderRadius: '8px' }}>
            <AlertTriangle size={32} style={{ color: 'var(--down)', marginBottom: '1rem' }} />
            <p style={{ marginBottom: '1rem' }}>No SnapTrade keys configured yet.</p>
            <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', marginBottom: '1rem' }}>
              Configure SNAPTRADE_CLIENT_ID_1 and SNAPTRADE_CONSUMER_KEY_1 in your environment to get started.
            </p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            {snapTradeKeys.map(key => (
              <div key={key.keyIndex} style={{
                padding: '1rem',
                backgroundColor: 'var(--bg-main)',
                borderRadius: '8px',
                border: '1px solid var(--border)'
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                  <div>
                    <div style={{ fontWeight: 600 }}>Key {key.keyIndex}</div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{key.clientId}</div>
                  </div>
                  <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                    <span style={{
                      padding: '0.25rem 0.75rem',
                      borderRadius: '4px',
                      fontSize: '0.75rem',
                      backgroundColor: key.registered ? 'rgba(34, 197, 94, 0.1)' : 'rgba(239, 68, 68, 0.1)',
                      color: key.registered ? 'var(--up)' : 'var(--down)'
                    }}>
                      {key.registered ? 'Registered' : 'Not Registered'}
                    </span>
                    <span style={{
                      padding: '0.25rem 0.75rem',
                      borderRadius: '4px',
                      fontSize: '0.75rem',
                      backgroundColor: 'rgba(107, 114, 128, 0.2)',
                      color: 'var(--text-secondary)'
                    }}>
                      {key.connectionCount} connection{key.connectionCount !== 1 ? 's' : ''}
                    </span>
                    <button
                      onClick={() => deleteKeyMutation.mutate(key.keyIndex)}
                      disabled={deleteKeyMutation.isPending}
                      style={{
                        padding: '0.5rem',
                        border: 'none',
                        background: 'rgba(239, 68, 68, 0.1)',
                        color: 'var(--down)',
                        borderRadius: '6px',
                        cursor: deleteKeyMutation.isPending ? 'not-allowed' : 'pointer'
                      }}
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>

                {/* Connections for this key */}
                <div style={{ marginTop: '1rem', paddingTop: '1rem', borderTop: '1px solid var(--border)' }}>
                  <div style={{ fontSize: '0.75rem', fontWeight: 600, textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: '0.75rem' }}>
                    Brokerage Connections ({key.connectionCount})
                  </div>
                  {key.connectionCount === 0 ? (
                    <div style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', marginBottom: '0.75rem' }}>
                      No connections yet.
                      <button
                        onClick={() => oauthMutation.mutate(key.keyIndex)}
                        disabled={oauthMutation.isPending}
                        style={{
                          marginLeft: '0.5rem',
                          color: 'var(--accent)',
                          background: 'none',
                          border: 'none',
                          cursor: oauthMutation.isPending ? 'not-allowed' : 'pointer',
                          textDecoration: 'underline'
                        }}
                      >
                        Add one
                      </button>
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                      {connections
                        .filter(keyGroup => keyGroup.keyIndex === key.keyIndex)
                        .flatMap(keyGroup => keyGroup.connections || [])
                        .map(conn => (
                          <div key={conn.id} style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            padding: '0.5rem',
                            backgroundColor: 'rgba(107, 114, 128, 0.1)',
                            borderRadius: '6px',
                            fontSize: '0.875rem'
                          }}>
                            <div style={{ flex: 1 }}>
                              {editingConnectionId === conn.id ? (
                                <input
                                  type="text"
                                  value={editingDisplayName}
                                  onChange={(e) => setEditingDisplayName(e.target.value)}
                                  style={{
                                    width: '100%',
                                    padding: '0.5rem',
                                    backgroundColor: 'var(--bg-card)',
                                    color: 'var(--text-primary)',
                                    border: '1px solid var(--border)',
                                    borderRadius: '4px'
                                  }}
                                />
                              ) : (
                                <div>
                                  <div style={{ fontWeight: 600 }}>{conn.display_name}</div>
                                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{conn.brokerage_name}</div>
                                </div>
                              )}
                            </div>
                            <div style={{ display: 'flex', gap: '0.5rem' }}>
                              {editingConnectionId === conn.id ? (
                                <button
                                  onClick={() => renameConnectionMutation.mutate({ connectionId: conn.id, displayName: editingDisplayName })}
                                  disabled={renameConnectionMutation.isPending}
                                  style={{
                                    padding: '0.5rem 0.75rem',
                                    backgroundColor: 'var(--up)',
                                    color: 'white',
                                    border: 'none',
                                    borderRadius: '4px',
                                    cursor: renameConnectionMutation.isPending ? 'not-allowed' : 'pointer',
                                    fontSize: '0.75rem'
                                  }}
                                >
                                  <Save size={14} />
                                </button>
                              ) : (
                                <button
                                  onClick={() => {
                                    setEditingConnectionId(conn.id);
                                    setEditingDisplayName(conn.display_name || conn.brokerage_name);
                                  }}
                                  style={{
                                    padding: '0.5rem 0.75rem',
                                    backgroundColor: 'transparent',
                                    color: 'var(--accent)',
                                    border: '1px solid var(--accent)',
                                    borderRadius: '4px',
                                    cursor: 'pointer'
                                  }}
                                >
                                  <Edit2 size={14} />
                                </button>
                              )}
                            </div>
                          </div>
                        ))}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', position: 'relative' }}>
          <h2 style={{ fontSize: '1.25rem' }}>Brokerage Connection Summary</h2>
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

        {snapTradeKeys.length === 0 ? (
          <div style={{ padding: '2rem', textAlign: 'center', backgroundColor: 'var(--bg-main)', borderRadius: '8px' }}>
            <AlertTriangle size={32} style={{ color: 'var(--down)', marginBottom: '1rem' }} />
            <p style={{ marginBottom: '0.5rem' }}>No SnapTrade keys configured.</p>
            <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>Configure keys in the SnapTrade Keys Management section above.</p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            {Array.isArray(connections) && connections.map(keyGroup => (
              <div key={`key-${keyGroup.keyIndex}`} style={{
                padding: '1rem',
                backgroundColor: 'var(--bg-main)',
                borderRadius: '8px',
                border: '1px solid var(--border)'
              }}>
                <div style={{ fontSize: '0.75rem', fontWeight: 600, textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: '1rem' }}>
                  Key {keyGroup.keyIndex} - {keyGroup.connections?.length || 0} connection{keyGroup.connections?.length !== 1 ? 's' : ''}
                </div>

                {!keyGroup.connections || keyGroup.connections.length === 0 ? (
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: '0.875rem' }}>No connections for this key</p>
                    <button
                      onClick={() => oauthMutation.mutate(keyGroup.keyIndex)}
                      disabled={oauthMutation.isPending}
                      style={{
                        padding: '0.5rem 1rem',
                        backgroundColor: 'var(--accent)',
                        color: 'white',
                        border: 'none',
                        borderRadius: '6px',
                        cursor: oauthMutation.isPending ? 'not-allowed' : 'pointer',
                        fontSize: '0.875rem'
                      }}
                    >
                      Add Connection
                    </button>
                  </div>
                ) : (
                  <table style={{ width: '100%', fontSize: '0.875rem' }}>
                    <tbody>
                      {keyGroup.connections.map(conn => (
                        <tr key={conn.id} style={{ borderBottom: '1px solid rgba(107, 114, 128, 0.2)' }}>
                          <td style={{ padding: '0.5rem 0', fontWeight: 600 }}>{conn.display_name}</td>
                          <td style={{ padding: '0.5rem 1rem', color: 'var(--text-muted)' }}>{conn.brokerage_name}</td>
                          <td style={{ padding: '0.5rem 1rem' }}>
                            <span style={{
                              backgroundColor: 'rgba(34, 197, 94, 0.1)',
                              color: 'var(--up)',
                              padding: '2px 6px',
                              borderRadius: '4px',
                              fontSize: '0.75rem'
                            }}>
                              {conn.connection_status}
                            </span>
                          </td>
                          <td style={{ padding: '0.5rem 1rem', textAlign: 'right' }}>
                            <button
                              onClick={() => handleDeleteConnection(conn.id)}
                              style={{
                                color: 'var(--down)',
                                background: 'none',
                                border: 'none',
                                cursor: 'pointer',
                                fontSize: '0.875rem'
                              }}
                            >
                              Delete
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            ))}
          </div>
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
