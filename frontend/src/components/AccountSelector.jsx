import React, { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';

const AccountSelector = ({ selectedAccount, onAccountChange, disabled = false }) => {
  const [accounts, setAccounts] = useState([]);
  const [flatAccounts, setFlatAccounts] = useState([]);

  // Fetch grouped accounts from the API
  const { data: groupedData = [] } = useQuery({
    queryKey: ['accounts', 'grouped'],
    queryFn: () => fetch('/api/accounts?grouped=true').then(res => res.json())
  });

  // Fetch flat accounts as fallback
  const { data: flatData = [] } = useQuery({
    queryKey: ['accounts', 'flat'],
    queryFn: () => fetch('/api/accounts').then(res => res.json())
  });

  // Build a flat list of all accounts for validation
  useEffect(() => {
    const flat = [];
    if (Array.isArray(flatData)) {
      flatData.forEach(acc => {
        if (acc.id) flat.push(acc);
      });
    }
    setFlatAccounts(flat);
  }, [flatData]);

  // If we have grouped data, use it; otherwise create groups from flat data
  useEffect(() => {
    if (Array.isArray(groupedData) && groupedData.length > 0) {
      setAccounts(groupedData);
    } else if (Array.isArray(flatData) && flatData.length > 0) {
      // Create synthetic groups from flat data
      const grouped = {};
      flatData.forEach(acc => {
        const keyIndex = acc.keyIndex || 1;
        const brokerage = acc.brokerage_name || 'Unknown';

        if (!grouped[keyIndex]) {
          grouped[keyIndex] = {
            keyIndex,
            brokerages: {}
          };
        }

        if (!grouped[keyIndex].brokerages[brokerage]) {
          grouped[keyIndex].brokerages[brokerage] = {
            brokerageName: brokerage,
            displayName: acc.displayName || brokerage,
            accounts: []
          };
        }

        grouped[keyIndex].brokerages[brokerage].accounts.push(acc);
      });

      setAccounts(Object.values(grouped));
    }
  }, [groupedData, flatData]);

  // Auto-select first account if none selected
  useEffect(() => {
    if (!selectedAccount && flatAccounts.length > 0) {
      onAccountChange(flatAccounts[0].id);
    }
  }, [flatAccounts, selectedAccount, onAccountChange]);

  return (
    <select
      value={selectedAccount}
      onChange={(e) => onAccountChange(e.target.value)}
      disabled={disabled}
      style={{
        width: '100%',
        padding: '0.75rem',
        background: 'var(--bg-main)',
        color: 'white',
        border: '1px solid var(--border)',
        borderRadius: '8px',
        fontSize: '0.95rem'
      }}
    >
      <option value="">Select an account...</option>

      {accounts.length > 0 ? (
        accounts.map(keyGroup => (
          <optgroup key={`key-${keyGroup.keyIndex}`} label={`Key ${keyGroup.keyIndex}`}>
            {keyGroup.brokerages && Object.values(keyGroup.brokerages).map(brokerage => (
              <optgroup
                key={`broker-${keyGroup.keyIndex}-${brokerage.brokerageName}`}
                label={`  ${brokerage.displayName}`}
              >
                {brokerage.accounts && brokerage.accounts.map(account => (
                  <option
                    key={account.id}
                    value={account.id}
                  >
                    {account.person || 'Unassigned'} — {account.accountName || account.name || 'Account'}
                  </option>
                ))}
              </optgroup>
            ))}
          </optgroup>
        ))
      ) : (
        <option disabled>No accounts available</option>
      )}
    </select>
  );
};

export default AccountSelector;
