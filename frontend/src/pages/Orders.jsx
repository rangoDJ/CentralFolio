import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { formatCurrency, formatDate } from '../utils/format';
import { History, Activity, Clock, CheckCircle2, XCircle, AlertCircle } from 'lucide-react';

const Orders = () => {
  const [activeTab, setActiveTab] = useState('brokerage');

  const { data: brokerageOrders = [], isLoading: loadingBrokerage } = useQuery({
    queryKey: ['orders'],
    queryFn: () => fetch('/api/orders').then(res => res.json()),
    refetchInterval: 30000
  });

  const { data: automationLogs = [], isLoading: loadingAutomation } = useQuery({
    queryKey: ['automationLogs'],
    queryFn: () => fetch('/api/automation-history').then(res => res.json()),
    refetchInterval: 30000
  });

  const getStatusBadge = (status) => {
    const s = status?.toUpperCase() || '';
    if (s.includes('FILLED') || s === 'SUCCESS') return { icon: <CheckCircle2 size={14} />, color: 'var(--up)', bg: 'rgba(0, 200, 150, 0.1)', text: 'Filled' };
    if (s.includes('CANCELED') || s === 'FAILED') return { icon: <XCircle size={14} />, color: 'var(--down)', bg: 'rgba(255, 100, 100, 0.1)', text: 'Canceled' };
    if (s.includes('PENDING') || s.includes('OPEN')) return { icon: <Clock size={14} />, color: 'var(--accent)', bg: 'rgba(0, 200, 150, 0.1)', text: 'Open' };
    return { icon: <AlertCircle size={14} />, color: 'var(--text-secondary)', bg: 'rgba(255, 255, 255, 0.05)', text: status };
  };

  return (
    <div style={{ maxWidth: '1200px' }}>
      <div style={{ marginBottom: '2rem' }}>
        <h1 style={{ fontSize: '2rem', fontWeight: 700, marginBottom: '0.25rem' }}>Order History</h1>
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>Recent trades and automated reinvestments</p>
      </div>

      <div style={{ display: 'flex', gap: '1rem', marginBottom: '2rem', borderBottom: '1px solid var(--border)', paddingBottom: '1rem' }}>
        <button 
          onClick={() => setActiveTab('brokerage')}
          style={{
            padding: '0.5rem 1rem',
            borderRadius: '8px',
            border: 'none',
            backgroundColor: activeTab === 'brokerage' ? 'rgba(0, 200, 150, 0.1)' : 'transparent',
            color: activeTab === 'brokerage' ? 'var(--accent)' : 'var(--text-muted)',
            cursor: 'pointer',
            fontWeight: activeTab === 'brokerage' ? 600 : 400,
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem'
          }}
        >
          <History size={18} />
          Brokerage Orders
        </button>
        <button 
          onClick={() => setActiveTab('automation')}
          style={{
            padding: '0.5rem 1rem',
            borderRadius: '8px',
            border: 'none',
            backgroundColor: activeTab === 'automation' ? 'rgba(0, 200, 150, 0.1)' : 'transparent',
            color: activeTab === 'automation' ? 'var(--accent)' : 'var(--text-muted)',
            cursor: 'pointer',
            fontWeight: activeTab === 'automation' ? 600 : 400,
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem'
          }}
        >
          <Activity size={18} />
          Automation History
        </button>
      </div>

      <div className="card" style={{ padding: '0' }}>
        {activeTab === 'brokerage' ? (
          <div style={{ overflowX: 'auto' }}>
            {loadingBrokerage ? <div style={{ padding: '3rem', textAlign: 'center' }}>Loading orders...</div> : (
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--border)', color: 'var(--text-secondary)', fontSize: '0.75rem', textTransform: 'uppercase' }}>
                    <th style={{ textAlign: 'left', padding: '1rem' }}>Time</th>
                    <th style={{ textAlign: 'left', padding: '1rem' }}>Account</th>
                    <th style={{ textAlign: 'left', padding: '1rem' }}>Symbol</th>
                    <th style={{ textAlign: 'left', padding: '1rem' }}>Side</th>
                    <th style={{ textAlign: 'left', padding: '1rem' }}>Qty</th>
                    <th style={{ textAlign: 'left', padding: '1rem' }}>Price</th>
                    <th style={{ textAlign: 'left', padding: '1rem' }}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {brokerageOrders.length === 0 ? (
                    <tr>
                      <td colSpan="7" style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)' }}>No recent orders found.</td>
                    </tr>
                  ) : (
                    brokerageOrders.map(order => {
                      const badge = getStatusBadge(order.state || order.status);
                      return (
                        <tr key={order.id} style={{ borderBottom: '1px solid var(--border)', fontSize: '0.875rem' }}>
                          <td style={{ padding: '1rem', whiteSpace: 'nowrap' }}>{formatDate(order.time_placed || order.timestamp)}</td>
                          <td style={{ padding: '1rem' }}>
                            <div style={{ fontWeight: 600 }}>{order.person}</div>
                            <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{order.accountName}</div>
                          </td>
                          <td style={{ padding: '1rem', fontWeight: 700 }}>{order.symbol?.symbol?.symbol || order.symbol}</td>
                          <td style={{ padding: '1rem' }}>
                            <span style={{ color: order.action === 'BUY' ? 'var(--up)' : 'var(--down)', fontWeight: 600 }}>
                              {order.action}
                            </span>
                          </td>
                          <td style={{ padding: '1rem' }}>{order.units || order.total_quantity}</td>
                          <td style={{ padding: '1rem' }}>{order.price ? formatCurrency(order.price) : 'MKT'}</td>
                          <td style={{ padding: '1rem' }}>
                            <div style={{ 
                              display: 'inline-flex', 
                              alignItems: 'center', 
                              gap: '0.4rem', 
                              padding: '0.25rem 0.6rem', 
                              borderRadius: '20px', 
                              backgroundColor: badge.bg, 
                              color: badge.color,
                              fontSize: '0.75rem',
                              fontWeight: 600
                            }}>
                              {badge.icon}
                              {badge.text}
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            )}
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            {loadingAutomation ? <div style={{ padding: '3rem', textAlign: 'center' }}>Loading history...</div> : (
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--border)', color: 'var(--text-secondary)', fontSize: '0.75rem', textTransform: 'uppercase' }}>
                    <th style={{ textAlign: 'left', padding: '1rem' }}>Time</th>
                    <th style={{ textAlign: 'left', padding: '1rem' }}>Symbol</th>
                    <th style={{ textAlign: 'left', padding: '1rem' }}>Amount</th>
                    <th style={{ textAlign: 'left', padding: '1rem' }}>Status</th>
                    <th style={{ textAlign: 'left', padding: '1rem' }}>Order ID</th>
                  </tr>
                </thead>
                <tbody>
                  {automationLogs.length === 0 ? (
                    <tr>
                      <td colSpan="5" style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)' }}>No automation history found.</td>
                    </tr>
                  ) : (
                    automationLogs.map(log => {
                      const badge = getStatusBadge(log.status);
                      return (
                        <tr key={log.id} style={{ borderBottom: '1px solid var(--border)', fontSize: '0.875rem' }}>
                          <td style={{ padding: '1rem' }}>{formatDate(log.timestamp)}</td>
                          <td style={{ padding: '1rem', fontWeight: 700 }}>{log.symbol}</td>
                          <td style={{ padding: '1rem', color: 'var(--up)', fontWeight: 600 }}>{formatCurrency(log.amount_reinvested)}</td>
                          <td style={{ padding: '1rem' }}>
                            <div style={{ 
                              display: 'inline-flex', 
                              alignItems: 'center', 
                              gap: '0.4rem', 
                              padding: '0.25rem 0.6rem', 
                              borderRadius: '20px', 
                              backgroundColor: badge.bg, 
                              color: badge.color,
                              fontSize: '0.75rem',
                              fontWeight: 600
                            }}>
                              {badge.icon}
                              {badge.text}
                            </div>
                          </td>
                          <td style={{ padding: '1rem', color: 'var(--text-muted)', fontSize: '0.75rem' }}>{log.order_id || 'N/A'}</td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default Orders;
