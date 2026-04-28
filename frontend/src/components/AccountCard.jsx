import React from 'react';
import { formatCurrency, formatPercent } from '../utils/format';
import { TrendingUp, TrendingDown } from 'lucide-react';

const AccountCard = ({ account, personColor }) => {
  const isPositive = (account.dayChange || 0) >= 0;

  return (
    <div className="glass-card" style={{ position: 'relative', overflow: 'hidden' }}>
      <div style={{ 
        position: 'absolute', 
        top: 0, 
        left: 0, 
        right: 0, 
        height: '4px', 
        backgroundColor: personColor 
      }} />
      <div style={{ position: 'absolute', top: 0, right: 0, padding: '0.5rem' }}>
        <span style={{
          fontSize: '0.75rem',
          padding: '2px 8px',
          borderRadius: '12px',
          backgroundColor: `${personColor}22`,
          color: personColor,
          fontWeight: 600
        }}>
          {account.type || account.accountName}
        </span>
      </div>

      <h3 style={{ fontSize: '1rem', color: 'var(--text-secondary)', marginBottom: '0.5rem' }}>
        {account.person}
      </h3>
      
      <div style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: '0.25rem' }}>
        {formatCurrency(account.value)}
      </div>
      
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.875rem' }}>
        <span className={isPositive ? 'text-up' : 'text-down'} style={{ display: 'flex', alignItems: 'center' }}>
          {isPositive ? <TrendingUp size={16} /> : <TrendingDown size={16} />}
          <span style={{ marginLeft: '4px' }}>{formatCurrency(account.dayChange)} ({formatPercent(account.dayChangePercent)})</span>
        </span>
      </div>

      <div style={{ marginTop: '1rem', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
        {account.allocation}% of {account.person}'s Total
      </div>
    </div>
  );
};

export default AccountCard;
