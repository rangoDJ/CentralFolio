const fs = require('fs');
const path = require('path');
const log = require('./logger');
const mockLog = log.make('mock');

// Resolve mock_data under DATA_DIR so it lives in the Docker volume with all other user data.
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'user_data');
const mockDataFolder = path.join(DATA_DIR, 'mock_data');

function loadMockData() {
  const data = { accounts: [], positions: [] };
  
  if (!fs.existsSync(mockDataFolder)) {
    fs.mkdirSync(mockDataFolder);
    mockLog.info('Created mock_data directory', { path: mockDataFolder });
    return data;
  }

  const files = fs.readdirSync(mockDataFolder).filter(f => f.endsWith('.csv'));
  
  files.forEach((file, index) => {
    const person = path.basename(file, '.csv');
    const content = fs.readFileSync(path.join(mockDataFolder, file), 'utf-8');
    
    let totalValue = 0;
    
    const lines = content.trim().split('\n');
    if (lines.length > 1) {
      const headers = lines[0].split(',').map(h => h.trim());
      
      for (let i = 1; i < lines.length; i++) {
        if (!lines[i].trim()) continue;
        const values = lines[i].split(',');
        const pos = {};
        
        headers.forEach((header, colIndex) => {
          const val = values[colIndex] ? values[colIndex].trim() : '';
          // Retain symbol and currency as strings, cast others to numbers
          pos[header] = (header === 'symbol' || header === 'currency') || isNaN(Number(val)) || val === '' ? val : Number(val);
        });
        
        pos.holders = [person];
        
        // Accommodate currency conversions dynamically roughly for account totals
        // A hardcoded 1.40 fxRate is acceptable for mock aggregated value projection
        const fxMult = pos.currency === 'USD' ? 1.40 : 1.0;
        totalValue += (pos.shares * pos.nativePrice) * fxMult;
        
        data.positions.push(pos);
      }
    }
    
    data.accounts.push({
      id: `mock-${person.toLowerCase()}-${index}`,
      brokerage_name: 'Wealthsimple (Mock)',
      accountName: `${person} Brokerage`,
      accountNumber: `W-TFSA-${person.toUpperCase()}`,
      person: person,
      currency: 'CAD',
      value: parseFloat(totalValue.toFixed(2)),
      dayChange: 215.50, // Static simulated buffer
      dayChangePercent: 0.1,
      allocation: 0 // Will be calculated globally if needed
    });
  });

  return data;
}

module.exports = loadMockData;
