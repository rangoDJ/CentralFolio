import React, { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { X, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import { formatCurrency } from '../utils/format';

// ─── Ticker Icon ─────────────────────────────────────────────────────────────

const ICON_PALETTES = [
  { bg: '#0d2137', color: '#4a9eff' },
  { bg: '#0d2a1e', color: '#34d399' },
  { bg: '#1e0d2a', color: '#a78bfa' },
  { bg: '#2a0d0d', color: '#f87171' },
  { bg: '#2a1a0d', color: '#fb923c' },
  { bg: '#0d2a2a', color: '#22d3ee' },
  { bg: '#1a1a0d', color: '#fbbf24' },
  { bg: '#1e0d1a', color: '#f472b6' },
];

const TickerIcon = ({ symbol }) => {
  let hash = 0;
  for (let i = 0; i < symbol.length; i++) hash = symbol.charCodeAt(i) + ((hash << 5) - hash);
  const p = ICON_PALETTES[Math.abs(hash) % ICON_PALETTES.length];
  return (
    <div style={{
      width: 42, height: 42, borderRadius: '50%',
      backgroundColor: p.bg, border: '1px solid rgba(255,255,255,0.08)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: '9px', fontWeight: 800, color: p.color,
      flexShrink: 0, letterSpacing: '0.04em', userSelect: 'none'
    }}>
      {symbol.slice(0, 4)}
    </div>
  );
};

// ─── Quick Order Modal ────────────────────────────────────────────────────────

const QuickOrderModal = ({ position, initialSide, onClose }) => {
  const { data: accounts = [] } = useQuery({
    queryKey: ['accounts'],
    queryFn: () => fetch('/api/accounts').then(r => r.json()),
    staleTime: 60000
  });

  const [side, setSide]           = useState(initialSide);
  const [accountId, setAccountId] = useState('');
  const [orderType, setOrderType] = useState('MARKET');
  const [quantity, setQuantity]   = useState('');
  const [limitPrice, setLimitPrice] = useState(position.nativePrice?.toFixed(2) || '');
  const [step, setStep]           = useState('form'); // 'form' | 'confirm'
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (accounts.length && !accountId) setAccountId(accounts[0].id);
  }, [accounts]);

  useEffect(() => {
    const handler = e => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  const selectedAccount = accounts.find(a => a.id === accountId);
  const priceForEst = orderType === 'LIMIT' ? parseFloat(limitPrice) || 0 : position.nativePrice || 0;
  const estNative   = parseFloat(quantity || 0) * priceForEst;
  const canPreview  = parseFloat(quantity) > 0 && accountId;

  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      const res = await fetch('/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          accountId,
          symbol: position.symbol,
          universalSymbolId: position.universalSymbolId || null,
          side,
          orderType,
          quantity: parseFloat(quantity),
          ...(orderType === 'LIMIT' && limitPrice ? { limitPrice: parseFloat(limitPrice) } : {})
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(
        typeof data.detail === 'string' ? data.detail : JSON.stringify(data.detail) || data.error
      );
      toast.success(`${side} ${quantity} ${position.symbol} submitted`);
      onClose();
    } catch (err) {
      toast.error(`Order failed: ${err.message}`);
      setStep('form');
    } finally {
      setSubmitting(false);
    }
  };

  const Label = ({ children }) => (
    <div style={{ fontSize: '0.7rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-muted)', marginBottom: '0.4rem' }}>
      {children}
    </div>
  );

  const inputStyle = {
    width: '100%', padding: '0.75rem',
    background: 'var(--bg-main)', border: '1px solid var(--border)',
    borderRadius: '8px', color: 'var(--text-primary)', fontSize: '0.875rem',
    outline: 'none', boxSizing: 'border-box'
  };

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 300 }}
      onClick={onClose}
    >
      <div
        className="card"
        style={{ width: '100%', maxWidth: '420px', position: 'relative', margin: '1rem' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Close */}
        <button onClick={onClose} style={{ position: 'absolute', top: '1rem', right: '1rem', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', display: 'flex', padding: '4px' }}>
          <X size={18} />
        </button>

        {step === 'form' ? (
          <>
            {/* Symbol header */}
            <div style={{ marginBottom: '1.5rem', paddingRight: '2rem' }}>
              <div style={{ fontSize: '1.25rem', fontWeight: 700 }}>{position.symbol}</div>
              {position.description && (
                <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '2px' }}>{position.description}</div>
              )}
              <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: '4px' }}>
                Current price: {position.currency === 'USD' ? `$${position.nativePrice?.toFixed(2)} USD` : `$${position.nativePrice?.toFixed(2)} CAD`}
                {' · '}{position.shares} held
              </div>
            </div>

            {/* BUY / SELL */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem', marginBottom: '1.25rem' }}>
              {['BUY', 'SELL'].map(s => (
                <button key={s} onClick={() => setSide(s)} style={{
                  padding: '0.75rem', borderRadius: '8px', fontWeight: 700, cursor: 'pointer', fontSize: '0.875rem',
                  border: `1px solid ${side === s ? (s === 'BUY' ? 'var(--up)' : 'var(--down)') : 'var(--border)'}`,
                  background: side === s ? (s === 'BUY' ? 'rgba(52,211,153,0.12)' : 'rgba(248,113,113,0.12)') : 'transparent',
                  color: side === s ? (s === 'BUY' ? 'var(--up)' : 'var(--down)') : 'var(--text-muted)',
                  transition: 'all 0.15s'
                }}>
                  {s}
                </button>
              ))}
            </div>

            {/* Account */}
            <div style={{ marginBottom: '1rem' }}>
              <Label>Account</Label>
              <select value={accountId} onChange={e => setAccountId(e.target.value)} style={{ ...inputStyle, cursor: 'pointer' }}>
                {accounts.map(a => (
                  <option key={a.id} value={a.id}>
                    {a.person ? `${a.person} — ` : ''}{a.accountName}
                  </option>
                ))}
              </select>
            </div>

            {/* Quantity */}
            <div style={{ marginBottom: '1rem' }}>
              <Label>Quantity (shares)</Label>
              <input
                type="number" min="0.001" step="any" placeholder="0"
                value={quantity} onChange={e => setQuantity(e.target.value)}
                style={inputStyle} autoFocus
              />
            </div>

            {/* Order type */}
            <div style={{ marginBottom: '1rem' }}>
              <Label>Order Type</Label>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
                {[['MARKET', 'Market'], ['LIMIT', 'Limit']].map(([val, label]) => (
                  <button key={val} onClick={() => setOrderType(val)} style={{
                    padding: '0.625rem', borderRadius: '8px', fontWeight: orderType === val ? 600 : 400,
                    cursor: 'pointer', fontSize: '0.8rem',
                    border: `1px solid ${orderType === val ? 'var(--accent)' : 'var(--border)'}`,
                    background: orderType === val ? 'rgba(0,200,150,0.12)' : 'transparent',
                    color: orderType === val ? 'var(--accent)' : 'var(--text-muted)',
                    transition: 'all 0.15s'
                  }}>
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {/* Limit Price */}
            {orderType === 'LIMIT' && (
              <div style={{ marginBottom: '1rem' }}>
                <Label>Limit Price ({position.currency})</Label>
                <input type="number" step="0.01" placeholder="0.00" value={limitPrice} onChange={e => setLimitPrice(e.target.value)} style={inputStyle} />
              </div>
            )}

            {/* Estimated value */}
            {parseFloat(quantity) > 0 && (
              <div style={{ padding: '0.75rem 1rem', background: 'var(--bg-main)', borderRadius: '8px', marginBottom: '1.25rem', display: 'flex', justifyContent: 'space-between', fontSize: '0.875rem' }}>
                <span style={{ color: 'var(--text-muted)' }}>Estimated value</span>
                <span style={{ fontWeight: 600 }}>${estNative.toFixed(2)} {position.currency}</span>
              </div>
            )}

            <button
              onClick={() => setStep('confirm')}
              disabled={!canPreview}
              style={{
                width: '100%', padding: '0.875rem', borderRadius: '8px', border: 'none',
                background: side === 'BUY' ? 'var(--up)' : 'var(--down)',
                color: 'white', fontWeight: 700, fontSize: '0.9rem',
                cursor: canPreview ? 'pointer' : 'not-allowed',
                opacity: canPreview ? 1 : 0.4, transition: 'opacity 0.15s'
              }}
            >
              Preview {side === 'BUY' ? 'Buy' : 'Sell'} Order →
            </button>
          </>
        ) : (
          <>
            {/* Confirmation */}
            <div style={{ fontSize: '1.1rem', fontWeight: 700, marginBottom: '1.5rem', paddingRight: '2rem' }}>Confirm Order</div>

            <div style={{ background: 'var(--bg-main)', borderRadius: '12px', padding: '1.25rem', marginBottom: '1.25rem' }}>
              {[
                ['Action', <span style={{ fontWeight: 700, color: side === 'BUY' ? 'var(--up)' : 'var(--down)' }}>{side} {quantity} {position.symbol}</span>],
                ['Account', `${selectedAccount?.person ? `${selectedAccount.person} — ` : ''}${selectedAccount?.accountName || '—'}`],
                ['Order Type', orderType === 'MARKET' ? 'Market' : `Limit @ $${limitPrice} ${position.currency}`],
                ['Est. Value', `$${estNative.toFixed(2)} ${position.currency}`],
              ].map(([label, value]) => (
                <div key={label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                  <span style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>{label}</span>
                  <span style={{ fontWeight: 600, fontSize: '0.875rem' }}>{value}</span>
                </div>
              ))}
            </div>

            <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.5rem', padding: '0.75rem 1rem', background: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.2)', borderRadius: '8px', marginBottom: '1.25rem', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
              <AlertTriangle size={14} style={{ flexShrink: 0, marginTop: '1px', color: 'var(--down)' }} />
              This will be submitted to your live brokerage account and cannot be undone.
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
              <button onClick={() => setStep('form')} style={{ padding: '0.875rem', borderRadius: '8px', border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-secondary)', cursor: 'pointer', fontWeight: 600 }}>
                ← Back
              </button>
              <button
                onClick={handleSubmit}
                disabled={submitting}
                style={{ padding: '0.875rem', borderRadius: '8px', border: 'none', background: side === 'BUY' ? 'var(--up)' : 'var(--down)', color: 'white', fontWeight: 700, cursor: submitting ? 'wait' : 'pointer', opacity: submitting ? 0.6 : 1, transition: 'opacity 0.15s' }}
              >
                {submitting ? 'Submitting…' : 'Submit Trade'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

// ─── Holdings Table ───────────────────────────────────────────────────────────

const HoldingsTable = ({ title, positions, fxRate }) => {
  const [hoveredRow, setHoveredRow] = useState(null);
  const [quickOrder, setQuickOrder] = useState(null); // { position, side }

  if (!positions || positions.length === 0) return null;

  const TH = ({ children, right, width }) => (
    <th style={{
      padding: '0.875rem 1.5rem', textAlign: right ? 'right' : 'left',
      fontSize: '0.78rem', fontWeight: 500, color: 'var(--text-muted)',
      whiteSpace: 'nowrap', borderBottom: '1px solid var(--border)',
      ...(width ? { width } : {})
    }}>
      {children}
    </th>
  );

  return (
    <>
      <div style={{ marginBottom: '2rem' }}>
        {title && (
          <div style={{ fontSize: '0.7rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--text-muted)', marginBottom: '0.75rem' }}>
            {title}
          </div>
        )}
        <div style={{ borderRadius: '16px', overflow: 'hidden', border: '1px solid var(--border)', backgroundColor: 'var(--bg-card)' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <TH>Positions</TH>
                <TH right>Total value</TH>
                <TH right>Today's price</TH>
                <TH right>Day P&amp;L</TH>
                <TH width="140px" />
              </tr>
            </thead>
            <tbody>
              {positions.map((pos, i) => {
                const totalCad = pos.currency === 'USD'
                  ? pos.shares * pos.nativePrice * fxRate
                  : pos.shares * pos.nativePrice;

                const dayUp  = (pos.dayChange || 0) >= 0;
                const pnlUp  = (pos.dayPnL || 0) >= 0;
                const priceLabel = pos.currency === 'USD' ? `$${pos.nativePrice.toFixed(2)} USD` : `$${pos.nativePrice.toFixed(2)} CAD`;
                const dayPct = pos.dayChangePercent != null ? `${dayUp ? '+' : ''}${Number(pos.dayChangePercent).toFixed(2)}%` : null;
                const pnlLabel = pos.dayPnL ? `${pnlUp ? '+' : '–'}$${Math.abs(pos.dayPnL).toFixed(2)}` : '—';
                const isLast = i === positions.length - 1;
                const isHovered = hoveredRow === i;

                return (
                  <tr
                    key={`${pos.symbol}-${i}`}
                    onMouseEnter={() => setHoveredRow(i)}
                    onMouseLeave={() => setHoveredRow(null)}
                    style={{
                      borderBottom: isLast ? 'none' : '1px solid var(--border)',
                      backgroundColor: isHovered ? 'rgba(255,255,255,0.03)' : 'transparent',
                      transition: 'background-color 0.12s'
                    }}
                  >
                    {/* Positions */}
                    <td style={{ padding: '1.125rem 1.5rem' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.875rem' }}>
                        <TickerIcon symbol={pos.symbol} />
                        <div>
                          <div style={{ fontWeight: 700, fontSize: '0.925rem' }}>{pos.symbol}</div>
                          {pos.description && (
                            <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '2px' }}>{pos.description}</div>
                          )}
                        </div>
                      </div>
                    </td>

                    {/* Total value */}
                    <td style={{ padding: '1.125rem 1.5rem', textAlign: 'right' }}>
                      <div style={{ fontWeight: 600, fontSize: '0.925rem' }}>{formatCurrency(totalCad)}</div>
                      <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '2px' }}>{pos.shares} shares</div>
                    </td>

                    {/* Today's price */}
                    <td style={{ padding: '1.125rem 1.5rem', textAlign: 'right' }}>
                      <div style={{ fontWeight: 600, fontSize: '0.925rem' }}>{priceLabel}</div>
                      {dayPct
                        ? <div style={{ fontSize: '0.78rem', color: dayUp ? 'var(--up)' : 'var(--down)', marginTop: '2px' }}>{dayPct}</div>
                        : <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '2px' }}>—</div>
                      }
                    </td>

                    {/* Day P&L */}
                    <td style={{ padding: '1.125rem 1.5rem', textAlign: 'right' }}>
                      <div style={{ fontWeight: 600, fontSize: '0.925rem', color: pos.dayPnL ? (pnlUp ? 'var(--up)' : 'var(--down)') : 'var(--text-secondary)' }}>
                        {pnlLabel}
                      </div>
                      {pos.currency === 'USD' && pos.fxImpact
                        ? <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '2px' }}>FX {pos.fxImpact >= 0 ? '+' : ''}{formatCurrency(pos.fxImpact)}</div>
                        : <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '2px' }}>—</div>
                      }
                    </td>

                    {/* Actions — appear on hover */}
                    <td style={{ padding: '0.75rem 1rem', textAlign: 'right' }}>
                      <div style={{ display: 'flex', gap: '0.4rem', justifyContent: 'flex-end', opacity: isHovered ? 1 : 0, transition: 'opacity 0.15s', pointerEvents: isHovered ? 'auto' : 'none' }}>
                        <button
                          onClick={() => setQuickOrder({ position: pos, side: 'BUY' })}
                          style={{ padding: '0.35rem 0.8rem', borderRadius: '6px', border: '1px solid var(--up)', background: 'rgba(52,211,153,0.1)', color: 'var(--up)', fontWeight: 700, fontSize: '0.75rem', cursor: 'pointer', transition: 'background 0.12s' }}
                          onMouseEnter={e => e.currentTarget.style.background = 'rgba(52,211,153,0.22)'}
                          onMouseLeave={e => e.currentTarget.style.background = 'rgba(52,211,153,0.1)'}
                        >
                          Buy
                        </button>
                        <button
                          onClick={() => setQuickOrder({ position: pos, side: 'SELL' })}
                          style={{ padding: '0.35rem 0.8rem', borderRadius: '6px', border: '1px solid var(--down)', background: 'rgba(248,113,113,0.1)', color: 'var(--down)', fontWeight: 700, fontSize: '0.75rem', cursor: 'pointer', transition: 'background 0.12s' }}
                          onMouseEnter={e => e.currentTarget.style.background = 'rgba(248,113,113,0.22)'}
                          onMouseLeave={e => e.currentTarget.style.background = 'rgba(248,113,113,0.1)'}
                        >
                          Sell
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {quickOrder && (
        <QuickOrderModal
          position={quickOrder.position}
          initialSide={quickOrder.side}
          onClose={() => setQuickOrder(null)}
        />
      )}
    </>
  );
};

export default HoldingsTable;
