import React, { useState, useEffect } from 'react';
import { NavLink } from 'react-router-dom';
import { 
  LayoutDashboard, 
  ArrowLeftRight, 
  Briefcase, 
  History, 
  Calendar, 
  LineChart,
  Settings,
  Menu,
  Sun,
  Moon,
  List,
  Activity
} from 'lucide-react';
import { Toaster } from 'sonner';
import { useTheme } from '../context/ThemeContext';

const Layout = ({ children }) => {
  const [fxRate, setFxRate] = useState(1.40);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const { theme, toggleTheme } = useTheme();

  useEffect(() => {
    const fetchFx = async () => {
      try {
        const res = await fetch('/api/fx-rate');
        const data = await res.json();
        if (data.rate) setFxRate(data.rate);
      } catch (err) {
        console.error('Failed to fetch FX rate', err);
      }
    };
    fetchFx();
    const interval = setInterval(fetchFx, 60000);
    return () => clearInterval(interval);
  }, []);

  const navItems = [
    { to: '/', icon: <LayoutDashboard size={20} />, label: 'Overview' },
    { to: '/trade', icon: <ArrowLeftRight size={20} />, label: 'Trade' },
    { to: '/holdings', icon: <Briefcase size={20} />, label: 'Holdings' },
    { to: '/transactions', icon: <List size={20} />, label: 'Transactions' },
    { to: '/automations', icon: <Activity size={20} />, label: 'Automations' },
    { to: '/orders', icon: <History size={20} />, label: 'Orders' },
    { to: '/dividends', icon: <Calendar size={20} />, label: 'Dividends' },
    { to: '/performance', icon: <LineChart size={20} />, label: 'Performance' },
    { to: '/settings', icon: <Settings size={20} />, label: 'Settings' },
  ];

  return (
    <div style={{ display: 'flex', minHeight: '100vh', width: '100%', position: 'relative' }}>
      {/* Mobile Dark Overlay */}
      {isMobileMenuOpen && (
        <div 
          onClick={() => setIsMobileMenuOpen(false)}
          style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 40 }}
        />
      )}

      {/* Sidebar */}
      <aside className={`sidebar ${isMobileMenuOpen ? 'open' : ''}`} style={{ 
        width: '260px', 
        backgroundColor: 'var(--bg-sidebar)',
        borderRight: '1px solid var(--border)',
        padding: '1.5rem',
        position: 'fixed',
        height: '100vh',
        zIndex: 50
      }}>
        <h1 style={{ fontSize: '1.25rem', marginBottom: '2rem', color: 'var(--accent)' }}>CentralFolio</h1>
        <nav>
          {navItems.map((item) => (
            <NavLink 
              key={item.to} 
              to={item.to}
              style={({ isActive }) => ({
                display: 'flex',
                alignItems: 'center',
                padding: '0.75rem 1rem',
                borderRadius: '8px',
                marginBottom: '0.5rem',
                color: isActive ? 'var(--text-primary)' : 'var(--text-secondary)',
                backgroundColor: isActive ? 'rgba(0, 200, 150, 0.1)' : 'transparent',
                transition: 'all 0.2s'
              })}
            >
              <span style={{ marginRight: '0.75rem' }}>{item.icon}</span>
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="card" style={{ padding: '0.5rem 1rem', borderRadius: '20px', border: '1px solid var(--border)', fontSize: '0.875rem', marginTop: 'auto' }}>
          <span style={{ color: 'var(--text-secondary)', marginRight: '0.5rem' }}>USD/CAD</span>
          <span style={{ fontWeight: 600 }}>{fxRate.toFixed(4)}</span>
        </div>
      </aside>

      {/* Main Content */}
      <main className="main-content" style={{ flex: 1, padding: '2rem 3rem', overflowY: 'auto', marginLeft: '260px', display: 'flex', flexDirection: 'column' }}>
        {/* Mobile Header + Theme Controls */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
          <button 
            className="mobile-only-btn"
            style={{ 
              background: 'transparent', 
              border: 'none', 
              color: 'var(--text-primary)', 
              cursor: 'pointer',
              display: 'none'
            }}
            onClick={() => setIsMobileMenuOpen(true)}
          >
            <Menu size={24} />
          </button>

          <div style={{ marginLeft: 'auto' }}>
            <button 
              onClick={toggleTheme}
              style={{ padding: '0.5rem', borderRadius: '50%', background: 'var(--bg-sidebar)', border: '1px solid var(--border)', cursor: 'pointer', color: 'var(--text-primary)', display: 'flex' }}
            >
              {theme === 'dark' ? <Sun size={20} /> : <Moon size={20} />}
            </button>
          </div>
        </div>

        {children}
      </main>

      <Toaster position="bottom-right" theme={theme === 'dark' ? 'dark' : 'light'} richColors />
    </div>
  );
};

export default Layout;
