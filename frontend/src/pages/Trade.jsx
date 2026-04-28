import React, { useState, useEffect } from 'react';
import PriceChart from '../components/PriceChart';
import { Search, Info, CheckCircle2 } from 'lucide-react';
import { formatCurrency } from '../utils/format';

const Trade = () => {
  const [symbol, setSymbol] = useState('VFV.TO');
  const [accounts, setAccounts] = useState([]);
  const [selectedAccount, setSelectedAccount] = useState('');
  const [orderDetails, setOrderDetails] = useState({
    side: 'BUY',
    type: 'MARKET',
    quantity: '',
    limitPrice: ''
  });
  const [showConfirm, setShowConfirm] = useState(false);

  useEffect(() => {
    fetch('/api/accounts')
      .then(res => res.json())
      .then(data => {
        setAccounts(data);
        if (data.length > 0) setSelectedAccount(data[0].id);
      });
  }, []);

  const handleOrderSubmit = (e) => {
    e.preventDefault();
    setShowConfirm(true);
  };

  const confirmOrder = () => {
    alert('Order Submitted (Mock)');
    setShowConfirm(false);
    setOrderDetails({ ...orderDetails, quantity: '', limitPrice: '' });
  };

  const selectedAccountData = accounts.find(a => a.id === selectedAccount);

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 340px', gap: '2rem' }}>
      {/* Left Column: Chart & Info */}
      <div style={{ minWidth: 0 }}>
        <div className="card" style={{ marginBottom: '2rem', display: 'flex', alignItems: 'center', gap: '1rem', padding: '0.75rem 1rem' }}>
          <Search size={20} style={{ color: 'var(--text-muted)' }} />
          <input 
            type="text" 
            placeholder="Search symbol (e.g. VFV.TO, TSLA)..." 
            value={symbol}
            onChange={(e) => setSymbol(e.target.value.toUpperCase())}
            style={{ 
              background: 'transparent', 
              border: 'none', 
              color: 'var(--text-primary)', 
              fontSize: '1rem', 
              width: '100%',
              outline: 'none'
            }}
          />
        </div>

        <PriceChart symbol={symbol} />

        <div className="card">
          <h3 style={{ fontSize: '1rem', marginBottom: '1rem' }}>Symbol Details</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '1rem', fontSize: '0.875rem' }}>
            <div>
              <div style={{ color: 'var(--text-muted)' }}>Symbol</div>
              <div style={{ fontWeight: 600 }}>{symbol}</div>
            </div>
            <div>
              <div style={{ color: 'var(--text-muted)' }}>Currency</div>
              <div style={{ fontWeight: 600 }}>{symbol.endsWith('.TO') ? 'CAD' : 'USD'}</div>
            </div>
            <div>
              <div style={{ color: 'var(--text-muted)' }}>Market Cap</div>
              <div style={{ fontWeight: 600 }}>$1.2T</div>
            </div>
            <div>
              <div style={{ color: 'var(--text-muted)' }}>52-Week High</div>
              <div style={{ fontWeight: 600 }}>$132.50</div>
            </div>
          </div>
        </div>
      </div>

      {/* Right Column: Order Ticket */}
      <div style={{ minWidth: 0 }}>
        <div className="card" style={{ position: 'sticky', top: 'calc(var(--header-height) + 2rem)' }}>
          <h2 style={{ fontSize: '1.25rem', marginBottom: '1.5rem' }}>Place Order</h2>
          
          <form onSubmit={handleOrderSubmit}>
            <div style={{ marginBottom: '1.5rem' }}>
              <label style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.5rem', textTransform: 'uppercase' }}>Account</label>
              <select 
                value={selectedAccount} 
                onChange={(e) => setSelectedAccount(e.target.value)}
                style={{ 
                  width: '100%', 
                  padding: '0.75rem', 
                  background: 'var(--bg-main)', 
                  color: 'white', 
                  border: '1px solid var(--border)', 
                  borderRadius: '8px' 
                }}
              >
                {accounts.map(acc => (
                  <option key={acc.id} value={acc.id}>
                    Person {acc.person} — {acc.type}
                  </option>
                ))}
              </select>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem', marginBottom: '1.5rem' }}>
              {['BUY', 'SELL'].map(side => (
                <button
                  key={side}
                  type="button"
                  onClick={() => setOrderDetails({ ...orderDetails, side })}
                  style={{
                    padding: '0.75rem',
                    borderRadius: '8px',
                    border: '1px solid var(--border)',
                    fontWeight: 600,
                    cursor: 'pointer',
                    background: orderDetails.side === side ? (side === 'BUY' ? 'var(--up)' : 'var(--down)') : 'transparent',
                    color: orderDetails.side === side ? 'white' : 'var(--text-secondary)'
                  }}
                >
                  {side}
                </button>
              ))}
            </div>

            <div style={{ marginBottom: '1.5rem' }}>
              <label style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.5rem', textTransform: 'uppercase' }}>Quantity</label>
              <input 
                type="number" 
                placeholder="0"
                value={orderDetails.quantity}
                onChange={(e) => setOrderDetails({ ...orderDetails, quantity: e.target.value })}
                required
                style={{ 
                  width: '100%', 
                  padding: '0.75rem', 
                  background: 'var(--bg-main)', 
                  color: 'white', 
                  border: '1px solid var(--border)', 
                  borderRadius: '8px' 
                }}
              />
            </div>

            <div style={{ marginBottom: '1.5rem' }}>
              <label style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.5rem', textTransform: 'uppercase' }}>Order Type</label>
              <select 
                value={orderDetails.type}
                onChange={(e) => setOrderDetails({ ...orderDetails, type: e.target.value })}
                style={{ 
                  width: '100%', 
                  padding: '0.75rem', 
                  background: 'var(--bg-main)', 
                  color: 'white', 
                  border: '1px solid var(--border)', 
                  borderRadius: '8px' 
                }}
              >
                <option value="MARKET">Market</option>
                <option value="LIMIT">Limit</option>
              </select>
            </div>

            {orderDetails.type === 'LIMIT' && (
              <div style={{ marginBottom: '1.5rem' }}>
                <label style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.5rem', textTransform: 'uppercase' }}>Limit Price</label>
                <input 
                  type="number" 
                  step="0.01"
                  placeholder="0.00"
                  value={orderDetails.limitPrice}
                  onChange={(e) => setOrderDetails({ ...orderDetails, limitPrice: e.target.value })}
                  style={{ 
                    width: '100%', 
                    padding: '0.75rem', 
                    background: 'var(--bg-main)', 
                    color: 'white', 
                    border: '1px solid var(--border)', 
                    borderRadius: '8px' 
                  }}
                />
              </div>
            )}

            <button 
              type="submit"
              style={{
                width: '100%',
                padding: '1rem',
                borderRadius: '8px',
                border: 'none',
                background: 'var(--accent)',
                color: 'white',
                fontWeight: 700,
                cursor: 'pointer',
                fontSize: '1rem'
              }}
            >
              Preview {orderDetails.side}
            </button>
          </form>
        </div>
      </div>

      {/* Confirmation Modal */}
      {showConfirm && (
        <div style={{ 
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, 
          backgroundColor: 'rgba(0,0,0,0.8)', display: 'flex', 
          alignItems: 'center', justifyContent: 'center', zIndex: 100 
        }}>
          <div className="card" style={{ maxWidth: '400px', width: '90%', textAlign: 'center' }}>
            <div style={{ color: 'var(--accent)', marginBottom: '1rem' }}>
              <Info size={48} style={{ margin: '0 auto' }} />
            </div>
            <h2 style={{ marginBottom: '1rem' }}>Confirm Order</h2>
            <div style={{ textAlign: 'left', marginBottom: '2rem', backgroundColor: 'var(--bg-main)', padding: '1rem', borderRadius: '8px' }}>
              <div style={{ marginBottom: '0.5rem' }}><span style={{ color: 'var(--text-muted)' }}>Action:</span> <span style={{ fontWeight: 600, color: orderDetails.side === 'BUY' ? 'var(--up)' : 'var(--down)' }}>{orderDetails.side} {orderDetails.quantity} {symbol}</span></div>
              <div style={{ marginBottom: '0.5rem' }}><span style={{ color: 'var(--text-muted)' }}>Account:</span> <span style={{ fontWeight: 600 }}>Person {selectedAccountData?.person} — {selectedAccountData?.type}</span></div>
              <div style={{ marginBottom: '0.5rem' }}><span style={{ color: 'var(--text-muted)' }}>Total (Est):</span> <span style={{ fontWeight: 600 }}>{formatCurrency(orderDetails.quantity * (orderDetails.limitPrice || 100))}</span></div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
              <button 
                onClick={() => setShowConfirm(false)}
                style={{ padding: '0.75rem', borderRadius: '8px', border: '1px solid var(--border)', background: 'transparent', color: 'white', cursor: 'pointer' }}
              >
                Cancel
              </button>
              <button 
                onClick={confirmOrder}
                style={{ padding: '0.75rem', borderRadius: '8px', border: 'none', background: 'var(--up)', color: 'white', fontWeight: 600, cursor: 'pointer' }}
              >
                Submit Trade
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Trade;
