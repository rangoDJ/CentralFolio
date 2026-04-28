import React, { useMemo } from 'react';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend, BarChart, Bar, XAxis, YAxis, CartesianGrid, AreaChart, Area } from 'recharts';

export const COLORS = ['#ec4899', '#3b82f6', '#8b5cf6', '#a855f7', '#14b8a6', '#f59e0b', '#ef4444', '#10b981'];

export const generateColor = (identifier) => {
  if (!identifier) return COLORS[0];
  let hash = 0;
  for (let i = 0; i < identifier.length; i++) {
    hash = identifier.charCodeAt(i) + ((hash << 5) - hash);
  }
  return COLORS[Math.abs(hash) % COLORS.length];
};

export const AssetAllocationDonut = ({ accounts }) => {
  const chartData = useMemo(() => {
    if (!accounts) return [];
    
    // Grouping by brokerage/account type or person conceptually
    const grouped = {};
    accounts.forEach(acc => {
      const key = `${acc.person} - ${acc.accountName}`;
      grouped[key] = (grouped[key] || 0) + acc.value;
    });

    return Object.keys(grouped).map(key => ({
      name: key,
      value: grouped[key]
    })).sort((a,b) => b.value - a.value);
  }, [accounts]);

  if (!chartData.length) return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-muted)' }}>No data available</div>;

  return (
    <ResponsiveContainer width="100%" height="100%">
      <PieChart>
        <Pie
          data={chartData}
          cx="50%"
          cy="50%"
          innerRadius={60}
          outerRadius={80}
          paddingAngle={5}
          dataKey="value"
          stroke="none"
        >
          {chartData.map((entry, index) => (
            <Cell key={`cell-${index}`} fill={generateColor(entry.name)} />
          ))}
        </Pie>
        <Tooltip 
          formatter={(value) => new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' }).format(value)}
          contentStyle={{ backgroundColor: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '8px', color: '#fff' }}
          itemStyle={{ color: '#fff' }}
        />
        <Legend verticalAlign="bottom" height={36} />
      </PieChart>
    </ResponsiveContainer>
  );
};

export const DividendBarChart = ({ data }) => {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
        <XAxis dataKey="month" stroke="var(--text-muted)" tickLine={false} axisLine={false} dy={10} fontSize={12} />
        <YAxis stroke="var(--text-muted)" tickLine={false} axisLine={false} tickFormatter={(val) => `$${val}`} fontSize={12} />
        <Tooltip 
          cursor={{ fill: 'rgba(255,255,255,0.05)' }}
          contentStyle={{ backgroundColor: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '8px', color: 'var(--text-primary)' }}
          formatter={(value) => [`$${value.toFixed(2)}`, 'Expected Payout']}
        />
        <Bar dataKey="expectedAmount" fill="var(--accent)" radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
};

export const PerformanceAreaChart = ({ data }) => {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={data} margin={{ top: 10, right: 10, left: 10, bottom: 0 }}>
        <defs>
          <linearGradient id="colorValue" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="var(--up)" stopOpacity={0.3}/>
            <stop offset="95%" stopColor="var(--up)" stopOpacity={0}/>
          </linearGradient>
          <linearGradient id="colorBench" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="var(--person-b)" stopOpacity={0.1}/>
            <stop offset="95%" stopColor="var(--person-b)" stopOpacity={0}/>
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
        <XAxis dataKey="date" stroke="var(--text-muted)" tickLine={false} axisLine={false} minTickGap={30} dy={10} fontSize={12} />
        <YAxis hide domain={['dataMin - 1000', 'dataMax + 1000']} />
        <Tooltip 
          contentStyle={{ backgroundColor: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '8px', color: 'var(--text-primary)' }}
          formatter={(value, name) => [
            new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' }).format(value), 
            name === 'value' ? 'Portfolio' : 'S&P 500 Index'
          ]}
        />
        <Area type="monotone" dataKey="benchmark" stroke="var(--person-b)" fillOpacity={1} fill="url(#colorBench)" strokeWidth={2} />
        <Area type="monotone" dataKey="value" stroke="var(--up)" fillOpacity={1} fill="url(#colorValue)" strokeWidth={3} />
        <Legend verticalAlign="top" height={36} wrapperStyle={{ fontSize: '12px' }}/>
      </AreaChart>
    </ResponsiveContainer>
  );
};
