import React, { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import ErrorBoundary from '../components/ErrorBoundary';
import { PerformanceAreaChart } from '../components/Charts';

const Performance = () => {
  const { data: accounts = [], isLoading } = useQuery({
    queryKey: ['accounts'],
    queryFn: () => fetch('/api/accounts').then(res => res.json())
  });

  const chartData = useMemo(() => {
    // Determine theoretical starting capital to build the geometric Brownian motion array backwards
    const currentTotal = accounts.reduce((sum, acc) => sum + acc.value, 0) || 100000;
    
    const data = [];
    let runningTotal = currentTotal * 0.85; // Assume 15% growth over the year roughly
    const now = new Date();

    // Generate 52 weeks of mock performance
    for (let i = 52; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - (i * 7));
      
      data.push({
        date: d.toISOString().split('T')[0],
        value: runningTotal,
        benchmark: runningTotal * (0.95 + (Math.random() * 0.1)) // S&P 500 drift analogue
      });

      // Brownian variance
      const volatileDrift = 1 + ((Math.random() - 0.45) * 0.05);
      runningTotal = runningTotal * volatileDrift; 
    }
    
    // Ensure the final data point maps exactly to our true mathematical present state uniformly
    data[data.length - 1].value = currentTotal;

    return data;
  }, [accounts]);

  if (isLoading) {
    return (
      <div>
        <div style={{ marginBottom: '2rem' }}>
          <h1 style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>Portfolio Benchmarking</h1>
          <p style={{ color: 'var(--text-secondary)' }}>Simulating Geometric Brownian historical curves</p>
        </div>
        <div className="skeleton" style={{ height: '450px', width: '100%', borderRadius: '12px' }}></div>
      </div>
    );
  }

  return (
    <div>
      <div style={{ marginBottom: '2rem' }}>
        <h1 style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>Portfolio Benchmarking</h1>
        <p style={{ color: 'var(--text-secondary)' }}>Comparing simulated geometric trajectory against broader market indexing globally</p>
      </div>

      <div className="glass-card" style={{ height: '500px', display: 'flex', flexDirection: 'column' }}>
        <div style={{ marginBottom: '1rem', color: 'var(--accent)' }}>
          <span style={{ fontSize: '1.25rem', fontWeight: 600 }}>1 Year Historical Trend</span>
        </div>
        <div style={{ flex: 1, minHeight: 0 }}>
          <ErrorBoundary>
            <PerformanceAreaChart data={chartData} />
          </ErrorBoundary>
        </div>
      </div>
    </div>
  );
};

export default Performance;
