const { DatabaseSync } = require('node:sqlite');
const path = require('path');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', '..', 'user_data');
const dbPath = path.join(DATA_DIR, 'folio.db');
const db = new DatabaseSync(dbPath);

console.log('--- Settings ---');
const settings = db.prepare('SELECT * FROM settings').all();
settings.forEach(s => {
  if (s.key.includes('SECRET') || s.key.includes('KEY')) {
    console.log(`${s.key}: [REDACTED]`);
  } else {
    console.log(`${s.key}: ${s.value}`);
  }
});

console.log('\n--- Connections ---');
const connections = db.prepare('SELECT * FROM connections').all();
console.table(connections);

console.log('\n--- Environment Keys ---');
for (let i = 1; i <= 3; i++) {
  console.log(`SNAPTRADE_CLIENT_ID_${i}: ${process.env[`SNAPTRADE_CLIENT_ID_${i}`] ? 'SET' : 'NOT SET'}`);
  console.log(`SNAPTRADE_CONSUMER_KEY_${i}: ${process.env[`SNAPTRADE_CONSUMER_KEY_${i}`] ? 'SET' : 'NOT SET'}`);
}
console.log(`SNAPTRADE_CLIENT_ID: ${process.env.SNAPTRADE_CLIENT_ID ? 'SET' : 'NOT SET'}`);
console.log(`SNAPTRADE_CONSUMER_KEY: ${process.env.SNAPTRADE_CONSUMER_KEY ? 'SET' : 'NOT SET'}`);
