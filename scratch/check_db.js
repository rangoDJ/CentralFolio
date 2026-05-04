import Database from 'better-sqlite3';
const db = new Database('snaptrade.db');
const rows = db.prepare('SELECT * FROM portfolios').all();
console.log(JSON.stringify(rows, null, 2));
