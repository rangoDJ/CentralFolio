import React, { useEffect, useRef } from 'react';
import { createChart, CandlestickSeries } from 'lightweight-charts';

const PriceChart = ({ symbol }) => {
  const chartContainerRef = useRef(null);
  const chartRef = useRef(null);

  useEffect(() => {
    if (!chartContainerRef.current) return;

    let chart;
    try {
      const containerWidth = chartContainerRef.current.clientWidth || 600;
      
      chart = createChart(chartContainerRef.current, {
        layout: {
          background: { color: 'transparent' },
          textColor: '#94a3b8',
        },
        grid: {
          vertLines: { color: '#334155' },
          horzLines: { color: '#334155' },
        },
        width: containerWidth,
        height: 400,
      });

      chartRef.current = chart;

      // New API for v5+: use addSeries with CandlestickSeries
      const candlestickSeries = chart.addSeries(CandlestickSeries, {
        upColor: '#22c55e',
        downColor: '#ef4444',
        borderVisible: false,
        wickUpColor: '#22c55e',
        wickDownColor: '#ef4444',
      });

      // Mock OHLC data
      const data = [];
      let price = 100;
      const baseDate = new Date(2024, 0, 1);
      for (let i = 0; i < 100; i++) {
        const open = price + (Math.random() - 0.5) * 5;
        const close = open + (Math.random() - 0.5) * 5;
        const high = Math.max(open, close) + Math.random() * 2;
        const low = Math.min(open, close) - Math.random() * 2;
        
        const time = new Date(baseDate);
        time.setDate(baseDate.getDate() + i);
        
        data.push({
          time: time.toISOString().split('T')[0],
          open, high, low, close
        });
        price = close;
      }

      candlestickSeries.setData(data);

      const handleResize = () => {
        if (chartRef.current && chartContainerRef.current) {
          const newWidth = chartContainerRef.current.clientWidth;
          if (newWidth > 0) {
            chartRef.current.applyOptions({ width: newWidth });
          }
        }
      };

      window.addEventListener('resize', handleResize);

      return () => {
        window.removeEventListener('resize', handleResize);
        if (chart) {
          chart.remove();
        }
      };
    } catch (err) {
      console.error('Error initializing chart:', err);
    }
  }, [symbol]);

  return (
    <div className="card" style={{ padding: '0.5rem', marginBottom: '2rem' }}>
      <div style={{ padding: '1rem', borderBottom: '1px solid var(--border)', marginBottom: '1rem', display: 'flex', justifyContent: 'space-between' }}>
        <h2 style={{ fontSize: '1.125rem' }}>{symbol || 'Select a symbol'}</h2>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          {['1D', '1W', '1M', '1Y', 'ALL'].map(tf => (
            <button key={tf} style={{ 
              background: tf === '1D' ? 'var(--accent)' : 'transparent',
              border: '1px solid var(--border)',
              color: tf === '1D' ? 'white' : 'var(--text-secondary)',
              padding: '2px 8px',
              borderRadius: '4px',
              cursor: 'pointer'
            }}>{tf}</button>
          ))}
        </div>
      </div>
      <div ref={chartContainerRef} style={{ width: '100%', minHeight: '400px' }}>
        {!chartRef.current && <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>Loading chart...</div>}
      </div>
    </div>
  );
};

export default PriceChart;
