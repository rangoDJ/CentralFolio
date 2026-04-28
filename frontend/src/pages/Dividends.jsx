import React, { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, TrendingUp, Calendar, DollarSign, BarChart2 } from 'lucide-react';
import { DividendBarChart } from '../components/Charts';
import { formatCurrency, formatDate } from '../utils/format';
import ErrorBoundary from '../components/ErrorBoundary';

// ─── Calendar ────────────────────────────────────────────────────────────────

const FREQ_LABEL = { 1: 'Annual', 2: 'Semi-ann.', 4: 'Quarterly', 12: 'Monthly' };
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];

const DividendCalendar = ({ dividends, fxRate }) => {
  const today = new Date();
  const [year, setYear]   = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth());

  const prevMonth = () => { if (month === 0) { setYear(y => y - 1); setMonth(11); } else setMonth(m => m - 1); };
  const nextMonth = () => { if (month === 11) { setYear(y => y + 1); setMonth(0); } else setMonth(m => m + 1); };

  // Build day → events map for the displayed month
  const dayEvents = useMemo(() => {
    const map = {};
    dividends.forEach(div => {
      div.nextPayDates.forEach(dateStr => {
        const d = new Date(dateStr + 'T12:00:00');
        if (d.getFullYear() !== year || d.getMonth() !== month) return;
        const day = d.getDate();
        if (!map[day]) map[day] = [];
        const income = div.currency === 'USD'
          ? div.lastAmount * div.shares * fxRate
          : div.lastAmount * div.shares;
        map[day].push({ symbol: div.symbol, income });
      });
    });
    return map;
  }, [dividends, year, month, fxRate]);

  // Grid: leading blanks + days + trailing blanks
  const firstDOW = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells = [
    ...Array(firstDOW).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];
  while (cells.length % 7 !== 0) cells.push(null);

  const isToday = d => d === today.getDate() && year === today.getFullYear() && month === today.getMonth();
  const isPast  = d => new Date(year, month, d) < new Date(today.getFullYear(), today.getMonth(), today.getDate());

  return (
    <div>
      {/* Month navigation */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.25rem' }}>
        <button onClick={prevMonth} style={{ background: 'none', border: '1px solid var(--border)', borderRadius: '8px', padding: '0.4rem 0.6rem', cursor: 'pointer', color: 'var(--text-secondary)', display: 'flex' }}>
          <ChevronLeft size={18} />
        </button>
        <span style={{ fontWeight: 700, fontSize: '1rem' }}>{MONTHS[month]} {year}</span>
        <button onClick={nextMonth} style={{ background: 'none', border: '1px solid var(--border)', borderRadius: '8px', padding: '0.4rem 0.6rem', cursor: 'pointer', color: 'var(--text-secondary)', display: 'flex' }}>
          <ChevronRight size={18} />
        </button>
      </div>

      {/* Day-of-week headers */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '4px', marginBottom: '4px' }}>
        {DOW.map(d => (
          <div key={d} style={{ textAlign: 'center', fontSize: '0.7rem', fontWeight: 600, color: 'var(--text-muted)', padding: '0.25rem 0' }}>{d}</div>
        ))}
      </div>

      {/* Day cells */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '4px' }}>
        {cells.map((day, i) => {
          const events = day ? (dayEvents[day] || []) : [];
          const hasDividend = events.length > 0;
          return (
            <div key={i} style={{
              minHeight: '72px',
              borderRadius: '8px',
              border: `1px solid ${isToday(day) ? 'var(--accent)' : 'var(--border)'}`,
              backgroundColor: hasDividend ? 'rgba(0,200,150,0.06)' : 'var(--bg-card)',
              padding: '0.4rem',
              opacity: day ? (isPast(day) && !isToday(day) ? 0.5 : 1) : 0.15,
              transition: 'border-color 0.15s'
            }}>
              {day && (
                <>
                  <div style={{
                    fontSize: '0.75rem',
                    fontWeight: isToday(day) ? 700 : 400,
                    color: isToday(day) ? 'var(--accent)' : 'var(--text-secondary)',
                    marginBottom: '3px',
                    lineHeight: 1
                  }}>
                    {day}
                  </div>
                  {events.map((ev, j) => (
                    <div key={j} style={{
                      backgroundColor: 'rgba(0,200,150,0.15)',
                      color: 'var(--accent)',
                      borderRadius: '4px',
                      fontSize: '0.6rem',
                      padding: '2px 4px',
                      marginBottom: '2px',
                      fontWeight: 700,
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      lineHeight: 1.4
                    }}>
                      {ev.symbol} {formatCurrency(ev.income)}
                    </div>
                  ))}
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

// ─── Upcoming Payments ────────────────────────────────────────────────────────

const UpcomingPayments = ({ dividends, fxRate }) => {
  const today = new Date();
  const cutoff = new Date(today); cutoff.setDate(cutoff.getDate() + 60);

  const upcoming = useMemo(() => {
    const rows = [];
    dividends.forEach(div => {
      div.nextPayDates.forEach(dateStr => {
        const d = new Date(dateStr + 'T12:00:00');
        if (d < today || d > cutoff) return;
        const income = div.currency === 'USD'
          ? div.lastAmount * div.shares * fxRate
          : div.lastAmount * div.shares;
        rows.push({ ...div, payDate: dateStr, income, _ts: d.getTime() });
      });
    });
    return rows.sort((a, b) => a._ts - b._ts);
  }, [dividends, fxRate]);

  if (!upcoming.length) return (
    <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem', padding: '1.5rem 0' }}>No dividend payments projected in the next 60 days.</p>
  );

  const TH = ({ children, right }) => (
    <th style={{ padding: '0.75rem 1rem', textAlign: right ? 'right' : 'left', fontSize: '0.72rem', fontWeight: 600, color: 'var(--text-muted)', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' }}>
      {children}
    </th>
  );

  return (
    <div style={{ borderRadius: '16px', overflow: 'hidden', border: '1px solid var(--border)', backgroundColor: 'var(--bg-card)' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <TH>Pay Date</TH>
            <TH>Symbol</TH>
            <TH>Description</TH>
            <TH right>Per Share</TH>
            <TH right>Shares</TH>
            <TH right>Income (CAD)</TH>
            <TH right>Frequency</TH>
          </tr>
        </thead>
        <tbody>
          {upcoming.map((row, i) => (
            <tr key={`${row.symbol}-${row.payDate}`} style={{ borderBottom: i < upcoming.length - 1 ? '1px solid var(--border)' : 'none' }}>
              <td style={{ padding: '0.875rem 1rem', fontSize: '0.875rem', whiteSpace: 'nowrap' }}>
                {formatDate(row.payDate)}
              </td>
              <td style={{ padding: '0.875rem 1rem', fontWeight: 700, fontSize: '0.875rem' }}>{row.symbol}</td>
              <td style={{ padding: '0.875rem 1rem', fontSize: '0.8rem', color: 'var(--text-muted)', maxWidth: '160px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {row.description || '—'}
              </td>
              <td style={{ padding: '0.875rem 1rem', textAlign: 'right', fontSize: '0.875rem' }}>
                {row.currency === 'USD' ? `$${row.lastAmount.toFixed(4)} USD` : `$${row.lastAmount.toFixed(4)} CAD`}
              </td>
              <td style={{ padding: '0.875rem 1rem', textAlign: 'right', fontSize: '0.875rem', color: 'var(--text-secondary)' }}>{row.shares}</td>
              <td style={{ padding: '0.875rem 1rem', textAlign: 'right', fontWeight: 600, fontSize: '0.875rem', color: 'var(--up)' }}>
                {formatCurrency(row.income)}
              </td>
              <td style={{ padding: '0.875rem 1rem', textAlign: 'right', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                {FREQ_LABEL[row.frequency] || `${row.frequency}×/yr`}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

// ─── Main Page ────────────────────────────────────────────────────────────────

const Dividends = () => {
  const { data: dividends = [], isLoading, isError } = useQuery({
    queryKey: ['dividends'],
    queryFn: () => fetch('/api/dividends').then(r => { if (!r.ok) throw new Error(r.status); return r.json(); }),
    staleTime: 5 * 60 * 1000,
    retry: 1
  });

  const { data: fxData } = useQuery({
    queryKey: ['fxRate'],
    queryFn: () => fetch('/api/fx-rate').then(r => r.json())
  });

  const fxRate = fxData?.rate || 1.40;

  // Aggregate forecast numbers
  const metrics = useMemo(() => {
    if (!dividends.length) return { annual: 0, monthly: 0, count: 0, chartData: [] };

    const annual = dividends.reduce((s, d) => s + d.annualIncomeCad, 0);

    // Build 12-month forward distribution
    const monthBuckets = {};
    const today = new Date();
    for (let i = 0; i < 12; i++) {
      const d = new Date(today.getFullYear(), today.getMonth() + i, 1);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      monthBuckets[key] = 0;
    }

    dividends.forEach(div => {
      const perPayment = div.annualIncomeCad / div.frequency;
      div.nextPayDates.forEach(dateStr => {
        const d = new Date(dateStr + 'T12:00:00');
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        if (key in monthBuckets) monthBuckets[key] += perPayment;
      });
    });

    const chartData = Object.entries(monthBuckets).map(([key, amt]) => {
      const [yr, mo] = key.split('-');
      const label = new Date(Number(yr), Number(mo) - 1, 1)
        .toLocaleString('default', { month: 'short', year: '2-digit' });
      return { month: label, expectedAmount: parseFloat(amt.toFixed(2)) };
    });

    return { annual, monthly: annual / 12, count: dividends.length, chartData };
  }, [dividends]);

  const SectionLabel = ({ children }) => (
    <div style={{ fontSize: '0.7rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--text-muted)', marginBottom: '1rem' }}>
      {children}
    </div>
  );

  if (isLoading) return (
    <div>
      <h1 style={{ fontSize: '2rem', fontWeight: 700, marginBottom: '0.25rem' }}>Passive Income Forecast</h1>
      <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', marginBottom: '2rem' }}>Fetching dividend data for your holdings…</p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem', marginBottom: '2rem' }}>
        {[1,2,3].map(i => <div key={i} className="skeleton" style={{ height: '100px', borderRadius: '16px' }} />)}
      </div>
      <div className="skeleton" style={{ height: '320px', borderRadius: '16px', marginBottom: '2rem' }} />
      <div className="skeleton" style={{ height: '440px', borderRadius: '16px' }} />
    </div>
  );

  if (isError) return (
    <div style={{ textAlign: 'center', padding: '4rem 2rem' }}>
      <h2 style={{ color: 'var(--text-secondary)', marginBottom: '0.5rem' }}>Could not load dividend data</h2>
      <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>Make sure the backend is running and accounts are synced.</p>
    </div>
  );

  if (!dividends.length) return (
    <div style={{ textAlign: 'center', padding: '4rem 2rem' }}>
      <h2 style={{ color: 'var(--text-secondary)', marginBottom: '0.5rem' }}>No dividend data available</h2>
      <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>
        Either no accounts are selected, or your current holdings don't pay dividends.
      </p>
    </div>
  );

  return (
    <div>
      {/* Header */}
      <div style={{ marginBottom: '2rem' }}>
        <h1 style={{ fontSize: '2rem', fontWeight: 700, marginBottom: '0.25rem' }}>Passive Income Forecast</h1>
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
          Dividend projections for {metrics.count} holding{metrics.count !== 1 ? 's' : ''} across your selected accounts
        </p>
      </div>

      {/* Summary Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem', marginBottom: '2.5rem' }}>
        {[
          { icon: <DollarSign size={18} />, label: 'Projected Annual', value: formatCurrency(metrics.annual) },
          { icon: <TrendingUp size={18} />,  label: 'Monthly Average',  value: formatCurrency(metrics.monthly) },
          { icon: <BarChart2 size={18} />,   label: 'Paying Holdings',  value: `${metrics.count} positions` },
        ].map(card => (
          <div key={card.label} className="card" style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--accent)' }}>
              {card.icon}
              <span style={{ fontSize: '0.72rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-muted)' }}>
                {card.label}
              </span>
            </div>
            <div style={{ fontSize: '1.75rem', fontWeight: 700, color: 'var(--text-primary)' }}>{card.value}</div>
          </div>
        ))}
      </div>

      {/* 12-Month Bar Chart */}
      <div className="card" style={{ marginBottom: '2.5rem' }}>
        <SectionLabel>12-Month Income Forecast</SectionLabel>
        <div style={{ height: '280px' }}>
          <ErrorBoundary>
            <DividendBarChart data={metrics.chartData} />
          </ErrorBoundary>
        </div>
      </div>

      {/* Calendar */}
      <div className="card" style={{ marginBottom: '2.5rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1.25rem' }}>
          <Calendar size={16} color="var(--accent)" />
          <span style={{ fontSize: '0.7rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--text-muted)' }}>Dividend Calendar</span>
        </div>
        <ErrorBoundary>
          <DividendCalendar dividends={dividends} fxRate={fxRate} />
        </ErrorBoundary>
      </div>

      {/* Upcoming Payments */}
      <div style={{ marginBottom: '2.5rem' }}>
        <SectionLabel>Upcoming Payments — Next 60 Days</SectionLabel>
        <ErrorBoundary>
          <UpcomingPayments dividends={dividends} fxRate={fxRate} />
        </ErrorBoundary>
      </div>

      {/* Per-Holding Breakdown */}
      <div>
        <SectionLabel>All Dividend-Paying Holdings</SectionLabel>
        <div style={{ borderRadius: '16px', overflow: 'hidden', border: '1px solid var(--border)', backgroundColor: 'var(--bg-card)' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                {['Symbol', 'Description', 'Shares', 'Last Paid', 'Per Share', 'Frequency', 'Annual / Share', 'Annual Income (CAD)'].map((h, i) => (
                  <th key={h} style={{ padding: '0.75rem 1rem', textAlign: i > 1 ? 'right' : 'left', fontSize: '0.72rem', fontWeight: 600, color: 'var(--text-muted)', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[...dividends].sort((a, b) => b.annualIncomeCad - a.annualIncomeCad).map((div, i) => (
                <tr key={div.symbol} style={{ borderBottom: i < dividends.length - 1 ? '1px solid var(--border)' : 'none' }}>
                  <td style={{ padding: '0.875rem 1rem', fontWeight: 700, fontSize: '0.875rem' }}>{div.symbol}</td>
                  <td style={{ padding: '0.875rem 1rem', fontSize: '0.8rem', color: 'var(--text-muted)', maxWidth: '180px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{div.description || '—'}</td>
                  <td style={{ padding: '0.875rem 1rem', textAlign: 'right', fontSize: '0.875rem', color: 'var(--text-secondary)' }}>{div.shares}</td>
                  <td style={{ padding: '0.875rem 1rem', textAlign: 'right', fontSize: '0.8rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{formatDate(div.lastPayDate)}</td>
                  <td style={{ padding: '0.875rem 1rem', textAlign: 'right', fontSize: '0.875rem' }}>
                    {div.currency === 'USD' ? `$${div.lastAmount.toFixed(4)} USD` : `$${div.lastAmount.toFixed(4)} CAD`}
                  </td>
                  <td style={{ padding: '0.875rem 1rem', textAlign: 'right', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                    {FREQ_LABEL[div.frequency] || `${div.frequency}×/yr`}
                  </td>
                  <td style={{ padding: '0.875rem 1rem', textAlign: 'right', fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
                    {div.currency === 'USD' ? `$${div.annualPerShare.toFixed(4)} USD` : `$${div.annualPerShare.toFixed(4)} CAD`}
                  </td>
                  <td style={{ padding: '0.875rem 1rem', textAlign: 'right', fontWeight: 600, fontSize: '0.875rem', color: 'var(--up)' }}>
                    {formatCurrency(div.annualIncomeCad)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default Dividends;
