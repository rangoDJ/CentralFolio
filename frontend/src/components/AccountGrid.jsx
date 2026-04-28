import React, { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import AccountCard from './AccountCard';
import { generateColor } from './Charts';

const AccountGrid = ({ onDataLoaded }) => {
  const { data: accounts, isLoading: loading } = useQuery({
    queryKey: ['accounts'],
    queryFn: () => fetch('/api/accounts').then(res => res.json()),
    refetchInterval: 15000
  });

  useEffect(() => {
    if (accounts && onDataLoaded) {
      onDataLoaded(accounts);
    }
  }, [accounts, onDataLoaded]);

  if (loading) {
    return (
      <div className="grid-9">
        {[1, 2, 3].map(i => (
          <div key={i} className="skeleton" style={{ height: '220px', width: '100%', borderRadius: '12px' }}></div>
        ))}
      </div>
    );
  }

  return (
    <div className="grid-9">
      {accounts.map((acc, index) => (
        <AccountCard
          key={acc.id || index}
          account={acc}
          personColor={generateColor(acc.person || acc.id)}
        />
      ))}
    </div>
  );
};

export default AccountGrid;
