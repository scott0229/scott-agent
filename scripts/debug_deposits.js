const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(process.cwd(), 'main.db');
const db = new Database(dbPath);

const rows = db.prepare('SELECT id, deposit_type, transaction_type, amount FROM DEPOSITS LIMIT 10').all();
console.log('Sample Deposits:', rows);

const distinctTypes = db.prepare('SELECT DISTINCT deposit_type FROM DEPOSITS').all();
console.log('Distinct Deposit Types:', distinctTypes);

const countByType = db.prepare('SELECT deposit_type, COUNT(*) as count FROM DEPOSITS GROUP BY deposit_type').all();
console.log('Count by Type:', countByType);
