import React from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import Layout from './components/Layout';
import Overview from './pages/Overview';
import Holdings from './pages/Holdings';
import Trade from './pages/Trade';
import Settings from './pages/Settings';
import Dividends from './pages/Dividends';
import Performance from './pages/Performance';
import Transactions from './pages/Transactions';
import Automations from './pages/Automations';
import Orders from './pages/Orders';

function App() {
  return (
    <Router>
      <Layout>
        <Routes>
          <Route path="/" element={<Overview />} />
          <Route path="/trade" element={<Trade />} />
          <Route path="/holdings" element={<Holdings />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/orders" element={<Orders />} />
          <Route path="/transactions" element={<Transactions />} />
          <Route path="/automations" element={<Automations />} />
          <Route path="/dividends" element={<Dividends />} />
          <Route path="/performance" element={<Performance />} />
        </Routes>
      </Layout>
    </Router>
  );
}

export default App;
