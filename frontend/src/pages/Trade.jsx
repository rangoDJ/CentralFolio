import React, { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import PriceChart from '../components/PriceChart';
import AccountSelector from '../components/AccountSelector';
import { Search, Info, CheckCircle2, Loader2 } from 'lucide-react';
import { formatCurrency } from '../utils/format';

const Trade = () => {
  const queryClient = useQueryClient();
  const [symbol, setSymbol] = useState('VFV.TO');
  const [selectedAccount, setSelectedAccount] = useState('');
  const [orderQuantityType, setOrderQuantityType] = useState('shares');
  const [orderDetails, setOrderDetails] = useState({
    side: 'BUY',
    type: 'MARKET',
    quantity: '',
    amount: '',
    limitPrice: ''
  });
  const [showConfirm, setShowConfirm] = useState(false);
  const [currentPrice, setCurrentPrice] = useState(100);

  const { data: accounts = [] } = useQuery({
    queryKey: ['accounts'],
    queryFn: () => fetch('/api/accounts').then(res => res.json())
  });

  const placeOrderMutation = useMutation({
    mutationFn: async () => {
      const quantity = orderQuantityType === 'shares'
        ? parseFloat(orderDetails.quantity)
        : parseFloat(orderDetails.amount) / currentPrice;

      const payload = {
        accountId: selectedAccount,
        symbol: symbol,
        side: orderDetails.side,
        orderType: orderDetails.type,
        quantity: quantity,
        ...(orderDetails.type === 'LIMIT' && { limitPrice: parseFloat(orderDetails.limitPrice) })
      };

      const res = await fetch('/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || 'Failed to place order');
      }

      return res.json();
    },
    onSuccess: (data) => {
      toast.success(`Order placed successfully! Order ID: ${data.orderId || 'Pending'}`);
      queryClient.invalidateQueries({ queryKey: ['orders'] });
      setShowConfirm(false);
      setOrderDetails({
        side: 'BUY',
        type: 'MARKET',
        quantity: '',
        amount: '',
        limitPrice: ''
      });
    },
    onError: (error) => {
      toast.error(error.message || 'Failed to place order');
    }
  });

  const handleOrderSubmit = (e) => {
    e.preventDefault();
    setShowConfirm(true);
  };

  const confirmOrder = () => {
    placeOrderMutation.mutate();
  };

  const isFormValid = () => {
    if (!selectedAccount) return false;

    const quantityValid = orderQuantityType === 'shares'
      ? parseFloat(orderDetails.quantity) > 0
      : parseFloat(orderDetails.amount) > 0 && (parseFloat(orderDetails.amount) / currentPrice) > 0;

    if (!quantityValid) return false;

    if (orderDetails.type === 'LIMIT') {
      return parseFloat(orderDetails.limitPrice) > 0;
    }

    return true;
  };

  const getCalculatedQuantity = () => {
    if (orderQuantityType === 'shares') {
      return parseFloat(orderDetails.quantity);
    }
    return parseFloat(orderDetails.amount) / currentPrice;
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
              <AccountSelector
                selectedAccount={selectedAccount}
                onAccountChange={setSelectedAccount}
                disabled={placeOrderMutation.isPending}
              />
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
              <label style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.5rem', textTransform: 'uppercase' }}>Order Amount Type</label>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem', marginBottom: '1rem' }}>
                {['shares', 'amount'].map(type => (
                  <button
                    key={type}
                    type="button"
                    onClick={() => setOrderQuantityType(type)}
                    style={{
                      padding: '0.75rem',
                      borderRadius: '8px',
                      border: '1px solid var(--border)',
                      fontWeight: 600,
                      cursor: 'pointer',
                      background: orderQuantityType === type ? 'var(--accent)' : 'transparent',
                      color: orderQuantityType === type ? 'white' : 'var(--text-secondary)'
                    }}
                  >
                    {type === 'shares' ? 'Fixed Shares' : 'Fixed Amount'}
                  </button>
                ))}
              </div>
            </div>

            {orderQuantityType === 'shares' ? (
              <div style={{ marginBottom: '1.5rem' }}>
                <label style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.5rem', textTransform: 'uppercase' }}>Quantity (Shares)</label>
                <input
                  type="number"
                  placeholder="0"
                  value={orderDetails.quantity}
                  onChange={(e) => setOrderDetails({ ...orderDetails, quantity: e.target.value })}
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
            ) : (
              <div style={{ marginBottom: '1.5rem' }}>
                <label style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.5rem', textTransform: 'uppercase' }}>Amount (CAD)</label>
                <input
                  type="number"
                  placeholder="0.00"
                  value={orderDetails.amount}
                  onChange={(e) => setOrderDetails({ ...orderDetails, amount: e.target.value })}
                  style={{
                    width: '100%',
                    padding: '0.75rem',
                    background: 'var(--bg-main)',
                    color: 'white',
                    border: '1px solid var(--border)',
                    borderRadius: '8px',
                    marginBottom: '0.5rem'
                  }}
                />
                {orderDetails.amount && currentPrice > 0 && (
                  <div style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
                    ≈ {(parseFloat(orderDetails.amount) / currentPrice).toFixed(4)} shares @ {formatCurrency(currentPrice)}/share
                  </div>
                )}
              </div>
            )}

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
                    border: `1px solid ${!orderDetails.limitPrice ? 'var(--down)' : 'var(--border)'}`,
                    borderRadius: '8px'
                  }}
                />
                {!orderDetails.limitPrice && (
                  <div style={{ fontSize: '0.75rem', color: 'var(--down)', marginTop: '0.25rem' }}>Required for limit orders</div>
                )}
              </div>
            )}

            <button
              type="submit"
              disabled={!isFormValid() || placeOrderMutation.isPending}
              style={{
                width: '100%',
                padding: '1rem',
                borderRadius: '8px',
                border: 'none',
                background: 'var(--accent)',
                color: 'white',
                fontWeight: 700,
                cursor: isFormValid() && !placeOrderMutation.isPending ? 'pointer' : 'not-allowed',
                fontSize: '1rem',
                opacity: isFormValid() && !placeOrderMutation.isPending ? 1 : 0.6
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
              <div style={{ marginBottom: '0.5rem' }}>
                <span style={{ color: 'var(--text-muted)' }}>Action:</span>
                <span style={{ fontWeight: 600, color: orderDetails.side === 'BUY' ? 'var(--up)' : 'var(--down)' }}>
                  {orderDetails.side} {orderQuantityType === 'shares' ? `${orderDetails.quantity} shares` : `${formatCurrency(parseFloat(orderDetails.amount))} worth (~${getCalculatedQuantity().toFixed(4)} shares)`} of {symbol}
                </span>
              </div>
              <div style={{ marginBottom: '0.5rem' }}><span style={{ color: 'var(--text-muted)' }}>Account:</span> <span style={{ fontWeight: 600 }}>{selectedAccountData?.person} — {selectedAccountData?.accountName}</span></div>
              {orderDetails.type === 'LIMIT' && (
                <div style={{ marginBottom: '0.5rem' }}><span style={{ color: 'var(--text-muted)' }}>Limit Price:</span> <span style={{ fontWeight: 600 }}>{formatCurrency(parseFloat(orderDetails.limitPrice))}</span></div>
              )}
              <div style={{ marginBottom: '0.5rem' }}><span style={{ color: 'var(--text-muted)' }}>Total (Est):</span> <span style={{ fontWeight: 600 }}>{formatCurrency(getCalculatedQuantity() * (parseFloat(orderDetails.limitPrice) || currentPrice))}</span></div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
              <button
                onClick={() => setShowConfirm(false)}
                disabled={placeOrderMutation.isPending}
                style={{ padding: '0.75rem', borderRadius: '8px', border: '1px solid var(--border)', background: 'transparent', color: 'white', cursor: placeOrderMutation.isPending ? 'not-allowed' : 'pointer', opacity: placeOrderMutation.isPending ? 0.6 : 1 }}
              >
                Cancel
              </button>
              <button
                onClick={confirmOrder}
                disabled={placeOrderMutation.isPending}
                style={{ padding: '0.75rem', borderRadius: '8px', border: 'none', background: 'var(--up)', color: 'white', fontWeight: 600, cursor: placeOrderMutation.isPending ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem' }}
              >
                {placeOrderMutation.isPending ? (
                  <>
                    <Loader2 size={16} className="animate-spin" />
                    Submitting...
                  </>
                ) : (
                  'Submit Trade'
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Trade;
